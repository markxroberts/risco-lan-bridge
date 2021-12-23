import { AssertionError } from 'assert'

export function assertIsDefined<T>(val: T, valName: string, message = ''): asserts val is NonNullable<T> {
  if (val === undefined || val === null) {
    throw new AssertionError({
      message: `Expected '${valName}' to be defined, but received ${val}. ${message}`
    });
  }
}

export function assertIsTrue(val: boolean | undefined, valName: string, message = '') {
  if (val !== true) {
    throw new AssertionError({
      message: `Expected '${valName}' to be true, but received ${val}. ${message}`
    });
  }
}

export function assertIsFalse(val: boolean | undefined, valName: string, message = '') {
  if (val !== false) {
    throw new AssertionError({
      message: `Expected '${valName}' to be false, but received ${val}. ${message}`
    });
  }
}