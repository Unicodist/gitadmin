import { ipcRenderer } from 'electron';
import { GitError } from './runner';
import { StopReason, quoteShell } from '../../../shared/askpass';
import { Field, Settings } from '../../../shared/settings';

// Commands that talk to a remote (clone, fetch, push) get variables that send the prompts of git and
// ssh to the app, use the key chosen for the host, and turn the usual failures into clear messages

export interface CredentialSession {
  session: string;
  env: Record<string, string>;
}

// Opens a session for the prompts of a command, and closes it once the command is done
export interface CredentialProvider {
  start(): CredentialSession | null;
  end(session: string): Promise<StopReason | null>;
}

// The main process shows the prompts in the window of the renderer
const ipcProvider: CredentialProvider = {
  start: () => ipcRenderer.sendSync('start-credential-session'),
  end: (session) => ipcRenderer.invoke('end-credential-session', session)
};

let provider: CredentialProvider | null = process.type === 'renderer' ? ipcProvider : null;

// Replaces how the prompts are answered (used by tests), null to not answer them
export function setCredentialProvider(newProvider: CredentialProvider | null) {
  provider = newProvider;
}

// The user cancelled a prompt, there is nothing to report
export class CancelledError extends Error {
  constructor() {
    super('Cancelled');
    this.name = 'CancelledError';
  }
}

// Host of an SSH URL: ssh://[user@]host[:port]/path or the scp-like [user@]host:path, null for the other URLs
export function getSshHost(url: string) {
  const match = /^(?:ssh|git\+ssh|ssh\+git):\/\/(?:[^@/]*@)?(\[[^\]]+\]|[^:/]+)/i.exec(url);
  if (match) {
    return match[1].replace(/^\[(.*)\]$/, '$1');
  }
  if (url.includes('://')) {
    return null;
  }
  // As git, a colon before any slash makes an scp-like URL, except for a Windows drive letter
  const scp = /^(?:[^@/:]*@)?(\[[^\]]+\]|[^:/]+):/.exec(url);
  if (!scp || /^[a-z]$/i.test(scp[1])) {
    return null;
  }
  return scp[1].replace(/^\[(.*)\]$/, '$1');
}

export function getSshHostKeys(): Record<string, string> {
  const keys = Settings.get(Field.SshHostKeys, {});
  return keys && typeof keys === 'object' ? keys : {};
}

// Command that connects with the key chosen for the host of the URL only, null to use ssh as configured
export function getSshCommand(url: string, hostKeys = getSshHostKeys()) {
  const host = getSshHost(url);
  const key = host ? hostKeys[host.toLowerCase()] : undefined;
  return key ? `ssh -i ${quoteShell(key)} -o IdentitiesOnly=yes` : null;
}

// Clear message for the usual failures of a network command, null for the others
export function describeNetworkError(stderr: string, stopReason: StopReason | null = null): string | null {
  if (stopReason === 'attempts') {
    return 'The passphrase or the password was wrong too many times. Check it and try again.';
  }
  const changedHost = /Host key for (\S+) has changed/i.exec(stderr);
  if (changedHost || /REMOTE HOST IDENTIFICATION HAS CHANGED/i.test(stderr)) {
    const host = changedHost ? changedHost[1] : 'the server';
    return `The SSH host key of ${host} has changed, the connection was refused because someone could be intercepting it. ` +
      'If the administrator of the server changed its key, check the new fingerprint with them, then remove the old key ' +
      `with "ssh-keygen -R ${changedHost ? changedHost[1] : '<host>'}".`;
  }
  if (/Host key verification failed/i.test(stderr)) {
    return 'The host key of the server was not accepted. Connect again and accept it if its fingerprint matches the one ' +
      'published by the server.';
  }
  if (/UNPROTECTED PRIVATE KEY FILE/i.test(stderr)) {
    return 'ssh refuses to use a private key that other users can read. Make it readable by you only (chmod 600).';
  }
  if (/Too many authentication failures/i.test(stderr)) {
    return 'The server closed the connection after too many keys were tried. Choose the key of this host in ' +
      'Preferences → Authentication.';
  }
  if (/Permission denied \([^)]*publickey/i.test(stderr)) {
    return 'The server refused your SSH key. Add your public key to your account on the server, unlock the key, ' +
      'or choose the key of this host in Preferences → Authentication.';
  }
  if (/Permission denied \(/i.test(stderr)) {
    return 'The server refused the credentials.';
  }
  const unknownHost = /Could not resolve hostname (\S+?):/i.exec(stderr);
  if (unknownHost) {
    return `The host ${unknownHost[1]} was not found. Check the URL of the remote and your network connection.`;
  }
  if (/Connection refused/i.test(stderr)) {
    return 'The server refused the connection. Check the host and the port of the remote.';
  }
  if (/(Connection|Operation) timed out/i.test(stderr)) {
    return 'The connection to the server timed out. Check your network connection, a firewall or a proxy may block it.';
  }
  const authentication = /Authentication failed for '([^']+)'/i.exec(stderr);
  if (authentication) {
    return `The server refused the username or the password of ${authentication[1]}. For most hosts, use a personal ` +
      'access token as the password.';
  }
  return null;
}

// Runs a network command with the variables that answer its prompts and use the chosen key, the
// variables of sshCommandUrl choose the key. Fails with CancelledError when the user cancels a prompt.
export async function runNetworkCommand<T>(sshCommandUrl: string | null, run: (env: Record<string, string>) => Promise<T>) {
  const currentProvider = provider;
  const credentials = currentProvider ? currentProvider.start() : null;
  const env: Record<string, string> = { ...(credentials ? credentials.env : {}) };
  const sshCommand = sshCommandUrl ? getSshCommand(sshCommandUrl) : null;
  if (sshCommand) {
    env.GIT_SSH_COMMAND = sshCommand;
  }
  const end = () => credentials ? currentProvider!.end(credentials.session) : Promise.resolve(null);
  let result: T;
  try {
    result = await run(env);
  } catch (e) {
    const stopReason = await end();
    if (stopReason === 'cancelled') {
      throw new CancelledError();
    }
    const message = e instanceof GitError ? describeNetworkError(e.stderr, stopReason) : null;
    throw message ? new Error(message) : e;
  }
  await end();
  return result;
}
