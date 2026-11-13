import type { HistoryEntry } from './collections';

const normalize = (value: string) => value.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase();

/** Filter saved history without changing its original most-recent-first order. */
export function historyView(history: readonly HistoryEntry[], query: string, singerId: string): HistoryEntry[] {
  const terms = normalize(query.trim()).split(/\s+/u).filter(Boolean);
  return history.filter(entry => {
    if (singerId && entry.singerId !== singerId) return false;
    const fields = [entry.singer, entry.artist, entry.title].map(normalize);
    return terms.every(term => fields.some(field => field.includes(term)));
  });
}
