import { RiscoComm } from './RiscoComm';
import { logger, RiscoLogger } from './Logger';
import { Zone, ZoneList } from './Devices/Zones';
import { OutputList } from './Devices/Outputs';
import { PartitionList } from './Devices/Partitions';
import { MBSystem } from './Devices/System';
import { EventEmitter } from 'events';
import { SocketMode } from './RiscoBaseSocket';

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
  panelConnectionDelay?: number,
  cloudConnectionDelay?: number,
  encoding?: BufferEncoding,
  socketMode?: SocketMode,
  ntpServer?: string,
  ntpPort?: number,
  commandsLog?: boolean,
  reconnectDelay?: number,
  badCRCLimit?: number
}

export class RiscoPanel extends EventEmitter {

  riscoComm: RiscoComm;

  zones!: ZoneList;
  outputs!: OutputList;
  partitions!: PartitionList;
  mbSystem!: MBSystem;

  devicesDiscoveryCompleted = false

  constructor(options: PanelOptions) {
    super();
    if (options.logger) {
      logger.delegate = options.logger;
    }
    this.riscoComm = new RiscoComm(options);

    this.riscoComm.on('PanelCommReady', async () => {
      if (!this.devicesDiscoveryCompleted) {
        logger.log('info', `Starting devices discovery`);
        try {
          this.mbSystem = await this.riscoComm.getSystemData();
          this.zones = await this.riscoComm.GetAllZonesData();
          this.outputs = await this.riscoComm.getAllOutputsData();
          this.partitions = await this.riscoComm.getAllPartitionsData();
          this.devicesDiscoveryCompleted = true
        } catch (e) {
          logger.log('error', e);
          logger.log('error', `Error caught during devices discovery, retrying`);
          this.riscoComm.tcpSocket?.disconnect(true);
          return;
        }
        logger.log('debug', `End of devices discovery`);
      } else {
        logger.log('info', 'Devices discovery already done')
      }

      logger.log('debug', `Starting watchdog`);
      this.riscoComm.watchDog();

      this.mbSystem.on('SStatusChanged', (EventStr: string) => {
        logger.log('debug', `MBSystem Status Changed :\n New Status: ${EventStr}`);
      });
      this.mbSystem.on('ProgModeOn', () => {
        if (!this.mbSystem.NeedUpdateConfig) {
          this.zones.values.forEach((zone: Zone) => {
            zone.NeedUpdateConfig = true;
          });
          this.outputs.values.forEach((output) => {
            output.NeedUpdateConfig = true;
          });
          this.partitions.values.forEach((partition) => {
            partition.NeedUpdateConfig = true;
          });
          this.mbSystem.NeedUpdateConfig = true;
          const WarnUpdate = () => {
            logger.log('error', `Panel configuration has been changed since connection was established.`);
            logger.log('error', `Please restart your plugin and its configuration to take into account the changes and avoid any abnormal behavior.`);
          };
          WarnUpdate();
          setInterval(() => {
            WarnUpdate();
          }, 60000);
        }
      });
      this.zones.on('ZStatusChanged', (Id: number, EventStr: string) => {
        logger.log('debug', `Zones Status Changed : Zone Id ${Id}, New Status: ${EventStr}`);
      });
      this.outputs.on('OStatusChanged', (Id: number, EventStr: string) => {
        logger.log('debug', `Outputs Status Changed : Output Id ${Id}, New Status: ${EventStr}`);
      });
      this.partitions.on('PStatusChanged', (Id: number, EventStr: string) => {
        logger.log('debug', `Partition Status Changed : Partition Id ${Id}, New Status: ${EventStr}`);
      });

      // Listen Event for new Status from Panel
      this.riscoComm.on('NewZoneStatusFromPanel', (data) => {
        const ZId = parseInt(data.substring(data.indexOf('ZSTT') + 4, data.indexOf('=')), 10);
        if (!isNaN(ZId)) {
          this.zones.byId(ZId).Status = data.substring(data.indexOf('=') + 1);
        }
      });
      this.riscoComm.on('NewOutputStatusFromPanel', (data) => {
        const OId = parseInt(data.substring(data.indexOf('OSTT') + 4, data.indexOf('=')), 10);
        if (!isNaN(OId)) {
          this.outputs.byId(OId).Status = data.substring(data.indexOf('=') + 1);
        }
      });
      this.riscoComm.on('NewPartitionStatusFromPanel', (data) => {
        const PId = parseInt(data.substring(data.indexOf('PSTT') + 4, data.indexOf('=')), 10);
        if (!isNaN(PId)) {
          this.partitions.byId(PId).Status = data.substring(data.indexOf('=') + 1);
        }
      });
      this.riscoComm.on('NewMBSystemStatusFromPanel', (data) => {
        this.mbSystem.Status = data.substring(data.indexOf('=') + 1);
      });

      // Finally, system is ready
      this.emit('SystemInitComplete');
      logger.log('verbose', `System initialization completed.`);
    });

    process.on('SIGINT', async () => {
      logger.log('info', `Received SIGINT, Disconnecting`);
      await this.disconnect();
      process.exit(0);
    });
    process.on('SIGTERM', async () => {
      logger.log('info', `Received SIGTERM, Disconnecting`);
      await this.disconnect();
      process.exit(0);
    });

    if (options.autoConnect != false) {
      logger.log('info', `autoConnect enabled, starting communication`);
      this.connect().then(_ => () => {});
    } else {
      logger.log('info', `autoConnect disabled in configuration file, you must call connect() in order to initialize the connection.`);
    }
  }

  /**
   * Alias for the InitRPSocket function
   * For external call and manual Connexion
   */
  async connect() {
    await this.riscoComm.initRPSocket();
  }

  /**
   * Causes the TCP socket to disconnect
   */
  async disconnect() {
    logger.log('verbose', `Disconnecting from Panel.`);
    await this.riscoComm.disconnect();
  }

  async armHome(id: number): Promise<boolean> {
    return this.armPart(id, 6);
  }

  async armAway(id: number): Promise<boolean> {
    return this.armPart(id, 5);
  }

  async armGroup(id: number, ArmType: number): Promise<boolean> {
    return this.armPart(id, ArmType);
  }

  /**
   * Arm the selected partition
   * TODO : find command for temporised arming
   * @param   id          id Of selected PArtition
   * @param   ArmType     Type of arm : Away(0) or HomeStay(1)
   * @return  Boolean
   */
  private async armPart(id: number, ArmType: number): Promise<boolean> {
    logger.log('debug', `Request for Arming a Partition.`);
    try {
      if ((id > this.partitions.values.length) || (id < 0)) {
        logger.log('warn', `Failed to Arm partition ${id} : invalid partition id`);
        return false;
      }
      const SelectedPart = this.partitions.byId(id);
      switch (ArmType) {
        case 1:
        case 2:
        case 3:
        case 4:
          return SelectedPart.groupArm(ArmType);
        case 5:
          return SelectedPart.awayArm();
        case 6:
          return SelectedPart.homeStayArm();
        default:
          throw new Error(`Unsupported arm type :${ArmType}`);
      }
    } catch (err) {
      logger.log('error', `Failed to Full/Stay Arming partition : ${id}`);
      throw err;
    }
  }

  /**
   * Disarm the selected partition
   * @param   id Identifier of selected Partition
   * @return  true if success
   */
  async disarmPart(id: number): Promise<boolean> {
    logger.log('debug', `Request for Disarming a Partition.`);
    try {
      if ((id > this.partitions.values.length) || (id < 0)) {
        logger.log('warn', `Failed to disarm partition ${id} : invalid partition id`);
        return false;
      }
      return await this.partitions.byId(id).disarm();
    } catch (err) {
      logger.log('error', `Failed to disarm the Partition ${id}: ${err}`);
      throw err;
    }
  }

  /**
   * Bypass or UnBypass the selected Zone
   * @param   id     id Of selected Zone
   * @return  boolean
   */
  async toggleBypassZone(id: number): Promise<boolean> {
    logger.log('debug', `Request for Bypassing/UnBypassing a Zone.`);
    return this.zones.byId(id).toggleBypass();
  }

  /**
   * Toggle Output
   * @param   {id}     id Of selected Output
   * @return  {Boolean}
   */
  async toggleOutput(id: number): Promise<boolean> {
    logger.log('debug', `Request for Toggle Output with id ${id}.`);
    try {
      return this.outputs.byId(id).toggleOutput();
    } catch (err) {
      logger.log('error', `Failed to Toggle Output ${id} : ${err}`);
      throw err;
    }
  }
}

export class Agility extends RiscoPanel {
  constructor(Options: PanelOptions) {
    super(Options);
  }
}

export class WiComm extends RiscoPanel {
  constructor(Options: PanelOptions) {
    super(Options);
  }
}

export class WiCommPro extends RiscoPanel {
  constructor(Options: PanelOptions) {
    super(Options);
  }
}

export class LightSys extends RiscoPanel {
  constructor(Options: PanelOptions) {
    super(Options);
  }
}

export class LightSysPlus extends RiscoPanel {
  constructor(Options: PanelOptions) {
    super(Options);
  }
}

export class ProsysPlus extends RiscoPanel {
  constructor(Options: PanelOptions) {
    super(Options);
  }
}

export class GTPlus extends ProsysPlus {
  constructor(Options: PanelOptions) {
    super(Options);
  }
}
