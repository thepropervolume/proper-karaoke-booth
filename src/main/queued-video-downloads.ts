import type { YouTubeDownloadProgress } from './youtube-download';

/** Serial acquisition follows committed requests, never renderer playback state. */
export class QueuedVideoDownloads {
  private wanted = new Set<string>();
  private manual = new Set<string>();
  private pending: string[] = [];
  private attempted = new Set<string>();
  private failures = new Map<string,string>();
  private running: string | null = null;
  private processing: Promise<void> | null = null;
  private closed = false;
  private blocked = false;
  constructor(private readonly acquire: (versionId:string) => Promise<YouTubeDownloadProgress | null>, private readonly changed: () => void = () => {}) {}
  snapshot() { return {pendingVersionIds:[...this.pending],activeVersionId:this.running,failures:[...this.failures].map(([versionId,message])=>({versionId,message})),blocked:this.blocked}; }
  private publish() { try { this.changed(); } catch {} }
  reconcile(ids: readonly string[]): void {
    if (this.closed) return;
    this.wanted = new Set(ids.slice(0,1000));
    this.pending = [];
    for (const id of new Set([...this.wanted,...this.manual])) this.add(id);
    this.pump(); this.publish();
  }
  enqueue(id: string, retry = false): void {
    if (this.closed) throw new Error('Video downloads are closing.');
    if (this.blocked) throw new Error('Automatic downloads are paused because temporary files need review.');
    if (retry && id !== this.running) {this.attempted.delete(id);this.failures.delete(id);}
    this.manual.add(id);this.add(id);this.pump();this.publish();
  }
  private add(id:string): void {
    if (id !== this.running && !this.attempted.has(id) && !this.pending.includes(id) && this.pending.length < 1000) this.pending.push(id);
  }
  cancelPending(id: string): boolean {
    if (id === this.running) return false;
    const index=this.pending.indexOf(id);if(index<0)return false;
    this.pending.splice(index,1);this.manual.delete(id);this.attempted.add(id);this.publish();return true;
  }
  private pump(): void {
    if (this.processing || this.closed || this.blocked || !this.pending.length) return;
    this.processing = this.run().finally(()=>{this.processing=null;this.pump();});
  }
  private async run(): Promise<void> {
    while (!this.closed && !this.blocked && this.pending.length) {
      const id=this.pending.shift()!;this.manual.delete(id);this.running=id;this.attempted.add(id);this.publish();
      try {
        const result=await this.acquire(id);
        if(result?.phase==='failed')this.failures.set(id,result.message);
        if(result?.cleanupNeeded){this.blocked=true;this.failures.set(id,'Temporary download files need review before more videos can be downloaded.');}
      } catch(error) {this.failures.set(id,error instanceof Error ? error.message : 'The video could not be downloaded.');}
      finally {while(this.failures.size>100)this.failures.delete(this.failures.keys().next().value!);this.running=null;this.publish();}
    }
  }
  async idle(): Promise<void> { while(this.processing) await this.processing; }
  async shutdown(): Promise<void> {this.closed=true;this.pending=[];this.manual.clear();await this.processing;}
}
