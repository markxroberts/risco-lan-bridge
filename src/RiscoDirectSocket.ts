import { RiscoBaseSocket, SocketOptions } from './RiscoBaseSocket';

import { Socket } from 'net';
import { logger } from './Logger';
import { WriteStream } from 'fs';

export class RiscoDirectTCPSocket extends RiscoBaseSocket {

  constructor(socketOptions: SocketOptions, commandsStream: WriteStream | undefined) {
    super(socketOptions, commandsStream)
  }

  /*
   * Create TCP Connection
   * @return  {Promise}
   */
  override async connect(): Promise<boolean> {
    this.disconnecting = false;
    this.panelSocket = new Socket()
    this.panelSocket.setTimeout(this.socketTimeout)

    this.panelSocket.once('ready', async () => {
      this.isPanelSocketConnected = true
      logger.log('verbose', `Socket Connected, log in to panel`)
      try {
        await this.panelConnect()
      } catch (e) {
        logger.log('error', e)
        this.emit('SocketError', (e as Error).toString())
        await this.disconnect(true)
      }
    })
    this.panelSocket.once('error', (err) => {
      logger.log('error', `New Socket Error : ${err}`)
      this.emit('SocketError', err.toString())
      this.disconnect(true)
    })
    this.panelSocket.once('close', () => {
      logger.log('error', `Socket Closed.`)
      this.emit('SocketError', 'Socket Closed')
      this.disconnect(true)
    })
    this.panelSocket.once('timeout', () => {
      logger.log('error', `Socket Timeout.`)
      this.emit('SocketError', 'Socket Timeout')
      this.disconnect(true)
    })
    this.panelSocket.on('data', (inputData: Buffer) => {
      this.newDataHandler(inputData)
    })
    this.panelSocket.connect(this.socketOptions.panelPort, this.socketOptions.panelIp)
    return true
  }

  /*
   * Disconnects the Socket and stops the WatchDog function
   */
  async disconnect(allowReconnect: boolean): Promise<boolean> {
    if (this.disconnecting) {
      return true
    }
    this.disconnecting = true
    if (this.panelSocket !== undefined && !this.panelSocket.destroyed) {
      if (this.isPanelSocketConnected) {
        try {
          await this.sendCommand('DCN', false, false)
        } catch (e) {
          logger.log('warn', e)
          logger.log('warn', 'Error while sending DCN command')
          this.emit('SocketError', (e as Error).toString())
        }
      }
      this.panelSocket.destroy()
      logger.log('debug', `Socket Destroyed.`)
      this.panelSocket.removeAllListeners()
      this.panelSocket = undefined
    }
    this.isPanelSocketConnected = false
    this.emit('Disconnected', allowReconnect)
    logger.log('debug', `Socket Disconnected.`)
    return true
  }

}
