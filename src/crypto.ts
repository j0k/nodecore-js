// VeriBlock Blockchain Project
// Copyright 2017-2018 VeriBlock, Inc
// Copyright 2018-2019 Xenios SEZC
// All rights reserved.
// https://www.veriblock.org
// Distributed under the MIT software license, see the accompanying
// file LICENSE or http://www.opensource.org/licenses/mit-license.php.

import secp256k1 from 'secp256k1';
import { sha256 } from './hash';
import { randomBytes } from 'crypto';
import { addressFromPublicKey } from './address';
import { NodecoreKeypair } from './transaction';

// prefix which you need to add to an uncompressed public key to get asn1 (java-like) public key
export const PUBKEY_ASN1_PREFIX = Buffer.from(
  '3056301006072A8648CE3D020106052B8104000A034200',
  'hex'
);

// prefix which you need to add to a private key to get asn1 (java-like) private key
export const PRIVKEY_ASN1_PREFIX = Buffer.from(
  '303E020100301006072A8648CE3D020106052B8104000A042730250201010420',
  'hex'
);

export class PublicKey {
  // stores asn1 encoded public key as [pubkey asn1 prefix + 0x04 + x + y]
  // 88 bytes in total
  private readonly _full: Buffer;

  constructor(buffer: Buffer) {
    if (
      buffer.length === 88 &&
      buffer[23] === 0x04 &&
      buffer.slice(0, PUBKEY_ASN1_PREFIX.length).compare(PUBKEY_ASN1_PREFIX) ===
        0
    ) {
      // it is a full asn1 encoded key
      this._full = buffer;
    } else if (buffer.length === 65 && buffer[0] === 0x04) {
      // it is an uncompressed secp256k1 public key in format [0x04 + x + y]
      this._full = Buffer.concat([PUBKEY_ASN1_PREFIX, buffer]);
    } else if (buffer.length === 33) {
      // 0x02 = even root
      // 0x03 = odd root
      if (buffer[0] !== 0x02 && buffer[0] !== 0x03) {
        throw new Error(
          'invalid key format, expected 0x02 or 0x03 as first byte'
        );
      }

      // it is a compressed secp256k1 public key in format [0x0(2|3) + x]
      const uncompressed: Buffer = secp256k1.publicKeyConvert(buffer, false);
      this._full = Buffer.concat([PUBKEY_ASN1_PREFIX, uncompressed]);
    } else {
      throw new Error('unknown public key format');
    }
  }

  get compressed(): Buffer {
    // extract [0x02 + x] from [PUBKEY_ASN1_PREFIX + 0x04 + x + y]
    return Buffer.concat([
      Buffer.from([0x02]),
      this._full.slice(this._full.length - 64, this._full.length - 32),
    ]);
  }

  get uncompressed(): Buffer {
    // return last 65 bytes
    return this._full.slice(this._full.length - 65);
  }

  get asn1(): Buffer {
    return this._full;
  }

  getAddress(): string {
    return addressFromPublicKey(this);
  }

  toStringHex(): string {
    return this.asn1.toString('hex');
  }

  static fromStringHex(h: string): PublicKey {
    return new PublicKey(Buffer.from(h, 'hex'));
  }

  static fromStringBase64(b64: string): PublicKey {
    return new PublicKey(Buffer.from(b64, 'base64'));
  }
}

export class PrivateKey {
  // stores asn1 encoded private key as [asn1 prefix + 32 byte private key]
  private readonly _full: Buffer;

  constructor(buffer: Buffer) {
    if (buffer.length === 32) {
      this._full = Buffer.concat([PRIVKEY_ASN1_PREFIX, buffer]);
    } else if (
      buffer.length === 64 &&
      buffer
        .slice(0, PRIVKEY_ASN1_PREFIX.length)
        .compare(PRIVKEY_ASN1_PREFIX) === 0
    ) {
      this._full = buffer;
    } else {
      throw new Error('unknown private key format');
    }
  }

  get canonical(): Buffer {
    // return last 32 bytes
    return this._full.slice(this._full.length - 32);
  }

  get asn1(): Buffer {
    return this._full;
  }

  derivePublicKey(): PublicKey {
    const buf = secp256k1.publicKeyCreate(this.canonical, true);
    return new PublicKey(buf);
  }

  toStringHex(): string {
    return this.asn1.toString('hex');
  }

  static fromStringHex(h: string): PrivateKey {
    return new PrivateKey(Buffer.from(h, 'hex'));
  }

  static fromStringBase64(b64: string): PrivateKey {
    return new PrivateKey(Buffer.from(b64, 'base64'));
  }
}

export class Signature {
  private readonly _canonical: Buffer;

  constructor(buffer: Buffer) {
    if (buffer.length === 71) {
      this._canonical = secp256k1.signatureImport(buffer);
    } else if (buffer.length === 64) {
      this._canonical = buffer;
    } else {
      throw new Error('unknown signature format');
    }
  }

  /// returns full asn1 encoded signature of length 71 bytes
  get asn1(): Buffer {
    return secp256k1.signatureExport(this._canonical);
  }

  /// returns canonical secp256k1 signature with length 64 bytes
  get canonical(): Buffer {
    return this._canonical;
  }

  toStringHex(): string {
    return this.asn1.toString('hex');
  }

  static fromStringHex(h: string): Signature {
    return new Signature(Buffer.from(h, 'hex'));
  }

  static fromStringBase64(b64: string): Signature {
    return new Signature(Buffer.from(b64, 'base64'));
  }
}

export class KeyPair {
  constructor(readonly publicKey: PublicKey, readonly privateKey: PrivateKey) {}

  static fromPrivateKey(privateKey: PrivateKey | Buffer) {
    if (privateKey instanceof Buffer) {
      privateKey = new PrivateKey(privateKey);
    }

    const pub = privateKey.derivePublicKey();
    return new KeyPair(pub, privateKey);
  }

  static generate(entropy?: Buffer): KeyPair {
    if (!entropy) {
      entropy = randomBytes(32);
    }

    if (entropy.length < 32) {
      throw new Error('not enough entropy, supply 32 bytes or more');
    }

    const priv = new PrivateKey(sha256(entropy));
    const pub = priv.derivePublicKey();

    return new KeyPair(pub, priv);
  }

  exportToNodecore(): NodecoreKeypair {
    const addr = this.publicKey.getAddress();
    const pub = this.publicKey.toStringHex().toUpperCase();
    const priv = this.privateKey.toStringHex().toUpperCase();

    // private_key can be used for nodecore-cli command: importprivatekey
    return {
      address: addr,
      private_key: '40' + priv + pub,
    };
  }

  static importFromNodecorePrivateKey(privateKey: string): KeyPair {
    const priv = Buffer.from(privateKey.substr(2, 128), 'hex');

    return KeyPair.fromPrivateKey(priv);
  }
}

export class SHA256withECDSA {
  static sign(msg: Buffer, privateKey: PrivateKey | KeyPair): Signature {
    if (privateKey instanceof KeyPair) {
      privateKey = privateKey.privateKey;
    }

    const m = sha256(msg);
    const sig = secp256k1.sign(m, privateKey.canonical);
    return new Signature(sig.signature);
  }

  static verify(
    msg: Buffer,
    sig: Signature,
    publicKey: PublicKey | KeyPair
  ): boolean {
    if (publicKey instanceof KeyPair) {
      publicKey = publicKey.publicKey;
    }
    const m = sha256(msg);
    return secp256k1.verify(m, sig.canonical, publicKey.uncompressed);
  }
}
