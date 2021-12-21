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

'use strict';

const EventEmitter = require('events').EventEmitter;
const Risco_ErrorCode = require('./constants').RiscoError;
const Log_Level = require('./constants').Log_Level;

class Risco_Base_Socket extends EventEmitter {

    constructor(SocketOptions) {
        super();

        this.ProxyInServer = undefined;
        this.CloudConnected = false;
        this.CloudSocket = undefined;

        this.Host = SocketOptions.Panel_Ip;
        this.Port = SocketOptions.Panel_Port;
        this.RCrypt = SocketOptions.RCrypt;
        this.Password = SocketOptions.Password;
        this.DiscoverCode = SocketOptions.DiscoverCode;
        this.logger = SocketOptions.logger;
        this.log = SocketOptions.log;

        this.Encoding = SocketOptions.Encoding || 'utf-8';

        this.LastRmtId = -5;
        this.IsConnected = false;
        this.Sequence_Id = 1;
        // this.ReSendData = false;
        this.WatchDogTimer = undefined;
        this.BadCRCTimer = undefined;
        this.BadCRCCount = 0;
        this.BadCRCLimit = 10;
        this.InProg = false;
        this.Discovering = false;
        this.InCryptTest = false;
        this.LastReceivedBuffer = undefined;
        this.LastMisunderstoodData = undefined;
        this.Password_length = 1;
        this.Disconnecting = false;
    }

    /*
     * Processing of received datas.
     * @param   {Buffer}    Encrypted Datas from Panel
     */
    NewDataHandler(data) {
        // Sometimes, Panel send multiple datas in same time
        // This behavior occurs in the event of a slowdown on the client side,
        // several data sets are then put in the reception buffer.
        let DataSeparator = `${String.fromCharCode(3)}${String.fromCharCode(2)}`;
        let lastReceivedId = 0;
        do {
            let subData = data;
            if (data.includes(DataSeparator)) {
                let SeparatorPos = data.indexOf(DataSeparator) + 1;
                subData = data.slice(0, SeparatorPos);
                data = data.slice(SeparatorPos);
            }
            this.LastReceivedBuffer = new Buffer.from(subData);
            let StringedBuffer = this.GetStringedBuffer(this.LastReceivedBuffer);

            this.logger(this.log, Log_Level.DEBUG, `Received data Buffer : ${StringedBuffer}`);
            let [Receive_Id, ReceiveCommandStr, IsCRCOK] = this.RCrypt.DecodeMessage(subData);
            this.LastMisunderstoodData = undefined;

            // If the CRC does not match, it is a communication error.
            // In this case, we increase the bad CRC counter for communication
            // cut-off after a certain number of errors (10)
            if (!IsCRCOK) {
                if (!this.InCryptTest) {
                    this.LastMisunderstoodData = ReceiveCommandStr;
                    this.BadCRCCount++;
                    this.ReSendData = true;
                    if (this.BadCRCCount > this.BadCRCLimit) {
                        this.logger(this.log, Log_Level.ERROR, `Receive[${Receive_Id}] Too many bad CRC value.`);
                        this.emit('BadCRCLimit');
                        this.Disconnect();
                        return;
                    } else {
                        // A timer is started to reset the counter to zero in the event of a temporary disturbance.
                        // This counter is canceled with each new error and then immediately restarted.
                        clearTimeout(this.BadCRCTimer);
                        this.BadCRCTimer = setTimeout( () => {
                            this.BadCRCCount = 0;
                        }, 60000);
                        this.logger(this.log, Log_Level.WARN, `Receive[${Receive_Id}] Wrong CRC value for the response.`);
                        this.emit('BadCRCData');
                    }
                } else {
                    lastReceivedId = Receive_Id;
                    this.CryptKeyValidity = false ;
                    this.LastMisunderstoodData = ReceiveCommandStr;
                }
            } else {
                // Don't do anything if it's a repeated Message
                if (lastReceivedId != Receive_Id) {
                    if (Receive_Id == '' && this.IsErrorCode(ReceiveCommandStr)) {
                        this.LastMisunderstoodData = ReceiveCommandStr;
                    } else if (Receive_Id >= 50) {
                        // it's an info from panel
                        // Send 'ACK' for acknowledge received datas
                        this.logger(this.log, Log_Level.DEBUG, `Receive[${Receive_Id}] Data from Panel, need to send an ACK.`);
                        this.SendAck(Receive_Id);
                    } else {
                        // it's a response from panel
                        this.logger(this.log, Log_Level.DEBUG, `Receive[${Receive_Id}] Command response from Panel.`);
                        let response_Id = parseInt(Receive_Id, 10);
                        if (response_Id == this.Sequence_Id) {
                            this.logger(this.log, Log_Level.DEBUG, `Receive[${Receive_Id}] Command response was expected, processing it.`);
                            this.emit(`CmdResponse_${Receive_Id}`, ReceiveCommandStr);
                            this.IncreaseSequenceId();
                        } else {
                            // Else, Unexpected response, we do not treat
                            this.logger(this.log, Log_Level.DEBUG, `Receive[${Receive_Id}] Command response was unexpected, ignoring processing it.`);
                        }

                    }
                    if (this.IsConnected) {
                        // Whether the data is expected or not, it is transmitted for analysis
                        this.emit('DataReceived', ReceiveCommandStr);
                    }
                    lastReceivedId = Receive_Id;
                }
            }
        } while (data.includes(DataSeparator));

        if (this.SocketMode === 'direct') {
            // We go back to 'listening' mode
            this.Socket.once('data', (new_input_data) => {
                this.NewDataHandler(new_input_data);
            });
        }
    }

    /*
    * Send a command and get the result part (after '=' sign)
    * @param   {Buffer}
    * @return  {String} The command result as String
    */
    async GetResult(CommandStr, ProgCmd) {
        let Result = await this.SendCommand(CommandStr, ProgCmd)
        Result = Result.substring(Result.indexOf('=') + 1).trim();
        return Result;
    }

    /*
    * Send a command and get the result part (after '=' sign) as an Integer
    * @param   {Buffer}
    * @return  {Integer} The command result as Integer
    */
    async GetIntResult(CommandStr, ProgCmd) {
        let Result = await this.GetResult(CommandStr, ProgCmd)
        return parseInt(Result);
    }

    /*
    * Send a command and check an 'ACK' is received
    * @param   {Buffer}
    * @return  {Boolean}
    */
    async GetAckResult(CommandStr, ProgCmd) {
        let Result = await this.SendCommand(CommandStr, ProgCmd)
        return Result === 'ACK';
    }

    /*
     * Send Data to Socket and Wait for a response
     * @param   {Buffer}
     * @return  {Promise}
     */
    async SendCommand(CommandStr, ProgCmd) {
        ProgCmd = ProgCmd || false;
        let WaitResponse = true;
        let ReceivedResponse = undefined;
        let TimeoutDelay = 5000;
        let IsTimedOut = false;
        let ReSendData = false;

        if (this.InCryptTest) {
            if (this.SocketMode === 'proxy') {
                TimeoutDelay = 5000;
            } else {
                TimeoutDelay = 500;
            }
        } else if ((this.Discovering) && (this.SocketMode === 'proxy')) {
            TimeoutDelay = 100;
        }
        if (this.InProg) {
            TimeoutDelay = 29000;
        }
        this.logger(this.log, Log_Level.DEBUG, `Sending Command: ${CommandStr}`);
        return new Promise(async (resolve, reject) => {
            try {
                const errFunc = (err) => {
                    resolve(err);
                };
                const CommandSent = (response) => {
                    WaitResponse = false;
                    ReceivedResponse = response;
                    if (this.InCryptTest) {
                        this.CryptKeyValidity = true;
                    }
                };
                while (this.InProg && !ProgCmd) {
                    // if we are in programmation mode, wait 5s before retry
                    await new Promise(r => setTimeout(r, 5000));
                }
                try {
                    if ((this.Socket !== undefined) && (this.Socket.listenerCount('error') === 0)) {
                        this.Socket.on('error', errFunc);
                    }

                    let Cmd_Id = this.Sequence_Id.toLocaleString('en-US', {minimumIntegerDigits: 2, useGrouping:false});
                    if (this.listenerCount(`CmdResponse_${Cmd_Id}`) === 0) {
                        this.once(`CmdResponse_${Cmd_Id}`, CommandSent);
                    }

                    let EncryptedCmd = this.RCrypt.GetCommande(CommandStr, Cmd_Id);

                    if ((this.Socket !== undefined) && (!this.Socket.destroyed)) {
                        this.Socket.write(EncryptedCmd);
                        this.logger(this.log, Log_Level.DEBUG, `Command[${Cmd_Id}] Sent.`);
                        // Emit data to RiscoPanel Object
                        this.emit('DataSent', CommandStr, this.Sequence_Id);
                        let TimeOutTimer = setTimeout((CommandStr) => {
                            IsTimedOut = true;
                            this.logger(this.log, Log_Level.DEBUG, `Command[${Cmd_Id}] '${CommandStr}' Timeout`);
                            this.off(`CmdResponse_${Cmd_Id}`, CommandSent);
                            ReSendData = true;
                        }, TimeoutDelay, CommandStr);
                        if (this.IsConnected) {
                            do {
                                if (!this.InProg) {
                                    await new Promise(r => setTimeout(r, 10));
                                } else {
                                    await new Promise(r => setTimeout(r, 1000));
                                }
                            } while ((WaitResponse && !IsTimedOut) || (this.InProg && !ProgCmd));
                            clearTimeout(TimeOutTimer);

                            if (this.LastMisunderstoodData !== undefined) {
                                if (!this.InCryptTest) {
                                    this.logger(this.log, Log_Level.DEBUG, `Command[${Cmd_Id}] Need to re-sent data.`);
                                    ReSendData = true;
                                } else {
                                    ReceivedResponse = this.LastMisunderstoodData;
                                }
                            }
                            if (ReSendData) {
                                ReSendData = false;
                                ReceivedResponse = await this.SendCommand(CommandStr);
                            }
                        } else {
                            resolve(false);
                        }
                        if ((this.Socket !== undefined) && (!this.Socket.destroyed)) {
                            this.Socket.off('error', errFunc);
                        }
                        this.logger(this.log, Log_Level.DEBUG, `Command[${Cmd_Id}] SendCommand receive this response : ${ReceivedResponse}`);
                        resolve(ReceivedResponse);
                    } else {
                        this.logger(this.log, Log_Level.ERROR, `Command[${Cmd_Id}] Socket Destroyed while using it.`);
                        if (this.Socket !== undefined) {
                            this.Socket.off('error', errFunc);
                        }
                        this.IsConnected = false;
                        this.Disconnect();
                    }
                } catch (err){
                    this.Socket.off('error', errFunc);
                    resolve(false);
                }
            } catch {
                resolve(false);
            }
        });
    }

    /*
     * Increase the sequence number.
     * The sequence number must be between 1 and 49 inclusive.
     */
    IncreaseSequenceId() {
        if (this.Sequence_Id >= 49 ) {
            this.Sequence_Id = 0;
        }
        this.Sequence_Id++;
    }

    /*
     * Send 'ACK' for acknowledge received datas
     * The response must match with the data sent.
     * The data ID number is used to identify the response.
     * @param   {String}    String matches Id
     */
    SendAck(Id) {
        this.logger(this.log, Log_Level.DEBUG, `Receive[${Id}] Sending Ack.`);
        let EncryptedCmd = this.RCrypt.GetCommande('ACK', Id.toLocaleString('en-US', {minimumIntegerDigits: 2, useGrouping:false}));
        this.Socket.write(EncryptedCmd);
    }

    /*
     * Compare Response with Risco ErrorCode
     * @return  {boolean}
     */
    IsErrorCode(data) {
        if ((data !== undefined) && (Object.keys(Risco_ErrorCode)).includes(data)) {
            return true;
        } else if ((this.SocketMode === 'proxy') && (data === undefined)) {
            return true;
        } else {
            return false;
        }
    }

    /*
     * Convert Buffer to string representation
     * @param   {Buffer}
     * @retrun  {string}
     */
    GetStringedBuffer(data) {
        let result = new Array(0);
        for (const value of data) {
            result.push(value);
        }
        return `[${result.join(',')}]`;
    }

    /*
     *  Function used to test the encryption table.
     *  If the result does not match, it means that the panel Id is not the correct one
     * and that it must be determined (provided that the option is activated).
     */
    async CryptTableTester() {
        const Test_Cmd = `CUSTLST`;
        return new Promise(async (resolve, reject) => {
            try {
                this.CryptKeyValidity = undefined;
                // To avoid false positives, this command provides a long response which
                // allows only few possible errors when calculating the CRC
                await this.SendCommand(`${Test_Cmd}?`)
                    .then( async (response) => {
                        while (this.CryptKeyValidity === undefined) {
                            await new Promise(r => setTimeout(r, 10));
                        }
                        this.logger(this.log, Log_Level.DEBUG, `Response crypt: ${response}`);
                        resolve([this.CryptKeyValidity && !this.IsErrorCode(response), this.LastReceivedBuffer]);
                    })
                    .catch( (err) => {
                        resolve([false, undefined]);
                    });
            } catch {
                resolve([false, undefined]);
            }
        });
    }

    /*
     * For reasons of sustainability, it is preferable to deactivate the RiscoCloud.
     * This function performs this operation.
     * @return  {boolean}       true/false if success/fails
     */
    async DisableRiscoCloud() {
        if (await this.EnableProgMode()) {
            this.logger(this.log, Log_Level.DEBUG, `Disabling RiscoCloud.`);
            await this.SendCommand(`ELASEN=0`, true)
            .then( async (data) => {
                if (data.includes('ACK') === true) {
                    let ExitProg = await this.DisableProgMode();
                    return ExitProg;
                } else {
                    return false;
                }
            })
            .then( result => {
                if (result) {
                    this.logger(this.log, Log_Level.DEBUG, `RiscoCloud Successfully Disabled.`);
                } else {
                    this.logger(this.log, Log_Level.DEBUG, `RiscoCloud not Diasbled.`);
                }
                return result;
            })
            .catch( (err) => {
                this.logger(this.log, Log_Level.ERROR, `Error on Disabling RiscoCloud: ${err.toString()}`);
                return false;
            });
        } else {
            this.Disconnect();
        }
    }

    /*
     * This function Activate RiscoCloud.
     * @return  {boolean}       true/false if success/fails
     */
    async EnableRiscoCloud() {
        if (await this.EnableProgMode()) {
            this.logger(this.log, Log_Level.DEBUG, `Enabling RiscoCloud.`);
            await this.SendCommand(`ELASEN=1`, true)
            .then( async (data) => {
                if (data.includes('ACK') === true) {
                    let ExitProg = await this.DisableProgMode();
                    return ExitProg;
                } else {
                    return false;
                }
            })
            .then( result => {
                if (result) {
                    this.logger(this.log, Log_Level.DEBUG, `RiscoCloud Successfully Enabled.`);
                } else {
                    this.logger(this.log, Log_Level.DEBUG, `RiscoCloud not Enabled.`);
                }
                return result;
            })
            .catch( (err) => {
                this.logger(this.log, Log_Level.ERROR, `Error on Enabling RiscoCloud: ${err.toString()}`);
                return false;
            });
        } else {
            this.Disconnect();
        }
    }

    /*
     * Modification of the configuration of the control unit according to the
     * parameters of the plugin and the suitability of the configuration
     * @param   {Array of String}   Command to be executed for modification
     * @return  {boolean}           true/false if success/fails
     */
    async ModifyPanelConfig(CommandsArr) {
        this.logger(this.log, Log_Level.DEBUG, `Modifying Panel Configuration.`);
        let ExitProgMode = undefined;
        if (await this.EnableProgMode()) {
            CommandsArr.forEach(async (command) => {
                await this.SendCommand(command, true)
                    .then(async (data) => {
                        if (data.includes('ACK') === true) {
                            ExitProgMode = await this.DisableProgMode();
                            return ExitProgMode;
                        } else {
                            return false;
                        }
                    })
                    .catch(async (err) => {
                        await this.DisableProgMode();
                        return false;
                    });
            });
        } else {
            this.Disconnect();
        }
    }

    /*
     * Switches the control unit to programming mode
     * @return  {Promise}
     */
    async EnableProgMode() {
        return new Promise(async (resolve, reject) => {
            await this.SendCommand(`PROG=1`, true)
                .then( data => {
                    if (data.includes('ACK') === true) {
                        this.logger(this.log, Log_Level.DEBUG, `Entering Programmation Mode.`);
                        this.InProg = true;
                        resolve(true);
                    } else {
                        this.logger(this.log, Log_Level.DEBUG, `Cannot Entering Programmation Mode.`);
                        resolve(false);
                    }
                })
                .catch( (err) => {
                    resolve(false);
                });
        });
    }

    /*
     * Switches the control unit out of programming mode
     * @return  {Promise}
     */
    async DisableProgMode() {
        return new Promise(async (resolve, reject) => {
            await this.SendCommand(`PROG=2`, true)
                .then( async (data) => {
                    if (data.includes('ACK') === true) {
                        this.logger(this.log, Log_Level.DEBUG, `Exiting Programmation Mode.`);
                        //this.InProg = false;
                        resolve(true);
                    } else {
                        this.logger(this.log, Log_Level.DEBUG, `Cannot Exiting Programmation Mode.`);
                        //this.InProg = false;
                        resolve(false);
                    }
                })
                .catch( (err) => {
                    this.InProg = false;
                    resolve(false);
                });
        });
    }
}

module.exports = {
    Risco_Base_Socket: Risco_Base_Socket
}