/* 
 *  Package: risco-lan-bridge
 *  File: RiscoPanel.js
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

import { PanelInfo, RiscoComm } from './RiscoComm'
import { logger, RiscoLogger } from './Logger'
import { Zone, ZoneList } from './Devices/Zones'
import { OutputList } from './Devices/Outputs'
import { PartitionList } from './Devices/Partitions'
import { MBSystem } from './Devices/System'
import { EventEmitter } from 'events'
import { SocketMode } from './RiscoBaseSocket'

export interface PanelOptions {
  panelIp?: string
  panelPort?: number
  panelPassword?: string,
  panelId?: number,
  watchDogInterval?: number,
  logger?: RiscoLogger,
  guessPasswordAndPanelId?: boolean,
  autoConnect?: boolean,
  listeningPort?: number,
  cloudUrl?: string,
  cloudPort?: number,
  encoding?: BufferEncoding,
  socketMode?: SocketMode,
  ntpServer?: string,
  ntpPort?: number,
}

export class RiscoPanel extends EventEmitter {

  riscoComm: RiscoComm

  zones!: ZoneList
  outputs!: OutputList
  partitions!: PartitionList
  mbSystem!: MBSystem

  constructor(options: PanelOptions) {
    super()
    if (options.logger) {
      logger.delegate = options.logger
    }
    this.riscoComm = new RiscoComm(options)

    this.riscoComm.on('PanelCommReady', async (panelInfo: PanelInfo) => {
      this.mbSystem = new MBSystem('', '---------------------')
      this.zones = new ZoneList(panelInfo.MaxZones, this.riscoComm)
      this.outputs = new OutputList(panelInfo.MaxOutputs, this.riscoComm)
      this.partitions = new PartitionList(panelInfo.MaxParts, this.riscoComm)

      logger.log('debug', `Beginning of device discovery.`)
      this.mbSystem = await this.riscoComm.getSystemData()
      this.zones = await this.riscoComm.GetAllZonesData(this.zones)
      this.outputs = await this.riscoComm.getAllOutputsData(this.outputs)
      this.partitions = await this.riscoComm.getAllPartitionsData(this.partitions)
      logger.log('debug', `End of device discovery.`)

      this.mbSystem.on('SStatusChanged', (EventStr: string) => {
        logger.log('debug', `MBSystem Status Changed :\n New Status: ${EventStr}`)
      })
      this.mbSystem.on('ProgModeOn', () => {
        if (!this.mbSystem.NeedUpdateConfig) {
          this.zones.values.forEach((zone: Zone) => {
            zone.NeedUpdateConfig = true
          })
          this.outputs.values.forEach((output) => {
            output.NeedUpdateConfig = true
          })
          this.partitions.values.forEach((partition) => {
            partition.NeedUpdateConfig = true
          })
          this.mbSystem.NeedUpdateConfig = true
          const WarnUpdate = () => {
            logger.log('error', `Panel configuration has been changed since connection was established.`)
            logger.log('error', `Please restart your plugin and its configuration to take into account the changes and avoid any abnormal behavior.`)
          }
          WarnUpdate()
          setInterval(() => {
            WarnUpdate()
          }, 60000)
        }
      })
      this.zones.on('ZStatusChanged', (Id: number, EventStr: string) => {
        logger.log('debug', `Zones Status Changed :\n Zone Id ${Id}\n New Status: ${EventStr}`)
      })
      this.outputs.on('OStatusChanged', (Id: number, EventStr: string) => {
        logger.log('debug', `Outputs Status Changed :\n Output Id ${Id}\n New Status: ${EventStr}`)
      })
      this.partitions.on('PStatusChanged', (Id: number, EventStr: string) => {
        logger.log('debug', `Partition Status Changed :\n Partition Id ${Id}\n New Status: ${EventStr}`)
      })

      // Listen Event for new Status from Panel
      this.riscoComm.on('NewZoneStatusFromPanel', (data) => {
        const ZId = parseInt(data.substring(data.indexOf('ZSTT') + 4, data.indexOf('=')), 10)
        if (!isNaN(ZId)) {
          this.zones.byId(ZId).Status = data.substring(data.indexOf('=') + 1)
        }
      })
      this.riscoComm.on('NewOutputStatusFromPanel', (data) => {
        if (this.outputs !== undefined) {
          const OId = parseInt(data.substring(data.indexOf('OSTT') + 4, data.indexOf('=')), 10)
          if (!isNaN(OId)) {
            this.outputs.byId(OId).Status = data.substring(data.indexOf('=') + 1)
          }
        }
      })
      this.riscoComm.on('NewPartitionStatusFromPanel', (data) => {
        if (this.partitions !== undefined) {
          const PId = parseInt(data.substring(data.indexOf('PSTT') + 4, data.indexOf('=')), 10)
          if (!isNaN(PId)) {
            this.partitions.byId(PId).Status = data.substring(data.indexOf('=') + 1)
          }
        }
      })
      this.riscoComm.on('NewMBSystemStatusFromPanel', (data) => {
        if (this.mbSystem !== undefined) {
          this.mbSystem.Status = data.substring(data.indexOf('=') + 1)
        }
      })

      // Finally, system is ready
      this.emit('SystemInitComplete')
      logger.log('verbose', `System initialization completed.`)
    })

    process.on('SIGINT', async () => {
      logger.log('info', `Received SIGINT, Disconnecting`)
      await this.disconnect()
      process.exit(0)
    })
    process.on('SIGTERM', async () => {
      logger.log('info', `Received SIGTERM, Disconnecting`)
      await this.disconnect()
      process.exit(0)
    })

    if (options.autoConnect != false) {
      logger.log('info', `autoConnect enabled, starting communication`)
      this.riscoComm.initRPSocket()
    } else {
      logger.log('info', `autoConnect disabled in configuration file, you must call connect() in order to initialize the connection.`)
    }
  }

  /**
   * Alias for the InitRPSocket function
   * For external call and manual Connexion
   */
  async connect() {
    await this.riscoComm.initRPSocket()
  }

  /**
   * Causes the TCP socket to disconnect
   */
  async disconnect() {
    logger.log('verbose', `Disconnecting from Panel.`)
    await this.riscoComm.disconnect()
  }

  async armHome(id: number): Promise<boolean> {
    return this.armPart(id, 1)
  }

  async armAway(id: number): Promise<boolean> {
    return this.armPart(id, 0)
  }

  /**
   * Arm the selected partition
   * TODO : find command for temporised arming
   * @param   id          id Of selected PArtition
   * @param   ArmType     Type of arm : Away(0) or HomeStay(1)
   * @return  Boolean
   */
  private async armPart(id: number, ArmType: number): Promise<boolean> {
    logger.log('debug', `Request for Full/Stay Arming a Partition.`)
    try {
      if ((id > this.partitions.values.length) || (id < 0)) {
        logger.log('warn', `Failed to Full/Stay Arming partition ${id} : invalid partition id`)
        return false
      }
      const SelectedPart = this.partitions.byId(id)
      switch (ArmType) {
        case 0:
          return SelectedPart.awayArm()
        case 1:
          return SelectedPart.homeStayArm()
        default:
          throw new Error(`Unsupported arm type :${ArmType}`)
      }
    } catch (err) {
      logger.log('error', `Failed to Full/Stay Arming partition : ${id}`)
      throw err
    }
  }

  /**
   * Disarm the selected partition
   * @param   {Integer}     id          id Of selected PArtition
   * @return  {Boolean}
   */
  async disarmPart(id: number): Promise<boolean> {
    logger.log('debug', `Request for Disarming a Partition.`)
    try {
      if ((id > this.partitions.values.length) || (id < 0)) {
        logger.log('warn', `Failed to disarm partition ${id} : invalid partition id`)
        return false
      }
      return await this.partitions.byId(id).disarm()
    } catch (err) {
      logger.log('error', `Failed to disarm the Partition ${id}: ${err}`)
      throw err
    }
  }

  /**
   * Bypass or UnBypass the selected Zone
   * @param   {id}     id Of selected Zone
   * @return  {Boolean}
   */
  async toggleBypassZone(id: number): Promise<boolean> {
    logger.log('debug', `Request for Bypassing/UnBypassing a Zone.`)
    return this.zones.byId(id).toggleBypass()
  }

  /**
   * Toggle Output
   * @param   {id}     id Of selected Output
   * @return  {Boolean}
   */
  async toggleOutput(id: number): Promise<boolean> {
    logger.log('debug', `Request for Toggle Output with id ${id}.`)
    try {
      return this.outputs.byId(id).toggleOutput()
    } catch (err) {
      logger.log('error', `Failed to Toggle Output ${id} : ${err}`)
      throw err
    }
  }
}

export class Agility extends RiscoPanel {
  constructor(Options: PanelOptions) {
    super(Options)
  }
}

export class WiComm extends RiscoPanel {
  constructor(Options: PanelOptions) {
    super(Options)
  }
}

export class WiCommPro extends RiscoPanel {
  constructor(Options: PanelOptions) {
    super(Options)
  }
}

export class LightSys extends RiscoPanel {
  constructor(Options: PanelOptions) {
    super(Options)
  }
}

export class ProsysPlus extends RiscoPanel {
  constructor(Options: PanelOptions) {
    super(Options)
  }
}

export class GTPlus extends ProsysPlus {
  constructor(Options: PanelOptions) {
    super(Options)
  }
}
