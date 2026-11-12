import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

type Predicate = (arg?: unknown) => unknown;
type Page = { evaluate(predicate: Predicate, arg?: unknown): Promise<unknown> };
type Wait = (page: Page, predicate: Predicate, arg?: unknown, options?: { timeout?: number; polling?: number }) => Promise<true>;
const helper: Promise<{ waitForHostCondition: Wait }> = import(pathToFileURL(resolve('scripts/wait-for-host-condition.mjs')).href);
const waitForHostCondition: Wait = async (...args) => (await helper).waitForHostCondition(...args);
const page: Page = { evaluate: async (predicate, arg) => await predicate(arg) };

test('host wait awaits async false results and polls until the predicate actually becomes true', async () => {
  let evaluations = 0, completed = 0;
  const result = await waitForHostCondition(page, async arg => {
    evaluations++; await delay(3); completed++;
    return completed === arg;
  }, 4, { timeout: 500, polling: 1 });
  assert.equal(result, true); assert.equal(evaluations, 4); assert.equal(completed, 4);
});

test('an async predicate that keeps returning false times out instead of resolving its Promise', async () => {
  let completed = 0;
  await assert.rejects(waitForHostCondition(page, async () => { await delay(2); completed++; return false; }, undefined,
    { timeout: 30, polling: 1 }), error => error instanceof Error && error.name === 'TimeoutError');
  assert.ok(completed > 1);
});

test('the overall deadline also bounds an evaluate call that never settles', { timeout: 1000 }, async () => {
  let calls = 0;
  await assert.rejects(waitForHostCondition({ evaluate: () => { calls++; return new Promise(() => {}); } }, () => true, undefined,
    { timeout: 20, polling: 1 }), error => error instanceof Error && error.name === 'TimeoutError');
  assert.equal(calls, 1);
});

test('invalid bounds are refused before evaluating and truthy non-booleans cannot pass', async () => {
  let calls = 0;
  const counted: Page = { evaluate: async (predicate, arg) => { calls++; return await predicate(arg); } };
  for (const timeout of [0, -1, NaN, Infinity, 300001, 1.5]) await assert.rejects(waitForHostCondition(counted, () => true, undefined, { timeout }), TypeError);
  for (const polling of [0, -1, NaN, Infinity, 1001, 1.5]) await assert.rejects(waitForHostCondition(counted, () => true, undefined, { polling }), TypeError);
  assert.equal(calls, 0);
  await assert.rejects(waitForHostCondition(counted, async () => ({ ready: true }), undefined, { timeout: 100 }), /boolean/);
  assert.equal(calls, 1);
});

test('predicate errors remain visible instead of being mistaken for a successful wait', async () => {
  await assert.rejects(waitForHostCondition(page, async () => { throw new Error('host IPC failed'); }, undefined, { timeout: 100 }), /host IPC failed/);
});
