export type SingerDisplayBranding = {
  boothName: string; displayLogoSize: number; bannerEnabled: boolean; bannerText: string;
  bannerPosition: 'top' | 'bottom'; bannerExpiresAt: string;
};
const DEFAULT_BRANDING: SingerDisplayBranding = {
  boothName: 'The Proper Volume Karaoke', displayLogoSize: 50, bannerEnabled: false,
  bannerText: '', bannerPosition: 'bottom', bannerExpiresAt: '',
};
type BrandingElements = {
  root?: HTMLElement | null; names: Iterable<HTMLElement>; logos: Iterable<HTMLImageElement>;
  banner?: HTMLElement | null; bannerText?: HTMLElement | null;
};
type BrandingClock = { now(): number; setTimeout(callback: () => void, milliseconds: number): unknown; clearTimeout(timer: unknown): void };

/** Changes visual branding only; it has no reference to media or playback state. */
export function createSingerDisplayBranding(elements: BrandingElements, clock: BrandingClock = {
  now: Date.now, setTimeout: (callback, milliseconds) => globalThis.setTimeout(callback, milliseconds),
  clearTimeout: timer => globalThis.clearTimeout(timer as ReturnType<typeof setTimeout>),
}) {
  let timer: unknown = null, disposed = false, revision = 0;
  const cancel = () => { if (timer !== null) clock.clearTimeout(timer); timer = null; };
  return {
    update(input: Partial<SingerDisplayBranding> | undefined, logo: string | null): void {
      if (disposed) return;
      cancel(); const currentRevision = ++revision;
      const value = { ...DEFAULT_BRANDING, ...input };
      const name = typeof value.boothName === 'string' && value.boothName.trim() ? value.boothName.trim().slice(0, 120) : DEFAULT_BRANDING.boothName;
      const size = typeof value.displayLogoSize === 'number' && Number.isFinite(value.displayLogoSize) ? Math.max(10, Math.min(85, value.displayLogoSize)) : DEFAULT_BRANDING.displayLogoSize;
      for (const element of elements.names) element.textContent = name;
      elements.root?.style?.setProperty('--display-logo-size', `${size}vw`);
      for (const image of elements.logos) {
        image.hidden = !logo;
        if (logo) { if (image.src !== logo) image.src = logo; }
        else image.removeAttribute('src');
      }
      const banner = elements.banner, text = elements.bannerText;
      if (!banner || !text) return;
      text.textContent = typeof value.bannerText === 'string' ? value.bannerText.slice(0, 1000) : '';
      banner.dataset.position = value.bannerPosition === 'top' ? 'top' : 'bottom';
      const expiry = value.bannerExpiresAt === '' ? null : Date.parse(value.bannerExpiresAt);
      const render = () => {
        if (disposed || revision !== currentRevision) return;
        const remaining = expiry === null ? null : expiry - clock.now();
        banner.hidden = value.bannerEnabled !== true || !text.textContent?.trim() || remaining !== null && (!Number.isFinite(remaining) || remaining <= 0);
        if (!banner.hidden && remaining !== null) timer = clock.setTimeout(render, Math.min(remaining, 2_147_483_647));
      };
      render();
    },
    dispose(): void { disposed = true; ++revision; cancel(); },
  };
}
