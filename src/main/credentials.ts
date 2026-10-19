import * as crypto from 'crypto';
import { app, ipcMain, WebContents } from 'electron';
import { AskpassServer } from './askpass-server';
import { CredentialBroker } from './credential-broker';
import { CredentialAnswer, CredentialRequest } from '../shared/askpass';

// The prompts of git and ssh go through the main process, so that the helper keeps working
// whatever the renderer can access. Each network command of a renderer gets a session, its
// prompts are shown by the renderer that started it.

let server: AskpassServer | null = null;
const sessions = new Map<string, WebContents>();
const pendingRequests = new Map<number, { webContents: WebContents, resolve: (answer: CredentialAnswer | null) => void }>();
const watchedWebContents = new WeakSet<WebContents>();

function askRenderer(session: string, request: CredentialRequest) {
  const webContents = sessions.get(session);
  if (!webContents || webContents.isDestroyed()) {
    return Promise.resolve(null);
  }
  return new Promise<CredentialAnswer | null>((resolve) => {
    pendingRequests.set(request.id, { webContents, resolve });
    webContents.send('credential-request', request);
  });
}

const broker = new CredentialBroker(askRenderer);

// Cancels the prompts of a window that is closed
function cancelRequests(webContents: WebContents) {
  for (const [id, pending] of pendingRequests) {
    if (pending.webContents === webContents) {
      pendingRequests.delete(id);
      pending.resolve(null);
    }
  }
}

export async function startCredentialService() {
  try {
    server = await AskpassServer.start(process.execPath, (request) => broker.handle(request));
  } catch (e) {
    console.error('Unable to start the credential prompts, git and ssh will not be able to ask for credentials', e);
  }

  // Variables of the environment of a network command, null when the prompts are not available
  ipcMain.on('start-credential-session', (event) => {
    if (!server) {
      event.returnValue = null;
      return;
    }
    const session = crypto.randomUUID();
    const webContents = event.sender;
    if (!watchedWebContents.has(webContents)) {
      watchedWebContents.add(webContents);
      webContents.once('destroyed', () => cancelRequests(webContents));
    }
    sessions.set(session, webContents);
    event.returnValue = { session, env: server.environment(session) };
  });

  // rejected: the server refused the HTTPS credentials
  ipcMain.handle('end-credential-session', (_event, session: string, rejected: boolean) => {
    sessions.delete(session);
    return broker.endSession(session, !!rejected);
  });

  ipcMain.on('credential-response', (_event, id: number, answer: CredentialAnswer | null) => {
    const pending = pendingRequests.get(id);
    if (pending) {
      pendingRequests.delete(id);
      pending.resolve(answer && typeof answer.value === 'string' ? { value: answer.value, remember: !!answer.remember } : null);
    }
  });

  ipcMain.handle('get-remembered-credential-count', () => broker.rememberedCount);

  ipcMain.handle('forget-credentials', () => broker.forgetAll());

  app.on('will-quit', () => {
    if (server) {
      server.close();
      server = null;
    }
  });
}
