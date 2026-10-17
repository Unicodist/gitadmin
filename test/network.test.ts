import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { describeNetworkError, getSshCommand, getSshHost } from '../src/renderer/helpers/git/network';

describe('getSshHost', () => {
  it('reads the host of SSH URLs', () => {
    assert.equal(getSshHost('git@github.com:ada/engine.git'), 'github.com');
    assert.equal(getSshHost('github.com:ada/engine.git'), 'github.com');
    assert.equal(getSshHost('ssh://git@example.com:2222/ada/engine.git'), 'example.com');
    assert.equal(getSshHost('ssh://example.com/engine.git'), 'example.com');
    assert.equal(getSshHost('git+ssh://git@example.com/engine.git'), 'example.com');
    assert.equal(getSshHost('ssh://git@[2001:db8::1]:22/engine.git'), '2001:db8::1');
  });

  it('ignores the other URLs', () => {
    assert.equal(getSshHost('https://github.com/ada/engine.git'), null);
    assert.equal(getSshHost('file:///srv/engine.git'), null);
    assert.equal(getSshHost('/srv/engine.git'), null);
    assert.equal(getSshHost('../engine'), null);
    assert.equal(getSshHost('C:\\repos\\engine'), null);
    assert.equal(getSshHost('C:/repos/engine'), null);
  });
});

describe('getSshCommand', () => {
  const keys = { 'github.com': '/home/ada/.ssh/id_work', 'example.com': '/home/ada/.ssh/ada\'s key' };

  it('uses only the key of the host', () => {
    assert.equal(getSshCommand('git@github.com:ada/engine.git', keys), 'ssh -i \'/home/ada/.ssh/id_work\' -o IdentitiesOnly=yes');
    assert.equal(getSshCommand('ssh://git@EXAMPLE.com/engine.git', keys),
      'ssh -i \'/home/ada/.ssh/ada\'\\\'\'s key\' -o IdentitiesOnly=yes');
  });

  it('keeps ssh as configured for the other hosts and URLs', () => {
    assert.equal(getSshCommand('git@gitlab.com:ada/engine.git', keys), null);
    assert.equal(getSshCommand('https://github.com/ada/engine.git', keys), null);
  });
});

describe('describeNetworkError', () => {
  it('explains the refused keys', () => {
    assert.match(describeNetworkError('git@github.com: Permission denied (publickey).\nfatal: Could not read from remote repository.')!,
      /refused your SSH key.*Preferences → Authentication/);
    assert.match(describeNetworkError('Received disconnect from 192.0.2.1 port 22:2: Too many authentication failures')!,
      /too many keys/);
    assert.equal(describeNetworkError('ada@example.com: Permission denied (password).'), 'The server refused the credentials.');
  });

  it('warns about a changed host key without suggesting to accept it', () => {
    const message = describeNetworkError([
      '@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@',
      '@    WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!     @',
      '@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@',
      'Host key for github.com has changed and you have requested strict checking.',
      'Host key verification failed.'
    ].join('\n'))!;
    assert.match(message, /host key of github\.com has changed/);
    assert.match(message, /intercepting/);
    assert.match(message, /ssh-keygen -R github\.com/);
  });

  it('explains a host key that was not accepted', () => {
    assert.match(describeNetworkError('Host key verification failed.\nfatal: Could not read from remote repository.')!,
      /host key of the server was not accepted/);
  });

  it('explains the connection failures', () => {
    assert.match(describeNetworkError('ssh: Could not resolve hostname githb.com: Name or service not known')!, /githb\.com was not found/);
    assert.match(describeNetworkError('ssh: connect to host example.com port 22: Connection refused')!, /refused the connection/);
    assert.match(describeNetworkError('ssh: connect to host example.com port 22: Connection timed out')!, /timed out/);
    assert.match(describeNetworkError('ssh: connect to host example.com port 22: Operation timed out')!, /timed out/);
  });

  it('explains the HTTPS failures and the wrong secrets', () => {
    const stderr = 'remote: Invalid username or password.\nfatal: Authentication failed for \'https://github.com/ada/engine.git/\'';
    assert.match(describeNetworkError(stderr)!,
      /username or the password of https:\/\/github\.com\/ada\/engine\.git\//);
    assert.match(describeNetworkError('anything', 'attempts')!, /wrong too many times/);
    assert.match(describeNetworkError('@ WARNING: UNPROTECTED PRIVATE KEY FILE! @')!, /chmod 600/);
  });

  it('keeps the other errors', () => {
    assert.equal(describeNetworkError('fatal: \'origin\' does not appear to be a git repository'), null);
    assert.equal(describeNetworkError('fatal: could not create work tree dir \'engine\': Permission denied'), null);
  });
});
