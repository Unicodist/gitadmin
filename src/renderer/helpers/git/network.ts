import { ipcRenderer } from 'electron';
import * as fs from 'fs';
import * as os from 'os';
import * as Path from 'path';
import { resolveGitDir, resolveGitExecPath } from 'dugite';
import { GitError, git } from './runner';
import { StopReason, quoteShell } from '../../../shared/askpass';
import { Field, Settings } from '../../../shared/settings';

// Commands that talk to a remote (clone, fetch, push) get variables that send the prompts of git and
// ssh to the app, use the key chosen for the host, and turn the usual failures into clear messages

export interface CredentialSession {
  session: string;
  env: Record<string, string>;
}

// Opens a session for the prompts of a command, and closes it once the command is done.
// rejected: the server refused the HTTPS credentials, the remembered ones are forgotten.
export interface CredentialProvider {
  start(): CredentialSession | null;
  end(session: string, rejected: boolean): Promise<StopReason | null>;
}

// The main process shows the prompts in the window of the renderer
const ipcProvider: CredentialProvider = {
  start: () => ipcRenderer.sendSync('start-credential-session'),
  end: (session, rejected) => ipcRenderer.invoke('end-credential-session', session, rejected)
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

// Git Credential Manager comes with the git of dugite, except on Linux arm64
export function hasCredentialManager() {
  const path = process.platform === 'win32' ?
    Path.join(resolveGitDir(), 'mingw64', 'bin', 'git-credential-manager.exe') :
    Path.join(resolveGitExecPath(), 'git-credential-manager');
  return fs.existsSync(path);
}

// Git for Windows always uses Git Credential Manager, its system configuration sets it
export function isCredentialManagerBuiltIn() {
  return process.platform === 'win32';
}

export function isCredentialManagerEnabled() {
  return Settings.get(Field.CredentialManager, true) !== false;
}

async function getConfiguredCredentialStore() {
  try {
    return (await git(['config', '--get', 'credential.credentialStore'], os.homedir(), { okExitCodes: [1] })).trim();
  } catch (e) {
    return '';
  }
}

// Variables that add Git Credential Manager to the credential helpers of the user, so that it saves the
// HTTPS credentials in the keychain of the system and signs in with the browser for the usual hosts.
// When it has nothing and cannot ask, git asks through GIT_ASKPASS.
export async function getCredentialManagerEnv(): Promise<Record<string, string>> {
  if (isCredentialManagerBuiltIn() || !isCredentialManagerEnabled() || !hasCredentialManager()) {
    return {};
  }
  const config: [string, string][] = [['credential.helper', 'manager']];
  // On Linux, it has no store until one is chosen
  if (process.platform === 'linux' && !process.env.GCM_CREDENTIAL_STORE && !(await getConfiguredCredentialStore())) {
    config.push(['credential.credentialStore', 'secretservice']);
  }
  // After the variables that may already be set, like git -c
  const count = parseInt(process.env.GIT_CONFIG_COUNT || '', 10) || 0;
  const env: Record<string, string> = { GIT_CONFIG_COUNT: String(count + config.length) };
  config.forEach(([key, value], i) => {
    env[`GIT_CONFIG_KEY_${count + i}`] = key;
    env[`GIT_CONFIG_VALUE_${count + i}`] = value;
  });
  return env;
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
  const credentialManagerEnv = await getCredentialManagerEnv();
  const currentProvider = provider;
  const credentials = currentProvider ? currentProvider.start() : null;
  const env: Record<string, string> = { ...(credentials ? credentials.env : {}), ...credentialManagerEnv };
  const sshCommand = sshCommandUrl ? getSshCommand(sshCommandUrl) : null;
  if (sshCommand) {
    env.GIT_SSH_COMMAND = sshCommand;
  }
  const end = (rejected: boolean) => credentials ? currentProvider!.end(credentials.session, rejected) : Promise.resolve(null);
  let result: T;
  try {
    result = await run(env);
  } catch (e) {
    const stopReason = await end(e instanceof GitError && /Authentication failed for/i.test(e.stderr));
    if (stopReason === 'cancelled') {
      throw new CancelledError();
    }
    const message = e instanceof GitError ? describeNetworkError(e.stderr, stopReason) : null;
    throw message ? new Error(message) : e;
  }
  await end(false);
  return result;
}
