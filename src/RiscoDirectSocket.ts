import { RiscoBaseSocket, SocketOptions } from './RiscoBaseSocket'

import { Socket } from 'net'
import { logger } from './Logger'
import { assertIsTrue } from './Assertions'
import { RiscoCrypt } from './RiscoCrypt'

export class RiscoDirectTCPSocket extends RiscoBaseSocket {

  constructor(socketOptions: SocketOptions, rcrypt: RiscoCrypt) {
    super(socketOptions, rcrypt)
    this.socketTimeout = 30000
  }

  /*
   * Create TCP Connection
   * @return  {Promise}
   */
  override async connect(): Promise<boolean> {
    this.socket = new Socket()
    this.socket.setTimeout(this.socketTimeout)

    this.socket.once('ready', async () => {
      this.isConnected = true
      logger.log('verbose', `Socket Connected.`)
      await this.panelConnect()
    })
    this.socket.once('error', (err) => {
      logger.log('error', `Socket Error : ${err}`)
      this.disconnect(true)
    })
    this.socket.once('close', () => {
      logger.log('error', `Socket Closed.`)
      this.disconnect(true)
    })
    this.socket.once('timeout', () => {
      logger.log('error', `Socket Timeout.`)
      this.disconnect(true)
    })
    this.socket.on('data', (inputData: Buffer) => {
      this.newDataHandler(inputData)
    })
    this.socket.connect(this.panelPort, this.panelIp)
    return true
  }

  /*
   * Panel connection mechanism.
   * Send command RMT + Connection password
   * Send LCL command
   * After this point, the data is encrypted.
   * @param   {Integer}   code length (between 1-6)
   * @return  {Boolean}   true/false if connected or not
   */
  private async panelConnect(codeLength = 4): Promise<boolean> {
    if (!this.isConnected) {
      await this.connect()
      // Wait 100ms for avoid slow connections
      await new Promise(r => setTimeout(r, 100))
    }
    assertIsTrue(this.isConnected, 'IsConnected', 'Socket failed to connect after 100ms delay')

    logger.log('verbose', `Authenticating to the panel`)
    const rmtResponse = await this.sendCommand(`RMT=${this.panelPassword.toString().padStart(codeLength, '0')}`)
    let authenticationOk = false
    if (!rmtResponse.includes('ACK')) {
      logger.log('warn', `Provided password is incorrect`)
      if (this.isErrorCode(rmtResponse) && !this.disconnecting) {
        if (this.guessPasswordAndPanelId) {
          logger.log('info', `Trying to guess password (brut force)`)
          this.inPasswordGuess = true
          const foundPassword = await this.guessPassword()
          this.inPasswordGuess = false
          if (foundPassword !== null) {
            logger.log('info', `Discovered Access Code : ${foundPassword}`)
            this.panelPassword = foundPassword
            authenticationOk = true
          } else {
            logger.log('error', `Unable to discover password`)
          }
        } else {
          logger.log('error', `Password discovery is disabled`)
        }
      }
      if (!authenticationOk) {
        logger.log('error', `Not able to authenticate to the Panel, exiting`)
        await this.disconnect(false)
        return false
      }
    }
    let panelConnected: boolean;
    if (await this.getAckResult(`LCL`)) {
      // Now, Encrypted channel is enabled
      this.rCrypt.cryptCommands = true
      logger.log('verbose', `Setting up encryption using Panel Id`)
      await new Promise(r => setTimeout(r, 1000))
      this.inCryptTest = true
      const testerResult = await this.cryptTableTester()
      let cryptResult = testerResult[0];
      const cryptedResponseBuffer = testerResult[1];
      if (!this.cryptKeyValidity) {
        logger.log('warn', `Bad Panel Id: ${this.rCrypt.panelId}. Trying to find the right one`)
        let possibleKey = 9999
        do {
          let isPossibleKey = false
          do {
            // Because the Buffer is modified by reference during decryption, a new Buffer is created on each attempt.
            const testBufferData = Buffer.alloc(cryptedResponseBuffer.length)
            cryptedResponseBuffer.copy(testBufferData)
            this.rCrypt.updatePanelId(possibleKey)
            const [receivedId, receivedCommandStr, isCRCOK] = this.rCrypt.DecodeMessage(testBufferData)
            if (receivedId == null && this.isErrorCode(receivedCommandStr) && isCRCOK) {
              logger.log('info', `Panel Id is possible candidate : ${possibleKey}`)
              isPossibleKey = true
            } else {
              logger.log('debug', `Panel Id is not: ${possibleKey}`)
              isPossibleKey = false
            }
            possibleKey--
          } while (possibleKey >= 0 && !isPossibleKey);

          if (isPossibleKey) {
            [cryptResult] = await this.cryptTableTester()
            if (cryptResult) {
              this.inCryptTest = false
              logger.log('info', `Discovered Panel Id: ${this.rCrypt.panelId}`)
              await new Promise(r => setTimeout(r, 1000))
            } else {
              logger.log('info', `Panel Id ${this.rCrypt.panelId} is incorrect`)
            }
          } else if (possibleKey < 0) {
            logger.log('error', `No remaining possible Panel Id, abandon`)
            this.inCryptTest = false
          }
        } while (this.inCryptTest)
        // Empty buffer socket???
        await new Promise(r => setTimeout(r, 2000))
      }
      this.inCryptTest = false
      panelConnected = cryptResult
    } else {
      panelConnected = false
    }

    if (panelConnected) {
      logger.log('verbose', `Connection to the control panel successfully established.`)
      this.isConnected = true
      this.emit('PanelConnected')
    } else {
      logger.log('error', `Unable to connect to the control panel.`)
      await this.disconnect(false)
    }
    return panelConnected
  }

  /*
   * Disconnects the Socket and stops the WatchDog function
   */
  async disconnect(allowReconnect: boolean): Promise<boolean> {
    if (this.disconnecting) {
      return true
    }
    this.disconnecting = true
    this.emit('Disconnected', allowReconnect)
    if ((this.socket !== undefined) && (!this.socket.destroyed)) {
      if (this.watchDogTimer) {
        clearTimeout(this.watchDogTimer)
      }

      await this.sendCommand('DCN')
      this.socket.destroy()
      logger.log('debug', `Socket Destroyed.`)
      this.socket.removeAllListeners()
      this.socket = undefined
    }
    this.isConnected = false
    logger.log('debug', `Socket Disconnected.`)
    return true
  }

  private async guessPassword(maxLength = 6): Promise<string | null> {
    logger.log('debug', `Password is incorrect, trying to guess it`)
    let foundPassword: string | null = null
    if (maxLength >= 4) {
      // Starting with 4 digits, as it is the most common password size
      foundPassword = await this.guessPasswordForLength(4)
      if (foundPassword) {
        return foundPassword
      }
    }
    let length = 1
    do {
      if (length !== 4) {
        foundPassword = await this.guessPasswordForLength(length)
        if (foundPassword) {
          return foundPassword
        }
      }
      length++
    } while (length <= maxLength)
    return null
  }

  private async guessPasswordForLength(length: number): Promise<string | null> {
    const maxValueForLength = Math.pow(10, length) - 1;
    let passwordAttempt = 0
    logger.log('info', `Trying passwords from ` + passwordAttempt.toString().padStart(length, '0') + ' to ' + maxValueForLength.toString().padStart(length, '0') + '...')
    do {
      const paddedPwd = passwordAttempt.toString().padStart(length, '0')
      if (passwordAttempt % 100 == 0) {
        logger.log('info', `${paddedPwd} to ${(passwordAttempt+99).toString().padStart(length, '0')}...`)
      }
      const rmtSuccess = await this.getAckResult(`RMT=${paddedPwd}`)
      if (rmtSuccess) {
        return paddedPwd
      }
      passwordAttempt++
    } while (passwordAttempt <= maxValueForLength)
    return null
  }

}
