/**
 * Poll a read-only host predicate through page.evaluate, awaiting its actual
 * boolean result. Playwright 1.65's waitForFunction treats a Promise as truthy.
 */
export async function waitForHostCondition(page, predicate, arg = undefined, options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).some(key => !['timeout', 'polling'].includes(key)))
    throw new TypeError('Host wait options must contain only timeout and polling.');
  const { timeout = 30000, polling = 50 } = options;
  if (!page || typeof page.evaluate !== 'function' || typeof predicate !== 'function' ||
      !Number.isInteger(timeout) || timeout < 1 || timeout > 300000 || !Number.isInteger(polling) || polling < 1 || polling > 1000)
    throw new TypeError('Host waits need a predicate, a 1–300000ms timeout and a 1–1000ms polling interval.');
  const deadline = performance.now() + timeout;
  const timedOut = () => { const error = new Error(`Host condition timed out after ${timeout}ms.`); error.name = 'TimeoutError'; return error; };
  let timeoutTimer, pollingTimer;
  const expired = new Promise((_, reject) => { timeoutTimer = setTimeout(() => reject(timedOut()), timeout); });
  try {
    for (;;) {
      if (performance.now() >= deadline) throw timedOut();
      const value = await Promise.race([page.evaluate(predicate, arg), expired]);
      if (performance.now() >= deadline) throw timedOut();
      if (typeof value !== 'boolean') throw new TypeError('A host condition must return a boolean.');
      if (value) return true;
      await Promise.race([new Promise(resolve => { pollingTimer = setTimeout(resolve, Math.min(polling, Math.max(1, deadline - performance.now()))); }), expired]);
      clearTimeout(pollingTimer); pollingTimer = undefined;
    }
  } finally { clearTimeout(timeoutTimer); clearTimeout(pollingTimer); }
}
