import { findExecutable, pathExecutables } from './media-tool-paths';

export type YtDlpLaunch = { executable: string; nodeExecutable?: string };

export function managedYtDlpOptions(nodeExecutable?: string): string[] {
  return nodeExecutable ? ['--no-js-runtimes', '--js-runtimes', `node:${nodeExecutable}`, '--no-remote-components'] : [];
}

export function ytDlpEnvironment(managedRuntime: boolean): NodeJS.ProcessEnv | undefined {
  if (!managedRuntime) return undefined;
  // Electron provides Node for the offline EJS scripts distributed by yt-dlp.
  const env: NodeJS.ProcessEnv = { ...process.env, ELECTRON_RUN_AS_NODE: '1' };
  delete env.NODE_OPTIONS;
  delete env.NODE_PATH;
  return env;
}

/** Resolve a host-selected executable or a normal absolute PATH entry; never a shell. */
export async function resolveYtDlpExecutable(selected = '', searchPath = process.env.PATH ?? ''): Promise<string> {
  const resolved = await findExecutable(selected ? [selected] : pathExecutables('yt-dlp', searchPath));
  if (resolved) return resolved;
  throw new Error('yt-dlp was not found. Prepare a managed build or correct your custom executable in Preferences.');
}
