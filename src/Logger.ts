/* 
 *  Package: risco-lan-bridge
 *  File: Logger.js
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

import {LogLevel} from "./constants";

export interface RiscoLogger {
    log(log_lvl: LogLevel, log_data: unknown): void
}

class DefaultLogger implements RiscoLogger {
    log(log_lvl: LogLevel, log_data: unknown): void {
        const ts = new Date().toISOString()
        const logMessage = `${ts} ${log_data}`
        switch (log_lvl) {
            case 'error' :
                console.error(logMessage);
                break;
            case 'warn' :
                console.warn(logMessage);
                break;
            case "info" :
                console.info(logMessage);
                break;
            case "verbose" :
                console.info(logMessage);
                break;
            case "debug" :
                console.debug(logMessage);
                break;
        }
    }
}

class DelegatingLogger implements RiscoLogger {

    constructor(public delegate: RiscoLogger) {
    }

    log(log_lvl: LogLevel, log_data: unknown) {
        this.delegate.log(log_lvl, log_data);
    }


}

export const logger = new DelegatingLogger(new DefaultLogger())