import { AskpassRequest } from './askpass-server';
import { CredentialAnswer, CredentialRequest, PromptKind, StopReason, parsePrompt } from '../shared/askpass';

// Times a secret is asked during a command before the command is stopped
export const MAX_ATTEMPTS = 3;

// Asks the user, resolves to null when the user cancels
export type AskUser = (session: string, request: CredentialRequest) => Promise<CredentialAnswer | null>;

interface Session {
  // Once set, the next prompts of the command fail without asking
  stopped: StopReason | null;
  // Number of times each secret was asked
  attempts: Map<string, number>;
}

// Decides what to answer to the prompts of the commands: asks the user, stops after a few wrong
// answers or a cancel, and answers with the secrets remembered until the app quits
export class CredentialBroker {
  private readonly askUser: AskUser;
  private readonly sessions: Map<string, Session>;
  // Secrets that the user asked to remember, in memory only
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
    const attempt = (session.attempts.get(prompt.key) || 0) + 1;
    session.attempts.set(prompt.key, attempt);
    if (attempt === 1 && this.remembered.has(prompt.key)) {
      return this.remembered.get(prompt.key)!;
    }
    // Asked again, the previous answer was wrong
    this.remembered.delete(prompt.key);
    if (attempt > MAX_ATTEMPTS) {
      session.stopped = 'attempts';
      return null;
    }
    const answer = await this.askUser(request.session, { ...prompt, id: this.nextId++, attempt, maxAttempts: MAX_ATTEMPTS });
    if (answer === null) {
      session.stopped = 'cancelled';
      return null;
    }
    if (answer.remember && prompt.secret) {
      this.remembered.set(prompt.key, answer.value);
    }
    return answer.value;
  }

  private getSession(id: string) {
    let session = this.sessions.get(id);
    if (!session) {
      session = { stopped: null, attempts: new Map() };
      this.sessions.set(id, session);
    }
    return session;
  }

  // Forgets a command once it is done, returns why its prompts stopped being answered
  endSession(id: string): StopReason | null {
    const session = this.sessions.get(id);
    this.sessions.delete(id);
    return session ? session.stopped : null;
  }

  get rememberedCount() {
    return this.remembered.size;
  }

  forgetAll() {
    this.remembered.clear();
  }
}
