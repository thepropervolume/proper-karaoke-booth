import { isAbsolute, join, normalize, resolve } from 'node:path';

/** Packaging must not silently move an existing show's profile to a display name. */
export function applicationUserData(input: { appData: string; current: string; appName: string; packaged: boolean; explicit?: string }): string {
  if (input.explicit) return resolve(input.explicit);
  if (!input.packaged) return input.current;
  if (!isAbsolute(input.appData) || !isAbsolute(input.current)) throw new Error('Application data directory is unavailable.');
  const same = (a: string, b: string) => process.platform === 'win32' ? normalize(a).toLowerCase() === normalize(b).toLowerCase() : normalize(a) === normalize(b);
  return same(input.current, join(input.appData, input.appName)) ? join(input.appData, 'proper-karaoke-booth') : input.current;
}
