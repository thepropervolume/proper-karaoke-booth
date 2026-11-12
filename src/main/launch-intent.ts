export type LaunchIntent = 'settings' | 'keybindings';

/** Exact CLI switches only; arguments after -- are positional. A request for
 * Keyboard Shortcuts is more specific than opening the general preferences. */
export function parseLaunchIntent(argv: readonly string[]): LaunchIntent | null {
  let intent: LaunchIntent | null = null;
  for (const argument of argv) {
    if (argument === '--') break;
    if (argument === '--keybindings') intent = 'keybindings';
    else if (argument === '--settings' && intent === null) intent = 'settings';
  }
  return intent;
}
