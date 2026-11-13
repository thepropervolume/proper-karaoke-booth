/** Keeps a separate YouTube preview from overlapping the show's audio. */
export class YouTubeAudioGate {
  private bumperStarting = false;

  constructor(private readonly isPreviewActive: () => boolean) {}

  canOpenPreview(state: { playbackActive: boolean; playbackTransition: boolean; bumperActive: boolean }): boolean {
    return !state.playbackActive && !state.playbackTransition && !state.bumperActive && !this.bumperStarting;
  }

  playbackBlocked(): boolean { return this.isPreviewActive(); }

  bumperStartPending(): boolean { return this.bumperStarting; }

  /** Reserve synchronously before awaiting output preparation. */
  async startBumper<T>(operation: () => Promise<T>): Promise<T> {
    if (this.bumperStarting || this.isPreviewActive()) throw new Error('Bumper music is unavailable while a song or the YouTube player is active.');
    this.bumperStarting = true;
    try { return await operation(); }
    finally { this.bumperStarting = false; }
  }
}
