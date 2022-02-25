import { CommandContext } from './RiscoBaseSocket';

export class RiscoError extends Error {
  constructor(message?: string) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class RiscoCommandError extends RiscoError {
  constructor(public cmd: CommandContext, reason: string) {
    super(`Risco command error: ${reason}. Command: ${JSON.stringify(cmd)}`);
  }
}
