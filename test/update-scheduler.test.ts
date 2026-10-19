import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { Changes, UpdateScheduler } from '../src/renderer/helpers/update-scheduler';

const DELAY = 10;

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// The updates finish when the test releases them
function createScheduler(busy = () => false) {
  const updates: Changes[] = [];
  const running: (() => void)[] = [];
  const scheduler = new UpdateScheduler((changes) => {
    updates.push(changes);
    return new Promise<void>((resolve) => running.push(resolve));
  }, busy, DELAY);
  const release = () => running.splice(0).forEach((resolve) => resolve());
  return { scheduler, updates, release };
}

describe('UpdateScheduler', () => {
  it('handles a burst of changes in one update', async () => {
    const { scheduler, updates } = createScheduler();
    // A fetch that moves 60 branches writes 60 files
    for (let i = 0; i < 60; ++i) {
      scheduler.schedule(true, false);
    }
    scheduler.schedule(false, true);
    await wait(DELAY * 5);
    assert.deepEqual(updates, [{ references: true, index: true }]);
  });

  it('updates the state alone when only other files changed', async () => {
    const { scheduler, updates } = createScheduler();
    scheduler.schedule(false, false);
    await wait(DELAY * 5);
    assert.deepEqual(updates, [{ references: false, index: false }]);
  });

  it('runs one update at once and the changes seen in the meantime after it', async () => {
    const { scheduler, updates, release } = createScheduler();
    scheduler.schedule(false, true);
    await wait(DELAY * 5);
    assert.equal(updates.length, 1);
    scheduler.schedule(true, false);
    scheduler.schedule(true, false);
    await wait(DELAY * 5);
    assert.equal(updates.length, 1);
    release();
    await wait(DELAY * 5);
    assert.deepEqual(updates, [{ references: false, index: true }, { references: true, index: false }]);
  });

  it('waits while the repository is busy', async () => {
    let busy = true;
    const { scheduler, updates, release } = createScheduler(() => busy);
    scheduler.schedule(true, false);
    await wait(DELAY * 5);
    assert.deepEqual(updates, []);
    busy = false;
    scheduler.resume();
    await wait(DELAY * 5);
    assert.deepEqual(updates, [{ references: true, index: false }]);
    // Nothing is left to do
    release();
    scheduler.resume();
    await wait(DELAY * 5);
    assert.equal(updates.length, 1);
  });

  it('starts nothing once stopped', async () => {
    const { scheduler, updates } = createScheduler();
    scheduler.schedule(true, true);
    scheduler.stop();
    scheduler.schedule(true, true);
    await wait(DELAY * 5);
    assert.deepEqual(updates, []);
  });
});
