import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as Path from 'path';
import { AskpassServer } from '../src/main/askpass-server';
import { CredentialBroker } from '../src/main/credential-broker';
import { CredentialAnswer, CredentialRequest, PromptKind } from '../src/shared/askpass';
import { setCredentialProvider } from '../src/renderer/helpers/git/network';
import { RepoWrapper } from '../src/renderer/helpers/repo-wrapper';
import { IDENTITY, TestRepo, writeFakeSsh } from './helpers';

// The tests run the shell scripts that git runs on Unix
describe('SSH prompts of the network commands', { skip: process.platform === 'win32' && 'runs a fake ssh written for sh' }, () => {
  let server: AskpassServer;
  let broker: CredentialBroker;
  let answers: (CredentialAnswer | null)[];
  let requests: CredentialRequest[];
  let dir: string;
  let remote: TestRepo;
  let clone: string;

  before(async () => {
    broker = new CredentialBroker(async (_session, request) => {
      requests.push(request);
      return answers.length > 0 ? answers.shift()! : null;
    });
    server = await AskpassServer.start(process.execPath, (request) => broker.handle(request));
    let nextSession = 0;
    setCredentialProvider({
      start: () => {
        const session = `session-${++nextSession}`;
        return { session, env: server.environment(session) };
      },
      end: async (session, rejected) => broker.endSession(session, rejected)
    });
  });

  after(async () => {
    setCredentialProvider(null);
    await server.close();
  });

  beforeEach(async () => {
    answers = [];
    requests = [];
    broker.forgetAll();
    dir = fs.realpathSync.native(fs.mkdtempSync(Path.join(os.tmpdir(), 'gitadmin-ssh-')));
    const sshPath = Path.join(dir, 'fake-ssh');
    writeFakeSsh(sshPath);
    remote = await TestRepo.create(Path.join(dir, 'remote'));
    await remote.commit('Initial', { 'file.txt': 'a\n' });
    clone = Path.join(dir, 'clone');
    await remote.git('clone', '--quiet', remote.workdir, clone);
    await setSsh(clone, sshPath);
    await remote.git('config', 'core.sshCommand', sshPath);
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  // Makes the repository reach its origin through the fake ssh
  async function setSsh(path: string, sshPath: string) {
    const repo = new RepoWrapper({ workdir: path, gitDir: Path.join(path, '.git') }, () => {});
    await repo.git(['config', 'core.sshCommand', sshPath]);
    await repo.git(['config', 'ssh.variant', 'simple']);
    await repo.git(['remote', 'set-url', 'origin', `fakehost:${remote.workdir}`]);
  }

  async function load() {
    const notifications: string[] = [];
    const wrapper = new RepoWrapper(await RepoWrapper.open(clone), (message) => notifications.push(message),
      { getIdentity: () => IDENTITY });
    await wrapper.init();
    return { wrapper, notifications };
  }

  async function remoteHead(wrapper: RepoWrapper) {
    return (await wrapper.git(['rev-parse', '--verify', '--quiet', 'refs/remotes/origin/main'], { okExitCodes: [1] })).trim();
  }

  it('fetches once the passphrase is given', async () => {
    const { wrapper, notifications } = await load();
    const sha = await remote.commit('Remote change', { 'file.txt': 'b\n' });
    answers = [{ value: 'secret', remember: false }];
    await wrapper.fetchAll();
    assert.deepEqual(notifications, []);
    assert.equal(await remoteHead(wrapper), sha);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].kind, PromptKind.Passphrase);
    assert.equal(requests[0].subject, '/keys/id_test');
    assert.equal(requests[0].attempt, 1);
  });

  it('asks again after a wrong passphrase, and stops with a clear error', async () => {
    const { wrapper, notifications } = await load();
    const sha = await remote.commit('Remote change', { 'file.txt': 'b\n' });
    answers = [{ value: 'wrong', remember: false }, { value: 'secret', remember: false }];
    await wrapper.fetchAll();
    assert.deepEqual(requests.map((request) => request.attempt), [1, 2]);
    assert.equal(await remoteHead(wrapper), sha);

    requests = [];
    answers = [1, 2, 3].map(() => ({ value: 'wrong', remember: false }));
    await wrapper.fetchAll();
    assert.equal(requests.length, 3);
    assert.equal(notifications.length, 1);
    assert.match(notifications[0], /^Unable to fetch all: The server refused your SSH key/);
  });

  it('asks once when several remotes need the passphrase', async () => {
    const { wrapper, notifications } = await load();
    await wrapper.git(['remote', 'add', 'mirror', `fakehost:${remote.workdir}`]);
    const sha = await remote.commit('Remote change', { 'file.txt': 'b\n' });
    answers = [{ value: 'secret', remember: false }];
    await wrapper.fetchAll();
    assert.deepEqual(notifications, []);
    assert.equal(requests.length, 1);
    assert.equal(await remoteHead(wrapper), sha);
    assert.equal((await wrapper.git(['rev-parse', 'refs/remotes/mirror/main'])).trim(), sha);
  });

  it('stops quietly when the prompt is cancelled', async () => {
    const { wrapper, notifications } = await load();
    const before = await remoteHead(wrapper);
    await remote.commit('Remote change', { 'file.txt': 'b\n' });
    answers = [null];
    await wrapper.fetchAll();
    assert.equal(requests.length, 1);
    assert.deepEqual(notifications, []);
    assert.equal(await remoteHead(wrapper), before);
  });

  it('remembers the passphrase for the next commands when asked', async () => {
    const { wrapper, notifications } = await load();
    answers = [{ value: 'secret', remember: true }];
    await wrapper.fetchAll();
    const sha = await remote.commit('Remote change', { 'file.txt': 'b\n' });
    await wrapper.fetchAll();
    assert.equal(requests.length, 1);
    assert.equal(await remoteHead(wrapper), sha);
    assert.deepEqual(notifications, []);
  });

  it('pushes once the passphrase is given', async () => {
    const { wrapper, notifications } = await load();
    await remote.git('checkout', '--quiet', '--detach');
    fs.writeFileSync(Path.join(clone, 'file.txt'), 'c\n');
    await wrapper.stageAll(await wrapper.getUnstagedPatches());
    await wrapper.commit('Local change');
    answers = [{ value: 'secret', remember: false }];
    await wrapper.push();
    assert.deepEqual(notifications, ['Pushed successfully']);
    assert.equal(requests.length, 1);
    assert.equal((await remote.git('log', '-1', '--format=%s', 'main')).trim(), 'Local change');
  });

  it('clones once the passphrase is given', async () => {
    const target = Path.join(dir, 'cloned');
    answers = [{ value: 'secret', remember: false }];
    // The clone has no configuration yet, the variables of the environment give the fake ssh
    const sshPath = Path.join(dir, 'fake-ssh');
    process.env.GIT_SSH_COMMAND = sshPath;
    process.env.GIT_SSH_VARIANT = 'simple';
    try {
      const location = await RepoWrapper.clone(`fakehost:${remote.workdir}`, target);
      assert.equal(location.workdir, target);
    } finally {
      delete process.env.GIT_SSH_COMMAND;
      delete process.env.GIT_SSH_VARIANT;
    }
    assert.equal(fs.readFileSync(Path.join(target, 'file.txt'), 'utf8'), 'a\n');
    assert.equal(requests.length, 1);
  });
});
