/** Zero is unlimited; omitted is the legacy default of three. */
export function futureRequestLimitMessage(requests: ReadonlyArray<{ singerId: string | null; status: string }>, singerId: string | null, configured?: number): string | null {
  if (singerId === null) return null;
  const limit = configured ?? 3;
  if (limit === 0) return null;
  const count = requests.filter(request => request.singerId === singerId && ['pending', 'accepted', 'staged'].includes(request.status)).length;
  return count >= limit ? `This singer already has ${limit} upcoming ${limit === 1 ? 'request' : 'requests'}. Please wait for a turn or remove a request.` : null;
}
