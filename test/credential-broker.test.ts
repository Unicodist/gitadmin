import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { CredentialBroker, MAX_ATTEMPTS } from '../src/main/credential-broker';
import { CredentialAnswer, CredentialRequest, PromptKind } from '../src/shared/askpass';

const PASSPHRASE_PROMPT = 'Enter passphrase for key \'/keys/id_test\': ';
const USERNAME_PROMPT = 'Username for \'https://github.com\': ';
const PASSWORD_PROMPT = 'Password for \'https://ada@example.com@github.com\': ';

// Answers the prompts with the answers in order, and records the requests
function createBroker(answers: (CredentialAnswer | null)[]) {
  const requests: CredentialRequest[] = [];
  const broker = new CredentialBroker(async (_session, request) => {
    requests.push(request);
    return answers.length > 0 ? answers.shift()! : null;
  });
  // parent is the ssh or git process that asks
  const ask = (session = 'a', prompt = PASSPHRASE_PROMPT, parent = '100') => broker.handle({ session, prompt, promptKind: '', parent });
  return { broker, requests, ask };
}

describe('CredentialBroker', () => {
  it('asks the user and returns the answer', async () => {
    const { broker, requests, ask } = createBroker([{ value: 'secret', remember: false }]);
    assert.equal(await ask(), 'secret');
    assert.equal(requests.length, 1);
    assert.equal(requests[0].kind, PromptKind.Passphrase);
    assert.equal(requests[0].subject, '/keys/id_test');
    assert.equal(requests[0].attempt, 1);
    assert.equal(requests[0].maxAttempts, MAX_ATTEMPTS);
    assert.equal(broker.endSession('a'), null);
  });

  it('counts the attempts and stops after the last one', async () => {
    const wrong = { value: 'wrong', remember: false };
    const { broker, requests, ask } = createBroker([wrong, wrong, wrong]);
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      assert.equal(await ask(), 'wrong');
    }
    assert.equal(await ask(), null);
    assert.deepEqual(requests.map((request) => request.attempt), [1, 2, 3]);
    assert.equal(broker.endSession('a'), 'attempts');
    // A new command starts again
    assert.equal(await ask('b'), null);
    assert.equal(requests[requests.length - 1].attempt, 1);
  });

  it('fails the next prompts of a command once the user cancels', async () => {
    const { broker, requests, ask } = createBroker([null, { value: 'secret', remember: false }]);
    assert.equal(await ask(), null);
    assert.equal(await ask('a', 'ada@example.com\'s password: '), null);
    assert.equal(requests.length, 1);
    assert.equal(broker.endSession('a'), 'cancelled');
  });

  it('answers with a remembered secret until it is rejected or forgotten', async () => {
    const { broker, requests, ask } = createBroker([
      { value: 'old', remember: true },
      { value: 'new', remember: true },
      { value: 'again', remember: false }
    ]);
    assert.equal(await ask('a'), 'old');
    broker.endSession('a');
    assert.equal(broker.rememberedCount, 1);
    // Remembered for the next commands
    assert.equal(await ask('b'), 'old');
    assert.equal(requests.length, 1);
    // ssh asks again when it is wrong
    assert.equal(await ask('b'), 'new');
    assert.equal(requests[1].attempt, 2);
    broker.endSession('b');
    assert.equal(await ask('c'), 'new');
    broker.forgetAll();
    assert.equal(broker.rememberedCount, 0);
    assert.equal(await ask('d'), 'again');
  });

  it('gives the same answer to the other processes of a command', async () => {
    const { broker, requests, ask } = createBroker([{ value: 'secret', remember: false }, { value: 'right', remember: false }]);
    // fetch --all runs one ssh per remote
    assert.equal(await ask('a', PASSPHRASE_PROMPT, '100'), 'secret');
    assert.equal(await ask('a', PASSPHRASE_PROMPT, '101'), 'secret');
    assert.equal(requests.length, 1);
    // Asked again by the same process, it was wrong
    assert.equal(await ask('a', PASSPHRASE_PROMPT, '101'), 'right');
    assert.equal(requests[1].attempt, 2);
    assert.equal(await ask('a', PASSPHRASE_PROMPT, '102'), 'right');
    assert.equal(requests.length, 2);
    assert.equal(broker.endSession('a'), null);
    // Not remembered for the next commands
    assert.equal(await ask('b', PASSPHRASE_PROMPT, '103'), null);
  });

  it('keeps a remembered secret when other processes ask for it', async () => {
    const { broker, requests, ask } = createBroker([{ value: 'secret', remember: true }]);
    assert.equal(await ask('a', PASSPHRASE_PROMPT, '100'), 'secret');
    broker.endSession('a');
    for (const parent of ['101', '102', '103', '104']) {
      assert.equal(await ask('b', PASSPHRASE_PROMPT, parent), 'secret');
    }
    assert.equal(broker.endSession('b'), null);
    assert.equal(requests.length, 1);
    assert.equal(broker.rememberedCount, 1);
  });

  it('asks the username and the password of an HTTPS remote once per command', async () => {
    const { broker, requests, ask } = createBroker([{ value: 'ada@example.com', remember: false }, { value: 'token', remember: false }]);
    // git asks once per process, the processes of a command may have the same parent
    for (const parent of ['100', '100', '101']) {
      assert.equal(await ask('a', USERNAME_PROMPT, parent), 'ada@example.com');
      assert.equal(await ask('a', PASSWORD_PROMPT, parent), 'token');
    }
    assert.deepEqual(requests.map((request) => [request.kind, request.attempt]),
      [[PromptKind.Username, 1], [PromptKind.HttpsPassword, 1]]);
    assert.equal(broker.endSession('a'), null);
  });

  it('remembers the username with the HTTPS password', async () => {
    const { broker, requests, ask } = createBroker([
      { value: 'ada@example.com', remember: false },
      { value: 'token', remember: true }
    ]);
    assert.equal(await ask('a', USERNAME_PROMPT), 'ada@example.com');
    assert.equal(await ask('a', PASSWORD_PROMPT), 'token');
    broker.endSession('a');
    assert.equal(broker.rememberedCount, 1);
    assert.equal(await ask('b', USERNAME_PROMPT, '101'), 'ada@example.com');
    assert.equal(await ask('b', PASSWORD_PROMPT, '101'), 'token');
    assert.equal(requests.length, 2);
    broker.forgetAll();
    assert.equal(await ask('c', USERNAME_PROMPT, '102'), null);
  });

  it('forgets the HTTPS credentials that the server rejected', async () => {
    const { broker, requests, ask } = createBroker([
      { value: 'ada@example.com', remember: false },
      { value: 'expired', remember: true },
      { value: 'secret', remember: true }
    ]);
    assert.equal(await ask('a', USERNAME_PROMPT), 'ada@example.com');
    assert.equal(await ask('a', PASSWORD_PROMPT), 'expired');
    assert.equal(await ask('a'), 'secret');
    broker.endSession('a');
    // The remembered token is used, then rejected
    assert.equal(await ask('b', USERNAME_PROMPT, '101'), 'ada@example.com');
    assert.equal(await ask('b', PASSWORD_PROMPT, '101'), 'expired');
    broker.endSession('b', true);
    assert.equal(broker.rememberedCount, 1);
    assert.equal(await ask('c', USERNAME_PROMPT, '102'), null);
    assert.equal(requests.length, 4);
    assert.equal(requests[3].kind, PromptKind.Username);
  });

  it('never remembers what is not a secret', async () => {
    const { broker, ask } = createBroker([{ value: 'yes', remember: true }]);
    const prompt = 'The authenticity of host \'example.com\' can\'t be established.\n' +
      'Are you sure you want to continue connecting (yes/no/[fingerprint])? ';
    assert.equal(await ask('a', prompt), 'yes');
    assert.equal(broker.rememberedCount, 0);
  });

  it('answers the notices without asking', async () => {
    const { broker, requests } = createBroker([]);
    assert.equal(await broker.handle({ session: 'a', prompt: 'Confirm user presence for key', promptKind: 'none', parent: '100' }), '');
    assert.equal(requests.length, 0);
  });
});
