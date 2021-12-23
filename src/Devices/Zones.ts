/* 
 *  Package: risco-lan-bridge
 *  File: Zones.js
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

import { EventEmitter } from 'events'
import { RiscoComm } from '../RiscoComm'
import { ZoneTypeStr } from '../constants'
import { logger } from '../Logger'
import { assertIsDefined } from '../Assertions'
import { TypedEmitter } from 'tiny-typed-emitter'

interface ZoneEvents {
  'ZStatusChanged': (zoneId: number, status: string) => void
}

export class Zone extends EventEmitter {
  Id: number
  RiscoComm: RiscoComm
  Label: string
  Type: number
  TypeStr: string
  ZTech: string
  ZStatus: string
  Grps: string[] = []
  Parts: number[] = []

  Open = false // O
  Arm = false // A
  Alarm = false // a
  Tamper = false // T
  Trouble = false // R
  Lost = false // L
  LowBattery = false // B
  Bypass = false // Y
  CommTrouble = false // C
  SoakTest = false // S
  Hours24 = false // H
  NotUsed = true // N

  FirstStatus = true
  NeedUpdateConfig = false

  constructor(Id: number, riscoComm: RiscoComm, Label?: string, Type?: number, Techno?: string, partsString?: string, groupsString?: string, ZStatus?: string) {
    super()
    this.Id = Id || 0
    this.RiscoComm = riscoComm
    this.Label = Label || `Zone ${this.Id}`
    this.Type = Type || 0
    this.TypeStr = ZoneTypeStr[this.Type]
    this.ZTech = Techno || 'N'
    this.ZStatus = ZStatus || '------------'

    if (partsString) {
      this.setPartsFromString(partsString)
    }
    if (groupsString) {
      this.setGroupsFromString(groupsString)
    }

    if (this.ZStatus !== '------------') {
      this.Status = this.ZStatus
    }
    this.Techno = this.ZTech
  }

  set Techno(value: string) {
    switch (value) {
      case 'E':
        this.ZTech = 'Wired Zone'
        this.NotUsed = false
        break
      case 'B' :
      case 'I' :
        this.ZTech = 'Bus Zone'
        this.NotUsed = false
        break
      case 'W' :
        this.ZTech = 'Wireless Zone'
        this.NotUsed = false
        break
      case 'N':
        this.ZTech = 'None'
        this.NotUsed = true
        this.emit(`ZStatusChanged`, this.Id, 'ZoneNotUsed')
        this.emit('ZoneNotUsed', this.Id)
        break
    }
    if ((this.FirstStatus) && (!this.NotUsed)) {
      this.emit(`ZStatusChanged`, this.Id, 'ZoneUsed')
      this.emit('ZoneUsed', this.Id)
    }
  }

  setPartsFromString(value: string) {
    this.Parts = []
    if (value.length === 1) {
      const letter = parseInt(value, 16)
      if (letter & 1) {
        this.Parts.push(1)
      }
      if (letter & 2) {
        this.Parts.push(2)
      }
      if (letter & 4) {
        this.Parts.push(3)
      }
      if (letter & 8) {
        this.Parts.push(4)
      }
    } else {
      //ProsysPlus/GTPlus
      for (let i = 0; i < value.length; i++) {
        const letter = parseInt(value.charAt(i), 16)
        if (letter & 1) {
          this.Parts.push((i * 4) + 1)
        }
        if (letter & 2) {
          this.Parts.push((i * 4) + 2)
        }
        if (letter & 4) {
          this.Parts.push((i * 4) + 3)
        }
        if (letter & 8) {
          this.Parts.push((i * 4) + 4)
        }
      }
    }
  }

  setGroupsFromString(value: string) {
    const Grpsval = parseInt(value, 16)
    this.Grps = []
    if (Grpsval & 1) {
      this.Grps.push('A')
    }
    if (Grpsval & 2) {
      this.Grps.push('B')
    }
    if (Grpsval & 4) {
      this.Grps.push('C')
    }
    if (Grpsval & 8) {
      this.Grps.push('D')
    }
  }

  set Status(value: string) {
    if (value !== undefined) {
      const StateArray = [
        ['O', 'this.Open', 'Open', 'Closed'],
        ['A', 'this.Arm', 'Armed', 'Disarmed'],
        ['a', 'this.Alarm', 'Alarm', 'StandBy'],
        ['T', 'this.Tamper', 'Tamper', 'Hold'],
        ['R', 'this.Trouble', 'Trouble', 'Sureness'],
        ['L', 'this.Lost', 'Lost', 'Located'],
        ['B', 'this.LowBattery', 'LowBattery', 'BatteryOk'],
        ['Y', 'this.Bypass', 'Bypassed', 'UnBypassed'],
        ['C', 'this.CommTrouble', 'CommTrouble', 'CommOk'],
        ['S', 'this.SoakTest', 'SoakTest', 'ExitSoakTest'],
        ['H', 'this.Hours24', '24HoursZone', 'NormalZone']
        // Removal of NotUsed from the logic because otherwise its value
        // is never correctly defined (does not always appear in the status value).
        // ['N', 'this.NotUsed', 'ZoneNotUsed', 'ZoneUsed']
      ]

      StateArray.forEach(StateValue => {
        const previousStateValue = eval(StateValue[1])
        if (value.includes(StateValue[0])) {
          eval(`${StateValue[1]} = true;`)
          if (!previousStateValue) {
            if (!this.FirstStatus) {
              this.emit(`ZStatusChanged`, this.Id, StateValue[2])
              this.emit(StateValue[2], this.Id)
            }
          }
        } else {
          eval(`${StateValue[1]} = false;`)
          if (previousStateValue) {
            if (!this.FirstStatus) {
              this.emit(`ZStatusChanged`, this.Id, StateValue[3])
              this.emit(StateValue[3], this.Id)
            }
          }
        }
      })

      this.FirstStatus = false
    }
  }

  async toggleBypass(): Promise<boolean> {
    assertIsDefined(this.RiscoComm.tcpSocket, 'RiscoComm.tcpSocket', 'TCP is not initialized')
    try {
        logger.log('debug', `Request for Bypassing/UnBypassing a Zone.`)
        return await this.RiscoComm.tcpSocket.getAckResult(`ZBYPAS=${this.Id}`)
      } catch (err) {
        logger.log('error', `Failed to Bypass/UnBypass Zone ${this.Id} : ${err}`)
        throw err
      }
  }

}

export class ZoneList extends TypedEmitter<ZoneEvents> {

  readonly values: Zone[]

  constructor(len: number, riscoComm: RiscoComm) {
    super()
    this.values = new Array(len)

    for (let i = 0; i < len; i++) {
      this.values[i] = new Zone(i + 1, riscoComm)
    }

    this.values.forEach(zone => {
      zone.on('ZStatusChanged', (Id, EventStr) => {
        this.emit('ZStatusChanged', Id, EventStr)
      })
    })
  }

  byId(Id: number): Zone {
    if ((Id > this.values.length) || (Id < 0)) {
      logger.log('warn', `Invalid zone id ${Id}`)
    }
    return this.values[Id - 1]
  }
}