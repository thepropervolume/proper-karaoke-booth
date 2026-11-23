import { createDesktopUpdater } from '@thepropervolume/karaoke-core/desktop-updates';
import { lstatSync } from 'node:fs';
import { join } from 'node:path';
import type { DesktopUpdateMode, DesktopUpdateStatus } from '../domain/desktop-update-preference';

type Updater = ReturnType<typeof createDesktopUpdater>;
type Update = Parameters<Updater['prepareInstall']>[0];

function installedWindows(resources: string): boolean {
  try {
    const marker = lstatSync(join(resources, 'tpv-booth-installed'));
    return marker.isFile() && !marker.isSymbolicLink() && marker.size === 0;
  } catch { return false; }
}

export function boothUpdateKind(platform: NodeJS.Platform, appImage?: string, installed = false) {
  if (platform === 'win32') return installed ? 'nsis' as const : 'zip' as const;
  if (platform === 'darwin') return 'pkg' as const;
  if (platform === 'linux') return appImage ? 'appimage' as const : 'deb' as const;
  return undefined;
}

/** Electron supplies presentation and lifecycle. Core verifies the feed and all package bytes. */
export class BoothDesktopUpdates {
  private mode: DesktopUpdateMode;
  private updater?: Updater;
  private snapshot: DesktopUpdateStatus;
  private update?: Update;
  private job?: { controller: AbortController; promise: Promise<DesktopUpdateStatus> };
  private readonly appImage?: string;

  constructor(
    version: string, cacheDirectory: string, mode: DesktopUpdateMode, packaged: boolean, resources: string,
    private readonly publish: (value: DesktopUpdateStatus) => void,
  ) {
    this.mode = mode;
    this.appImage = process.platform === 'linux' ? process.env.APPIMAGE : undefined;
    const preferredKind = boothUpdateKind(process.platform, this.appImage, process.platform === 'win32' && installedWindows(resources));
    if (packaged && preferredKind) {
      this.updater = createDesktopUpdater({ product: 'booth', runningVersion: version, cacheDirectory, mode, preferredKind });
      this.snapshot = { phase: 'idle' };
    } else this.snapshot = { phase: 'unavailable', message: 'Update checks are available in packaged Booth builds.' };
  }

  status(): DesktopUpdateStatus { return { ...this.snapshot }; }

  private set(value: DesktopUpdateStatus): DesktopUpdateStatus {
    this.snapshot = value;
    try { this.publish(this.status()); } catch { /* A closing host window cannot interrupt a verified download. */ }
    return this.status();
  }

  setMode(mode: DesktopUpdateMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.updater?.setMode(mode);
    if (this.job) { this.job.controller.abort(); this.job = undefined; }
    this.update = undefined;
    if (this.updater) this.set({ phase: 'idle' });
  }

  check(manual = false): Promise<DesktopUpdateStatus> {
    if (!this.updater || (!manual && this.mode === 'off')) return Promise.resolve(this.status());
    return this.run(async (updater, signal) => {
      const result = await updater.check({ manual, signal });
      if (signal.aborted) return this.status();
      if (!('update' in result)) {
        this.update = undefined;
        return this.set({ phase: result.status === 'current' ? 'current' : 'idle' });
      }
      this.update = result.update;
      if (result.status === 'downloaded') return this.downloaded(result.update);
      return this.set({ phase: result.status, version: result.update.version });
    });
  }

  download(): Promise<DesktopUpdateStatus> {
    const update = this.update;
    if (!update || this.snapshot.phase !== 'available') return Promise.resolve(this.status());
    return this.run(async (updater, signal) => {
      await updater.download(update, { signal });
      return signal.aborted ? this.status() : this.downloaded(update);
    });
  }

  private downloaded(update: Update): DesktopUpdateStatus {
    return this.set({ phase: 'downloaded', version: update.version, ...(update.artifact.kind === 'zip' && {
      message: 'Portable update downloaded. Use Show Download to find and extract the new ZIP.',
    }) });
  }

  private run(action: (updater: Updater, signal: AbortSignal) => Promise<DesktopUpdateStatus>): Promise<DesktopUpdateStatus> {
    if (!this.updater) return Promise.resolve(this.status());
    if (this.job) return this.job.promise;
    const controller = new AbortController(), updater = this.updater;
    this.set({ phase: 'checking', version: this.update?.version });
    const promise = action(updater, controller.signal).catch(() => controller.signal.aborted ? this.status() :
      this.set({ phase: 'error', message: 'The update could not be checked or verified. Try again later.' }))
      .finally(() => { if (this.job?.controller === controller) this.job = undefined; });
    this.job = { controller, promise };
    return promise;
  }

  async reveal(showInFolder: (path: string) => void): Promise<void> {
    if (!this.updater || !this.update || this.snapshot.phase !== 'downloaded') return;
    const verified = await this.updater.prepareInstall(this.update);
    showInFolder(verified.path);
  }

  canApplyOnQuit(): boolean {
    return !!this.update && this.snapshot.phase === 'downloaded' && this.mode === 'install' &&
      this.update.artifact.kind !== 'zip';
  }

  async applyOnQuit(openInstaller: (path: string) => Promise<string>): Promise<void> {
    const update = this.update, updater = this.updater;
    if (!update || !updater || !this.canApplyOnQuit()) return;
    if (update.artifact.kind === 'appimage' && this.appImage) {
      await updater.applyAppImageUpdate(update, this.appImage);
      return;
    }
    const verified = await updater.prepareInstall(update);
    if (await openInstaller(verified.path)) throw new Error('The system installer could not be opened.');
  }
}
