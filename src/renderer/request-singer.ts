/** Build one song request without losing a newly created singer on failure. */
export type SingerChoice = { singerId: string; newSingerName?: never } | { singerId?: never; newSingerName: string };
export type RequestCommandResult = { ok: boolean; error?: string };

/**
 * The singer is already committed before the request command runs. Inform the
 * dialog immediately so a rejected request can be retried for that same singer.
 */
export async function requestWithSinger(choice: SingerChoice, callbacks: {
  createSingerId: () => string;
  addSinger: (singer: { id: string; name: string }) => Promise<RequestCommandResult>;
  singerCreated: (id: string) => void;
  addRequest: (singerId: string) => Promise<RequestCommandResult>;
}): Promise<void> {
  let singerId = choice.singerId;
  if (!singerId) {
    if (!choice.newSingerName) throw new Error('Enter a singer name');
    singerId = callbacks.createSingerId();
    const added = await callbacks.addSinger({ id: singerId, name: choice.newSingerName });
    if (!added.ok) throw new Error(added.error || 'Could not add singer');
    callbacks.singerCreated(singerId);
  }
  const result = await callbacks.addRequest(singerId);
  if (!result.ok) throw new Error(result.error || 'Could not add request');
}
