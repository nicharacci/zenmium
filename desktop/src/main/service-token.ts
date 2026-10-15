import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** Main-process-only codec. A token must never fall back to plaintext storage. */
export interface SecureStringCodec {
  encrypt(value: string): Uint8Array;
  decrypt(value: Uint8Array): string;
}

/** Small safeStorage-backed store for the optional Goalpost/agent service token. */
export class ServiceTokenStore {
  private readonly file: string;
  private readonly codec?: SecureStringCodec;

  constructor(directory: string, codec?: SecureStringCodec) {
    this.file = join(directory, "service-token.bin");
    this.codec = codec;
  }

  get encryptionAvailable(): boolean {
    return Boolean(this.codec);
  }

  hasToken(): boolean {
    if (!this.codec) return false;
    try {
      const encrypted = readFileSync(this.file);
      return this.codec.decrypt(encrypted).trim().length > 0;
    } catch {
      return false;
    }
  }

  set(value: string): void {
    const token = value.trim();
    if (!token) {
      this.clear();
      return;
    }
    if (!this.codec) throw new Error("Secure token storage is unavailable on this system.");
    const encrypted = this.codec.encrypt(token);
    mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
    const temporary = `${this.file}.tmp`;
    writeFileSync(temporary, Buffer.from(encrypted), { mode: 0o600, flag: "w" });
    renameSync(temporary, this.file);
  }

  clear(): void {
    try { unlinkSync(this.file); } catch { /* The token is already absent. */ }
  }
}
