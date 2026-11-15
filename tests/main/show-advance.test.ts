import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ShowAdvance, type ShowAdvanceClock, type ShowAdvanceSnapshot } from '../../src/main/show-advance';
function fixture() {
  let now = 0;
  const timers = new Set<{ at: number; run(): void }>();
  const clock: ShowAdvanceClock = { now: () => now, schedule(run, delay) { const timer = { at: now + delay, run }; timers.add(timer); return { cancel: () => timers.delete(timer) }; } };
  const state: ShowAdvanceSnapshot = { enabled: true, playing: false, requestId: 'next', notBeforeMs: 1000, ready: true };
  const advance = async (ms: number) => { now += ms; const due = [...timers].filter(timer => timer.at <= now); for (const timer of due) { timers.delete(timer); timer.run(); } await Promise.resolve(); await Promise.resolve(); };
  return { state, clock, advance, timers };
}
test('queue/launch changes never autoplay; a completed show advances exactly once after the gap', async () => {
  const f = fixture(), starts: string[] = [];
  const automation = new ShowAdvance(() => f.state, async (id, current) => { assert.equal(current(), true); starts.push(id); return { ok: true }; }, undefined, f.clock);
  automation.changed(); await f.advance(5000); assert.deepEqual(starts, []);
  f.state.notBeforeMs = 6000; automation.arm(); await f.advance(999); assert.deepEqual(starts, []);
  await f.advance(1); assert.deepEqual(starts, ['next']); await f.advance(5000); assert.deepEqual(starts, ['next']); automation.close();
});
test('waiting downloads and empty queues preserve the armed show until an eligible song is ready', async () => {
  const f = fixture(); f.state.requestId = null; f.state.notBeforeMs = 0; let starts = 0;
  const automation = new ShowAdvance(() => f.state, async () => { starts++; return { ok: true }; }, undefined, f.clock);
  automation.arm(); await f.advance(500); assert.equal(starts, 0);
  f.state.requestId = 'download'; f.state.ready = false; automation.changed(); await f.advance(500); assert.equal(starts, 0);
  f.state.ready = true; automation.changed(); await f.advance(0); assert.equal(starts, 1); assert.equal(automation.isArmed(), false); automation.close();
});
test('manual Stop/Pause, disabling and output loss cancel pending and in-flight starts', async () => {
  const f = fixture(); f.state.notBeforeMs = 0; let finish!: () => void, valid!: () => boolean;
  const gate = new Promise<void>(resolve => { finish = resolve; });
  const automation = new ShowAdvance(() => f.state, async (_id, current) => { valid = current; await gate; return { ok: current() }; }, () => assert.fail('Cancelled work must not report an error'), f.clock);
  automation.arm(); await f.advance(0); assert.equal(valid(), true);
  automation.cancel(); assert.equal(valid(), false); finish(); await Promise.resolve(); await Promise.resolve();
  assert.equal(automation.isArmed(), false); assert.equal(f.timers.size, 0);
  f.state.enabled = false; automation.arm(); assert.equal(automation.isArmed(), false); automation.close();
});
test('changed staged identity invalidates an in-flight start and a failed song stays for explicit recovery', async () => {
  const f = fixture(); f.state.notBeforeMs = 0; const errors: string[] = []; let observed!: () => boolean;
  const automation = new ShowAdvance(() => f.state, async (_id, current) => { observed = current; f.state.requestId = 'replacement'; assert.equal(current(), false); return { ok: false, error: 'The recording changed.' }; }, value => errors.push(value), f.clock);
  automation.arm(); await f.advance(0); assert.equal(observed(), false); assert.deepEqual(errors, ['The recording changed.']);
  assert.equal(f.state.requestId, 'replacement'); assert.equal(automation.isArmed(), false); automation.close();
});

test('failed media stops automatic advancement without silently consuming a turn or retrying forever', async () => {
  const f = fixture(); f.state.notBeforeMs = 0; f.state.ready = false; f.state.error = 'Relink the missing song.';
  const errors: string[] = [];
  const automation = new ShowAdvance(() => f.state, async () => assert.fail('A failed recording must never start'), value => errors.push(value), f.clock);
  automation.arm(); await f.advance(0); await f.advance(10000);
  assert.deepEqual(errors, ['Relink the missing song.']); assert.equal(f.state.requestId, 'next'); assert.equal(automation.isArmed(), false); automation.close();
});
