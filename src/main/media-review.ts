import { lstat } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import type { MediaReviewIssue, MediaReviewResult } from '../domain/media-review';
import type { StoredMedia } from './store';

type MediaLocation = Pick<StoredMedia, 'id' | 'path'>;
type Inspect = (path: string) => Promise<{ isFile(): boolean; size: number }>;

/** A check uses storage metadata only. Even disconnected storage occupies at most one worker. */
export class MediaReview {
  private current: { id: string; cancelled: boolean } | null = null;
  constructor(private readonly inspect: Inspect = lstat) {}

  async scan(id: string, locations: () => MediaLocation[]): Promise<MediaReviewResult> {
    if (this.current) return { status: 'busy' };
    const session = { id, cancelled: false };
    this.current = session;
    try {
      const files = locations();
      const issues: MediaReviewIssue[] = [];
      for (const { id: versionId, path } of files) {
        if (session.cancelled) return { status: 'cancelled' };
        let reason: MediaReviewIssue['reason'] | undefined;
        try {
          if (!isAbsolute(path)) reason = 'invalid';
          else {
            const info = await this.inspect(path);
            if (!info.isFile() || info.size === 0) reason = 'invalid';
          }
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          reason = code === 'ENOENT' || code === 'ENOTDIR' ? 'missing' : 'unavailable';
        }
        if (reason) issues.push({ versionId, filename: path.split(/[\\/]/).pop() ?? '', reason });
      }
      return session.cancelled ? { status: 'cancelled' } : { status: 'completed', checked: files.length, issues };
    } finally { this.current = null; }
  }

  cancel(id?: string): void {
    if (this.current && (id === undefined || this.current.id === id)) this.current.cancelled = true;
  }
}
