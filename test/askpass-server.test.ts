import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert/strict';
import { execFile } from 'child_process';
import * as fs from 'fs';
import * as Path from 'path';
import { AskpassRequest, AskpassServer } from '../src/main/askpass-server';

// Runs the helper as git and ssh do, with the prompt as argument
function runHelper(server: AskpassServer, prompt: string, env: Record<string, string> = {}) {
  const helperPath = Path.join(server.dir, 'askpass.js');
  return new Promise<{ code: number, stdout: string }>((resolve) => {
    execFile(process.execPath, [helperPath, prompt], { env: { ...process.env, ...server.environment('session-1'), ...env } },
      (error, stdout) => resolve({ code: error ? (error.code as number) : 0, stdout }));
  });
}

describe('AskpassServer', () => {
  let server: AskpassServer;
  const requests: AskpassRequest[] = [];

  before(async () => {
    server = await AskpassServer.start(process.execPath, async (request) => {
      requests.push(request);
      return request.prompt.includes('cancel') ? null : `answer to ${request.prompt}`;
    });
  });

  after(async () => {
    await server.close();
  });

  it('gives the variables of the helper', () => {
    const env = server.environment('session-1');
    assert.equal(env.SSH_ASKPASS, server.launcherPath);
    assert.equal(env.GIT_ASKPASS, server.launcherPath);
    assert.equal(env.SSH_ASKPASS_REQUIRE, 'force');
    assert.equal(env.GITADMIN_ASKPASS_SESSION, 'session-1');
    assert.equal(fs.readFileSync(server.launcherPath, 'utf8').startsWith('#!/bin/sh\n'), true);
  });

  it('forwards the prompt and prints the answer', async () => {
    const result = await runHelper(server, 'Enter passphrase for key \'/keys/id\': ', { SSH_ASKPASS_PROMPT: 'confirm' });
    assert.equal(result.code, 0);
    assert.equal(result.stdout, 'answer to Enter passphrase for key \'/keys/id\': \n');
    assert.deepEqual(requests[requests.length - 1], {
      session: 'session-1',
      prompt: 'Enter passphrase for key \'/keys/id\': ',
      promptKind: 'confirm',
      parent: ''
    });
  });

  it('fails when the prompt is cancelled', async () => {
    const result = await runHelper(server, 'cancel me');
    assert.notEqual(result.code, 0);
    assert.equal(result.stdout, '');
  });

  it('refuses a helper without the token', async () => {
    const count = requests.length;
    const result = await runHelper(server, 'Password:', { GITADMIN_ASKPASS_TOKEN: 'wrong' });
    assert.notEqual(result.code, 0);
    assert.equal(requests.length, count);
  });

  it('runs the helper through its launcher', { skip: process.platform === 'win32' && 'the launcher is run by the sh of Git on Windows' },
    async () => {
      const result = await new Promise<string>((resolve, reject) => {
        execFile(server.launcherPath, ['Password:'], { env: { ...process.env, ...server.environment('session-2') } },
          (error, stdout) => error ? reject(error) : resolve(stdout));
      });
      assert.equal(result, 'answer to Password:\n');
      // The process that runs the launcher, like ssh
      assert.equal(requests[requests.length - 1].parent, String(process.pid));
    });

  it('removes its files when it is closed', async () => {
    const other = await AskpassServer.start(process.execPath, async () => null);
    assert.equal(fs.existsSync(other.launcherPath), true);
    await other.close();
    assert.equal(fs.existsSync(other.dir), false);
  });
});
