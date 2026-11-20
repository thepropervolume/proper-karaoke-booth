/** Persist a harmless revision first, so a failed DB write cannot activate new
 * source settings while guest pagination still sees the old show revision. */
export function saveWithDiscoveryRevision<T extends { revision: number }, R>(state: T, saveState: (next: T) => void,
  setState: (next: T) => void, writeSettings: () => R, notifyFailure: () => void): R {
  const next = { ...state, revision: state.revision + 1 };
  saveState(next);
  setState(next);
  try { return writeSettings(); }
  catch (error) { try { notifyFailure(); } catch { /* Preserve the settings error. */ } throw error; }
}
