import { DEFAULT_KARAFUN_MIX, KARAFUN_ROLE_LABELS, validStemVolume, type KaraFunMixStatus, type KaraFunStemRole } from '../domain/karafun-mix';

export type ActiveKaraFunMix = {
  generation: string; versionId: string;
  stems: readonly { id: number; role: KaraFunStemRole; voice: string | null }[];
};

/** The host changes gains on the current authorized performance, never KIT
 * bytes or account state. Numeric stem IDs are local to a single performance. */
export class KaraFunMixer {
  private generation: string | null = null;
  private volumes = new Map<number, number>();
  constructor(private readonly active: () => ActiveKaraFunMix | null) {}

  status(): KaraFunMixStatus | null {
    const active = this.active();
    if (this.generation !== (active?.generation ?? null)) {
      this.generation = active?.generation ?? null; this.volumes.clear();
    }
    if (!active) return null;
    const counts = new Map<KaraFunStemRole, number>();
    const totals = (role: KaraFunStemRole) => active.stems.filter(stem => stem.role === role).length;
    return { generation: active.generation, versionId: active.versionId, stems: active.stems.map(stem => {
      const ordinal = (counts.get(stem.role) ?? 0) + 1; counts.set(stem.role, ordinal);
      // Provider captions are display text, not paths or stable user identities.
      const voice = stem.voice?.replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, 100);
      const label = `${KARAFUN_ROLE_LABELS[stem.role]}${totals(stem.role) > 1 ? ` ${ordinal}` : ''}${voice ? ` · ${voice}` : ''}`;
      return { id: stem.id, role: stem.role, label, volume: this.volumes.get(stem.id) ?? DEFAULT_KARAFUN_MIX[stem.role] };
    }) };
  }

  set(input: unknown): KaraFunMixStatus {
    const current = this.status();
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Choose a current KaraFun audio channel.');
    const command = input as Record<string, unknown>;
    if (!current || command.generation !== current.generation) throw new Error('The KaraFun song changed. Reopen Vocal Mix.');
    const reset = command.reset === true;
    if (Object.keys(command).some(key => !(reset ? ['generation', 'reset'] : ['generation', 'stemId', 'volume']).includes(key)))
      throw new Error('Invalid KaraFun mix command.');
    if (reset) this.volumes.clear();
    else {
      if (!Number.isInteger(command.stemId) || !current.stems.some(stem => stem.id === command.stemId) || !validStemVolume(command.volume))
        throw new Error('Choose an available audio channel and a volume from 0 to 100%.');
      this.volumes.set(command.stemId as number, command.volume);
    }
    return this.status()!;
  }
}
