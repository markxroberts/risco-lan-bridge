import { RiscoBaseSocket, SocketOptions } from './RiscoBaseSocket';

import { Socket } from 'net';
import { logger } from './Logger';
import { WriteStream } from 'fs';
import { TypedEmitter } from 'tiny-typed-emitter';

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
        this.emit('SocketError', JSON.stringify(e as Error))
        logger.log('error', e)
        await this.disconnect(true)
      }
    })
    this.panelSocket.once('error', (error) => {
      this.emit('SocketError', JSON.stringify(error as Error))
      logger.log('error', `Socket Error: ${error}`)
      this.disconnect(true)
    })
    this.panelSocket.once('close', () => {
      this.emit('SocketError', 'Socket Closed')
      logger.log('error', `Socket Closed.`)
      this.disconnect(true)
    })
    this.panelSocket.once('timeout', () => {
      this.emit('SocketError', 'Socket Timeout')
      logger.log('error', `Socket Timeout.`)
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
          this.emit('SocketError', JSON.stringify(e as Error))
          logger.log('warn', e)
          logger.log('warn', 'Error while sending DCN command')
        }
      }
      this.panelSocket.destroy()
      logger.log('debug', `Socket Destroyed.`)
      let listenerdelay;
      listenerdelay = setTimeout(function() {
        this.panelSocket.removeAllListeners();
        this.panelSocket = undefined}, 5000)
    }
    this.isPanelSocketConnected = false
    this.emit('Disconnected', allowReconnect)
    logger.log('debug', `Socket Disconnected.`)
    return true
  }

}
