/* 
 *  Package: risco-lan-bridge
 *  File: RiscoChannels.js
 *  
 *  MIT License
 *  
 *  Copyright (c) 2021 TJForc
 *  
 *  Permission is hereby granted, free of charge, to any person obtaining a copy
 *  of this software and associated documentation files (the "Software"), to deal
 *  in the Software without restriction, including without limitation the rights
 *  to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 *  copies of the Software, and to permit persons to whom the Software is
 *  furnished to do so, subject to the following conditions:
 *  
 *  The above copyright notice and this permission notice shall be included in all
 *  copies or substantial portions of the Software.
 *  
 *  THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 *  IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 *  FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 *  AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 *  LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 *  OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 *  SOFTWARE.
 */

'use strict'

import { Socket } from 'net'
import { RiscoError } from './constants'
import { EventEmitter } from 'events'
import { logger } from './Logger'
import { assertIsDefined, assertIsFalse, assertIsTrue } from './Assertions'
import { RiscoCrypt } from './RiscoCrypt'
import { TypedEmitter } from 'tiny-typed-emitter'

interface RiscoSocketEvents {
  'BadCRCLimit': () => void
  'BadCRCData': () => void
  'DataReceived': (cmdId: number | null, command: string) => void
  'DataSent': (sequenceId: number, command: string) => void
  'Disconnected': (allowReconnect: boolean) => void
  'PanelConnected': () => void
  'IncomingRemoteConnection': () => void
  'EndIncomingRemoteConnection': () => void
}

export interface SocketOptions {
  listeningPort: number,
  panelIp: string,
  panelPort: number,
  guessPasswordAndPanelId: boolean,
  panelPassword: string,
  encoding: string,
  cloudUrl: string,
  cloudPort: number,
  panelConnectionDelay: number,
  socketMode: SocketMode
}


export type SocketMode = 'direct' | 'proxy'

export abstract class RiscoBaseSocket extends TypedEmitter<RiscoSocketEvents> {

  protected panelIp: string
  protected panelPort: number
  protected panelPassword: string
  protected guessPasswordAndPanelId: boolean
  protected socketTimeout: number
  protected socketMode: SocketMode

  panelSocket: Socket | undefined

  isPanelSocketConnected = false
  isPanelConnected = false;
  inProg = false
  inCryptTest = false
  inPasswordGuess = false
  protected disconnecting = false

  protected sequenceId = 1
  protected watchDogTimer?: NodeJS.Timeout
  private badCRCTimer?: NodeJS.Timeout
  private badCRCCount = 0
  private badCRCLimit = 10
  private lastReceivedBuffer?: Buffer
  private lastReceivedId: number | null = null
  private lastMisunderstoodData?: string
  protected cryptKeyValidity = false

  protected commandResponseEmitter = new EventEmitter()

  protected constructor(socketOptions: SocketOptions, protected rCrypt: RiscoCrypt) {
    super()
    this.socketMode = socketOptions.socketMode

    this.panelIp = socketOptions.panelIp
    this.panelPort = socketOptions.panelPort
    this.panelPassword = socketOptions.panelPassword
    this.guessPasswordAndPanelId = socketOptions.guessPasswordAndPanelId
    this.socketTimeout = 30000
  }

  abstract connect(): Promise<boolean>

  abstract disconnect(allowReconnect: boolean): Promise<boolean>

  /*
   * Processing of received datas.
   * @param   {Buffer}    Encrypted Datas from Panel
   */
  async newDataHandler(data: Buffer) {
    // Sometimes, Panel send multiple datas in same time
    // This behavior occurs in the event of a slowdown on the client side,
    // several data sets are then put in the reception buffer.
    const DataSeparator = `${String.fromCharCode(3)}${String.fromCharCode(2)}`
    do {
      let subData = data
      if (data.includes(DataSeparator)) {
        const SeparatorPos = data.indexOf(DataSeparator) + 1
        subData = data.slice(0, SeparatorPos)
        data = data.slice(SeparatorPos)
      }
      this.lastMisunderstoodData = undefined
      this.lastReceivedBuffer = Buffer.from(subData)
      const stringedBuffer = this.getStringedBuffer(this.lastReceivedBuffer)

      logger.log('debug', `Received data Buffer : ${stringedBuffer}`)
      const [receivedId, receivedCommandStr, isCRCOK] = this.rCrypt.decodeMessage(subData)

      if (this.lastReceivedId != null && this.lastReceivedId == receivedId) {
        logger.log('warn', `Command[${receivedId}] receivedId is the same as lastReceivedId, ignoring this panel message`)
        continue
      }
      // Keep memory of previous received message is new is null
      this.lastReceivedId = receivedId || this.lastReceivedId

      if (this.inCryptTest) {
        this.cryptKeyValidity = isCRCOK
        // in crypto test, always return the result for analysis, event if CRC is KO
        logger.log('verbose', `Command[${receivedId}] inCryptTest enabled, emitting response without checks`)
        this.commandResponseEmitter.emit(`CmdResponse_${this.sequenceId}`, receivedCommandStr)
        this.increaseSequenceId()
        continue
      } else {
        if (!isCRCOK) {
          await this.onCommandBadCrc(receivedId)
          if (this.disconnecting) {
            return
          }
        }
      }
      if (isCRCOK || this.inCryptTest) {
        if (receivedId == null && this.isErrorCode(receivedCommandStr)) {
          this.lastMisunderstoodData = receivedCommandStr
        } else if (receivedId && receivedId >= 50) {
          // it's an info from panel
          // Send 'ACK' for acknowledge received datas
          logger.log('debug', `Command[${receivedId}] Data from Panel, need to send an ACK.`)
          this.sendAck(receivedId)
        } else {
          // it's a response from panel
          logger.log('debug', `Command[${receivedId}] Command response from Panel`)
          if (receivedId == this.sequenceId) {
            logger.log('debug', `Command[${receivedId}] Emitting expected command response`)
            this.commandResponseEmitter.emit(`CmdResponse_${receivedId}`, receivedCommandStr)
            this.increaseSequenceId()
          } else {
            // Else, Unexpected response, we do not treat
            logger.log('warn', `Command[${receivedId}] Command response was unexpected, ignoring. Data[${receivedCommandStr}]. sequenceId[${this.sequenceId}]`)
          }
        }
        if (this.isPanelSocketConnected) {
          // Whether the data is expected or not, it is transmitted for analysis
          this.emit('DataReceived', receivedId, receivedCommandStr)
        }
      } else {
        // If the CRC does not match, it is a communication error.
        // In this case, we increase the bad CRC counter for communication
        // cut-off after a certain number of errors (10)
        this.lastMisunderstoodData = receivedCommandStr
      }
    } while (data.includes(DataSeparator) && !this.disconnecting)

    // if (this.socketMode === 'direct') {
    //     // We go back to 'listening' mode
    //     this.Socket.once('data', (new_input_data: any) => {
    //         this.NewDataHandler(new_input_data);
    //     });
    // }
  }

  private async onCommandBadCrc(receivedId: number | null) {
    this.badCRCCount++
    if (this.badCRCCount > this.badCRCLimit) {
      logger.log('error', `Command[${receivedId}] Too many bad CRC value.`)
      this.emit('BadCRCLimit')
      await this.disconnect(true)
      return
    } else {
      // A timer is started to reset the counter to zero in the event of a temporary disturbance.
      // This counter is canceled with each new error and then immediately restarted.
      if (this.badCRCTimer) {
        clearTimeout(this.badCRCTimer)
      }
      this.badCRCTimer = setTimeout(() => {
        this.badCRCCount = 0
      }, 60000)
      logger.log('warn', `Command[${receivedId}] Wrong CRC value for the response.`)
      this.emit('BadCRCData')
    }
  }

  /*
  * Send a command and get the result part (after '=' sign)
  * @param   {Buffer}
  * @return  {String} The command result as String
  */
  async getResult(commandStr: string, progCmd?: boolean): Promise<string> {
    let Result = await this.sendCommand(commandStr, progCmd)
    Result = Result.substring(Result.indexOf('=') + 1).trim()
    return Result
  }

  /*
  * Send a command and get the result part (after '=' sign) as an Integer
  * @param   {string}
  * @return  {Integer} The command result as Integer
  */
  async getIntResult(CommandStr: string, progCmd?: boolean): Promise<number> {
    const result = await this.getResult(CommandStr, progCmd)
    return parseInt(result)
  }

  /*
  * Send a command and check an 'ACK' is received
  * @param   {Buffer}
  * @return  {Boolean}
  */
  async getAckResult(CommandStr: string, ProgCmd?: boolean): Promise<boolean> {
    const Result = await this.sendCommand(CommandStr, ProgCmd)
    return Result === 'ACK'
  }

  /*
   * Send Data to Socket and Wait for a response
   * @param   {Buffer}
   * @return  {Promise}
   */
  async sendCommand(commandStr: string, progCmd = false): Promise<string> {
    assertIsDefined(this.panelSocket,`panelSocket`, `sendCommand(${commandStr}): socket is undefined`)
    if (this.panelSocket.destroyed) {
      logger.log('warn', `sendCommand(${commandStr}): Socket is destroyed, ignoring command`)
      return ''
    }
    if (!this.isPanelSocketConnected) {
      logger.log('warn', `sendCommand(${commandStr}): Socket not connected, ignoring command`)
      return ''
    }

    const cmdId = this.sequenceId

    while (this.inProg && !progCmd) {
      // if we are in programming mode, wait 5s before retry
      logger.log('debug', `Command[${cmdId}] waiting for programming mode to exit`)
      await new Promise(r => setTimeout(r, 5000))
    }
    if (this.inProg && !progCmd) {
      const message = `Command[${cmdId}] Programming mode did not exit after delay, rejecting command`
      logger.log('error', message)
      throw new Error(message)
    }

    let waitResponse = true
    let receivedResponse = ''

    let isTimedOut = false
    let shouldRetry = false

    let responseTimeoutDelay: number
    if (progCmd) {
      responseTimeoutDelay = 29000
    } else if (this.inCryptTest) {
      responseTimeoutDelay = 2000
    } else {
      responseTimeoutDelay = 5000
    }

    logger.log('verbose', `Command[${cmdId}] Sending Command: ${commandStr}`)
    const responseHandler = (response: string) => {
      waitResponse = false
      shouldRetry = false
      receivedResponse = response
    }

    const socketErrorHandler = (err: Error) => {
      waitResponse = false
      shouldRetry = false
      logger.log('error', `Command[${cmdId}] error: ${err}`)
    }

    try {
      this.panelSocket.on('error', socketErrorHandler)
      this.commandResponseEmitter.on(`CmdResponse_${cmdId}`, responseHandler)

      const encryptedCmdBuffer = this.rCrypt.getCommandBuffer(commandStr, cmdId)
      this.panelSocket.write(encryptedCmdBuffer)

      logger.log('debug', `Command[${cmdId}] Writing command buffer to socket: ${this.getStringedBuffer(encryptedCmdBuffer)}`)
      this.emit('DataSent', this.sequenceId, commandStr)

      const responseTimeout = setTimeout(() => {
        logger.log('warn', `Command[${cmdId}] '${commandStr}' Timeout`)
        isTimedOut = true
        shouldRetry = true
      }, responseTimeoutDelay)

      do {
        await new Promise(r => setTimeout(r, this.inProg ? 1000 : 10))
      } while (waitResponse && !isTimedOut)

      clearTimeout(responseTimeout)

      if (this.lastMisunderstoodData !== undefined) {
        if (!this.inCryptTest) {
          logger.log('verbose', `Command[${cmdId}] Respond was not understood, must retry.`)
          shouldRetry = true
        } else {
          receivedResponse = this.lastMisunderstoodData
        }
      }
    } finally {
      this.panelSocket.off('error', socketErrorHandler)
      this.commandResponseEmitter.off(`CmdResponse_${cmdId}`, responseHandler)
    }

    if (shouldRetry) {
      logger.log('debug', `Command[${cmdId}] retrying with a new command Id`)
      return await this.sendCommand(commandStr, progCmd)
    } else {
      logger.log('debug', `Command[${cmdId}] SendCommand receive this response : ${receivedResponse}`)
      return receivedResponse
    }
  }

  /*
   * Increase the sequence number.
   * The sequence number must be between 1 and 49 inclusive.
   */
  increaseSequenceId() {
    if (this.sequenceId >= 49) {
      this.sequenceId = 0
    }
    this.sequenceId++
  }

  /*
   * Send 'ACK' for acknowledge received datas
   * The response must match with the data sent.
   * The data ID number is used to identify the response.
   * @param   {String}    String matches Id
   */
  sendAck(Id: number): void {
    assertIsDefined(this.panelSocket, 'Socket')
    logger.log('debug', `Command[${Id}] Sending Ack.`)
    const EncryptedCmd = this.rCrypt.getCommandBuffer('ACK', Id)
    this.panelSocket.write(EncryptedCmd)
  }

  /*
   * Compare Response with Risco ErrorCode
   * @return  {boolean}
   */
  isErrorCode(data: string): boolean {
    if ((data !== undefined) && (Object.keys(RiscoError)).includes(data)) {
      return true
    } else if ((this.socketMode === 'proxy') && (data === undefined)) {
      return true
    } else {
      return false
    }
  }

  getErrorCode(data: string): [errorCode: string, errorLabel: string] | null {
    if ((Object.keys(RiscoError)).includes(data)) {
      return [data, RiscoError[data]]
    } else {
      return null
    }
  }

  /**
   * Convert Buffer to string representation
   */
  getStringedBuffer(data: Buffer): string {
    return `[${data.join(',')}]`
  }

  /*
   *  Function used to test the encryption table.
   *  If the result does not match, it means that the panel Id is not the correct one
   * and that it must be determined (provided that the option is activated).
   */
  async cryptTableTester(): Promise<[boolean, Buffer]> {
    const testCmd = `CUSTLST`
    // this.cryptKeyValidity = undefined
    // To avoid false positives, this command provides a long response which
    // allows only few possible errors when calculating the CRC
    const maxAttempts = 3
    let currentAttempt = 0
    let response: string
    do {
      response = await this.sendCommand(`${testCmd}?`, false)
      logger.log('debug', `cryptTableTester response: ${response}`)
      currentAttempt++
    } while (this.isErrorCode(response) && currentAttempt < maxAttempts)
    return [this.cryptKeyValidity && !this.isErrorCode(response), this.lastReceivedBuffer || Buffer.of()]
  }

  /*
   * This function update RiscoCloud.
   * @return  {boolean}       true/false if success/fails
   */
  async updateRiscoCloud(enable: boolean): Promise<boolean> {
    let success = false
    try {
      if (await this.enableProgMode()) {
        logger.log('info', `Setting RiscoCloud activation to ${enable}.`)
        const elasenParam = enable ? 1 : 0
        const data = await this.sendCommand(`ELASEN=${elasenParam}`, true)
        if (data.includes('ACK')) {
          logger.log('info', `RiscoCloud Successfully updated.`)
          if (await this.disableProgMode()) {
            success = true
          }
        } else {
          logger.log('error', `Unable to update RiscoCloud. ELASEN command failed, see debug logs`)
        }
      } else {
        logger.log('error', `Error while updating RiscoCloud: failed to enable prog mode`)
      }
    } catch (err) {
      logger.log('error', `Error while updating RiscoCloud: ${err}`)
    } finally {
      if (!success) {
        logger.log('error', `Something went wrong while updating RiscoCloud, Disconnecting`)
        await this.disconnect(false)
      }
    }
    return success
  }

  /*
   * Modification of the configuration of the control unit according to the
   * parameters of the plugin and the suitability of the configuration
   * @param   {Array of String}   Command to be executed for modification
   * @return  {boolean}           true/false if success/fails
   */
  async modifyPanelConfig(CommandsArr: string[]): Promise<boolean> {
    logger.log('info', `Modifying Panel Configuration.`)
    let failed = false
    if (await this.enableProgMode()) {
      try {
        for (const command of CommandsArr) {
          const success = await this.getAckResult(command, true)
          if (!success) {
            logger.log('error', `Modifying Panel Configuration failed for command ${command}`)
            failed = true
            break
          }
        }
      } catch (e) {
        logger.log('error', `Modifying Panel Configuration failed with error ${e}`)
        failed = true
      } finally {
        if (!await this.disableProgMode()) {
          failed = true
          logger.log('error', `Failed to disable programming mode while modifying Panel Configuration`)
        }
      }
    } else {
      failed = true
      logger.log('error', `Failed to enable programming mode while modifying Panel Configuration`)
    }
    if (failed) {
      logger.log('error', `Disconnecting as Panel Configuration modification failed`)
      await this.disconnect(false)
    }
    return !failed
  }

  /*
   * Switches the control unit to programming mode
   * @return  {Promise}
   */
  async enableProgMode(): Promise<boolean> {
    try {
      if (await this.getAckResult(`PROG=1`, true)) {
        logger.log('info', `Programming Mode enabled.`)
        this.inProg = true
        return true
      } else {
        logger.log('error', `Cannot Enter Programming Mode.`)
        return false
      }
    } catch (err) {
      logger.log('error', `Cannot Enter Programming Mode: ${err}`)
      throw err
    }
  }

  /*
   * Switches the control unit out of programming mode
   * @return  {Promise}
   */
  async disableProgMode(): Promise<boolean> {
    try {
      if (await this.sendCommand(`PROG=2`, true)) {
        logger.log('info', `Programmation Mode disabled.`)
        this.inProg = false
        return true
      } else {
        logger.log('error', `Cannot Exit Programmation Mode.`)
        this.inProg = false
        return false
      }
    } catch (err) {
      this.inProg = false
      logger.log('error', `Cannot Exit Programmation Mode: ${err}`)
      throw err

    }
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

  /*
   * Panel connection mechanism.
   * Send command RMT + Connection password
   * Send LCL command
   * After this point, the data is encrypted.
   * @param   {Integer}   code length (between 1-6)
   * @return  {Boolean}   true/false if connected or not
   */
  protected async panelConnect(codeLength = 4): Promise<boolean> {
    assertIsTrue(this.isPanelSocketConnected, 'isPanelSocketConnected', 'Socket failed to connect after 100ms delay')

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
            const [receivedId, receivedCommandStr, isCRCOK] = this.rCrypt.decodeMessage(testBufferData)
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
      this.isPanelConnected = cryptResult
    } else {
      this.isPanelConnected = false
    }

    if (this.isPanelConnected) {
      logger.log('verbose', `Connection to the control panel successfully established.`)
      this.emit('PanelConnected')
    } else {
      logger.log('error', `Unable to connect to the control panel.`)
      await this.disconnect(false)
    }
    return this.isPanelConnected
  }

}