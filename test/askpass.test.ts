import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { PromptKind, parsePrompt, quoteShell } from '../src/shared/askpass';

describe('parsePrompt', () => {
  it('recognizes the passphrase of a key', () => {
    const prompt = parsePrompt('Enter passphrase for key \'/home/ada/.ssh/id_ed25519\': ');
    assert.equal(prompt.kind, PromptKind.Passphrase);
    assert.equal(prompt.subject, '/home/ada/.ssh/id_ed25519');
    assert.equal(prompt.key, 'passphrase:/home/ada/.ssh/id_ed25519');
    assert.equal(prompt.secret, true);
    assert.equal(parsePrompt('Enter passphrase for /home/ada/.ssh/id_rsa:').subject, '/home/ada/.ssh/id_rsa');
  });

  it('recognizes the passwords of SSH servers', () => {
    for (const text of ['ada@example.com\'s password: ', '(ada@example.com) Password: ']) {
      const prompt = parsePrompt(text);
      assert.equal(prompt.kind, PromptKind.Password, text);
      assert.equal(prompt.subject, 'ada@example.com');
      assert.equal(prompt.secret, true);
    }
  });

  it('recognizes the username and the password of HTTPS remotes', () => {
    const username = parsePrompt('Username for \'https://example.com\': ');
    assert.equal(username.kind, PromptKind.Username);
    assert.equal(username.subject, 'https://example.com');
    assert.equal(username.secret, false);
    const password = parsePrompt('Password for \'https://ada@example.com\': ');
    assert.equal(password.kind, PromptKind.HttpsPassword);
    assert.equal(password.subject, 'https://ada@example.com');
    assert.equal(password.secret, true);
  });

  it('recognizes the confirmation of an unknown host key with its fingerprint', () => {
    const prompt = parsePrompt([
      'The authenticity of host \'example.com (192.0.2.1)\' can\'t be established.',
      'ED25519 key fingerprint is SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU.',
      'This key is not known by any other names.',
      'Are you sure you want to continue connecting (yes/no/[fingerprint])? '
    ].join('\n'), 'confirm');
    assert.equal(prompt.kind, PromptKind.HostKey);
    assert.equal(prompt.subject, 'example.com (192.0.2.1)');
    assert.equal(prompt.fingerprint, 'ED25519 key fingerprint is SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU.');
    assert.equal(prompt.secret, false);
  });

  it('keeps the other prompts as they are', () => {
    const pin = parsePrompt('Enter PIN for ECDSA-SK key /home/ada/.ssh/id_ecdsa_sk: ');
    assert.equal(pin.kind, PromptKind.Other);
    assert.equal(pin.secret, true);
    assert.equal(parsePrompt('Allow use of key?', 'confirm').secret, false);
    assert.equal(parsePrompt('Confirm user presence for key ECDSA-SK', 'none').kind, PromptKind.Notice);
  });
});

describe('quoteShell', () => {
  it('quotes the single quotes', () => {
    assert.equal(quoteShell('/home/ada/.ssh/id_rsa'), '\'/home/ada/.ssh/id_rsa\'');
    assert.equal(quoteShell('/keys/ada\'s key'), '\'/keys/ada\'\\\'\'s key\'');
  });
});
