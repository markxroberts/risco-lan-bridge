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
   *            {boolean}    IsValidCRC
   */
  decodeMessage(message: Buffer): [number | null, string, boolean] {
    this.cryptCommands = RiscoCrypt.isCrypted(message);
    const DecryptedMsgBytes = this.decryptChars(message);
    const DecryptedMessage = this.byteToString(DecryptedMsgBytes);
    let cmd_id, Command, CRCValue;
    if (DecryptedMessage.startsWith('N') || DecryptedMessage.startsWith('B')) {
      cmd_id = null;
      Command = DecryptedMessage.substring(0, DecryptedMessage.indexOf(String.fromCharCode(23)));
      CRCValue = DecryptedMessage.substring(DecryptedMessage.indexOf(String.fromCharCode(23)) + 1);
    } else {
      cmd_id = parseInt(DecryptedMessage.substring(0, 2), 10);
      Command = DecryptedMessage.substring(2, DecryptedMessage.indexOf(String.fromCharCode(23)));
      CRCValue = DecryptedMessage.substring(DecryptedMessage.indexOf(String.fromCharCode(23)) + 1);
    }
    return [cmd_id, Command, this.IsValidCRC(cmd_id, DecryptedMessage, CRCValue)];
  }

  /**
   * Encode the Message with PseudoBuffer
   * Each Char is XOred with same index char in PseudoBuffer
   * Some char are added (start of frame = 2, end of frame = 3 and encryption indicator = 17)
   *
   * Command example :
   * 01RMT=5678 ABCD
   * Where :
   * 01    => Command number (from 01 to 49)
   * RMT=    => Command itself (ReMoTe)
   * 5678 => Default passcode for Remote
   * ABCD => CRC Value
   *
   */
  getCommandBuffer(Command: string, CmdId: number, ForceCrypt?: boolean | undefined): Buffer {
    //byte = 2 => start of Command
    let Encrypted = [2];
    if ((ForceCrypt === undefined && this.cryptCommands) || ForceCrypt) {
      //byte = 17 => encryption indicator
      Encrypted = Encrypted.concat([17]);
    }
    //Add Cmd_Id to Command and Separator character between Cmd and CRC value
    const FullCmd = ''.concat(CmdId.toLocaleString('en-US', {
      minimumIntegerDigits: 2,
      useGrouping: false,
    }), Command, Buffer.from([23]).toString());
    //Calculate CRC
    const CRCValue = this.getCommandCRC(FullCmd);
    //Encrypt Command
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
    logger.log('debug', `Pseudo Buffer Created for Panel Id(${this.panelId}): \n[${PseudoBuffer.join(',')}]`);
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
   * @param	{string}	UnCryptedMessage
   * @param	{string}	RcvCRC
   * @return	{boolean}
   */
  private IsValidCRC(CmdId: number | null, UnCryptedMessage: string, RcvCRC: string): boolean {
    const StrNoCRC = UnCryptedMessage.substring(0, UnCryptedMessage.indexOf(String.fromCharCode(23)) + 1);

    const MsgCRC = this.getCommandCRC(StrNoCRC);
    const crcOK = RcvCRC == MsgCRC;
    logger.log('debug', `Command[${CmdId}] crcOK : ${crcOK}, Computed CRC : ${MsgCRC}, Received CRC: ${RcvCRC}`);
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
    let cryptedChars: number[] = [];
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
          cryptedChars = cryptedChars.concat([16]);
      }
      cryptedChars = cryptedChars.concat([chars[i]]);
      position++;
    }
    return cryptedChars;
  }

  /**
   * Decryption mechanism
   */
  private decryptChars(charsCmd: Buffer): Buffer {
    const decrypt = RiscoCrypt.isCrypted(charsCmd);
    let offset = 0;
    let cryptedChars: number[] = [];
    let position = 0;
    const chars = charsCmd;
    for (let i = (decrypt ? 2 : 1); i < chars.length - 1; i++) {
      if (decrypt) {
        if ((chars[i] == 16) && (chars[i + 1] == 2 || chars[i + 1] == 3 || chars[i + 1] == 16)) {
          offset++;
        } else {
          chars[i] ^= this.cryptBuffer[position - offset];
        }
      }
      if (chars[i] != 16) {
        cryptedChars = cryptedChars.concat([chars[i]]);
      }
      position++;
    }
    return Buffer.from(cryptedChars);
  }

  private static isCrypted(data: Buffer): boolean {
    return data[1] == 17;
  }

}
