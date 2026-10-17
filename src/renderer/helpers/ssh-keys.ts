import * as fs from 'fs';
import * as os from 'os';
import * as Path from 'path';

export interface SshKey {
  path: string;
  name: string;
  // Algorithm from the public key, like ssh-ed25519, empty when there is no public key
  type: string;
  comment: string;
  // Whether a passphrase protects the key, null when the format is unknown
  encrypted: boolean | null;
}

export interface AgentStatus {
  running: boolean;
  // Socket or pipe of the agent
  location: string | null;
}

export function getSshDirectory() {
  return Path.join(os.homedir(), '.ssh');
}

// Files of ~/.ssh that are not keys
const IGNORED_FILES = /^(known_hosts|authorized_keys|config|environment)/;

// Whether the private key in the format of OpenSSH or PEM is encrypted
export function isPrivateKeyEncrypted(content: string): boolean | null {
  if (/-----BEGIN ENCRYPTED PRIVATE KEY-----/.test(content) || /Proc-Type:\s*4,ENCRYPTED/.test(content)) {
    return true;
  }
  const openssh = /-----BEGIN OPENSSH PRIVATE KEY-----([\s\S]*?)-----END OPENSSH PRIVATE KEY-----/.exec(content);
  if (!openssh) {
    return /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(content) ? false : null;
  }
  // "openssh-key-v1\0", then the length and the name of the cipher, which is "none" for a key without passphrase
  const data = Buffer.from(openssh[1].replace(/\s+/g, ''), 'base64');
  const magic = 'openssh-key-v1\0';
  if (data.length < magic.length + 4 || data.toString('latin1', 0, magic.length) !== magic) {
    return null;
  }
  const length = data.readUInt32BE(magic.length);
  const start = magic.length + 4;
  if (data.length < start + length) {
    return null;
  }
  return data.toString('latin1', start, start + length) !== 'none';
}

// Private keys of a directory, ~/.ssh by default, sorted by name
export function listSshKeys(dir = getSshDirectory()): SshKey[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    return [];
  }
  const keys: SshKey[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || entry.name.endsWith('.pub') || IGNORED_FILES.test(entry.name)) {
      continue;
    }
    const path = Path.join(dir, entry.name);
    let content: string;
    try {
      // Keys are small, a large file is something else
      if (fs.statSync(path).size > 64 * 1024) {
        continue;
      }
      content = fs.readFileSync(path, 'latin1');
    } catch (e) {
      continue;
    }
    if (!/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(content)) {
      continue;
    }
    let type = '';
    let comment = '';
    try {
      const [publicType = '', , ...rest] = fs.readFileSync(`${path}.pub`, 'utf8').trim().split(/\s+/);
      type = publicType;
      comment = rest.join(' ');
    } catch (e) {
      // No public key
    }
    keys.push({ path, name: entry.name, type, comment, encrypted: isPrivateKeyEncrypted(content) });
  }
  return keys.sort((a, b) => a.name.localeCompare(b.name));
}

// Pipe of the OpenSSH agent service of Windows
const WINDOWS_AGENT_PIPE = '\\\\.\\pipe\\openssh-ssh-agent';

// Whether an SSH agent can be reached by ssh, from SSH_AUTH_SOCK, or the agent service on Windows
export function getAgentStatus(env: NodeJS.ProcessEnv = process.env, platform = process.platform): AgentStatus {
  const socket = env.SSH_AUTH_SOCK;
  if (socket && fs.existsSync(socket)) {
    return { running: true, location: socket };
  }
  if (platform === 'win32' && fs.existsSync(WINDOWS_AGENT_PIPE)) {
    return { running: true, location: WINDOWS_AGENT_PIPE };
  }
  return { running: false, location: null };
}
