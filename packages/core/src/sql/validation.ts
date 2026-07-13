import { InvalidIdentifierException } from '../exceptions/invalid-identifier.exception';

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_.]*$/;

export function assertSafeIdentifier(identifier: string): void {
  if (!IDENTIFIER.test(identifier)) {
    throw new InvalidIdentifierException(identifier);
  }
}
