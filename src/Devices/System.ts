/* 
 *  Package: risco-lan-bridge
 *  File: System.js
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

export class MBSystem extends EventEmitter {
  Label: string
  SStatus: string
  NeedUpdateConfig: boolean
  LowBatteryTrouble = false // B
  ACTrouble = false // A
  PhoneLineTrouble = false// P
  ClockTrouble = false // C
  DefaultSwitch = false // D
  MS1ReportTrouble = false // 1
  MS2ReportTrouble = false // 2
  MS3ReportTrouble = false // 3
  BoxTamper = false // X
  JammingTrouble = false  // J
  ProgMode = false // I
  LearnMode = false // L
  ThreeMinBypass = false // M
  WalkTest = false // W
  AuxTrouble = false // U
  Rs485BusTrouble = false // R
  LsSwitch = false // S
  BellSwitch = false // F
  BellTrouble = false // E
  BellTamper = false // Y
  ServiceExpired = false // V
  PaymentExpired = false // T
  ServiceMode = false // Z
  DualPath = false // Q
  FirstStatus = true

  constructor(Label?: string, SStatus?: string) {
    super()
    this.Label = Label || ''
    this.SStatus = SStatus || '---------------------'
    this.NeedUpdateConfig = false
    if (this.SStatus !== '---------------------') {
      this.Status = this.SStatus
    }
  }

  set Status(value: string) {
    if (value !== undefined) {
      const stateArray = [
        ['B', 'this.LowBatteryTrouble', 'LowBattery', 'BatteryOk'],
        ['A', 'this.ACTrouble', 'ACUnplugged', 'ACPlugged'],
        ['P', 'this.PhoneLineTrouble', 'PhoneLineTrouble', 'PhoneLineOk'],
        ['C', 'this.ClockTrouble', 'ClockTrouble', 'ClockOk'],
        ['D', 'this.DefaultSwitch', 'DefaultSwitchOn', 'DefaultSwitchOff'],
        ['1', 'this.MS1ReportTrouble', 'MS1ReportTrouble', 'MS1ReportOk'],
        ['2', 'this.MS2ReportTrouble', 'MS2ReportTrouble', 'MS2ReportOk'],
        ['3', 'this.MS3ReportTrouble', 'MS3reportTrouble', 'MS3ReportOk'],
        ['X', 'this.BoxTamper', 'BoxTamperOpen', 'BoxTamperClosed'],
        ['J', 'this.JammingTrouble', 'JammingTrouble', 'JammingOk'],
        ['I', 'this.ProgMode', 'ProgModeOn', 'ProgModeOff'],
        ['L', 'this.LearnMode', 'LearnModeOn', 'LearnModeOff'],
        ['M', 'this.ThreeMinBypass', 'ThreeMinBypassOn', 'ThreeMinBypassOff'],
        ['W', 'this.WalkTest', 'WalkTestOn', 'WalkTestOff'],
        ['U', 'this.AuxTrouble', 'AuxTrouble', 'AuxOk'],
        ['R', 'this.Rs485BusTrouble', 'Rs485BusTrouble', 'Rs485BusOk'],
        ['S', 'this.LsSwitch', 'LsSwitchOn', 'LsSwitchOff'],
        ['F', 'this.BellSwitch', 'BellSwitchOn', 'BellSwitchOff'],
        ['E', 'this.BellTrouble', 'BellTrouble', 'BellOk'],
        ['Y', 'this.BellTamper', 'BellTamper', 'BellTamperOk'],
        ['V', 'this.ServiceExpired', 'ServiceExpired', 'ServiceOk'],
        ['T', 'this.PaymentExpired', 'PaymentExpired', 'PaymentOk'],
        ['Z', 'this.ServiceMode', 'ServiceModeOn', 'ServiceModeOff'],
        ['Q', 'this.DualPath', 'DualPathOn', 'DualPathOff']
      ]

      stateArray.forEach(StateValue => {
        const previousStateValue = eval(StateValue[1])
        if (value.includes(StateValue[0])) {
          eval(`${StateValue[1]} = true;`)
          if (!previousStateValue) {
            if (!this.FirstStatus) {
              this.emit(`SStatusChanged`, StateValue[2])
              this.emit(StateValue[2])
            }
          }
        } else {
          eval(`${StateValue[1]} = false;`)
          if (previousStateValue) {
            if (!this.FirstStatus) {
              this.emit(`SStatusChanged`, StateValue[3])
              this.emit(StateValue[3])
            }
          }
        }
      })
      this.FirstStatus = false
    }
  }
}
