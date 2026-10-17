// Prompts of ssh and git that the askpass helper forwards to the app, and the answers of the user

export enum PromptKind {
  // Passphrase of a private key
  Passphrase = 'passphrase',
  // Password of a user on an SSH server
  Password = 'password',
  // Confirmation of the key of a host that is not in known_hosts yet
  HostKey = 'host-key',
  // Username of an HTTPS remote
  Username = 'username',
  // Password or token of an HTTPS remote
  HttpsPassword = 'https-password',
  // Any other secret, like the PIN of a security key
  Other = 'other',
  // A message that needs no answer, like a request to touch a security key
  Notice = 'notice'
}

export interface ParsedPrompt {
  kind: PromptKind;
  // Text of the prompt, as ssh or git wrote it
  text: string;
  // What the prompt is about: the path of the key, user@host, the host or the URL
  subject: string;
  // Identifies the secret, prompts with the same key ask for the same secret
  key: string;
  // Whether the answer is hidden when it is typed
  secret: boolean;
  // Lines with the fingerprint of an unknown host key
  fingerprint?: string;
}

// Sent by the main process to the renderer that runs the command
export interface CredentialRequest extends ParsedPrompt {
  id: number;
  // 1 the first time the secret is asked during a command, more when the previous answer was rejected
  attempt: number;
  maxAttempts: number;
}

// Sent back by the renderer, null when the user cancels
export interface CredentialAnswer {
  value: string;
  // Keeps the answer in memory until the app quits
  remember: boolean;
}

// Why the prompts of a command stopped being answered: the user cancelled one, or a secret was wrong too many times
export type StopReason = 'cancelled' | 'attempts';

// Answer that accepts an unknown host key
export const ACCEPT_HOST_KEY = 'yes';

// The quotes and the trailing colon around a path or a URL
function unquote(value: string) {
  return value.trim().replace(/:$/, '').replace(/^['"](.*)['"]$/, '$1');
}

// Quotes a value for sh, which runs the helper and GIT_SSH_COMMAND, on Windows too
export function quoteShell(value: string) {
  return `'${value.replace(/'/g, '\'\\\'\'')}'`;
}

// Classifies a prompt of ssh or git. promptKind is the SSH_ASKPASS_PROMPT variable of ssh:
// 'none' for a message to show only, 'confirm' for a yes/no question.
export function parsePrompt(text: string, promptKind = ''): ParsedPrompt {
  const trimmed = text.trim();
  const make = (kind: PromptKind, subject: string, secret: boolean, extra: Partial<ParsedPrompt> = {}): ParsedPrompt =>
    ({ kind, text: trimmed, subject, key: `${kind}:${subject}`, secret, ...extra });

  if (promptKind === 'none') {
    return make(PromptKind.Notice, trimmed, false);
  }
  if (/continue connecting \(yes\/no/i.test(trimmed)) {
    const host = /authenticity of host '([^']+)'/i.exec(trimmed);
    const fingerprint = trimmed.split('\n').filter((line) => /fingerprint is/i.test(line)).join('\n');
    return make(PromptKind.HostKey, host ? host[1] : '', false, { fingerprint: fingerprint || undefined });
  }
  let match = /^Enter passphrase for (?:key )?(.+?)\s*:?$/is.exec(trimmed);
  if (match) {
    return make(PromptKind.Passphrase, unquote(match[1]), true);
  }
  match = /^Username for '(.+)':$/i.exec(trimmed);
  if (match) {
    return make(PromptKind.Username, match[1], false);
  }
  match = /^Password for '(.+)':$/i.exec(trimmed);
  if (match) {
    return make(PromptKind.HttpsPassword, match[1], true);
  }
  // user@host's password: or (user@host) Password: for keyboard-interactive authentication
  match = /^(?:(\S+?)'s password|\((\S+)\) Password):$/i.exec(trimmed);
  if (match) {
    return make(PromptKind.Password, match[1] || match[2], true);
  }
  return make(PromptKind.Other, trimmed, promptKind !== 'confirm');
}

// Title of the dialog that asks for the answer
export function getPromptTitle(kind: PromptKind) {
  switch (kind) {
    case PromptKind.Passphrase:
      return 'Unlock SSH key';
    case PromptKind.Password:
      return 'SSH password';
    case PromptKind.HostKey:
      return 'Unknown SSH host';
    case PromptKind.Username:
    case PromptKind.HttpsPassword:
      return 'Sign in';
    default:
      return 'Authentication';
  }
}
