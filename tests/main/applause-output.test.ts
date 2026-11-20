import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApplauseOutput } from '../../src/main/applause-output';

test('applause reserves at most three simultaneous sounds, including pending starts', async () => {
  const requests: { id: string; volume: number; outputId: string }[] = [];
  const output = new ApplauseOutput(request => requests.push(request));
  const first = output.play(0.7, 'device');
  const second = output.play(0.7, 'device');
  const third = output.play(0.7, 'device');
  await assert.rejects(output.play(0.7, 'device'), /Three applause/);
  output.acknowledge({ id: requests[0].id, ok: true, durationMs: 3000 });
  output.acknowledge({ id: requests[1].id, ok: false, error: 'Audio output unavailable.' });
  output.acknowledge({ id: requests[2].id, ok: true, durationMs: 11184 });
  await first;
  await assert.rejects(second, /Audio output unavailable/);
  await third;
  const replacement = output.play(0.7, 'device');
  output.acknowledge({ id: requests[3].id, ok: true, durationMs: 4000 });
  await replacement;
  await assert.rejects(output.play(0.7, 'device'), /Three applause/);
  output.clear();
});

test('closing the display rejects pending starts', async () => {
  const output = new ApplauseOutput(() => {});
  const pending = output.play(1, '');
  output.clear();
  await assert.rejects(pending, /closed/);
});
