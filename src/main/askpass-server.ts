import * as crypto from 'crypto';
import * as fs from 'fs';
import * as net from 'net';
import * as os from 'os';
import * as Path from 'path';
import { quoteShell } from '../shared/askpass';

// git and ssh run a program to ask for credentials when they have no terminal: GIT_ASKPASS for the
// username and password of HTTPS remotes, SSH_ASKPASS for the passphrases of keys, the passwords of
// SSH servers and the confirmation of unknown host keys. Both point at a helper that forwards the
// prompt to this server and prints the answer it gets back.

export interface AskpassRequest {
  // Command that asks, set by the app in the environment of the command
  session: string;
  prompt: string;
  // SSH_ASKPASS_PROMPT set by ssh: 'confirm', 'none' or empty
  promptKind: string;
  // Process that asks, ssh or git: a prompt asked again by the same process had a wrong answer
  parent: string;
}

// Returns the answer to print, or null to make the helper fail, which ssh and git take as a cancel
export type AskpassHandler = (request: AskpassRequest) => Promise<string | null>;

// Variable of the environment that identifies the command for the server
export const SESSION_VARIABLE = 'GITADMIN_ASKPASS_SESSION';

// Script run by the executable of the app as Node.js (ELECTRON_RUN_AS_NODE)
const HELPER_SCRIPT = `'use strict';
const net = require('net');
let response = '';
const socket = net.connect(process.env.GITADMIN_ASKPASS_HANDLE);
socket.setEncoding('utf8');
socket.on('connect', () => {
  socket.write(JSON.stringify({
    token: process.env.GITADMIN_ASKPASS_TOKEN || '',
    session: process.env.${SESSION_VARIABLE} || '',
    prompt: process.argv[2] || '',
    promptKind: process.env.SSH_ASKPASS_PROMPT || '',
    parent: process.env.GITADMIN_ASKPASS_PARENT || ''
  }) + '\\n');
});
socket.on('data', (data) => {
  response += data;
});
socket.on('end', () => {
  let answer = null;
  try {
    answer = JSON.parse(response).answer;
  } catch (e) {
  }
  if (typeof answer === 'string') {
    process.stdout.write(answer + '\\n');
    process.exit(0);
  }
  process.exit(1);
});
socket.on('error', () => process.exit(1));
`;

// ssh and git run SSH_ASKPASS and GIT_ASKPASS without arguments other than the prompt, the launcher
// gives the helper to the executable. Git for Windows runs the scripts that start with #! too. $PPID is
// the ssh or git process that asks, also on Windows where exec starts a new process.
function getLauncherScript(execPath: string, helperPath: string) {
  return `#!/bin/sh\nGITADMIN_ASKPASS_PARENT=$PPID ELECTRON_RUN_AS_NODE=1 exec ${quoteShell(execPath)} ${quoteShell(helperPath)} "$@"\n`;
}

// Compares in a constant time
function isSameToken(a: string, b: string) {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  return bufferA.length === bufferB.length && crypto.timingSafeEqual(bufferA, bufferB);
}

export class AskpassServer {
  readonly dir: string;
  readonly handle: string;
  readonly launcherPath: string;
  private readonly token: string;
  private readonly server: net.Server;

  private constructor(dir: string, handle: string, launcherPath: string, token: string, server: net.Server) {
    this.dir = dir;
    this.handle = handle;
    this.launcherPath = launcherPath;
    this.token = token;
    this.server = server;
  }

  // Writes the helper in a new private directory and listens for its connections.
  // execPath runs the helper as Node.js: the executable of the app, or of Node.js in the tests.
  static async start(execPath: string, handler: AskpassHandler) {
    const dir = fs.realpathSync.native(fs.mkdtempSync(Path.join(os.tmpdir(), 'gitadmin-askpass-')));
    fs.chmodSync(dir, 0o700);
    const helperPath = Path.join(dir, 'askpass.js');
    const launcherPath = Path.join(dir, 'askpass.sh');
    fs.writeFileSync(helperPath, HELPER_SCRIPT);
    fs.writeFileSync(launcherPath, getLauncherScript(execPath, helperPath), { mode: 0o700 });

    const token = crypto.randomBytes(32).toString('hex');
    // A Unix socket in the private directory, a named pipe on Windows, where the token keeps other programs out
    const handle = process.platform === 'win32' ?
      `\\\\.\\pipe\\gitadmin-askpass-${crypto.randomBytes(16).toString('hex')}` :
      Path.join(dir, 'askpass.sock');
    const server = net.createServer((socket) => AskpassServer.serve(socket, token, handler));
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(handle, () => {
        server.off('error', reject);
        resolve();
      });
    });
    return new AskpassServer(dir, handle, launcherPath, token, server);
  }

  private static serve(socket: net.Socket, token: string, handler: AskpassHandler) {
    let data = '';
    let handled = false;
    socket.setEncoding('utf8');
    socket.on('error', () => socket.destroy());
    socket.on('data', async (chunk: string) => {
      data += chunk;
      const end = data.indexOf('\n');
      if (handled || end === -1) {
        return;
      }
      handled = true;
      let answer: string | null = null;
      try {
        const request = JSON.parse(data.substring(0, end));
        if (typeof request.token === 'string' && isSameToken(request.token, token)) {
          answer = await handler({
            session: String(request.session || ''),
            prompt: String(request.prompt || ''),
            promptKind: String(request.promptKind || ''),
            parent: String(request.parent || '')
          });
        }
      } catch (e) {
        answer = null;
      }
      if (!socket.destroyed) {
        socket.end(JSON.stringify({ answer }));
      }
    });
  }

  // Variables that make git and ssh ask through the helper, for the commands of a session
  environment(session: string): Record<string, string> {
    return {
      GIT_ASKPASS: this.launcherPath,
      SSH_ASKPASS: this.launcherPath,
      // OpenSSH 8.4 and later use SSH_ASKPASS even when the app was started from a terminal
      SSH_ASKPASS_REQUIRE: 'force',
      GITADMIN_ASKPASS_HANDLE: this.handle,
      GITADMIN_ASKPASS_TOKEN: this.token,
      [SESSION_VARIABLE]: session
    };
  }

  // The files are removed right away, so that they are removed when the app quits
  async close() {
    fs.rmSync(this.dir, { recursive: true, force: true });
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }
}
