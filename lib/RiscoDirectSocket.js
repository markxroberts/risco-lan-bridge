const Net = require("net");
const Socket = Net.Socket;
const {Log_Level} = require("./constants");
const Risco_Base_Socket = require("./RiscoChannels").Risco_Base_Socket;

class Risco_DirectTCP_Socket extends Risco_Base_Socket {

    constructor(SocketOptions) {
        super(SocketOptions);

        this.SocketMode = 'direct';
        this.SocketTimeout = 30000;
        this.TCPConnect();
    }

    /*
     * Create TCP Connection
     * @return  {Promise}
     */
    async TCPConnect() {
        this.Socket = new Socket();
        this.Socket.setTimeout(this.SocketTimeout);
        if (this.Socket.connecting !== true) {
            return new Promise((resolve, reject) => {
                try {
                    this.on('BadCode', async () => {
                        // The AccessCode is incorrect.
                        // We go into a search mode to test all the codes between 0 and
                        // 999999 (maximum value).
                        // In the worst case (code 999999) the search can take up to several hours
                        // (around 100ms per test for an IPC2 card on the control panel, ie around 30 hours).
                        // Attention, access codes with one or more '0' prefixes are seen differently
                        // from the same code without the '0':
                        // 5678 != 05678 != 005678
                        const max_Password_Value = 999999;
                        if (this.DiscoverCode) {
                            this.logger(this.log, Log_Level.DEBUG, `Discovery Mode Enabled.`);
                            if (this.Discovering) {
                                do {
                                    if ((this.Password > max_Password_Value) && (this.Password_length < 6)) {
                                        this.Password_length++;
                                        this.Password = 0;
                                    } else if (this.Password > max_Password_Value) {
                                        this.Disconnect();
                                    } else {
                                        this.Password++;
                                    }
                                } while ((this.Password_length <= this.Password.toString().length) && (this.Password_length > 1));
                            } else {
                                this.logger(this.log, Log_Level.ERROR, `Bad Access Code : ${this.Password}`);
                                this.Discovering = true;
                                this.Password = 0;
                                this.Password_length = 1;
                                this.once('AccessCodeOk', () => {
                                    this.logger(this.log, Log_Level.VERBOSE, `Discovered Access Code : ${this.Password}`);
                                    this.Discovering = false;
                                });
                            }
                            let code_len = (this.Password.toString().length >= this.Password_length) ? this.Password.toString().length : this.Password_length;
                            this.Sequence_Id = 1;
                            this.PanelConnect(code_len);
                        } else {
                            this.logger(this.log, Log_Level.ERROR, `Discovery Mode Is not Enabled. To Discovering Access Code, Enable it!!`);
                        }
                    });
                    this.Socket.once('ready', async () => {
                        this.IsConnected = true;
                        this.logger(this.log, Log_Level.VERBOSE, `Socket Connected.`);
                        this.PanelConnect();
                    });
                    this.Socket.once('error', (data) => {
                        this.logger(this.log, Log_Level.ERROR, `Socket Error : ${data.toString()}`);
                        this.Disconnect();
                    });
                    this.Socket.once('close', () => {
                        this.logger(this.log, Log_Level.ERROR, `Socket Closed.`);
                        this.Disconnect();
                    });
                    this.Socket.once('timeout', () => {
                        this.logger(this.log, Log_Level.ERROR, `Socket Timeout.`);
                        this.Disconnect();
                    });
                    this.Socket.once('data', (new_input_data) => {
                        this.NewDataHandler(new_input_data);
                    });
                    this.Socket.connect(this.Port, this.Host);
                    resolve(true);
                } catch (error) {
                    this.logger(this.log, Log_Level.ERROR, `Socket Error : ${error}`);
                    resolve(false);
                }
            });
        }
    }

    /*
     * Panel connection mechanism.
     * Send command RMT + Connection password
     * Send LCL command
     * After this point, the data is encrypted.
     * @param   {Integer}   code length (between -6)
     * @return  {Boolean}   true/false if connected or not
     */
    async PanelConnect(code_len) {
        code_len = (code_len !== undefined) ? code_len : 4;

        if (!(this.IsConnected)) {
            await this.TCPConnect();
            // Wait 100ms for avoid slow connection
            await new Promise(r => setTimeout(r, 100));
        }

        let PossibleKey = 9999;
        let ConnectPanel;

        ConnectPanel = await this.SendCommand(`RMT=${this.Password.toString().padStart(code_len, '0')}`)
            .then(async (data) => {
                if (data !== undefined) {
                    if (data.includes('ACK') === true) {
                        if (this.Discovering) {
                            this.logger(this.log, Log_Level.DEBUG, `Access Code is Ok : ${this.Password}`);
                            this.emit('AccessCodeOk');
                            this.Discovering = false;
                        }
                        return await this.SendCommand(`LCL`);
                    } else if (this.IsErrorCode(data) && !this.Disconnecting) {
                        this.emit('BadCode');
                        return false;
                    } else {
                        return false;
                    }
                } else {
                    return false;
                }
            })
            .then(async (data) => {
                if (data && data.includes('ACK') === true) {
                    // Now, Encrypted channel is enabled
                    let CryptResult = true;
                    let TestBuffer;
                    this.RCrypt.CryptCommand = true;
                    await new Promise(r => setTimeout(r, 1000));
                    this.InCryptTest = true;
                    [CryptResult, TestBuffer] = await this.CryptTableTester();
                    if (this.DiscoverCode && !this.CryptKeyValidity) {
                        this.logger(this.log, Log_Level.DEBUG, `Bad Panel Id : ${this.RCrypt.Panel_Id}.`);
                        let CryptedResponseBuffer = new Buffer.from(TestBuffer);
                        this.emit('BadCryptKey');
                        this.once('CryptKeyOk', () => {
                            this.logger(this.log, Log_Level.VERBOSE, `Discovered Panel Id : ${this.RCrypt.Panel_Id}.`);
                            this.InCryptTest = false;
                        });
                        let TestResultOk = false;
                        do {
                            do {
                                // Because the Buffer is modified by reference during decryption, a new Buffer is created on each attempt.
                                let TestBufferData = new Buffer.from(CryptedResponseBuffer);
                                this.RCrypt.Panel_Id = PossibleKey;
                                this.RCrypt.UpdatePseudoBuffer();
                                let [Receive_Id, ReceiveCommandStr, IsCRCOK] = this.RCrypt.DecodeMessage(TestBufferData);
                                TestResultOk = (() => {
                                    if ((Receive_Id == '') && (this.IsErrorCode(ReceiveCommandStr)) && IsCRCOK) {
                                        this.logger(this.log, Log_Level.DEBUG, `Panel Id is possible candidate : ${PossibleKey}`);
                                        return true;
                                    } else {
                                        this.logger(this.log, Log_Level.DEBUG, `Panel Id is not : ${PossibleKey}`);
                                        PossibleKey--;
                                        return false;
                                    }
                                })();
                            } while ((PossibleKey >= 0) && !TestResultOk);

                            [CryptResult,] = await this.CryptTableTester();
                            if ((PossibleKey >= 0) && (CryptResult)) {
                                await new Promise(r => setTimeout(r, 1000));
                                this.InCryptTest = false;
                                this.emit('CryptKeyOk');
                            } else if ((PossibleKey < 0)) {
                                this.InCryptTest = false;
                            } else {
                                this.InCryptTest = true;
                                // Reauth and restart test from actual PossibleKey
                                await new Promise(r => setTimeout(r, 1000));
                                PossibleKey--;
                            }
                        } while (!ConnectPanel && this.InCryptTest);
                        // Empty buffer socket???
                        await new Promise(r => setTimeout(r, 2000));
                    }
                    this.InCryptTest = false;
                    return CryptResult;
                } else {
                    return false;
                }
            })
            .catch((err) => {
                return false;
            });

        if (!this.Discovering) {
            if (ConnectPanel !== false) {
                this.logger(this.log, Log_Level.DEBUG, `Connection to the control panel successfully established.`);
                this.IsConnected = true;
                this.emit('PanelConnected');
            } else {
                this.logger(this.log, Log_Level.ERROR, `Error when connecting to the control panel.`);
                this.Disconnect();
            }
        }
    }

    /*
     * Disconnects the Socket and stops the WatchDog function
     */
    async Disconnect() {
        this.Disconnecting = true;
        this.emit('Disconnected');
        if ((this.Socket !== undefined) && (!this.Socket.destroyed)) {
            clearTimeout(this.WatchDogTimer);
            await this.SendCommand('DCN');
            this.Socket.destroy();
            this.logger(this.log, Log_Level.DEBUG, `Socket Destroyed.`);
            this.Socket.removeAllListeners();
            this.Socket = undefined;
        }
        this.IsConnected = false;
        this.logger(this.log, Log_Level.DEBUG, `Socket Disconnected.`);
    }
}

module.exports = {
    Risco_DirectTCP_Socket: Risco_DirectTCP_Socket
}