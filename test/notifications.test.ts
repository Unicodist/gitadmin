import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  AUTO_DISMISS_DELAY, DismissTimer, getAutoDismissDelay, getTransitionDuration, NotificationType, splitNotificationMessage
} from '../src/renderer/helpers/notifications';
import { NotificationType as ExportedNotificationType } from '../src/renderer/components/notification-item';

describe('getAutoDismissDelay', () => {
  it('dismisses the information after a few seconds', () => {
    assert.equal(getAutoDismissDelay(NotificationType.Information), AUTO_DISMISS_DELAY);
    assert.ok(AUTO_DISMISS_DELAY >= 3000 && AUTO_DISMISS_DELAY <= 6000);
  });

  it('keeps the errors until they are dismissed', () => {
    assert.equal(getAutoDismissDelay(NotificationType.Error), null);
  });

  it('is the type that the components export', () => {
    assert.equal(ExportedNotificationType, NotificationType);
  });
});

describe('splitNotificationMessage', () => {
  it('splits an error into a title and the message of git', () => {
    assert.deepEqual(splitNotificationMessage('Unable to push: fatal: the remote end hung up unexpectedly'), {
      title: 'Unable to push',
      details: 'fatal: the remote end hung up unexpectedly'
    });
  });

  it('keeps a message without details as it is', () => {
    assert.deepEqual(splitNotificationMessage('Merged successfully'), { title: 'Merged successfully', details: '' });
    assert.deepEqual(splitNotificationMessage('Unable to push: '), { title: 'Unable to push', details: '' });
    // The colons of the paths and of the URLs are not followed by a space
    assert.deepEqual(splitNotificationMessage('Cloned https://example.com/repo.git in C:\\repos'), {
      title: 'Cloned https://example.com/repo.git in C:\\repos',
      details: ''
    });
  });

  it('keeps the line breaks of the details', () => {
    assert.deepEqual(splitNotificationMessage('Unable to merge: error: conflict\nAborting\n'), {
      title: 'Unable to merge',
      details: 'error: conflict\nAborting'
    });
  });
});

describe('DismissTimer', () => {
  it('calls its callback once after the delay', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    let calls = 0;
    const timer = new DismissTimer(() => ++calls, 4000);
    timer.start();
    timer.start();
    assert.equal(timer.isRunning(), true);
    t.mock.timers.tick(3999);
    assert.equal(calls, 0);
    t.mock.timers.tick(1);
    assert.equal(calls, 1);
    assert.equal(timer.isRunning(), false);
    // It is finished, it does not start again
    timer.start();
    t.mock.timers.tick(10000);
    assert.equal(calls, 1);
  });

  it('stops the time while it is paused', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    let calls = 0;
    const timer = new DismissTimer(() => ++calls, 4000);
    timer.start();
    t.mock.timers.tick(3000);
    timer.pause();
    timer.pause();
    assert.equal(timer.isRunning(), false);
    t.mock.timers.tick(60000);
    assert.equal(calls, 0);
    // It resumes with the time that was left
    timer.start();
    t.mock.timers.tick(999);
    assert.equal(calls, 0);
    t.mock.timers.tick(1);
    assert.equal(calls, 1);
  });

  it('never calls its callback once it is stopped', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    let calls = 0;
    const timer = new DismissTimer(() => ++calls, 4000);
    timer.start();
    timer.stop();
    timer.start();
    t.mock.timers.tick(60000);
    assert.equal(calls, 0);
  });
});

describe('getTransitionDuration', () => {
  it('returns the longest transition with its delay, in milliseconds', () => {
    assert.equal(getTransitionDuration({ transitionDuration: '0.2s', transitionDelay: '0s' }), 200);
    assert.equal(getTransitionDuration({ transitionDuration: '200ms, 0.12s', transitionDelay: '0s, 100ms' }), 220);
    // The delays repeat when there are fewer of them
    assert.equal(getTransitionDuration({ transitionDuration: '0.1s, 0.3s', transitionDelay: '50ms' }), 350);
  });

  it('returns 0 when the transitions are turned off', () => {
    assert.equal(getTransitionDuration({ transitionDuration: '0s', transitionDelay: '0s' }), 0);
    assert.equal(getTransitionDuration({ transitionDuration: '', transitionDelay: '' }), 0);
  });
});
