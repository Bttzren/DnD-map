import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { CODE_ALPHABET } from '../shared/types';

/**
 * DM secrets are `nonce || hmac(key, code:nonce)`. With a stable key (from
 * SECRET_KEY or HOST_PASSWORD) the server can verify a DM even after it has
 * lost its disk, which is what lets a DM's browser restore a room safely.
 */
export class Secrets {
  readonly stable: boolean;
  private key: Buffer;

  constructor(key?: string | null) {
    this.stable = !!key;
    this.key = key ? createHash('sha256').update(`dnd-map:${key}`).digest() : randomBytes(32);
  }

  private sign(code: string, nonce: string) {
    return createHmac('sha256', this.key).update(`${code}:${nonce}`).digest('hex').slice(0, 32);
  }

  make(code: string): string {
    const nonce = randomBytes(16).toString('hex');
    return nonce + this.sign(code, nonce);
  }

  signatureValid(code: string, secret: string): boolean {
    if (typeof secret !== 'string' || !/^[0-9a-f]{64}$/.test(secret)) return false;
    const a = Buffer.from(secret.slice(32)), b = Buffer.from(this.sign(code, secret.slice(0, 32)));
    return timingSafeEqual(a, b);
  }

  /** May this secret recreate a room the server no longer has? */
  mayRestore(code: string, secret: string): boolean {
    if (typeof secret !== 'string' || !/^[0-9a-f]{64}$/.test(secret)) return false;
    return this.stable ? this.signatureValid(code, secret) : true;
  }
}

export function hashSecret(secret: string): string {
  return createHash('sha256').update(String(secret)).digest('hex');
}

export function sameHash(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function randomCode(): string {
  const bytes = randomBytes(6);
  let s = '';
  for (const b of bytes) s += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return s;
}
