import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as Path from 'path';
import { getAgentStatus, isPrivateKeyEncrypted, listSshKeys } from '../src/renderer/helpers/ssh-keys';

// Private key in the format of OpenSSH, only its header is meaningful
function opensshKey(cipher: string) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(cipher.length);
  const data = Buffer.concat([Buffer.from('openssh-key-v1\0', 'latin1'), length, Buffer.from(cipher), Buffer.alloc(32)]);
  return `-----BEGIN OPENSSH PRIVATE KEY-----\n${data.toString('base64')}\n-----END OPENSSH PRIVATE KEY-----\n`;
}

describe('isPrivateKeyEncrypted', () => {
  it('reads the cipher of the keys of OpenSSH', () => {
    assert.equal(isPrivateKeyEncrypted(opensshKey('none')), false);
    assert.equal(isPrivateKeyEncrypted(opensshKey('aes256-ctr')), true);
  });

  it('reads the headers of the PEM keys', () => {
    assert.equal(isPrivateKeyEncrypted('-----BEGIN RSA PRIVATE KEY-----\nProc-Type: 4,ENCRYPTED\nDEK-Info: AES-128-CBC,00\n\nAAAA\n'), true);
    assert.equal(isPrivateKeyEncrypted('-----BEGIN ENCRYPTED PRIVATE KEY-----\nAAAA\n'), true);
    assert.equal(isPrivateKeyEncrypted('-----BEGIN RSA PRIVATE KEY-----\nAAAA\n'), false);
  });

  it('does not know the other files', () => {
    assert.equal(isPrivateKeyEncrypted('ssh-ed25519 AAAA ada@example.com'), null);
    assert.equal(isPrivateKeyEncrypted('-----BEGIN OPENSSH PRIVATE KEY-----\nAAAA\n-----END OPENSSH PRIVATE KEY-----'), null);
  });
});

describe('listSshKeys', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(Path.join(os.tmpdir(), 'gitadmin-ssh-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('lists the private keys with their public keys', () => {
    fs.writeFileSync(Path.join(dir, 'id_ed25519'), opensshKey('aes256-ctr'));
    fs.writeFileSync(Path.join(dir, 'id_ed25519.pub'), 'ssh-ed25519 AAAAC3Nza ada@example.com\n');
    fs.writeFileSync(Path.join(dir, 'deploy'), opensshKey('none'));
    fs.writeFileSync(Path.join(dir, 'known_hosts'), 'github.com ssh-ed25519 AAAA\n');
    fs.writeFileSync(Path.join(dir, 'config'), 'Host *\n');
    fs.writeFileSync(Path.join(dir, 'notes.txt'), 'not a key\n');
    fs.mkdirSync(Path.join(dir, 'sockets'));
    assert.deepEqual(listSshKeys(dir), [
      { path: Path.join(dir, 'deploy'), name: 'deploy', type: '', comment: '', encrypted: false },
      { path: Path.join(dir, 'id_ed25519'), name: 'id_ed25519', type: 'ssh-ed25519', comment: 'ada@example.com', encrypted: true }
    ]);
  });

  it('finds nothing in a missing directory', () => {
    assert.deepEqual(listSshKeys(Path.join(dir, 'missing')), []);
  });
});

describe('getAgentStatus', () => {
  it('finds the socket of the agent', () => {
    const socket = Path.join(os.tmpdir());
    assert.deepEqual(getAgentStatus({ SSH_AUTH_SOCK: socket }, 'linux'), { running: true, location: socket });
    assert.deepEqual(getAgentStatus({ SSH_AUTH_SOCK: Path.join(socket, 'gitadmin-missing-agent') }, 'linux'),
      { running: false, location: null });
    assert.deepEqual(getAgentStatus({}, 'linux'), { running: false, location: null });
  });
});
