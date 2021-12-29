import { RiscoBaseSocket, SocketOptions } from './RiscoBaseSocket'

import { Socket } from 'net'
import { logger } from './Logger'
import { RiscoCrypt } from './RiscoCrypt'

export class RiscoDirectTCPSocket extends RiscoBaseSocket {

  constructor(socketOptions: SocketOptions, rcrypt: RiscoCrypt) {
    super(socketOptions, rcrypt)
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
      await this.panelConnect()
    })
    this.panelSocket.once('error', (err) => {
      logger.log('error', `Socket Error : ${err}`)
      this.disconnect(true)
    })
    this.panelSocket.once('close', () => {
      logger.log('error', `Socket Closed.`)
      this.disconnect(true)
    })
    this.panelSocket.once('timeout', () => {
      logger.log('error', `Socket Timeout.`)
      this.disconnect(true)
    })
    this.panelSocket.on('data', (inputData: Buffer) => {
      this.newDataHandler(inputData)
    })
    this.panelSocket.connect(this.panelPort, this.panelIp)
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
      if (this.watchDogTimer) {
        clearTimeout(this.watchDogTimer)
      }

      if (this.isPanelSocketConnected) {
        await this.sendCommand('DCN')
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
