/** Public host-facing import state. Full source paths stay in the main process. */
export type ImportOutcome = 'imported' | 'duplicate' | 'failed' | 'cancelled';
export type ImportResult = { name: string; kind: 'file' | 'directory'; outcome: ImportOutcome; needsReview: boolean; message?: string };
export type ImportPhase = 'scanning' | 'hashing' | 'cancelling' | 'completed' | 'cancelled' | 'failed';
export type ImportProgress = {
  jobId: string; phase: ImportPhase; discovered: number; processed: number;
  imported: number; duplicates: number; failed: number; cancelled: number; needsReview: number;
  directoriesScanned?: number; skippedUnsupported?: number;
  current: { name: string; bytesRead: number; bytesTotal: number } | null;
};
export type ImportResultsPage = { items: ImportResult[]; offset: number; nextOffset: number | null; total: number };
