import { Server, Socket } from 'net';
import { RiscoBaseSocket, SocketOptions } from './RiscoBaseSocket';
import { logger } from './Logger';
import { assertIsDefined } from './Assertions';
import { WriteStream } from 'fs';

export class RiscoProxyTCPSocket extends RiscoBaseSocket {

  private readonly proxyInServer: Server
  private readonly listeningPort: number
  private cloudSocket: Socket

  private readonly cloudPort: number

  private readonly cloudUrl: string
  private readonly cloudSocketTimeout: number
  private readonly panelConnectionDelay: number
  private readonly cloudConnectionDelay: number


  private panelConnectTimer?: NodeJS.Timeout
  private cloudConnectionRetryTimer?: NodeJS.Timeout
  private cloudHasConnected = false
  private cloudConnected = false
  private isCloudSocketConnected = false
  private lastRmtId: number | null = null
  private inRemoteConn = false
  private isPanelConnecting = false

  constructor(socketOptions: SocketOptions, commandsStream: WriteStream | undefined) {
    super(socketOptions, commandsStream)
    this.listeningPort = socketOptions.listeningPort
    this.cloudSocketTimeout = 120000
    this.cloudConnectionRetryTimer = undefined
    this.cloudPort = socketOptions.cloudPort
    this.cloudUrl = socketOptions.cloudUrl
    this.panelConnectionDelay = socketOptions.panelConnectionDelay
    this.cloudConnectionDelay = socketOptions.cloudConnectionDelay
    this.cloudSocket = new Socket()
    this.proxyInServer = new Server()
    // Accept only 1 connections at the same time
    this.proxyInServer.maxConnections = 1
  }

  /*
   * Create TCP Connection
   * @return  {Promise}
   */
  async connect(): Promise<boolean> {
    this.proxyInServer.removeAllListeners()
    this.proxyInServer.on('error', (err) => {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      if (err.code === 'EADDRINUSE') {
        logger.log('error', `[RLB] Cannot start Proxy.  Address already in use, retrying within 5sec...`)
        setTimeout(() => {
          this.proxyInServer.close()
          this.proxyInServer.listen(this.listeningPort)
        }, 5000)
      }
    })
    this.proxyInServer.on('connection', async (socket) => {
      try {
        logger.log('info', `[RLB] Incoming connection from panel received`)
        if (this.panelSocket) {
          this.panelSocket.removeAllListeners()
          this.panelSocket.destroy()
        }
        this.panelSocket = socket
        this.isPanelSocketConnected = true
        this.panelSocket.setTimeout(this.socketTimeout)

        // Keep registration data buffered until the cloud can receive it, but
        // install close/error handlers immediately while the cloud is offline.
        socket.pause()
        socket.setTimeout(0)
        this.cloudHasConnected = false

        this.panelSocket.once('error', (error) => {
          if (this.disconnecting || this.panelSocket !== socket) return
          this.emit('SocketError', JSON.stringify(error))
          logger.log('error', `[RLB] Panel Socket Error: ${error}`)
          this.disconnect(true)
        })

        this.panelSocket.once('close', () => {
          if (this.disconnecting || this.panelSocket !== socket) return
          this.emit('SocketError', 'Panel socket closed')
          logger.log('error', `[RLB] Panel Socket Closed.`)
          this.isPanelSocketConnected = false
          if (this.cloudConnectionRetryTimer !== undefined) {
            clearTimeout(this.cloudConnectionRetryTimer)
          }
          this.disconnect(true)
        })

        this.panelSocket.on('timeout', () => {
          if (this.disconnecting || this.panelSocket !== socket) return
          this.emit('SocketError', 'Panel socket timeout')
          logger.log('error', `[RLB] Panel Socket Timeout.`)
          this.disconnect(true)
        })

        this.panelSocket.on('data', (data) => {
          this.newDataFromPanelSocket(data)
        })
        this.initCloudSocket()
      } catch (err) {
        this.emit('SocketError', JSON.stringify(err as Error))
        logger.log('error', `[RLB] RiscoCloud Socket Error : ${err}`)
      }
    })
    this.proxyInServer.on('listening', () => {
      const ProxyInfo = this.proxyInServer.address()
      if (typeof ProxyInfo == 'string') {
        logger.log('info', `[RLB] Listening on ${ProxyInfo}`)
      } else {
        logger.log('info', `[RLB] Listening on IP ${ProxyInfo?.address} and Port ${ProxyInfo?.port}`)
      }
      logger.log('info', `[RLB] Waiting for panel incoming connection... This can take up to 1 or 2 minutes`)
    })
    if (!this.proxyInServer.listening) {
      this.proxyInServer.listen(this.listeningPort)
    }
    return true
  }

  private clearConnectionTimers() {
    if (this.cloudConnectionRetryTimer !== undefined) clearTimeout(this.cloudConnectionRetryTimer)
    if (this.panelConnectTimer !== undefined) clearTimeout(this.panelConnectTimer)
    this.cloudConnectionRetryTimer = this.panelConnectTimer = undefined
    this.isPanelConnecting = false
  }

  private retryCloudConnection() {
    if (this.disconnecting || !this.isPanelSocketConnected || this.cloudConnectionRetryTimer !== undefined) return
    logger.log('info', `[RLB] Cloud unavailable. Keeping panel socket; retrying cloud in ${this.cloudConnectionDelay} ms`)
    this.cloudConnectionRetryTimer = setTimeout(() => {
      this.cloudConnectionRetryTimer = undefined
      if (!this.disconnecting && this.isPanelSocketConnected) this.initCloudSocket()
    }, this.cloudConnectionDelay)
  }

  private initCloudSocket(): void {
    if (this.disconnecting || !this.isPanelSocketConnected) return
    this.cloudSocket.removeAllListeners()
    this.cloudSocket.destroy()
    const cloud = this.cloudSocket = new Socket()
    // Bound an unreachable TCP connect; preserve the existing idle timeout once ready.
    cloud.setTimeout(30000)
    cloud.on('error', (error) => {
      if (this.disconnecting || this.cloudSocket !== cloud) return
      logger.log('error', `[RLB] RiscoCloud socket error (${this.cloudUrl}:${this.cloudPort}): ${error.message}`)
      this.emit('SocketError', `Cloud socket error: ${error.message}`)
      cloud.destroy()
    })
    cloud.on('ready', () => {
      if (this.disconnecting || this.cloudSocket !== cloud || !this.isPanelSocketConnected) return
      logger.log('info', '[RLB] RiscoCloud Socket: ready')
      this.cloudHasConnected = this.isCloudSocketConnected = true
      cloud.setTimeout(this.cloudSocketTimeout)
      this.panelSocket?.setTimeout(this.socketTimeout)
      this.panelSocket?.resume()
      this.maybeConnectPanel()
    })
    cloud.on('close', () => {
      if (this.disconnecting || this.cloudSocket !== cloud) return
      this.isCloudSocketConnected = false
      this.emit('SocketError', 'RiscoCloud socket closed')
      if (!this.cloudHasConnected) {
        // No cloud session exists yet: restarting the panel only adds its retry delay.
        this.retryCloudConnection()
      } else {
        // A live cloud session may have changed the panel's protocol state.
        // Re-establish both sides rather than assuming a new cloud login is safe.
        this.disconnect(true)
      }
    })
    cloud.on('timeout', () => {
      if (this.disconnecting || this.cloudSocket !== cloud) return
      logger.log('error', '[RLB] RiscoCloud socket timeout; closing failed connection')
      this.emit('SocketError', 'Cloud socket timeout')
      cloud.destroy()
    })
    cloud.on('data', (data) => {
      if (!this.disconnecting && this.cloudSocket === cloud) this.newDataFromCloudSocket(data)
    })
    cloud.connect(this.cloudPort, this.cloudUrl)
  }

  async maybeConnectPanel() {
    if (!this.disconnecting && this.isCloudSocketConnected && this.isPanelSocketConnected && !this.isPanelConnected && !this.isPanelConnecting) {
      logger.log('info', `[RLB] Setting a timer for panel connection in ${this.panelConnectionDelay} ms`)
      this.isPanelConnecting = true
      if (this.panelConnectTimer) {
        clearTimeout(this.panelConnectTimer)
      }
      this.panelConnectTimer = setTimeout(async () => {
        this.isPanelConnecting = false
        this.panelConnectTimer = undefined
        if (!this.disconnecting && this.isCloudSocketConnected && this.isPanelSocketConnected) {
          await this.panelConnect()
        }
        else {
          logger.log('warn', `[RLB] Panel Socket not connected, aborting panel connection sequence`)
        }
          // setTimeout(() => {
          //   this.panelSocket?.destroy(new Error('Fake panel error event'))
          // }, 30000)
          //
          // setTimeout(() => {
          //   this.cloudSocket?.destroy(new Error('Fake cloud error event'))
          // }, 20000)
        }, this.panelConnectionDelay
      )
    }
  }

  /*
   * Handle new data Received on Panel Socket Side
   * @param   {Buffer}
   */
  async newDataFromPanelSocket(new_output_data: Buffer) {
    const stringedBuffer = this.bufferAsString(new_output_data)
    switch (new_output_data[1]) {
      case 19: {
        // let DecryptedBuffer = Buffer.from(new_output_data, this.encoding).toString(this.encoding);
        logger.log('debug', `[RLB][Panel => Cloud] Forwarding panel packet to cloud: ${stringedBuffer}`)
        if (this.isCloudSocketConnected) {
          this.cloudSocket.write(new_output_data)
        } else {
          logger.log('warn', `[RLB][Panel => Cloud] Cloud socket not connected, discarding packet: ${stringedBuffer}`)
        }
        break
      }
      case 17: {
        logger.log('debug', `[RLB][Panel => Bridge] Received encrypted data Buffer from Panel : ${stringedBuffer}`)
        // if (this.inRemoteConn) {
        //   // To be able to correctly intercept the end of the remote connection, we must be able to decrypt
        //   // the commands exchanged between the control panel and the RiscoCloud as soon as possible.
        //   // As soon as a frame is long enough, we will check if we decode it correctly and if not we look
        //   // for the decryption key.
        //   let [RmtId, RmtCommandStr, RmtIsCRCOK] = this.rCrypt.decodeMessage(Buffer.from(new_output_data))
        //   if (!RmtIsCRCOK && (new_output_data.length > 90) && !this.inCryptTest) {
        //     setTimeout(() => {
        //       this.inCryptTest = true
        //       let PossibleKey = 9999
        //       let TestResultOk = false
        //       do {
        //         // Because the Buffer is modified by reference during decryption, a new Buffer is created on each attempt.
        //         const TestBufferData = Buffer.from(new_output_data)
        //         this.rCrypt.updatePanelId(PossibleKey);
        //         [RmtId, RmtCommandStr, RmtIsCRCOK] = this.rCrypt.decodeMessage(TestBufferData)
        //         TestResultOk = (() => {
        //           if (RmtIsCRCOK) {
        //             logger.log('debug', `Panel Id is possible candidate : ${PossibleKey}`)
        //             this.inCryptTest = false
        //             return true
        //           } else {
        //             logger.log('debug', `Panel Id is not : ${PossibleKey}`)
        //             PossibleKey--
        //             return false
        //           }
        //         })()
        //       } while ((PossibleKey >= 0) && !TestResultOk)
        //     }, 50)
        //   }
        //   if (RmtId === this.lastRmtId) {
        //     this.cloudSocket.write(new_output_data)
        //   }
        //   if (RmtCommandStr.includes('STT')) {
        //     await this.newDataHandler(new_output_data)
        //   }
        // } else {
        await this.newDataHandler(new_output_data)
        // }
        break
      }
      default: {
        // if (this.inRemoteConn) {
        //   logger.log('debug', `[Panel => Bridge] Received unencrypted data Buffer from Panel : ${stringedBuffer}`)
        //   this.cloudSocket.write(new_output_data)
        // } else {
        logger.log('debug', `[RLB][Panel => Bridge] Received unencrypted data Buffer from Panel : ${stringedBuffer}`)
        await this.newDataHandler(new_output_data)
        // }
      }
    }
  }

  /**
   * Handle new data received on Cloud Socket side
   */
  newDataFromCloudSocket(new_input_data: Buffer) {
    assertIsDefined(this.panelSocket, 'panelSocket')
    const dataBufferAsString = this.bufferAsString(new_input_data)

    switch (new_input_data[1]) {
      case 19: {
        this.cloudConnected = true
        logger.log('debug', `[RLB][Cloud => Panel] Forwarding Cloud data Buffer to panel: ${dataBufferAsString}`)
        // logger.log('debug', `Assuming connected in 45 seconds, don't know why...`);
        this.panelSocket.write(new_input_data)
        break
      }
      case 17: {
        const [cmdId, cmdStr, crcOK] = this.rCrypt.decodeMessage(new_input_data)
        logger.log('info', `${cmdId} ${cmdStr} ${crcOK}`)
        logger.log('debug', `[RLB][Cloud => Panel] Forwarding encrypted Cloud data Buffer to panel: ${dataBufferAsString}`)
        this.panelSocket.write(new_input_data)
        if (this.inRemoteConn && crcOK && cmdStr.includes('DCN')) {
          this.inRemoteConn = false
          const FakeResponse = this.rCrypt.getCommandBuffer('ACK', this.lastRmtId || -1, true)
          logger.log('debug', `[RLB] Send Fake Response to RiscoCloud Socket : ${this.bufferAsString(FakeResponse)}`)
          this.cloudSocket.write(FakeResponse)
          this.emit('EndIncomingRemoteConnection')
        }
        break
      }
      default: {
        const [cmdId, cmdStr, crcOK] = this.rCrypt.decodeMessage(new_input_data)
        logger.log('info', `${cmdId} ${cmdStr} ${crcOK}`)
        logger.log('debug', `[RLB][Cloud => Panel] Forwarding unencrypted Cloud data Buffer from RiscoCloud : ${dataBufferAsString}`)
        switch (true) {
          case (cmdStr.includes('RMT=')):
            this.emit('IncomingRemoteConnection')
            this.inRemoteConn = true
            if (this.isPanelSocketConnected) {
              const rmtPassword = cmdStr.substring(cmdStr.indexOf('=') + 1)
              if (parseInt(rmtPassword, 10) === parseInt(this.socketOptions.panelPassword, 10)) {
                const fakeResponse = this.rCrypt.getCommandBuffer('ACK', this.lastRmtId || -1, false)
                logger.log('debug', `[RLB] Send Fake Response to RiscoCloud Socket : ${this.bufferAsString(fakeResponse)}`)
                this.cloudSocket.write(fakeResponse)
              }
            } else {
              this.panelSocket.write(new_input_data)
            }
            break
          case (cmdStr.includes('LCL')):
            if (this.isPanelSocketConnected) {
              const fakeResponse = this.rCrypt.getCommandBuffer('ACK', this.lastRmtId || -1, false)
              logger.log('debug', `[RLB] Send Fake Response to RiscoCloud Socket : ${this.bufferAsString(fakeResponse)}`)
              this.cloudSocket.write(fakeResponse)
            } else {
              this.panelSocket.write(new_input_data)
            }
            break
          default:
            this.panelSocket.write(new_input_data)
            break
        }
      }
    }
  }


  /*
   * Disconnects the Socket and stops the WatchDog function
   */
  async disconnect(allowReconnect: boolean): Promise<boolean> {
    if (this.disconnecting) return true
    this.disconnecting = true
    this.clearConnectionTimers()
    if (this.proxyInServer.listening) this.proxyInServer.close()
    const panel = this.panelSocket
    const cloud = this.cloudSocket
    // DCN is meaningful only after local authentication. An unauthenticated
    // panel cannot answer it and used to add another command timeout per retry.
    if (panel && !panel.destroyed && this.isPanelConnected && this.isPanelSocketConnected) {
      try {
        await this.sendCommand('DCN')
      } catch (e) {
        logger.log('warn', e)
        logger.log('warn', '[RLB] Error while sending DCN command')
      }
    }
    if (panel) {
      panel.removeAllListeners()
      panel.on('error', () => { /* Ignore errors from a socket being destroyed. */ })
      panel.destroy()
    }
    cloud.removeAllListeners()
    cloud.on('error', () => { /* Ignore errors from a socket being destroyed. */ })
    cloud.destroy()
    this.panelSocket = undefined
    this.isPanelConnected = this.cloudConnected = this.isCloudSocketConnected = this.isPanelSocketConnected = false
    this.emit('Disconnected', allowReconnect)
    return true
  }
}
