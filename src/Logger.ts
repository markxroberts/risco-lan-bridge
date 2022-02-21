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
