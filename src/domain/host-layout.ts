export type HostPanelSizes = { sidebar: number; queue: number; preview: number; libraryQueue: number };
export type HostLayoutSettings = { hostPreviewPosition: 'above' | 'below' | 'hidden'; hostPanelSizes: HostPanelSizes; singerScreenEnabled: boolean; singerScreenPort: number };
export const DEFAULT_HOST_PANEL_SIZES: Readonly<HostPanelSizes> = Object.freeze({ sidebar: 196, queue: 350, preview: 190, libraryQueue: 210 });
export const DEFAULT_HOST_LAYOUT: Readonly<HostLayoutSettings> = Object.freeze({ hostPreviewPosition: 'above', hostPanelSizes: DEFAULT_HOST_PANEL_SIZES, singerScreenEnabled: false, singerScreenPort: 4051 });
export const HOST_PANEL_LIMITS = { sidebar: [140, 340], queue: [260, 1000], preview: [90, 600], libraryQueue: [100, 800] } as const;

export function parseHostLayout(value: Record<string, unknown>): HostLayoutSettings {
  const position = value.hostPreviewPosition === undefined ? DEFAULT_HOST_LAYOUT.hostPreviewPosition : value.hostPreviewPosition;
  if (!['above', 'below', 'hidden'].includes(position as string)) throw new Error('Choose Above Queue, Below Queue or Hidden for the singer preview.');
  const supplied = value.hostPanelSizes === undefined ? DEFAULT_HOST_PANEL_SIZES : value.hostPanelSizes;
  if (!supplied || typeof supplied !== 'object' || Array.isArray(supplied) || Object.keys(supplied).some(key => !Object.hasOwn(HOST_PANEL_LIMITS, key)))
    throw new Error('Panel sizes must contain sidebar, queue, preview and libraryQueue dimensions.');
  const sizes = { ...DEFAULT_HOST_PANEL_SIZES, ...supplied };
  for (const key of Object.keys(HOST_PANEL_LIMITS) as (keyof HostPanelSizes)[]) {
    const [minimum, maximum] = HOST_PANEL_LIMITS[key];
    if (!Number.isInteger(sizes[key]) || sizes[key] < minimum || sizes[key] > maximum) throw new Error(`The ${key} panel size must be between ${minimum} and ${maximum} pixels.`);
  }
  const enabled = value.singerScreenEnabled === undefined ? false : value.singerScreenEnabled, port = value.singerScreenPort === undefined ? 4051 : value.singerScreenPort;
  if (typeof enabled !== 'boolean' || !Number.isInteger(port) || (port as number) < 1024 || (port as number) > 65535)
    throw new Error('Singer-screen sharing needs an enabled checkbox and a port from 1024 to 65535.');
  return { hostPreviewPosition: position as HostLayoutSettings['hostPreviewPosition'], hostPanelSizes: sizes, singerScreenEnabled: enabled, singerScreenPort: port as number };
}

/** Clamp to the current viewport without overwriting the saved desktop layout. */
export function fittedHostPanels(sizes: HostPanelSizes, width: number, height: number): HostPanelSizes {
  const sidebar = Math.max(140, Math.min(sizes.sidebar, Math.max(140, width * .24)));
  const queue = Math.max(260, Math.min(sizes.queue, width - sidebar - 312));
  return { sidebar: Math.round(sidebar), queue: Math.round(queue), preview: Math.round(Math.max(90, Math.min(sizes.preview, height * .4))), libraryQueue: Math.round(Math.max(100, Math.min(sizes.libraryQueue, height * .45))) };
}
