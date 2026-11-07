import { randomUUID } from 'node:crypto';

export type BumperTrack = { id: string; name: string; path: string };
export type BumperSnapshot = { status: 'stopped' | 'starting' | 'playing'; trackId: string | null; generation: string | null };
/** The adapter must resolve stop only after the audio element has stopped producing sound. */
export interface BumperOutput {
  start(track: BumperTrack, generation: string): Promise<void>;
  stop(): Promise<void>;
}

/** Owns bumper playback. The karaoke authority MUST await karaokeStarting before starting audio. */
export class BumperController {
  private tail: Promise<unknown> = Promise.resolve();
  private outputAvailable = false;
  private karaokeActive = false;
  private wanted = false;
  private disposed = false;
  private snapshot: BumperSnapshot = { status: 'stopped', trackId: null, generation: null };
  constructor(private output: BumperOutput, private tracks: () => readonly BumperTrack[], private publish: (state: BumperSnapshot) => void = () => {}) {}

  private enqueue<T>(run: () => Promise<T>): Promise<T> {
    const next = this.tail.then(run, run);
    this.tail = next.catch(() => {});
    return next;
  }
  private update(snapshot: BumperSnapshot): void { this.snapshot = snapshot; this.publish({ ...snapshot }); }
  getState(): BumperSnapshot { return { ...this.snapshot }; }

  /** Explicit host action. Never begins after output loss or while karaoke is active. */
  start(): Promise<boolean> {
    if (this.disposed || this.karaokeActive || !this.outputAvailable) return Promise.resolve(false);
    this.wanted = true;
    return this.enqueue(async () => {
      if (this.snapshot.status !== 'stopped') return true;
      return this.playNext(null);
    });
  }
  stop(): Promise<void> { this.wanted = false; return this.enqueue(() => this.stopNow()); }

  /** Mark unavailable immediately; callers must await the returned stop before changing outputs. */
  setOutputAvailable(available: boolean): Promise<void> {
    this.outputAvailable = available;
    if (available) return Promise.resolve();
    this.wanted = false;
    return this.enqueue(() => this.stopNow());
  }
  /** Call before starting or resuming karaoke; no bumper may start until karaokeEnded. */
  karaokeStarting(): Promise<void> {
    this.karaokeActive = true;
    this.wanted = false;
    return this.enqueue(() => this.stopNow());
  }
  karaokeEnded(): void { this.karaokeActive = false; }
  /** Only the currently active generation may advance to another supplied track. */
  ended(generation: string): Promise<void> {
    return this.enqueue(async () => {
      if (this.snapshot.status !== 'playing' || this.snapshot.generation !== generation) return;
      const previousId = this.snapshot.trackId;
      this.update({ status: 'stopped', trackId: null, generation: null });
      if (this.wanted && this.outputAvailable && !this.karaokeActive && !this.disposed) await this.playNext(previousId);
    });
  }
  /** Removal and player transitions share the same queue to prevent starting a removed track. */
  removeTrack(id: string, remove: () => boolean): Promise<boolean> {
    return this.enqueue(async () => {
      if (this.snapshot.trackId === id) { this.wanted = false; await this.stopNow(); }
      return remove();
    });
  }
  close(): Promise<void> { this.disposed = true; this.wanted = false; return this.enqueue(() => this.stopNow()); }

  private async stopNow(): Promise<void> {
    if (this.snapshot.status !== 'stopped') {
      // Do not claim silence if the adapter failed to stop.
      await this.output.stop();
      this.update({ status: 'stopped', trackId: null, generation: null });
    }
  }
  private async playNext(previousId: string | null): Promise<boolean> {
    if (!this.wanted || !this.outputAvailable || this.karaokeActive || this.disposed) return false;
    const tracks = this.tracks();
    if (!tracks.length) { this.wanted = false; return false; }
    const previous = tracks.findIndex(track => track.id === previousId);
    const track = tracks[previous < 0 ? 0 : (previous + 1) % tracks.length];
    const generation = randomUUID();
    this.update({ status: 'starting', trackId: track.id, generation });
    try { await this.output.start(track, generation); }
    catch (error) {
      this.wanted = false;
      await this.output.stop();
      this.update({ status: 'stopped', trackId: null, generation: null });
      throw error;
    }
    if (!this.wanted || !this.outputAvailable || this.karaokeActive || this.disposed) { await this.stopNow(); return false; }
    this.update({ status: 'playing', trackId: track.id, generation });
    return true;
  }
}
