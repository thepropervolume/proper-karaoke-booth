/** Fence delayed media events as soon as React commits another performance. */
export class PlayerGenerationFence {
  private current = '';
  update(generation: string): void { this.current = generation; }
  matches(generation: string): boolean { return generation === this.current; }
}
