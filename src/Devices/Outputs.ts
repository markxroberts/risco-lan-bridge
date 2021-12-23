/* 
 *  Package: risco-lan-bridge
 *  File: Outputs.js
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
import { TypedEmitter } from 'tiny-typed-emitter'
import { logger } from '../Logger'
import { assertIsDefined } from '../Assertions'

interface OutputEvents {
  'OStatusChanged': (outputId: number, status: string) => void
  'Pulsed': (outputId: number) => void
  'Activated': (outputId: number) => void
  'Deactivated': (outputId: number) => void
}

export class Output extends TypedEmitter<OutputEvents> {

  Id: number
  private RiscoComm: RiscoComm
  Label: string
  private OStatus: string

  get Pulsed(): boolean {
    return this.Type % 2 === 0
  }

  get NormallyOpen() {
    return this.Type >= 2
  }

  Type: number
  PulseDelay: number
  private FirstStatus: boolean
  UserUsable: boolean
  NeedUpdateConfig: boolean
  private Active: boolean

  constructor(Id: number, RiscoComm: RiscoComm, Label?: string, Type?: number, OStatus?: string) {
    super()
    this.Id = Id
    this.RiscoComm = RiscoComm
    this.Label = Label || ''

    this.Type = Type || 0
    this.OStatus = OStatus || '--'

    this.PulseDelay = 0
    this.FirstStatus = true
    this.UserUsable = false
    this.NeedUpdateConfig = false

    // a
    this.Active = false

    if (this.OStatus !== '--') {
      this.Status = this.OStatus
    }

  }

  // /*
  //  * value can be :
  //  * Pulse NC = 0
  //  * Latch NC = 1
  //  * Pulse NO = 2
  //  * Latch NO = 3
  //  */
  // set Type(value: number) {
  //     this.Pulsed = value % 2 === 0;
  // }
  //
  // get Type() {
  //     return ((this.Pulsed) ? 'Pulse' : 'Latch');
  // }

  set Status(value: string) {
    if (value) {
      const previousStateValue = this.Active
      if (value.includes('a')) {
        this.Active = true
        if (!previousStateValue) {
          if (this.Pulsed) {
            if (!this.FirstStatus) {
              this.emit(`OStatusChanged`, this.Id, 'Pulsed')
              this.emit('Pulsed', this.Id)
            }
          } else {
            if (!this.FirstStatus) {
              this.emit(`OStatusChanged`, this.Id, 'Activated')
              this.emit('Activated', this.Id)
            }
          }
        }
      } else {
        this.Active = false
        if (previousStateValue) {
          if (!this.Pulsed) {
            if (!this.FirstStatus) {
              this.emit(`OStatusChanged`, this.Id, 'Deactivated')
              this.emit('Deactivated', this.Id)
            }
          }
        }
      }
      this.FirstStatus = false
    }

  }

  async toggleOutput(): Promise<boolean> {
    assertIsDefined(this.RiscoComm.tcpSocket, 'RiscoComm.tcpSocket', 'TCP is not initialized')
    try {
        logger.log('debug', `Request for Toggle an Output.`)
        const ActOutputResult = await this.RiscoComm.tcpSocket.getAckResult(`ACTUO${this.Id}`)
        // Because Pulsed Output have no Status Update from Panel
        if (this.Pulsed) {
          this.Status = 'a'
          setTimeout(() => {
            this.Status = '-'
          }, this.PulseDelay)
        }
        return ActOutputResult
      } catch (err) {
        logger.log('error', `Failed to Toggle Output : ${this.Id}`)
        throw err
      }
  }

}

export class OutputList extends TypedEmitter<OutputEvents> {

  readonly values: Output[]

  constructor(len: number, RiscoComm: RiscoComm) {
    super()
    this.values = new Array(len)

    for (let i = 0; i < len; i++) {
      this.values[i] = new Output(i + 1, RiscoComm)
    }

    this.values.forEach(output => {
      output.on('OStatusChanged', (Id, EventStr) => {
        this.emit('OStatusChanged', Id, EventStr)
      })
    })
  }

  byId(Id: number): Output {
    if ((Id > this.values.length) || (Id < 0)) {
      logger.log('warn', `Invalid Output id ${Id}`)
    }
    return this.values[Id - 1]
  }
}