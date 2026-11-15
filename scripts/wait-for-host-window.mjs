/** Startup also paints a hidden singer window; arrival order is not authority. */
export async function waitForHostWindow(app, timeout = 30000) {
  const deadline = performance.now() + timeout;
  while (performance.now() < deadline) {
    const host = app.windows().find(page => !page.isClosed() && /\/renderer\/index\.html(?:[?#]|$)/.test(page.url()));
    if (host) return host;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error('The host workspace did not open.');
}
