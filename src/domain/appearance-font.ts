export const APPEARANCE_FONTS = [
  { id: 'default', label: 'Booth Default', stack: undefined },
  { id: 'system-sans', label: 'System Sans', stack: 'system-ui, sans-serif' },
  { id: 'serif', label: 'Serif', stack: 'Georgia, "Times New Roman", serif' },
  { id: 'monospace', label: 'Monospace', stack: 'ui-monospace, "Cascadia Mono", Consolas, monospace' },
] as const;

export type AppearanceFont = typeof APPEARANCE_FONTS[number]['id'];

export function isAppearanceFont(value: unknown): value is AppearanceFont {
  return APPEARANCE_FONTS.some(font => font.id === value);
}

export function appearanceFontStack(font: AppearanceFont | undefined): string | undefined {
  return APPEARANCE_FONTS.find(option => option.id === font)?.stack;
}
