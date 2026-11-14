/**
 * Log leggibile su file con rotazione per dimensione: ponte.log, ponte.1.log … ponte.(N-1).log.
 * Scrittura sincrona (appendFileSync): una riga scritta resta anche se il processo si ferma subito dopo.
 */
import { appendFileSync, existsSync, renameSync, rmSync, statSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export class RotatingLog {
  constructor({ dir, name = 'ponte', maxBytes, files, now = Date.now, echo = false }) {
    mkdirSync(dir, { recursive: true });
    Object.assign(this, { dir, name, maxBytes, files, now, echo });
  }

  file(index = 0) { return join(this.dir, index === 0 ? `${this.name}.log` : `${this.name}.${index}.log`); }

  #rotate() {
    rmSync(this.file(this.files - 1), { force: true });
    for (let i = this.files - 2; i >= 0; i--) if (existsSync(this.file(i))) renameSync(this.file(i), this.file(i + 1));
  }

  write(level, message) {
    const line = `${new Date(this.now()).toISOString()} [${level}] ${String(message).replace(/[\r\n]+/g, ' ')}\n`;
    const current = this.file(0);
    const size = existsSync(current) ? statSync(current).size : 0;
    if (size > 0 && size + Buffer.byteLength(line) > this.maxBytes) this.#rotate();
    appendFileSync(current, line, 'utf8');
    if (this.echo) (level === 'INFO' ? console.log : console.error)(line.trimEnd());
  }
}
