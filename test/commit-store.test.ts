import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as Path from 'path';
import { CommitStore, MAX_CACHED_REPOSITORIES, getCacheName } from '../src/renderer/helpers/commit-store';
import { Commit } from '../src/renderer/helpers/git/model';
import { BASE_ENV, git } from '../src/renderer/helpers/git/runner';
import { parseCommits } from '../src/renderer/helpers/git/parsers';
import { RepoWrapper } from '../src/renderer/helpers/repo-wrapper';
import { TestRepo } from './helpers';

let repo: TestRepo;
let cacheDir: string;

beforeEach(async () => {
  repo = await TestRepo.create();
  cacheDir = fs.mkdtempSync(Path.join(os.tmpdir(), 'gitadmin-cache-'));
});

afterEach(() => {
  repo.remove();
  fs.rmSync(cacheDir, { recursive: true, force: true });
});

function commit(sha: string, parents: string[] = [], time = 0) {
  const signature = { name: 'Ada', email: 'ada@example.com', date: new Date(time * 1000) };
  return new Commit(sha, parents, signature, signature, `${sha}\n\nbody of ${sha}\n`);
}

// A wrapper whose commit cache is written for any number of commits, and the git commands it runs
function cachedWrapper(test = repo) {
  const ran: string[] = [];
  const wrapper = new RepoWrapper({ workdir: test.workdir, gitDir: test.path('.git') }, () => undefined,
    { getIdentity: () => null, commitCacheDirectory: cacheDir });
  wrapper.commitStore = new CommitStore(wrapper.path, cacheDir, 0);
  const git = wrapper.git.bind(wrapper);
  wrapper.git = (args, options) => {
    ran.push(args[0]);
    return git(args, options);
  };
  return { wrapper, ran };
}

function shas(wrapper: RepoWrapper) {
  return wrapper.commits.map((commit) => commit.sha());
}

// Children come before their parents
function assertTopological(wrapper: RepoWrapper) {
  wrapper.commits.forEach((commit, i) => {
    for (const parentSha of wrapper.parents.get(commit.sha())!) {
      assert.ok(wrapper.shaToIndex.get(parentSha)! > i, `${commit.summary()} comes before its parents`);
    }
    assert.equal(wrapper.shaToIndex.get(commit.sha()), i);
  });
}

async function history() {
  await repo.commit('A');
  await repo.git('branch', 'feature');
  await repo.commit('B');
  await repo.git('checkout', '--quiet', 'feature');
  await repo.commit('C');
  await repo.git('checkout', '--quiet', 'main');
  await repo.git('merge', '--quiet', '--no-edit', 'feature');
  await repo.commit('D');
}

describe('CommitStore', () => {
  it('keeps the tips and collects the history of commits', () => {
    const store = new CommitStore('/repo/.git', null);
    store.add([commit('c', ['b']), commit('b', ['a']), commit('a')]);
    assert.deepEqual([...store.tips], ['c']);
    store.add([commit('d', ['b']), commit('e', ['c', 'd'])]);
    assert.deepEqual([...store.tips], ['e']);
    // Adding commits already stored changes nothing
    store.add([commit('c', ['b'])]);
    assert.deepEqual([...store.tips], ['e']);
    assert.deepEqual(store.collect(['d'], () => false).map((c) => c.sha()).sort(), ['a', 'b', 'd']);
    assert.deepEqual(store.collect(['e', 'd'], (sha) => sha === 'b').map((c) => c.sha()).sort(), ['c', 'd', 'e']);
    // A missing parent is the boundary of a shallow clone
    assert.deepEqual(store.collect(['x'], () => false), []);
    store.compact([commit('b', ['a']), commit('a')]);
    assert.deepEqual([...store.tips], ['b']);
    assert.equal(store.size, 2);
  });

  it('writes the commits and reads them back', async () => {
    const store = new CommitStore('/repo/.git', cacheDir, 0);
    store.add([commit('b', ['a'], 20), commit('a', [], 10)]);
    await store.save();
    const read = new CommitStore('/repo/.git', cacheDir, 0);
    assert.equal(await read.load(''), true);
    assert.deepEqual([...read.tips], ['b']);
    const b = read.get('b')!;
    assert.deepEqual(b.parentIds, ['a']);
    assert.equal(b.message(), 'b\n\nbody of b\n');
    assert.equal(b.date().valueOf(), 20000);
    assert.equal(b.author().email, 'ada@example.com');
    assert.deepEqual(read.get('a')!.parentIds, []);
  });

  it('only appends the new commits', async () => {
    const store = new CommitStore('/repo/.git', cacheDir, 0);
    const files = { commits: Path.join(cacheDir, `${getCacheName('/repo/.git')}.commits`) };
    store.add([commit('a')]);
    await store.save();
    const first = fs.readFileSync(files.commits).toString();
    store.add([commit('b', ['a'])]);
    await store.save();
    const second = fs.readFileSync(files.commits).toString();
    assert.ok(second.startsWith(first));
    assert.equal(second.split('\n').length, first.split('\n').length + 1);
    const read = new CommitStore('/repo/.git', cacheDir, 0);
    assert.equal(await read.load(''), true);
    assert.deepEqual([...read.tips], ['b']);
  });

  it('does not write small histories', async () => {
    const store = new CommitStore('/repo/.git', cacheDir, 3);
    store.add([commit('b', ['a']), commit('a')]);
    await store.save();
    assert.deepEqual(fs.readdirSync(cacheDir), []);
  });

  it('ignores commits written after the header, as when the app stops while writing', async () => {
    const store = new CommitStore('/repo/.git', cacheDir, 0);
    store.add([commit('a')]);
    await store.save();
    fs.appendFileSync(Path.join(cacheDir, `${getCacheName('/repo/.git')}.commits`), '["b","a","A","a@x",1,"A","a@x",1,"half');
    const read = new CommitStore('/repo/.git', cacheDir, 0);
    assert.equal(await read.load(''), true);
    assert.deepEqual([...read.commits.keys()], ['a']);
    // The next write starts over
    read.add([commit('b', ['a'])]);
    await read.save();
    const again = new CommitStore('/repo/.git', cacheDir, 0);
    assert.equal(await again.load(''), true);
    assert.deepEqual([...again.commits.keys()].sort(), ['a', 'b']);
  });

  it('drops a cache that is corrupted, incomplete or for another shallow clone', async () => {
    const store = new CommitStore('/repo/.git', cacheDir, 0);
    store.add([commit('c', ['b']), commit('b', ['a']), commit('a')]);
    await store.save();
    const path = Path.join(cacheDir, `${getCacheName('/repo/.git')}.commits`);
    const content = fs.readFileSync(path).toString();
    assert.equal(await new CommitStore('/repo/.git', cacheDir, 0).load('shallow-sha\n'), false);
    // b is missing, c has a parent that is not stored
    const lines = content.split('\n');
    fs.writeFileSync(path, [lines[0], lines[1], lines[3].replace('"a"', '"x"'), lines[3], ''].join('\n'));
    const read = new CommitStore('/repo/.git', cacheDir, 0);
    assert.equal(await read.load(''), false);
    assert.equal(read.size, 0);
    fs.writeFileSync(path, content.replace('"c"', '"c'));
    assert.equal(await new CommitStore('/repo/.git', cacheDir, 0).load(''), false);
    fs.writeFileSync(path, content.substring(0, content.length - 10));
    assert.equal(await new CommitStore('/repo/.git', cacheDir, 0).load(''), false);
  });

  it('writes the whole cache again when another window wrote it in the meantime', async () => {
    const first = new CommitStore('/repo/.git', cacheDir, 0);
    first.add([commit('a')]);
    await first.save();
    const second = new CommitStore('/repo/.git', cacheDir, 0);
    assert.equal(await second.load(''), true);
    first.add([commit('b', ['a'])]);
    await first.save();
    second.add([commit('c', ['a'])]);
    await second.save();
    const read = new CommitStore('/repo/.git', cacheDir, 0);
    assert.equal(await read.load(''), true);
    assert.deepEqual([...read.commits.keys()].sort(), ['a', 'c']);
  });

  it('keeps the caches of the repositories opened last', async () => {
    for (let i = 0; i <= MAX_CACHED_REPOSITORIES; ++i) {
      const store = new CommitStore(`/repo${i}/.git`, cacheDir, 0);
      store.add([commit('a')]);
      await store.save();
      // The oldest cache is the first one
      const time = new Date(Date.now() - (MAX_CACHED_REPOSITORIES - i) * 60000);
      fs.utimesSync(Path.join(cacheDir, `${getCacheName(`/repo${i}/.git`)}.json`), time, time);
    }
    const store = new CommitStore('/last/.git', cacheDir, 0);
    store.add([commit('a')]);
    await store.save();
    const names = fs.readdirSync(cacheDir);
    assert.equal(names.length, 2 * MAX_CACHED_REPOSITORIES);
    assert.ok(!names.includes(`${getCacheName('/repo0/.git')}.json`));
    assert.ok(!names.includes(`${getCacheName('/repo1/.git')}.json`));
    assert.ok(names.includes(`${getCacheName('/last/.git')}.commits`));
  });
});

describe('commit cache', () => {
  it('lets git output a long history at once', () => {
    // git log flushes after each commit by default when its output is a pipe
    assert.equal(BASE_ENV.GIT_FLUSH, '0');
  });

  it('loads the history from the cache without git log', async () => {
    await history();
    const first = cachedWrapper();
    await first.wrapper.init();
    assert.ok(first.ran.includes('log'));
    await first.wrapper.saveCommitCache();
    const second = cachedWrapper();
    await second.wrapper.init();
    assert.ok(!second.ran.includes('log'));
    assert.deepEqual(shas(second.wrapper), shas(first.wrapper));
    assert.deepEqual([...second.wrapper.graph.positions], [...first.wrapper.graph.positions]);
    assert.equal(second.wrapper.headCommit!.summary(), 'D');
  });

  it('reads only the commits that are not cached', async () => {
    await history();
    const first = cachedWrapper();
    await first.wrapper.init();
    await first.wrapper.saveCommitCache();
    await repo.commit('E');
    await repo.git('checkout', '--quiet', '-b', 'other', 'HEAD~2');
    await repo.commit('F');
    const second = cachedWrapper();
    let output = '';
    const git = second.wrapper.git;
    second.wrapper.git = async (args, options) => {
      const result = await git(args, options);
      if (args[0] === 'log') {
        output = result;
      }
      return result;
    };
    await second.wrapper.init();
    assert.deepEqual(parseCommits(output).map((commit) => commit.summary()).sort(), ['E', 'F']);
    const fresh = repo.wrapper().wrapper;
    await fresh.init();
    assert.deepEqual(shas(second.wrapper), shas(fresh));
  });

  it('switches the focus without git log', async () => {
    await history();
    const { wrapper, ran } = cachedWrapper();
    await wrapper.init();
    ran.length = 0;
    await wrapper.setFocus(['refs/heads/feature']);
    assert.ok(!ran.includes('log'));
    assert.deepEqual(wrapper.commits.map((commit) => commit.summary()), ['C', 'A']);
    await wrapper.setFocus([]);
    assert.ok(!ran.includes('log'));
    assert.equal(wrapper.commits.length, 5);
  });

  it('loads the history again when a shallow clone gets deeper', async () => {
    await history();
    const clone = await TestRepo.create(fs.mkdtempSync(Path.join(os.tmpdir(), 'gitadmin-shallow-')));
    try {
      await clone.git('fetch', '--quiet', '--depth=2', `file://${repo.workdir}`, 'main:refs/remotes/origin/main');
      await clone.git('checkout', '--quiet', '-B', 'main', 'refs/remotes/origin/main');
      const { wrapper } = cachedWrapper(clone);
      await wrapper.init();
      assert.deepEqual(wrapper.commits.map((commit) => commit.summary()), ['D', 'Merge branch \'feature\'']);
      await clone.git('fetch', '--quiet', '--deepen=5', `file://${repo.workdir}`, 'main:refs/remotes/origin/main');
      assert.equal(await wrapper.requestUpdateCommits(), true);
      assert.deepEqual(wrapper.commits.map((commit) => commit.summary()).sort(), ['A', 'B', 'C', 'D', 'Merge branch \'feature\'']);
      assertTopological(wrapper);
    } finally {
      clone.remove();
    }
  });

  it('follows replaced parents without the store', async () => {
    await history();
    const { wrapper } = cachedWrapper();
    await wrapper.init();
    const merge = await repo.sha('HEAD~1');
    // The merge now only has B as parent
    await repo.git('replace', '--graft', merge, await repo.sha('HEAD~2'));
    await wrapper.requestUpdateCommits();
    assert.deepEqual(wrapper.parents.get(merge), [await repo.sha('HEAD~2')]);
    assertTopological(wrapper);
  });
});

describe('incremental updates', () => {
  // Builds a random history with fast-import, with dates that do not follow the order of the commits
  async function randomHistory(count: number, branches: number, seed: number, from: Map<string, number> | null) {
    let state = seed;
    const random = () => {
      state = (state * 1103515245 + 12345) % 2147483648;
      return state / 2147483648;
    };
    const heads = new Map<string, number>(from || []);
    let mark = Math.max(0, ...heads.values());
    const out: string[] = [];
    const names = Array.from({ length: branches }, (_, i) => i === 0 ? 'main' : `b${i}`);
    for (let i = 0; i < count; ++i) {
      const name = names[Math.floor(random() * names.length)];
      const parent = heads.get(name) ?? heads.get('main');
      ++mark;
      const time = 1700000000 + Math.floor(random() * 100000);
      out.push(`commit refs/heads/${name}`, `mark :${mark}`, `committer A <a@x> ${time} +0000`, `data ${`c${mark}`.length}`, `c${mark}`);
      if (parent !== undefined) {
        out.push(`from :${parent}`);
        const other = heads.get(names[Math.floor(random() * names.length)]);
        if (other !== undefined && other !== parent && random() < 0.2) {
          out.push(`merge :${other}`);
        }
      }
      out.push('');
      heads.set(name, mark);
    }
    return { input: out.join('\n') + '\n', heads };
  }

  it('inserts new commits in topological order and removes only what is unreachable', async () => {
    const marks = Path.join(repo.workdir, '.git', 'marks');
    const first = await randomHistory(150, 6, 7, null);
    await git(['fast-import', '--quiet', `--export-marks=${marks}`], repo.workdir, { stdin: first.input });
    await repo.git('checkout', '--quiet', '--force', 'main');
    const { wrapper } = cachedWrapper();
    await wrapper.init();
    assertTopological(wrapper);
    let removals = 0;
    const remove = wrapper.removeUnreachableCommits.bind(wrapper);
    wrapper.removeUnreachableCommits = (roots) => {
      ++removals;
      remove(roots);
    };
    // New commits on top of the branches, some older than the commits already loaded
    const second = await randomHistory(80, 6, 11, first.heads);
    await git(['fast-import', '--quiet', `--import-marks=${marks}`, `--export-marks=${marks}`], repo.workdir, { stdin: second.input });
    assert.equal(await wrapper.requestUpdateCommits(), true);
    assert.equal(removals, 0);
    assertTopological(wrapper);
    const fresh = repo.wrapper().wrapper;
    await fresh.init();
    assert.deepEqual([...shas(wrapper)].sort(), [...shas(fresh)].sort());
    assert.equal(wrapper.graph.positions.size, wrapper.commits.length);
    // A branch that goes back loses commits
    await repo.git('update-ref', 'refs/heads/b1', 'refs/heads/b1~3');
    await repo.git('branch', '-D', 'b2');
    assert.equal(await wrapper.requestUpdateCommits(), true);
    assert.equal(removals, 1);
    assertTopological(wrapper);
    const after = repo.wrapper().wrapper;
    await after.init();
    assert.deepEqual([...shas(wrapper)].sort(), [...shas(after)].sort());
  });

  it('puts a new commit on top like a full load', async () => {
    await history();
    const { wrapper } = cachedWrapper();
    await wrapper.init();
    await repo.commit('E');
    await repo.git('checkout', '--quiet', 'feature');
    await repo.commit('F');
    await wrapper.requestUpdateCommits();
    const fresh = repo.wrapper().wrapper;
    await fresh.init();
    assert.deepEqual(shas(wrapper), shas(fresh));
  });
});
