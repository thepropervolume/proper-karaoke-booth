/**
 * Show-scoped applause credits and points. The owning show authority authenticates
 * actors and persists the resulting ledger together with the originating command.
 */
export type PointsAccount = { singerId: string; points: number; credits: number };
export type PerformancePoints = {
  generationId: string;
  performers: string[];
  eligibleListeners: string[];
  applauseCount: number;
  applauders: string[];
  singerApplause: { singerId: string; count: number }[];
  allListenerBonusAwarded?: boolean;
  finished: boolean;
};
type Receipt = { id: string; event: string };
export type PointsLedger = {
  version: 1;
  showId: string;
  accounts: PointsAccount[];
  performances: PerformancePoints[];
  receipts: Receipt[];
  duetAwards?: { requestId: string; singerId: string }[];
  queueFacts?: { requestId: string; everQueuedOrSung: boolean; sungBy: string[] }[];
  queueAwards?: { requestId: string; singerId: string }[];
};

type BaseEvent = { eventId: string };
export type PointsEvent =
  | (BaseEvent & { type: 'join'; singerId: string })
  | (BaseEvent & { type: 'queue'; singerId: string; sungEarlierThisShow: boolean; everQueuedOrSung: boolean; isDuet?: boolean; coSingerId?: string; requestId?: string })
  | (BaseEvent & { type: 'duetPartner'; requestId: string; singerId: string })
  | (BaseEvent & { type: 'rememberQueue'; requestId: string; everQueuedOrSung: boolean; sungBy: string[] })
  | (BaseEvent & { type: 'assignQueue'; requestId: string; singerId: string })
  | (BaseEvent & { type: 'start'; generationId: string; performers: string[]; participants: string[] })
  | (BaseEvent & { type: 'applause'; actor: { role: 'host' } | { role: 'singer'; singerId: string }; generationId: string | null })
  | (BaseEvent & { type: 'finish'; generationId: string; completed: boolean })
  | (BaseEvent & { type: 'suggestion' | 'photo'; singerId: string });

export function newPointsLedger(showId: string): PointsLedger {
  validId(showId);
  return { version: 1, showId, accounts: [], performances: [], receipts: [] };
}

function validId(id: unknown): asserts id is string {
  if (typeof id !== 'string' || !id.trim() || id.length > 500) throw new Error('Invalid points identity.');
}

function uniqueIds(ids: string[]): string[] {
  if (!Array.isArray(ids)) throw new Error('Invalid singer list.');
  for (const id of ids) validId(id);
  if (new Set(ids).size !== ids.length) throw new Error('Duplicate singer identity.');
  return [...ids];
}

function account(ledger: PointsLedger, singerId: string): PointsAccount {
  validId(singerId);
  let result = ledger.accounts.find(item => item.singerId === singerId);
  if (!result) {
    result = { singerId, points: 0, credits: 3 };
    ledger.accounts.push(result);
  }
  return result;
}

function performance(ledger: PointsLedger, generationId: string): PerformancePoints {
  validId(generationId);
  const item = ledger.performances.find(row => row.generationId === generationId);
  if (!item || item.finished) throw new Error('This performance is no longer accepting applause.');
  return item;
}

/** Older in-progress ledgers lack this flag, so the same check also repairs them at finish. */
function awardAllListenerBonus(ledger: PointsLedger, current: PerformancePoints, enabled: boolean): void {
  if (!enabled || current.allListenerBonusAwarded || current.eligibleListeners.length === 0 ||
      !current.eligibleListeners.every(id => current.applauders.includes(`singer:${id}`))) return;
  for (const id of current.performers) account(ledger, id).points += 50;
  current.allListenerBonusAwarded = true;
}

/**
 * Returns a new ledger; a repeated event with the same payload is a no-op.
 * Rejecting an event leaves the original object untouched. All eligibility,
 * ownership, historical-song facts and participant identities come from the
 * authenticated authority, never from an untrusted singer client.
 */
export function applyPointsEvent(original: PointsLedger, event: PointsEvent, options: { pointsEnabled: boolean; applauseEnabled: boolean }): { ledger: PointsLedger; applied: boolean } {
  validId(event.eventId);
  if (!original || original.version !== 1 || !Array.isArray(original.receipts)) throw new Error('Invalid points ledger.');
  const fingerprint = JSON.stringify(event);
  const existing = original.receipts.find(item => item.id === event.eventId);
  if (existing) {
    if (existing.event !== fingerprint) throw new Error('Points event identity is already in use.');
    return { ledger: original, applied: false };
  }
  const ledger: PointsLedger = structuredClone(original);
  switch (event.type) {
    case 'join':
      account(ledger, event.singerId);
      break;
    case 'queue': {
      if (typeof event.sungEarlierThisShow !== 'boolean' || typeof event.everQueuedOrSung !== 'boolean' || (event.isDuet !== undefined && typeof event.isDuet !== 'boolean')) throw new Error('Invalid song history.');
      const singer = account(ledger, event.singerId);
      if (event.coSingerId === event.singerId) throw new Error('Choose a different duet singer.');
      const coSinger = event.coSingerId ? account(ledger, event.coSingerId) : null;
      if (options.pointsEnabled) {
        if (event.requestId) (ledger.queueAwards ??= []).push({ requestId: event.requestId, singerId: event.singerId });
        singer.points += 12 + (event.sungEarlierThisShow ? 0 : 6) + (event.everQueuedOrSung ? 0 : 18) + (event.isDuet || coSinger ? 14 : 0);
        if (coSinger) coSinger.points += 14;
        if ((event.isDuet || coSinger) && event.requestId) {
          validId(event.requestId);
          const awards = ledger.duetAwards ??= [];
          awards.push({ requestId: event.requestId, singerId: singer.singerId });
          if (coSinger) awards.push({ requestId: event.requestId, singerId: coSinger.singerId });
        }
      }
      break;
    }
    case 'rememberQueue': {
      validId(event.requestId);
      if (typeof event.everQueuedOrSung !== 'boolean') throw new Error('Invalid song history.');
      const sungBy = uniqueIds(event.sungBy);
      const facts = ledger.queueFacts ??= [];
      if (facts.some(item => item.requestId === event.requestId)) throw new Error('Queue history already exists.');
      facts.push({ requestId: event.requestId, everQueuedOrSung: event.everQueuedOrSung, sungBy });
      break;
    }
    case 'assignQueue': {
      validId(event.requestId);
      const singer = account(ledger, event.singerId);
      const awards = ledger.queueAwards ??= [];
      // Old ledgers may have recorded the original award only in their event receipts.
      const legacyAward = ledger.receipts.some(receipt => {
        try { const prior = JSON.parse(receipt.event); return prior.type === 'queue' && prior.requestId === event.requestId && prior.singerId === event.singerId; }
        catch { return false; }
      });
      if (options.pointsEnabled && !legacyAward && !awards.some(item => item.requestId === event.requestId && item.singerId === event.singerId)) {
        const facts = ledger.queueFacts?.find(item => item.requestId === event.requestId);
        singer.points += 12 + (facts && !facts.sungBy.some(id => id !== event.singerId) ? 6 : 0) + (facts && !facts.everQueuedOrSung ? 18 : 0);
        awards.push({ requestId: event.requestId, singerId: event.singerId });
      }
      break;
    }
    case 'duetPartner': {
      validId(event.requestId);
      const singer = account(ledger, event.singerId);
      const awards = ledger.duetAwards ??= [];
      if (options.pointsEnabled && !awards.some(item => item.requestId === event.requestId && item.singerId === event.singerId)) {
        singer.points += 14;
        awards.push({ requestId: event.requestId, singerId: event.singerId });
      }
      break;
    }
    case 'start': {
      validId(event.generationId);
      if (ledger.performances.some(item => item.generationId === event.generationId)) throw new Error('This performance already exists.');
      const performers = uniqueIds(event.performers);
      const participants = uniqueIds(event.participants);
      for (const id of [...performers, ...participants]) account(ledger, id);
      ledger.performances.push({ generationId: event.generationId, performers, eligibleListeners: participants.filter(id => !performers.includes(id)),
        applauseCount: 0, applauders: [], singerApplause: [], finished: false });
      break;
    }
    case 'applause': {
      if (!options.applauseEnabled) throw new Error('Applause is turned off.');
      const current = event.generationId === null ? null : performance(ledger, event.generationId);
      let actorKey = 'host';
      let giver: PointsAccount | undefined;
      if (event.actor.role === 'singer') {
        if (current?.performers.includes(event.actor.singerId)) throw new Error('You cannot applaud your own performance.');
        giver = account(ledger, event.actor.singerId);
        if (giver.credits <= 0) throw new Error('No applause credits remain.');
        giver.credits--;
        actorKey = `singer:${event.actor.singerId}`;
      } else if (event.actor.role !== 'host') throw new Error('Invalid applause actor.');
      if (current) {
        const amount = [10, 15, 25][current.applauseCount] ?? 5;
        current.applauseCount++;
        const firstFromActor = !current.applauders.includes(actorKey);
        if (firstFromActor) current.applauders.push(actorKey);
        if (options.pointsEnabled) {
          const uniqueBonus = firstFromActor && current.applauders.length > 1 ? 5 : 0;
          for (const id of current.performers) account(ledger, id).points += amount + uniqueBonus;
        }
        awardAllListenerBonus(ledger, current, options.pointsEnabled);
        if (giver && current.performers.length > 0 && !current.performers.includes(giver.singerId)) {
          let giving = current.singerApplause.find(item => item.singerId === giver!.singerId);
          if (!giving) { giving = { singerId: giver.singerId, count: 0 }; current.singerApplause.push(giving); }
          if (options.pointsEnabled) giver.points += [8, 4, 2][giving.count] ?? 0;
          giving.count++;
        }
      }
      break;
    }
    case 'finish': {
      if (typeof event.completed !== 'boolean') throw new Error('Invalid performance outcome.');
      const current = performance(ledger, event.generationId);
      current.finished = true;
      // Recover the bonus for a legacy in-progress snapshot whose last clap was
      // recorded before immediate awards were introduced.
      awardAllListenerBonus(ledger, current, options.pointsEnabled);
      if (event.completed) {
        for (const id of current.performers) {
          const singer = account(ledger, id);
          singer.credits = Math.min(5, singer.credits + 1);
        }
      }
      break;
    }
    case 'suggestion':
    case 'photo':
      if (options.pointsEnabled) account(ledger, event.singerId).points += event.type === 'suggestion' ? 10 : 24;
      else account(ledger, event.singerId);
      break;
    default: throw new Error('Invalid points event.');
  }
  ledger.receipts.push({ id: event.eventId, event: fingerprint });
  return { ledger, applied: true };
}
