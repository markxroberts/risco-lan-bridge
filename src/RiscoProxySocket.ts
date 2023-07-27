import { Server, Socket } from 'net';
import { RiscoBaseSocket, SocketOptions } from './RiscoBaseSocket';
import { logger } from './Logger';
import { assertIsDefined } from './Assertions';
import { WriteStream } from 'fs';

export class RiscoProxyTCPSocket extends RiscoBaseSocket {

  private readonly proxyInServer: Server
  private readonly listeningPort: number
  private readonly cloudSocket: Socket

  private readonly cloudPort: number

  private readonly cloudUrl: string
  private readonly cloudSocketTimeout: number
  private readonly panelConnectionDelay: number
  private readonly cloudConnectionDelay: number


  private panelConnectTimer?: NodeJS.Timeout
  private cloudConnectionRetryTimer?: NodeJS.Timeout
  cloudConnected = false
  private isCloudSocketConnected = false
  private lastRmtId: number | null = null
  private inRemoteConn = false
  private isPanelConnecting = false

  constructor(socketOptions: SocketOptions, commandsStream: WriteStream | undefined) {
    super(socketOptions, commandsStream)
    this.listeningPort = socketOptions.listeningPort
    this.cloudSocketTimeout = 240000
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
        logger.log('error', `Cannot start Proxy ; Address already in use, retrying within 5sec...`)
        setTimeout(() => {
          this.proxyInServer.close()
          this.proxyInServer.listen(this.listeningPort)
        }, 5000)
      }
    })
    this.proxyInServer.on('connection', async (socket) => {
      try {
        logger.log('info', `Incoming connection from panel received`)
        if (this.panelSocket) {
          this.panelSocket.removeAllListeners()
          this.panelSocket.destroy()
        }
        this.panelSocket = socket
        this.isPanelSocketConnected = true
        this.panelSocket.setTimeout(this.socketTimeout)

        await this.initCloudSocket()

        this.panelSocket.once('error', (error) => {
          logger.log('error', `Panel Socket Error : ${error}`)
          this.disconnect(true)
        })

        this.panelSocket.once('close', () => {
          logger.log('error', `Panel Socket Closed.`)
          this.isPanelSocketConnected = false
          if (this.cloudConnectionRetryTimer !== undefined) {
            clearTimeout(this.cloudConnectionRetryTimer)
          }
          this.disconnect(true)
        })

        this.panelSocket.on('timeout', () => {
          logger.log('error', `Panel Socket Timeout.`)
          this.disconnect(true)
        })

        this.panelSocket.on('data', (data) => {
          this.newDataFromPanelSocket(data)
        })
        await this.maybeConnectPanel()
      } catch (err) {
        logger.log('error', `RiscoCloud Socket Error : ${err}`)
      }
    })
    this.proxyInServer.on('listening', () => {
      const ProxyInfo = this.proxyInServer.address()
      if (typeof ProxyInfo == 'string') {
        logger.log('info', `Listening on ${ProxyInfo}`)
      } else {
        logger.log('info', `Listening on IP ${ProxyInfo?.address} and Port ${ProxyInfo?.port}`)
      }
      logger.log('info', `Waiting for panel incoming connection... This can take up to 1 or 2 minutes`)
    })
    if (!this.proxyInServer.listening) {
      this.proxyInServer.listen(this.listeningPort)
    }
    return true
  }

  private async initCloudSocket(): Promise<boolean> {
    return new Promise((resolve) => {
      this.cloudSocket.removeAllListeners()
      this.cloudSocket.setTimeout(this.cloudSocketTimeout)
      this.cloudSocket.on('error', (error) => {
        logger.log('debug', `RiscoCloud socket error: ${error}`)
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        if (error.code === 'ECONNREFUSED') {
          logger.log('error', `RiscoCloud socket connection error: ${error}`)
          this.cloudConnectionRetryTimer = setTimeout(() => {
            this.cloudSocket.connect(this.cloudPort, this.cloudUrl)
          }, this.cloudConnectionDelay)
        } else {
          this.cloudSocket.destroy(error)
        }
      })
      this.cloudSocket.on('ready', async () => {
        logger.log('info', `RiscoCloud Socket: ready`)
        this.isCloudSocketConnected = true
        resolve(true)
        await this.maybeConnectPanel()
      })
      this.cloudSocket.on('connect', () => {
        logger.log('debug', `RiscoCloud Socket: connect`)
        if (this.cloudConnectionRetryTimer !== undefined) {
          clearTimeout(this.cloudConnectionRetryTimer)
        }
      })
      this.cloudSocket.on('close', () => {
        this.isCloudSocketConnected = false
        if (!this.disconnecting) {
          logger.log('error', `RiscoCloud Socket: close. Retrying within ${this.cloudConnectionDelay} ms`)
          this.cloudConnectionRetryTimer = setTimeout(() => {
            this.cloudSocket.connect(this.cloudPort, this.cloudUrl)
          }, this.cloudConnectionDelay)
        } else {
          logger.log('info', `RiscoCloud Socket: close`)
        }
      })
      this.cloudSocket.on('timeout', () => {
        logger.log('error', `RiscoCloud Socket Timeout.`)
      })
      this.cloudSocket.on('data', (data) => {
        this.newDataFromCloudSocket(data)
      })
      this.cloudSocket.connect(this.cloudPort, this.cloudUrl)
    })

  }

  async maybeConnectPanel() {
    if (this.isCloudSocketConnected && this.isPanelSocketConnected && !this.isPanelConnected && !this.isPanelConnecting) {
      logger.log('info', `Setting a timer for panel connection in ${this.panelConnectionDelay} ms`)
      this.isPanelConnecting = true
      if (this.panelConnectTimer) {
        clearTimeout(this.panelConnectTimer)
      }
      this.panelConnectTimer = setTimeout(async () => {
        this.isPanelConnecting = false
        if (this.isPanelSocketConnected) {
          await this.panelConnect()
        }
        else {
          logger.log('warn', `Panel Socket not connected, aborting panel connection sequence`)
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
        logger.log('debug', `[Panel => Cloud] Forwarding panel packet to cloud: ${stringedBuffer}`)
        if (this.isCloudSocketConnected) {
          this.cloudSocket.write(new_output_data)
        } else {
          logger.log('warn', `[Panel => Cloud] Cloud socket not connected, discarding packet: ${stringedBuffer}`)
        }
        break
      }
      case 17: {
        logger.log('debug', `[Panel => Bridge] Received encrypted data Buffer from Panel : ${stringedBuffer}`)
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
        logger.log('debug', `[Panel => Bridge] Received unencrypted data Buffer from Panel : ${stringedBuffer}`)
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
        logger.log('debug', `[Cloud => Panel] Forwarding Cloud data Buffer to panel: ${dataBufferAsString}`)
        // logger.log('debug', `Assuming connected in 45 seconds, don't know why...`);
        this.panelSocket.write(new_input_data)
        this.emit('CloudConnected')
        break
      }
      case 17: {
        const [cmdId, cmdStr, crcOK] = this.rCrypt.decodeMessage(new_input_data)
        logger.log('info', `${cmdId} ${cmdStr} ${crcOK}`)
        logger.log('debug', `[Cloud => Panel] Forwarding encrypted Cloud data Buffer to panel: ${dataBufferAsString}`)
        this.panelSocket.write(new_input_data)
        if (this.inRemoteConn && crcOK && cmdStr.includes('DCN')) {
          this.inRemoteConn = false
          const FakeResponse = this.rCrypt.getCommandBuffer('ACK', this.lastRmtId || -1, true)
          logger.log('debug', `Send Fake Response to RiscoCloud Socket : ${this.bufferAsString(FakeResponse)}`)
          this.cloudSocket.write(FakeResponse)
          this.emit('EndIncomingRemoteConnection')
        }
        break
      }
      default: {
        const [cmdId, cmdStr, crcOK] = this.rCrypt.decodeMessage(new_input_data)
        logger.log('info', `${cmdId} ${cmdStr} ${crcOK}`)
        logger.log('debug', `[Cloud => Panel] Forwarding unencrypted Cloud data Buffer from RiscoCloud : ${dataBufferAsString}`)
        switch (true) {
          case (cmdStr.includes('RMT=')):
            this.emit('IncomingRemoteConnection')
            this.inRemoteConn = true
            if (this.isPanelSocketConnected) {
              const rmtPassword = cmdStr.substring(cmdStr.indexOf('=') + 1)
              if (parseInt(rmtPassword, 10) === parseInt(this.socketOptions.panelPassword, 10)) {
                const fakeResponse = this.rCrypt.getCommandBuffer('ACK', this.lastRmtId || -1, false)
                logger.log('debug', `Send Fake Response to RiscoCloud Socket : ${this.bufferAsString(fakeResponse)}`)
                this.cloudSocket.write(fakeResponse)
              }
            } else {
              this.panelSocket.write(new_input_data)
            }
            break
          case (cmdStr.includes('LCL')):
            if (this.isPanelSocketConnected) {
              const fakeResponse = this.rCrypt.getCommandBuffer('ACK', this.lastRmtId || -1, false)
              logger.log('debug', `Send Fake Response to RiscoCloud Socket : ${this.bufferAsString(fakeResponse)}`)
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
    this.disconnecting = true
    this.proxyInServer.close()
    if (this.panelSocket !== undefined && !this.panelSocket.destroyed) {
      if (this.isPanelSocketConnected) {
        try {
          await this.sendCommand('DCN')
        } catch (e) {
          logger.log('warn', e)
          logger.log('warn', 'Error while sending DCN command')
        }
      }
      this.panelSocket.removeAllListeners()
      this.panelSocket.destroy()
      this.panelSocket = undefined
      logger.log('debug', `Socket Destroyed.`)
    }
    if (this.cloudSocket !== undefined && !this.cloudSocket.destroyed) {
      this.cloudSocket.destroy()
      this.cloudSocket.removeAllListeners()
      logger.log('debug', `RiscoCloud Socket Destroyed.`)
    }
    this.isPanelConnected = this.cloudConnected = this.isCloudSocketConnected = this.isPanelSocketConnected = false
    this.emit('Disconnected', allowReconnect)
    this.emit('CloudDisconnected')
    return true
  }
}
