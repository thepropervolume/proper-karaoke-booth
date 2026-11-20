export type GuestPhotoPreview = { id: string; singer: string; dataUrl: string };
type PendingPhoto = { preview: GuestPhotoPreview; expiresAt: number; timer: ReturnType<typeof setTimeout>; shown(): void };

/** A single, memory-only review slot. A receipt can be returned before the host makes a decision. */
export class MobilePhotoReview {
  private pending: PendingPhoto | null = null;
  private presenting: symbol | null = null;

  constructor(private publish: (preview: GuestPhotoPreview | null) => void,
    private display: (dataUrl: string) => Promise<void>, private clearDisplay: () => void,
    private available: () => boolean, private reviewMs = 45_000, private now = Date.now) {}

  submit(singer: string, dataUrl: string, shown: () => void): void {
    if (!this.available()) throw new Error('The host screen is not available for photo review.');
    if (this.pending && this.pending.expiresAt <= this.now()) this.discard(this.pending.preview.id);
    if (this.pending || this.presenting) throw new Error('The host is already reviewing a photo. Try again later.');
    const preview = { id: crypto.randomUUID(), singer, dataUrl };
    const timer = setTimeout(() => this.discard(preview.id), this.reviewMs);
    this.pending = { preview, expiresAt: this.now() + this.reviewMs, timer, shown };
    this.publish(preview);
  }

  discard(id: string): void {
    if (this.pending?.preview.id !== id) return;
    clearTimeout(this.pending.timer);
    this.pending = null;
    this.publish(null);
  }

  async approve(id: string): Promise<void> {
    const photo = this.pending;
    if (!photo || photo.preview.id !== id) return;
    this.discard(id);
    if (photo.expiresAt <= this.now() || !this.available()) return;
    const turn = Symbol();
    this.presenting = turn;
    try {
      await this.display(photo.preview.dataUrl);
      if (this.presenting === turn && this.available()) photo.shown();
    } catch (error) {
      if (this.presenting === turn) throw error;
    } finally {
      if (this.presenting === turn) this.presenting = null;
    }
  }

  clear(): void {
    if (this.pending) this.discard(this.pending.preview.id);
    this.presenting = null;
    this.clearDisplay();
  }
}
