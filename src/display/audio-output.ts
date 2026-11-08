type Device = { kind: string; deviceId: string };
type Player = { muted: boolean; pause(): void; setSinkId?: (id: string) => Promise<void> };

/** Mute before routing and only unmute the current player after routing succeeds. */
export class AudioOutputRouter {
  private revision = 0;
  constructor(private readonly list: () => Promise<readonly Device[]>) {}

  async prepare(player: Player, outputId: string, stillCurrent: () => boolean): Promise<boolean> {
    const revision = ++this.revision;
    player.muted = true;
    if (outputId) {
      const devices = await this.list();
      if (!devices.some(device => device.kind === 'audiooutput' && device.deviceId === outputId))
        throw new Error('The selected audio output is unavailable. Choose an output in Preferences.');
    }
    if (player.setSinkId) await player.setSinkId(outputId);
    else if (outputId) throw new Error('This platform cannot select an audio output.');
    if (revision !== this.revision || !stillCurrent()) return false;
    player.muted = false;
    return true;
  }

  /** Any device change is treated conservatively until the host resumes. */
  invalidate(player: Player): void {
    ++this.revision;
    player.muted = true;
    player.pause();
  }
}
