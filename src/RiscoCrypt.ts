/* 
 *  Package: risco-lan-bridge
 *  File: RCrypt.js
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

'use strict';

import { CRCArray_base64 } from './constants';
import { logger } from './Logger';

export interface RiscoCryptOptions {
  panelId: number,
  encoding: BufferEncoding
}

const endOfBlockString = String.fromCharCode(23)

/**
 *  Create a Crypt Object for Encoding / Decoding Risco Communication
 *  This Pseudo Buffer is based on Panel Id
 *  When Panel Id is 0, no encryption is applied
 *  Default Panel Id is 0001
 */
export class RiscoCrypt {

  panelId: number;
  private readonly encoding: BufferEncoding;

  private cryptBuffer: Uint8Array;
  private readonly CRCArray: Uint16Array;
  cryptCommands: boolean;

  constructor(cryptOptions: RiscoCryptOptions) {
    this.panelId = cryptOptions.panelId;
    this.encoding = cryptOptions.encoding;

    this.cryptBuffer = this.createPseudoBuffer(this.panelId);
    this.cryptCommands = false;
    const buffCRC = Buffer.from(CRCArray_base64, 'base64');
    this.CRCArray = Uint16Array.from(eval(buffCRC.toString(this.encoding)));
  }

  /**
   * Decode received message and extract Command id, command and CRC Value
   * @param    {string}    message
   * @return    {number}    Command Id
   *            {string}    Command itself
   *            {boolean}    isValidCRC
   */
  decodeMessage(message: Buffer): [number | null, string, boolean] {
    this.cryptCommands = RiscoCrypt.isEncrypted(message);
    const decryptedMsgBytes = this.decryptChars(message);
    const decryptedMessage = this.byteToString(decryptedMsgBytes);
    let cmdId, commandStr, crcValue;
    if (decryptedMessage.startsWith('N') || decryptedMessage.startsWith('B')) {
      cmdId = null;
      commandStr = decryptedMessage.substring(0, decryptedMessage.indexOf(endOfBlockString));
      crcValue = decryptedMessage.substring(decryptedMessage.indexOf(endOfBlockString) + 1);
    } else {
      cmdId = parseInt(decryptedMessage.substring(0, 2), 10);
      commandStr = decryptedMessage.substring(2, decryptedMessage.indexOf(endOfBlockString));
      crcValue = decryptedMessage.substring(decryptedMessage.indexOf(endOfBlockString) + 1);
    }
    return [cmdId, commandStr, this.isValidCRC(cmdId, decryptedMessage, crcValue)];
  }

  /**
   * Encode the Message with PseudoBuffer
   * Each Char is XOred with same index char in PseudoBuffer
   * Some char are added (start of frame = 2, end of frame = 3 and encryption indicator = 17)
   *
   * command example :
   * 01RMT=5678 ABCD
   * Where :
   * 01    => command number (from 01 to 49)
   * RMT=    => command itself (ReMoTe)
   * 5678 => Default passcode for Remote
   * ABCD => CRC Value
   *
   */
  getCommandBuffer(command: string, cmdId: number, forceCrypt?: boolean | undefined): Buffer {
    //byte = 2 => start of command
    let Encrypted = [2];
    if ((forceCrypt === undefined && this.cryptCommands) || forceCrypt) {
      //byte = 17 => encryption indicator
      Encrypted = Encrypted.concat([17]);
    }
    //Add Cmd_Id to command and Separator character between Cmd and CRC value
    const FullCmd = ''.concat(cmdId.toLocaleString('en-US', {
      minimumIntegerDigits: 2,
      useGrouping: false,
    }), command, Buffer.from([23]).toString());
    //Calculate CRC
    const CRCValue = this.getCommandCRC(FullCmd);
    //Encrypt command
    Encrypted = Encrypted.concat(this.encryptChars(FullCmd.concat(CRCValue)));

    //Add Terminal Char
    Encrypted = Encrypted.concat([3]);
    return Buffer.from(Encrypted);
  }

  updatePanelId(panelId: number): void {
    this.panelId = panelId;
    this.cryptBuffer = this.createPseudoBuffer(this.panelId);
  }

  /*
   * Create the pseudo buffer used to encode/decode communication
   */
  private createPseudoBuffer(panelId: number): Uint8Array {
    const BufferLength = 255;
    const PseudoBuffer = new Uint8Array(BufferLength);
    let pid = panelId;
    const numArray = new Uint16Array([2, 4, 16, 32768]);
    if (pid !== 0) {
      for (let index = 0; index < BufferLength; ++index) {
        let n1 = 0;
        let n2 = 0;
        for (n1 = 0; n1 < 4; ++n1) {
          if ((pid & numArray[n1]) > 0) {
            n2 ^= 1;
          }
        }
        pid = pid << 1 | n2;
        PseudoBuffer[index] = (pid & BufferLength);
      }
    } else {
      PseudoBuffer.fill(0);
    }
    logger.log('debug', `Pseudo Buffer Created for Panel Id(${this.panelId})`);
    return PseudoBuffer;
  }

  /**
   * Convert String to byte array
   */
  private stringToByte(Command: string): Buffer {
    return Buffer.from(Command, this.encoding);
  }

  /**
   * Convert String to byte array
   */
  private byteToString(bytes: Buffer) {
    return bytes.toString(this.encoding);
  }

  /*
   * Verify if Received Data CRC is OK
   * @param	{string}	decryptedMessage
   * @param	{string}	receivedCrc
   * @return	{boolean}
   */
  private isValidCRC(CmdId: number | null, decryptedMessage: string, receivedCrc: string): boolean {
    const strNoCRC = decryptedMessage.substring(0, decryptedMessage.indexOf(endOfBlockString) + 1);

    const computedCrc = this.getCommandCRC(strNoCRC);
    const crcOK = (receivedCrc == computedCrc);
    logger.log('debug', `Command[${CmdId}] crcOK : ${crcOK}, Computed CRC : ${computedCrc}, Received CRC: ${receivedCrc}`);
    return crcOK;
  }

  /**
   * Calculate CRC for Command based on original character(not encrypted)
   * and CRC array Value
   */
  private getCommandCRC(cmdStr: string): string {
    const CmdBytes = this.stringToByte(cmdStr);
    let CRCBase = 65535;
    for (let i = 0; i < CmdBytes.length; i++) {
      CRCBase = CRCBase >>> 8 ^ this.CRCArray[CRCBase & 255 ^ CmdBytes[i]];
    }

    return ''.concat(
      (CRCBase >>> 12 & 15).toString(16).toUpperCase(),
      ((CRCBase >>> 8) & 15).toString(16).toUpperCase(),
      ((CRCBase >>> 4) & 15).toString(16).toUpperCase(),
      ((CRCBase & 15).toString(16).toUpperCase()),
    );
  }

  /**
   * Encryption/Decryption mechanism
   */
  private encryptChars(charsCmd: string): number[] {
    const offset = 0;
    let encryptedChars: number[] = [];
    let position = 0;
    const chars = Buffer.from(charsCmd, this.encoding);
    for (let i = 0; i < chars.length; i++) {
      if (this.cryptCommands) {
        chars[i] ^= this.cryptBuffer[position - offset];
      }
      switch (chars[i]) {
        case 2:
        case 3:
        case 16:
          encryptedChars = encryptedChars.concat([16]);
      }
      encryptedChars = encryptedChars.concat([chars[i]]);
      position++;
    }
    return encryptedChars;
  }

  /**
   * Decryption mechanism
   */
  private decryptChars(charsCmd: Buffer): Buffer {
    let escapedDleChars: number[] = [];
    for (let i = 0; i < charsCmd.length; i++) {
      if ((charsCmd[i] == 16) && (charsCmd[i + 1] == 2 || charsCmd[i + 1] == 3 || charsCmd[i + 1] == 16)) {
        escapedDleChars = escapedDleChars.concat(charsCmd[i + 1]);
        i++
      } else {
        escapedDleChars = escapedDleChars.concat(charsCmd[i])
      }
    }
    const decrypt = RiscoCrypt.isEncrypted(charsCmd);
    let offset = 0;
    let decryptedChars: number[] = [];
    let position = 0;

    for (let i = (decrypt ? 2 : 1); i < escapedDleChars.length - 1; i++) {
      if (decrypt) {
        escapedDleChars[i] ^= this.cryptBuffer[position - offset];
      }
      decryptedChars = decryptedChars.concat([escapedDleChars[i]]);
      // console.log(`Position: ${position}, i: ${i}, chars[i]: ${escapedDleChars[i]}, Output: ${this.byteToString(Buffer.from(decryptedChars))}`)
      position++;
    }
    return Buffer.from(decryptedChars);
  }

  private static isEncrypted(data: Buffer): boolean {
    return data[1] == 17;
  }

}
