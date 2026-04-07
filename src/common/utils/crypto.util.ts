import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

export class AesEncryptionUtil {
  constructor(private readonly masterKey: string) {}

  encrypt(plainText: string): string {
    const iv = randomBytes(16);
    const key = createHash('sha256').update(this.masterKey).digest();
    const cipher = createCipheriv('aes-256-cbc', key, iv);
    const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
    return `${iv.toString('hex')}:${encrypted.toString('hex')}`;
  }

  decrypt(cipherText: string): string {
    const [ivHex, encryptedHex] = cipherText.split(':');
    const key = createHash('sha256').update(this.masterKey).digest();
    const decipher = createDecipheriv('aes-256-cbc', key, Buffer.from(ivHex, 'hex'));
    const plain = Buffer.concat([
      decipher.update(Buffer.from(encryptedHex, 'hex')),
      decipher.final(),
    ]);
    return plain.toString('utf8');
  }
}
