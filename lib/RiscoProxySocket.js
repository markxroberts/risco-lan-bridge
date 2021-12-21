const Net = require("net");
const Socket = Net.Socket;
const Log_Level = require('./constants').Log_Level
const Risco_Base_Socket = require("./RiscoChannels").Risco_Base_Socket;

class Risco_ProxyTCP_Socket extends Risco_Base_Socket {

    constructor(SocketOptions) {
        super(SocketOptions);

        this.SocketMode = 'proxy';
        this.SocketTimeout = 120000;
        this.CloudRetryTimer = undefined;

        this.ListeningPort = SocketOptions.ListeningPort;
        this.CloudPort = SocketOptions.CloudPort;
        this.CloudUrl = SocketOptions.CloudUrl;

        this.TCPConnect();
    }

    /*
     * Create TCP Connection
     * @return  {Promise}
     */
    TCPConnect() {
        return new Promise((resolve, reject) => {
            try {
                if (this.ProxyInServer === undefined) {
                    this.ProxyInServer = new Net.Server();
                    // Accept only 1 connections at the same time
                    this.ProxyInServer.maxConnections = 1;
                } else {
                    this.ProxyInServer.removeAllListeners();
                }
                this.ProxyInServer.on('error', (err) => {
                    if (err.code === 'EADDRINUSE') {
                        this.logger(this.log, Log_Level.ERROR, `Cannot start Proxy ; Address already in use, retrying within 5sec...`);
                        setTimeout(() => {
                            this.ProxyInServer.close();
                            this.ProxyInServer.listen(this.ListeningPort);
                        }, 5000);
                    }
                });
                this.ProxyInServer.on('connection', (socket) => {
                    try {
                        this.Socket = socket;
                        this.CloudSocket = new Socket();
                        this.Socket.setTimeout(this.SocketTimeout);
                        this.CloudSocket.setTimeout(this.SocketTimeout);
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
                                        if ((this.Password > max_Password_Value) && (this.Password_length < 6)){
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
                        this.CloudSocket.on('ready', async () => {
                            if (this.CloudRetryTimer !== undefined) {
                                clearTimeout(this.CloudRetryTimer);
                            }
                            this.logger(this.log, Log_Level.VERBOSE, `Panel Socket and RiscoCloud Socket Connected.`);
                            this.IsConnected = true;
                            do {
                                await new Promise(r => setTimeout(r, 1000));
                            } while ((this.CloudConnected !== true) || (this.InRemoteConn));
                            this.PanelConnect();
                        });
                        this.Socket.once('error', (error) => {
                            this.logger(this.log, Log_Level.ERROR, `Socket Error : ${error.toString()}`);
                            if (!this.CloudSocket.destroyed) {
                                this.CloudSocket.destroy(`Destroy RiscoCloud Socket due to Panel Socket Error`)
                            }
                        });
                        this.CloudSocket.on('error', (error) => {
                            if (error.code === 'ECONNREFUSED') {
                                this.logger(this.log, Log_Level.ERROR, `Cannot connect to RiscoCloud, retrying within 5sec...`);
                                this.CloudSocket.end();
                                this.CloudRetryTimer = setTimeout(() => {
                                    this.CloudSocket.connect(this.CloudPort, this.CloudUrl);
                                }, 5000);
                            } else {
                                this.logger(this.log, Log_Level.ERROR, `RiscoCloud Socket Error : ${error.toString()}`);
                                if (this.Socket && !this.Socket.destroyed) {
                                    this.Socket.destroy(`Destroy Panel Socket due to RiscoCloud Socket Error`);
                                }
                            }
                        });
                        this.CloudSocket.on('connect', () => {
                            if (this.CloudRetryTimer !== undefined) {
                                clearTimeout(this.CloudRetryTimer);
                            }
                        })
                        this.Socket.once('close', () => {
                            this.logger(this.log, Log_Level.ERROR, `Socket Closed.`);
                            if (this.CloudRetryTimer !== undefined) {
                                clearTimeout(this.CloudRetryTimer);
                            }
                            this.Disconnect();
                        });
                        this.CloudSocket.on('close', () => {
                            if (this.CloudRetryTimer === undefined) {
                                this.logger(this.log, Log_Level.ERROR, `RiscoCloud Socket Closed.`);
                                if (this.Socket && !this.Socket.destroyed) {
                                    this.Socket.end(`Close Panel Socket due to RiscoCloud Socket is Closed`);
                                    this.Disconnect();
                                }
                            }
                        });
                        this.Socket.on('timeout', () => {
                            this.logger(this.log, Log_Level.ERROR, `${new Date().toLocaleTimeString()} Panel Socket Timeout.`);
                            this.Disconnect();
                        });
                        this.CloudSocket.on('timeout', () => {
                            this.logger(this.log, Log_Level.ERROR, `${new Date().toLocaleTimeString()} RiscoCloud Socket Timeout.`);
                            if (this.Socket && !this.Socket.destroyed) {
                                this.Socket.end(`Close Panel Socket due to RiscoCloud Socket Timeout`);
                            }
                            this.Disconnect();
                        });
                        this.Socket.once('data', (data) => {
                            this.NewDataHandler_PanelSocket(data);
                        });
                        this.CloudSocket.once('data', (data) => {
                            this.NewDataHandler_CloudSocket(data);
                        });
                        this.CloudSocket.connect(this.CloudPort, this.CloudUrl);
                        resolve(true);
                    } catch (err) {
                        this.logger(this.log, Log_Level.ERROR, `RiscoCloud Socket Error : ${error}`);
                    }
                });
                this.ProxyInServer.on('listening', () => {
                    const ProxyInfo = this.ProxyInServer.address();
                    this.logger(this.log, Log_Level.INFO, `Listening on IP ${ProxyInfo.address} and Port ${ProxyInfo.port}`);
                });
                if (!this.ProxyInServer.listening) {
                    this.ProxyInServer.listen(this.ListeningPort);
                }
            } catch (err) {
                this.logger(this.log, Log_Level.ERROR, `Error on Internal Socket creation : ${err}`);
            }
        });
    }

    /*
     * Hanle new data Received on Panel Socket Side
     * @param   {Buffer}
     */
    async NewDataHandler_PanelSocket(new_output_data) {
        let StringedBuffer = this.GetStringedBuffer(new_output_data);
        if (new_output_data[1] === 19) {
            let DecryptedBuffer = new Buffer.from(new_output_data, this.Encoding).toString(this.Encoding);
            this.logger(this.log, Log_Level.DEBUG, `Received Cloud data Buffer from Panel : ${StringedBuffer}`);
            this.CloudSocket.write(new_output_data);
        } else {
            let DecryptedBuffer = new Buffer.from(new_output_data, this.Encoding).toString(this.Encoding);
            if (new_output_data[1] !== 17) {
                this.logger(this.log, Log_Level.DEBUG, `Received data Buffer from Panel : ${StringedBuffer}`);
                if (this.InRemoteConn) {
                    this.CloudSocket.write(new_output_data);
                } else {
                    this.NewDataHandler(new_output_data);
                }
            } else if (new_output_data[1] === 17) {
                this.logger(this.log, Log_Level.DEBUG, `Received data Buffer from Panel : ${StringedBuffer}`);
                if (this.InRemoteConn) {
                    // To be able to correctly intercept the end of the remote connection, we must be able to decrypt
                    // the commands exchanged between the control panel and the RiscoCloud as soon as possible.
                    // As soon as a frame is long enough, we will check if we decode it correctly and if not we look
                    // for the decryption key.
                    let [RmtId, RmtCommandStr, RmtIsCRCOK] = this.RCrypt.DecodeMessage(new Buffer.from(new_output_data));
                    if (!RmtIsCRCOK && (new_output_data.length > 90) && !this.InCryptTest) {
                        setTimeout( r => {
                            this.InCryptTest = true;
                            let PossibleKey = 9999;
                            let TestResultOk = false;
                            do {
                                // Because the Buffer is modified by reference during decryption, a new Buffer is created on each attempt.
                                let TestBufferData = new Buffer.from(new_output_data);
                                this.RCrypt.Panel_Id = PossibleKey;
                                this.RCrypt.UpdatePseudoBuffer();
                                [RmtId, RmtCommandStr, RmtIsCRCOK] = this.RCrypt.DecodeMessage(TestBufferData);
                                TestResultOk = (() => {
                                    if (RmtIsCRCOK) {
                                        this.logger(this.log, Log_Level.DEBUG, `Panel Id is possible candidate : ${PossibleKey}`);
                                        this.InCryptTest = false;
                                        return true;
                                    } else {
                                        this.logger(this.log, Log_Level.DEBUG, `Panel Id is not : ${PossibleKey}`);
                                        PossibleKey--;
                                        return false;
                                    }
                                })();
                            } while ((PossibleKey >=0) && !TestResultOk);
                        }, 50);
                    }
                    [RmtId, RmtCommandStr, RmtIsCRCOK] = this.RCrypt.DecodeMessage(new Buffer.from(new_output_data));
                    if (parseInt(RmtId, 10) === parseInt(this.LastRmtId, 10)) {
                        this.CloudSocket.write(new_output_data);
                    }
                    if (RmtCommandStr.includes('STT')) {
                        this.NewDataHandler(new_output_data);
                    }
                } else {
                    this.NewDataHandler(new_output_data);
                }
            }
        }
        this.Socket.once('data', (data) => {
            this.NewDataHandler_PanelSocket(data);
        });
    }

    /*
     * Handle new data received on Cloud Socket side
     * @param   {Buffer}
     */
    NewDataHandler_CloudSocket(new_input_data) {
        let StringedBuffer = this.GetStringedBuffer(new_input_data);
        if (new_input_data[1] === 19) {
            setTimeout(async () => {
                this.CloudConnected = true;
            }, 45000);
            this.logger(this.log, Log_Level.DEBUG, `Received Cloud data Buffer from RiscoCloud : ${StringedBuffer}`);
            this.Socket.write(new_input_data);
        } else {
            this.Socket.write(new_input_data);
            let DecryptedBuffer = new Buffer.from(new_input_data, this.Encoding).toString(this.Encoding);
            let RmtCommandStr = undefined;
            let RmtIsCRCOK = undefined;
            [this.LastRmtId, RmtCommandStr, RmtIsCRCOK] = this.RCrypt.DecodeMessage(new Buffer.from(new_input_data));
            if (new_input_data[1] !== 17) {
                this.logger(this.log, Log_Level.DEBUG, `Received Remote data Buffer from RiscoCloud : ${StringedBuffer}`);
                switch (true) {
                    case (RmtCommandStr.includes('RMT=')):
                        this.emit('IncomingRemoteConnection');
                        this.InRemoteConn = true;
                        if (this.IsConnected) {
                            const RmtPassword = RmtCommandStr.substring(RmtCommandStr.indexOf('=') + 1);
                            if (parseInt(RmtPassword, 10) === parseInt(this.Password, 10)){
                                const FakeResponse = this.RCrypt.GetCommande('ACK', this.LastRmtId, false);
                                this.logger(this.log, Log_Level.DEBUG, `Send Fake Response to RiscoCloud Socket : ${this.GetStringedBuffer(FakeResponse)}`);
                                this.CloudSocket.write(FakeResponse);
                            }
                        } else {
                            this.Socket.write(new_input_data);
                        }
                        break;
                    case (DecryptedBuffer.includes('LCL')):
                        if (this.IsConnected) {
                            const FakeResponse = this.RCrypt.GetCommande('ACK', this.LastRmtId, false);
                            this.logger(this.log, Log_Level.DEBUG, `Send Fake Response to RiscoCloud Socket : ${this.GetStringedBuffer(FakeResponse)}`);
                            this.CloudSocket.write(FakeResponse);
                        } else {
                            this.Socket.write(new_input_data);
                        }
                        break;
                    default:
                        this.Socket.write(new_input_data);
                        break;
                }
            } else if (new_input_data[1] === 17) {
                this.Socket.write(new_input_data);
                if (this.InRemoteConn && RmtIsCRCOK && RmtCommandStr.includes('DCN')) {
                    this.InRemoteConn = false;
                    const FakeResponse = this.RCrypt.GetCommande('ACK', this.LastRmtId, true);
                    this.logger(this.log, Log_Level.DEBUG, `Send Fake Response to RiscoCloud Socket : ${this.GetStringedBuffer(FakeResponse)}`);
                    this.CloudSocket.write(FakeResponse);
                    this.emit('EndIncomingRemoteConnection');
                }
            }
        }
        this.CloudSocket.once('data', (data) => {
            this.NewDataHandler_CloudSocket(data);
        });
    }

    /*
     * Panel connection mechanism.
     * Send command RMT + Connection password
     * Send LCL command
     * After this point, the data is encrypted.
     * @paran   {Integer}   code length (between -6)
     * @return  {Boolean}   true/false if connected or not
     */
    async PanelConnect(code_len) {
        code_len = (code_len !== undefined) ? code_len : 4;

        if (!(this.CloudConnected)) {
            await this.TCPConnect();
            // Wait 100ms for avoid slow connection
            await new Promise(r => setTimeout(r, 100));
        }

        let PossibleKey = 9999;
        let ConnectPanel;

        ConnectPanel = await this.SendCommand(`RMT=${this.Password.toString().padStart(code_len, '0')}`)
            .then( async (data) => {
                if ((data !== undefined) && data && (data.includes('ACK') === true)) {
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
            })
            .then( async (data) => {
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
                                    if (IsCRCOK) {
                                        this.logger(this.log, Log_Level.DEBUG, `Panel Id is possible candidate : ${PossibleKey}`);
                                        return true;
                                    } else {
                                        this.logger(this.log, Log_Level.DEBUG, `Panel Id is not : ${PossibleKey}`);
                                        PossibleKey--;
                                        return false;
                                    }
                                })();
                            } while ((PossibleKey >=0) && !TestResultOk);

                            [CryptResult, ] = await this.CryptTableTester();
                            if ((PossibleKey >= 0) && (CryptResult)) {
                                await new Promise(r => setTimeout(r, 1000));
                                this.InCryptTest = false;
                                this.emit('CryptKeyOk');
                            } else if ((PossibleKey < 0)) {
                                this.InCryptTest = false;
                            } else {
                                this.InCryptTest = true;
                                // Reauth and restart test from actual PossibleKey
                                await new Promise(r => setTimeout(r, 100));
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
            .catch( (err) => {
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
        this.ProxyInServer.close();
        this.emit('Disconnected');
        if ((this.Socket !== undefined) && (!this.Socket.destroyed)) {
            this.IsConnected = this.CloudConnected = false;
            clearTimeout(this.WatchDogTimer);
            await this.SendCommand('DCN');
            if (this.Socket !== undefined) {
                this.Socket.removeAllListeners();
                this.Socket.destroy();
                this.Socket = undefined;
                this.logger(this.log, Log_Level.DEBUG, `Socket Destroyed.`);
            }
        }
        if ((this.CloudSocket !== undefined) && (!this.CloudSocket.destroyed)) {
            this.CloudSocket.destroy();
            this.logger(this.log, Log_Level.DEBUG, `RiscoCloud Socket Destroyed.`);
            this.CloudSocket.removeAllListeners();
            this.CloudSocket = undefined;
        }
        this.CloudConnected = false;
    }
}

module.exports = {
    Risco_ProxyTCP_Socket: Risco_ProxyTCP_Socket
}