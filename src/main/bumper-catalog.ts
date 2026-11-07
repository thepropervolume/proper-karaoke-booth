import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, isAbsolute } from 'node:path';
import type { BumperTrack } from './bumper-controller';

export const MAX_BUMPER_TRACKS = 5;
const extensions = new Set(['.mp3', '.m4a', '.wav', '.ogg']);
type PublicTrack = { id: string; name: string };

/** Kept in the main process: renderer-facing list() never exposes source paths. */
export class BumperCatalog {
  private items: BumperTrack[];
  constructor(private file: string) {
    if (!existsSync(file)) { this.items = []; return; }
    const value: unknown = JSON.parse(readFileSync(file, 'utf8'));
    if (!Array.isArray(value) || value.length > MAX_BUMPER_TRACKS || !value.every(x => x && typeof x === 'object' && typeof x.id === 'string' && x.id.length > 0 && typeof x.name === 'string' && x.name.length > 0 && typeof x.path === 'string' && isAbsolute(x.path)))
      throw new Error('Invalid bumper catalog; the file was not changed.');
    const items = value as BumperTrack[];
    if (new Set(items.map(x => x.id)).size !== items.length) throw new Error('Invalid bumper catalog: duplicate IDs.');
    this.items = items.map(x => ({ id: x.id, name: x.name, path: x.path }));
  }
  list(): PublicTrack[] { return this.items.map(({ id, name }) => ({ id, name })); }
  /** For the trusted player adapter only. */
  forPlayback(): readonly BumperTrack[] { return this.items.map(item => ({ ...item })); }
  addSelectedFile(path: string): PublicTrack {
    if (this.items.length >= MAX_BUMPER_TRACKS) throw new Error('A maximum of five bumper tracks is allowed.');
    if (!isAbsolute(path) || !extensions.has(extname(path).toLowerCase())) throw new Error('Choose a local MP3, M4A, WAV or OGG file.');
    const resolved = realpathSync(path);
    if (!statSync(resolved).isFile()) throw new Error('Choose an audio file.');
    const key = (p: string) => process.platform === 'win32' ? p.toLowerCase() : p;
    if (this.items.some(item => key(item.path) === key(resolved))) throw new Error('That audio file is already in the list.');
    const item = { id: randomUUID(), name: basename(resolved), path: resolved };
    this.save([...this.items, item]);
    return { id: item.id, name: item.name };
  }
  remove(id: string): boolean {
    const next = this.items.filter(item => item.id !== id);
    if (next.length === this.items.length) return false;
    this.save(next);
    return true;
  }
  private save(items: BumperTrack[]): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    try { writeFileSync(temporary, `${JSON.stringify(items, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' }); renameSync(temporary, this.file); }
    catch (error) { try { unlinkSync(temporary); } catch {} throw error; }
    this.items = items;
  }
}
