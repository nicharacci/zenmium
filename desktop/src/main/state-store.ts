import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** Small atomic JSON store under userData/zenmium/<file>. */
export class JsonStore<T> {
  private readonly file: string;

  constructor(userDataDir: string, file: string) {
    this.file = join(userDataDir, "zenmium", file);
  }

  read(fallback: T): T {
    try {
      const raw = readFileSync(this.file, "utf8");
      const parsed = JSON.parse(raw) as T;
      return parsed ?? fallback;
    } catch {
      return fallback;
    }
  }

  write(value: T): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(value, null, 2), "utf8");
    renameSync(tmp, this.file);
  }
}
