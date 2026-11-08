import { SnapshotCleanupError } from './show-snapshots';

export type BackupResult = { status: 'saved' | 'cancelled' | 'failed' | 'cleanup-needed'; published?: boolean };

/** Tracks the picker, snapshot and any temporary-file cleanup until shutdown. */
export class ShowBackup {
  private active: Promise<BackupResult> | null = null;
  private recovery: SnapshotCleanupError | null = null;
  private stopping = false;
  constructor(private readonly choose: () => Promise<string | null>, private readonly snapshot: (path: string) => Promise<void>) {}

  private track(work: () => Promise<BackupResult>): Promise<BackupResult> {
    if (this.stopping || this.active) return Promise.resolve({ status: 'failed' });
    const operation = Promise.resolve().then(work);
    this.active = operation;
    void operation.finally(() => { if (this.active === operation) this.active = null; });
    return operation;
  }
  start(): Promise<BackupResult> {
    return this.track(async () => {
      if (this.recovery) return { status: 'cleanup-needed', published: this.recovery.published };
      try {
        const path = await this.choose();
        if (this.stopping || !path) return { status: 'cancelled' };
        await this.snapshot(path);
        return { status: 'saved' };
      } catch (error) {
        if (error instanceof SnapshotCleanupError) {
          this.recovery = error;
          return { status: 'cleanup-needed', published: error.published };
        }
        return { status: 'failed' };
      }
    });
  }
  retryCleanup(): Promise<BackupResult> {
    return this.track(async () => this.clean());
  }
  private async clean(): Promise<BackupResult> {
    const recovery = this.recovery;
    if (!recovery) return { status: 'cancelled' };
    try { await recovery.retryCleanup(); this.recovery = null; return { status: recovery.published ? 'saved' : 'failed' }; }
    catch { return { status: 'cleanup-needed', published: recovery.published }; }
  }
  needsShutdownWait(): boolean { return !!this.active || !!this.recovery; }
  async shutdown(): Promise<boolean> {
    this.stopping = true;
    if (this.active) await this.active;
    if (this.recovery) return (await this.clean()).status !== 'cleanup-needed';
    return true;
  }
}
