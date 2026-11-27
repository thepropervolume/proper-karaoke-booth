const normalize = (text: string) => text.normalize('NFKD').toLowerCase().replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const commonWords = new Set(['a', 'an', 'and', 'for', 'in', 'my', 'of', 'on', 'the', 'to', 'with']);

export function preferenceSearchTerms(query: string): string[] {
  const normalized = normalize(query);
  return normalized ? normalized.split(' ').filter(term => !commonWords.has(term)) : [];
}

/** Find every term within the category and one related set of controls. */
export function preferenceTopicMatches(terms: readonly string[], category: string, topic: string, keywords: string): boolean {
  const haystack = normalize(`${category} ${topic} ${keywords}`);
  return terms.every(term => haystack.includes(term));
}
