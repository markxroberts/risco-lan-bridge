/* 
 *  Package: risco-lan-bridge
 *  File: Partitions.js
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

import { RiscoComm } from '../RiscoComm'
import { EventEmitter } from 'events'
import { logger } from '../Logger'
import { assertIsDefined } from '../Assertions'

export class Partition extends EventEmitter {
  Id: number
  riscoComm: RiscoComm
  Label: string
  PStatus: string
  FirstStatus: boolean
  NeedUpdateConfig: boolean

  // a
  Alarm = false
  // D
  Duress = false
  // C
  FalseCode = false
  // F
  Fire = false
  // P
  Panic = false
  // M
  Medic = false
  // N
  NoActivity = false
  // A
  Arm = false
  // H
  HomeStay = false
  // R
  // Ready: In the sense that the partition is capable of being armed
  Ready = false
  // O
  // true if at least 1 zone of the partition is active
  // false if all the zones of the partition are inactive
  Open = false
  // E
  Exist = false
  // S
  ResetRequired = false
  // 1
  GrpAArm = false
  // 2
  GrpBArm = false
  // 3
  GrpCArm = false
  // 4
  GrpDArm = false
  // T
  Trouble = false

  constructor(Id: number, riscoComm: RiscoComm, Label?: string, PStatus?: string) {
    super()
    this.Id = Id || 1
    this.riscoComm = riscoComm
    this.Label = Label || ''
    this.PStatus = PStatus || '-----------------'
    this.FirstStatus = true
    this.NeedUpdateConfig = false

    if (this.PStatus !== '-----------------') {
      this.Status = this.PStatus
    }
  }

  set Status(value: string) {
    if (value !== undefined) {
      const stateArray = [
        ['a', 'this.Alarm', 'Alarm', 'StandBy'],
        ['D', 'this.Duress', 'Duress', 'Free'],
        ['C', 'this.FalseCode', 'FalseCode', 'CodeOk'],
        ['F', 'this.Fire', 'Fire', 'NoFire'],
        ['P', 'this.Panic', 'Panic', 'NoPanic'],
        ['M', 'this.Medic', 'Medic', 'NoMedic'],
        ['A', 'this.Arm', 'Armed', 'Disarmed'],
        ['H', 'this.HomeStay', 'HomeStay', 'HomeDisarmed'],
        ['R', 'this.Ready', 'Ready', 'NotReady'],
        ['O', 'this.Open', 'ZoneOpen', 'ZoneClosed'],
        ['E', 'this.Exist', 'Exist', 'NotExist'],
        ['S', 'this.ResetRequired', 'MemoryEvent', 'MemoryAck'],
        ['N', 'this.NoActivity', 'ActivityAlert', 'ActivityOk'],
        ['1', 'this.GrpAArm', 'GrpAArmed', 'GrpADisarmed'],
        ['2', 'this.GrpBArm', 'GrpBArmed', 'GrpBDisarmed'],
        ['3', 'this.GrpCArm', 'GrpCArmed', 'GrpCDisarmed'],
        ['4', 'this.GrpDArm', 'GrpDArmed', 'GrpDDisarmed'],
        ['T', 'this.Trouble', 'Trouble', 'Ok']
      ]
      stateArray.forEach(StateValue => {
        const previousStateValue = eval(StateValue[1])
        if (value.includes(StateValue[0])) {
          eval(`${StateValue[1]} = true;`)
          if (!previousStateValue) {
            if (!this.FirstStatus) {
              this.emit(`PStatusChanged`, this.Id, StateValue[2])
              this.emit(StateValue[2], this.Id)
            }
          }
        } else {
          eval(`${StateValue[1]} = false;`)
          if (previousStateValue) {
            if (!this.FirstStatus) {
              this.emit(`PStatusChanged`, this.Id, StateValue[3])
              this.emit(StateValue[3], this.Id)
            }
          }
        }
      })
      this.FirstStatus = false
    }
  }

  async awayArm(): Promise<boolean> {
    assertIsDefined(this.riscoComm.tcpSocket, 'RiscoComm.tcpSocket', 'TCP is not initialized')
    logger.log('debug', `Request for Full Arming partition ${this.Id}.`)
    if (!this.Ready || this.Open) {
      logger.log('warn', `Failed to Full Arming partition ${this.Id} : partition is not ready or is open`)
      return false
    }
    if (this.Arm && !this.HomeStay) {
      logger.log('debug', `No need to arm away partition ${this.Id} : partition already armed away`)

      return true
    } else {
      return await this.riscoComm.tcpSocket.getAckResult(`ARM=${this.Id}`)
    }
  }

  async homeStayArm(): Promise<boolean> {
    assertIsDefined(this.riscoComm.tcpSocket, 'RiscoComm.tcpSocket', 'TCP is not initialized')
    logger.log('debug', `Request for Stay Arming partition ${this.Id}.`)
    if (!this.Ready || this.Open) {
      logger.log('warn', `Failed to Stay Arming partition ${this.Id} : partition is not ready or is open`)
      return false
    }
    if (this.HomeStay) {
      logger.log('debug', `No need to arm home partition ${this.Id} : partition already armed home`)
      return true
    } else {
      return await this.riscoComm.tcpSocket.getAckResult(`STAY=${this.Id}`)
    }
  }

  async groupArm(armType: number): Promise<boolean> {
    assertIsDefined(this.riscoComm.tcpSocket, 'RiscoComm.tcpSocket', 'TCP is not initialized')
    logger.log('debug', `Request for Group Arming partition ${this.Id}.`)
    if (!this.Ready || this.Open) {
      logger.log('warn', `Failed to Group Arming partition ${this.Id} : partition is not ready or is open`)
      return false
    }
    if (this.HomeStay || this.Arm) {
      logger.log('debug', `No need to group arm partition ${this.Id} : partition already armed`)
      return true
    } else {
      return await this.riscoComm.tcpSocket.getAckResult(`GARM*${armType}=${this.Id}`)
    }
  }

  async disarm(): Promise<boolean> {
    assertIsDefined(this.riscoComm.tcpSocket, 'RiscoComm.tcpSocket', 'TCP is not initialized')
    logger.log('debug', `Request for Disarming partition ${this.Id}.`)
    if (!this.Arm && !this.HomeStay) {
      logger.log('debug', `No need to disarm partition ${this.Id} : partition is not armed`)
      return true
    } else {
      return await this.riscoComm.tcpSocket.getAckResult(`DISARM=${this.Id}`)
    }
  }
}

export class PartitionList extends EventEmitter {

  readonly values: Partition[]

  constructor(len: number, RiscoComm: RiscoComm) {
    super()
    this.values = new Array(len)

    for (let i = 0; i < len; i++) {
      this.values[i] = new Partition(i + 1, RiscoComm)
    }

    this.values.forEach(partition => {
      partition.on('PStatusChanged', (Id, EventStr) => {
        this.emit('PStatusChanged', Id, EventStr)
      })
    })
  }

  byId(Id: number): Partition {
    if ((Id > this.values.length) || (Id < 0)) {
      logger.log('warn', `Invalid Partition id ${Id}`)
    }
    return this.values[Id - 1]
  }
}