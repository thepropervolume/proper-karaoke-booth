type PhotoRequest = { id: string; dataUrl: string };
type PhotoReply = { id: string; ok: boolean };

/** A temporary corner overlay leaves the player and its audio running. */
export function createPhotoOverlay(reply: (value: PhotoReply) => void) {
  let current: HTMLImageElement | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let loading = false;
  function clear() {
    if (timer) clearTimeout(timer);
    timer = undefined;
    current?.remove();
    current = null;
    loading = false;
  }
  function show(request: PhotoRequest) {
    if (!request || typeof request.id !== 'string' || !request.id ||
        typeof request.dataUrl !== 'string' || request.dataUrl.length > 3 * 1024 * 1024 ||
        !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(request.dataUrl) || current || loading) {
      if (request && typeof request.id === 'string') reply({ id: request.id, ok: false });
      return;
    }
    loading = true;
    const image = document.createElement('img');
    image.alt = 'Photo shared by a singer';
    image.className = 'shared-singer-photo';
    const abort = setTimeout(() => { clear(); reply({ id: request.id, ok: false }); }, 5000);
    image.onload = () => {
      clearTimeout(abort);
      if (!loading) return;
      loading = false;
      current = image;
      document.body.append(image);
      reply({ id: request.id, ok: true });
      timer = setTimeout(clear, 10000);
    };
    image.onerror = () => { clearTimeout(abort); clear(); reply({ id: request.id, ok: false }); };
    image.src = request.dataUrl;
  }
  return { show, clear };
}
