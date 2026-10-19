import { AskpassRequest } from './askpass-server';
import { CredentialAnswer, CredentialRequest, PromptKind, StopReason, parsePrompt } from '../shared/askpass';

// Times a secret is asked during a command before the command is stopped
export const MAX_ATTEMPTS = 3;

// Asks the user, resolves to null when the user cancels
export type AskUser = (session: string, request: CredentialRequest) => Promise<CredentialAnswer | null>;

interface Session {
  // Once set, the next prompts of the command fail without asking
  stopped: StopReason | null;
  // Number of times each secret was asked, by process and secret
  attempts: Map<string, number>;
  // Answers given during the command, by secret, for the other processes that ask the same
  answers: Map<string, string>;
}

function isHttpsPrompt(kind: PromptKind) {
  return kind === PromptKind.Username || kind === PromptKind.HttpsPassword;
}

// Key of the username prompt that goes with the password prompt of an HTTPS remote: git asks the
// username for https://host, then the password for https://user@host. The username may contain @.
function getUsernameKey(passwordSubject: string) {
  const match = /^([a-z][a-z0-9+.-]*:\/\/)(.+)@([^@]*)$/i.exec(passwordSubject);
  return match ? { key: `${PromptKind.Username}:${match[1]}${match[3]}`, username: match[2] } : null;
}

// Decides what to answer to the prompts of the commands: asks the user, stops after a few wrong
// answers or a cancel, and answers with the secrets remembered until the app quits
export class CredentialBroker {
  private readonly askUser: AskUser;
  private readonly sessions: Map<string, Session>;
  // Secrets that the user asked to remember and the usernames of the HTTPS passwords, in memory only
  private readonly remembered: Map<string, string>;
  private nextId: number;

  constructor(askUser: AskUser) {
    this.askUser = askUser;
    this.sessions = new Map();
    this.remembered = new Map();
    this.nextId = 1;
  }

  async handle(request: AskpassRequest): Promise<string | null> {
    const prompt = parsePrompt(request.prompt, request.promptKind);
    // Like a request to touch a security key, ssh closes the helper once it is done
    if (prompt.kind === PromptKind.Notice) {
      return '';
    }
    const session = this.getSession(request.session);
    if (session.stopped) {
      return null;
    }
    // ssh asks again when an answer is wrong. A command can also run several processes that ask
    // the same, like fetch --all that fetches each remote on its own, they get the same answer.
    // git asks for the username and the password of an HTTPS remote once per process.
    const attemptKey = `${request.parent}:${prompt.key}`;
    const attempt = isHttpsPrompt(prompt.kind) ? 1 : (session.attempts.get(attemptKey) || 0) + 1;
    session.attempts.set(attemptKey, attempt);
    if (attempt === 1) {
      const known = session.answers.has(prompt.key) ? session.answers.get(prompt.key) : this.remembered.get(prompt.key);
      if (known !== undefined) {
        session.answers.set(prompt.key, known);
        return known;
      }
    } else {
      // Asked again, the previous answer was wrong
      session.answers.delete(prompt.key);
      this.remembered.delete(prompt.key);
    }
    if (attempt > MAX_ATTEMPTS) {
      session.stopped = 'attempts';
      return null;
    }
    const answer = await this.askUser(request.session, { ...prompt, id: this.nextId++, attempt, maxAttempts: MAX_ATTEMPTS });
    if (answer === null) {
      session.stopped = 'cancelled';
      return null;
    }
    // Never the confirmation of a host key, each process shows the key it gets
    if (prompt.secret || prompt.kind === PromptKind.Username) {
      session.answers.set(prompt.key, answer.value);
    }
    if (answer.remember && prompt.secret) {
      this.remembered.set(prompt.key, answer.value);
      // The password is only asked once the username is given
      const username = prompt.kind === PromptKind.HttpsPassword ? getUsernameKey(prompt.subject) : null;
      if (username && session.answers.get(username.key) === username.username) {
        this.remembered.set(username.key, username.username);
      }
    }
    return answer.value;
  }

  private getSession(id: string) {
    let session = this.sessions.get(id);
    if (!session) {
      session = { stopped: null, attempts: new Map(), answers: new Map() };
      this.sessions.set(id, session);
    }
    return session;
  }

  // Forgets a command once it is done, returns why its prompts stopped being answered. git does not
  // ask again for a wrong HTTPS password, the command fails: rejected forgets the answers it used.
  endSession(id: string, rejected = false): StopReason | null {
    const session = this.sessions.get(id);
    this.sessions.delete(id);
    if (!session) {
      return null;
    }
    if (rejected) {
      for (const key of session.answers.keys()) {
        if (key.startsWith(`${PromptKind.Username}:`) || key.startsWith(`${PromptKind.HttpsPassword}:`)) {
          this.remembered.delete(key);
        }
      }
    }
    return session.stopped;
  }

  // The usernames are not counted, they are remembered with their password
  get rememberedCount() {
    return [...this.remembered.keys()].filter((key) => !key.startsWith(`${PromptKind.Username}:`)).length;
  }

  forgetAll() {
    this.remembered.clear();
  }
}
