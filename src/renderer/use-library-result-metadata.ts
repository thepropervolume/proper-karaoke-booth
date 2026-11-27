import { useEffect, useRef, useState } from 'react';
import type { LibraryResultMetadata } from '../domain/library-result-fields';

export type LibraryMetadataReader = (ids: string[]) => Promise<Record<string, LibraryResultMetadata> | null>;
const batchSize = 32;
const empty = new Map<string, LibraryResultMetadata>();

export function useLibraryResultMetadata(ids: readonly string[], revision: string, read: LibraryMetadataReader) {
  const cache = useRef({ revision, values: empty });
  const [snapshot, setSnapshot] = useState(cache.current);
  const [loading, setLoading] = useState(false);
  const signature = JSON.stringify(ids);
  useEffect(() => {
    // Normal browsing only fetches visible rows. An explicit metadata sort
    // can request all matched local files in bounded batches, then sort them once.
    let active = true;
    let retryTimer: number | undefined;
    let releaseRetry: (() => void) | undefined;
    if (cache.current.revision !== revision) cache.current = { revision, values: empty };
    const queue = (JSON.parse(signature) as string[]).filter(id => !cache.current.values.has(id));
    setLoading(queue.length > 0);
    const load = async () => {
      for (let start = 0; active && start < queue.length;) {
        const batch = queue.slice(start, start + batchSize);
        const result = await read(batch);
        if (!active) break;
        if (result === null) {
          await new Promise<void>(resolve => {
            releaseRetry = resolve;
            retryTimer = window.setTimeout(resolve, 300);
          });
          continue;
        }
        if (cache.current.values === empty || cache.current.values === snapshot.values)
          cache.current = { revision, values: new Map(cache.current.values) };
        for (const id of batch) cache.current.values.set(id, Object.hasOwn(result, id) ? result[id] : {});
        start += batch.length;
      }
    };
    if (queue.length) {
      void load().catch(() => {}).finally(() => {
        if (!active) return;
        setSnapshot(cache.current);
        setLoading(false);
      });
    } else if (snapshot !== cache.current) setSnapshot(cache.current);
    return () => {
      active = false;
      window.clearTimeout(retryTimer);
      releaseRetry?.();
    };
  // Cache changes from completed batches do not invalidate the current read.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, revision, read]);
  return { values: snapshot.revision === revision ? snapshot.values : empty, loading };
}
