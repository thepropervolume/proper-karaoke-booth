/** A bounded literal search shared by every singer catalog authority. */
export function validCatalogQuery(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 200 && !/[\x00-\x1f\x7f\ufffd]/u.test(value);
}
export function matchesCatalogQuery(song: { artist: string; title: string }, query: string): boolean {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/u).filter(Boolean);
  const haystack = `${song.artist} ${song.title}`.toLocaleLowerCase();
  return terms.every(term => haystack.includes(term));
}
