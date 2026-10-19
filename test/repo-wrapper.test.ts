import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as Path from 'path';
import { ConflictVersion, RepoState, RepoWrapper, ResetType, PatchStatus, getRepoName } from '../src/renderer/helpers/repo-wrapper';
import { IDENTITY, TestRepo, lines } from './helpers';

let repo: TestRepo;

beforeEach(async () => {
  repo = await TestRepo.create();
});

afterEach(() => {
  repo.remove();
});

async function load() {
  const result = repo.wrapper();
  await result.wrapper.init();
  return result;
}

function summaries(wrapper: RepoWrapper) {
  return wrapper.commits.map((commit) => commit.summary());
}

function patchList(patches: RepoWrapper['stagedPatches']) {
  return patches.map((patch) => [patch.status, patch.newFile.path]);
}

describe('getRepoName', () => {
  it('uses the working directory name', () => {
    assert.equal(getRepoName('/home/ada/projects/engine'), 'engine');
    assert.equal(getRepoName('/home/ada/projects/engine/'), 'engine');
  });

  it('supports the .git paths saved by older versions', () => {
    assert.equal(getRepoName('/home/ada/projects/engine/.git/'), 'engine');
  });
});

describe('opening repositories', () => {
  it('opens a repository from its working directory, a subdirectory or its .git directory', async () => {
    await repo.commit('Initial', { 'src/main.c': 'int main;\n' });
    for (const path of [repo.workdir, repo.path('src'), repo.path('.git'), repo.path('.git') + '/']) {
      const location = await RepoWrapper.open(path);
      assert.equal(location.workdir, repo.workdir);
      assert.equal(location.gitDir, repo.path('.git'));
    }
  });

  it('fails for a directory that is not a repository', async () => {
    const dir = fs.mkdtempSync(Path.join(os.tmpdir(), 'gitadmin-empty-'));
    await assert.rejects(RepoWrapper.open(dir));
    fs.rmSync(dir, { recursive: true });
  });

  it('initializes a repository', async () => {
    const dir = Path.join(fs.realpathSync.native(os.tmpdir()), `gitadmin-init-${process.pid}-${Date.now()}`, 'nested');
    const location = await RepoWrapper.init(dir);
    assert.equal(location.workdir, dir);
    assert.ok(fs.existsSync(Path.join(dir, '.git', 'HEAD')));
    fs.rmSync(Path.dirname(dir), { recursive: true });
  });

  it('clones a repository', async () => {
    await repo.commit('Initial', { 'README.md': 'hello\n' });
    const dir = Path.join(fs.realpathSync.native(os.tmpdir()), `gitadmin-clone-${process.pid}-${Date.now()}`);
    const location = await RepoWrapper.clone(repo.workdir, dir);
    assert.equal(location.workdir, dir);
    assert.equal(fs.readFileSync(Path.join(dir, 'README.md')).toString(), 'hello\n');
    fs.rmSync(dir, { recursive: true });
  });
});

describe('history', () => {
  it('loads an empty repository', async () => {
    const { wrapper, errors } = await load();
    assert.deepEqual(wrapper.commits, []);
    assert.equal(wrapper.head, null);
    assert.equal(wrapper.headCommit, null);
    assert.deepEqual(errors(), []);
  });

  it('loads commits from all references in topological order', async () => {
    await repo.commit('A', { 'file.txt': 'a\n' });
    await repo.git('branch', 'feature');
    await repo.commit('B', { 'file.txt': 'b\n' });
    await repo.git('checkout', '--quiet', 'feature');
    await repo.commit('C', { 'other.txt': 'c\n' });
    await repo.git('checkout', '--quiet', 'main');
    await repo.git('merge', '--quiet', '--no-edit', 'feature');
    const { wrapper } = await load();
    const order = summaries(wrapper);
    assert.equal(order.length, 4);
    // Children always come before their parents
    for (const commit of wrapper.commits) {
      for (const parent of wrapper.parents.get(commit.sha())!) {
        assert.ok(wrapper.shaToIndex.get(commit.sha())! < wrapper.shaToIndex.get(parent)!);
      }
    }
    assert.equal(order[0], "Merge branch 'feature'");
    assert.equal(order[3], 'A');
    assert.equal(wrapper.head!.name(), 'refs/heads/main');
    assert.equal(wrapper.headCommit!.summary(), "Merge branch 'feature'");
    assert.equal(wrapper.parents.get(wrapper.headCommit!.sha())!.length, 2);
    assert.equal(wrapper.children.get(await repo.sha('main~1'))!.length, 1);
    // The graph has a position for each commit
    assert.equal(wrapper.graph.positions.size, 4);
  });

  it('parses the commit metadata', async () => {
    repo.write('file.txt', 'x\n');
    await repo.git('add', '.');
    await repo.git('commit', '--quiet', '-m', 'Summary line\n\nThe body\nof the message');
    const { wrapper } = await load();
    const commit = wrapper.headCommit!;
    assert.equal(commit.summary(), 'Summary line');
    assert.equal(commit.body(), 'The body\nof the message');
    assert.equal(commit.author().name, 'Config User');
    assert.equal(commit.author().email, 'config@example.com');
    assert.equal(commit.date().valueOf(), (await repo.git('log', '-1', '--format=%ct')).trim() as any * 1000);
  });

  it('maps references, including annotated tags, to their commits', async () => {
    const first = await repo.commit('First');
    const second = await repo.commit('Second');
    await repo.git('tag', 'light', first);
    await repo.git('tag', '-a', '-m', 'Release', 'v1.0', second);
    const { wrapper } = await load();
    assert.deepEqual(wrapper.shaToReferences.get(first), ['refs/tags/light']);
    assert.deepEqual(wrapper.shaToReferences.get(second)!.sort(), ['refs/heads/main', 'refs/tags/v1.0']);
    const tag = wrapper.references.get('refs/tags/v1.0')!;
    assert.equal(tag.commitId, second);
    assert.notEqual(tag.targetId, second);
    assert.equal(wrapper.getReferenceCommit(tag)!.sha(), second);
  });

  it('updates incrementally and removes unreachable commits', async () => {
    await repo.commit('A');
    await repo.commit('B');
    const { wrapper } = await load();
    assert.deepEqual(summaries(wrapper), ['B', 'A']);
    await repo.commit('C');
    await wrapper.requestUpdateCommits();
    await wrapper.updateHead();
    assert.deepEqual(summaries(wrapper), ['C', 'B', 'A']);
    await repo.git('reset', '--quiet', '--hard', 'HEAD~2');
    await wrapper.requestUpdateCommits();
    await wrapper.updateHead();
    assert.deepEqual(summaries(wrapper), ['A']);
    assert.equal(wrapper.headCommit!.summary(), 'A');
    assert.equal(wrapper.children.get(wrapper.headCommit!.sha())!.length, 0);
  });

  it('does nothing more when nothing moved', async () => {
    await repo.commit('A');
    await repo.commit('B');
    const { wrapper } = await load();
    const ran: string[] = [];
    const git = wrapper.git.bind(wrapper);
    wrapper.git = (args, options) => {
      ran.push(args[0]);
      return git(args, options);
    };
    assert.equal(await wrapper.requestUpdateCommits(), false);
    // The references and the stashes, the head is read from its file
    assert.deepEqual(ran.sort(), ['for-each-ref', 'stash']);
    const graph = wrapper.graph.positions;
    await repo.commit('C');
    ran.length = 0;
    assert.equal(await wrapper.requestUpdateCommits(), true);
    assert.deepEqual(ran.sort(), ['for-each-ref', 'log', 'stash']);
    // The head and the graph follow
    assert.equal(wrapper.headCommit!.summary(), 'C');
    assert.equal(wrapper.graph.positions, graph);
    assert.deepEqual([...graph.keys()], wrapper.commits.map((commit) => commit.sha()));
  });

  it('shares an update that has not started yet', async () => {
    await repo.commit('A');
    const { wrapper } = await load();
    let updates = 0;
    const updateCommits = wrapper.updateCommits.bind(wrapper);
    wrapper.updateCommits = (...args) => {
      ++updates;
      return updateCommits(...args);
    };
    await repo.commit('B');
    const first = wrapper.requestUpdateCommits();
    const second = wrapper.requestUpdateCommits();
    assert.equal(first, second);
    assert.equal(await second, true);
    assert.equal(updates, 1);
    // A new request once it has started is a new update
    assert.equal(await wrapper.requestUpdateCommits(), false);
    assert.equal(updates, 2);
  });

  it('reads the head of a branch without commits, a branch and a detached head', async () => {
    const { wrapper } = await load();
    assert.equal(wrapper.headName, 'refs/heads/main');
    assert.equal(wrapper.headSha, null);
    const sha = await repo.commit('A');
    await wrapper.requestUpdateCommits();
    assert.equal(wrapper.headName, 'refs/heads/main');
    assert.equal(wrapper.headSha, sha);
    assert.equal(wrapper.head!.name(), 'refs/heads/main');
    await repo.git('checkout', '--quiet', '--detach');
    await wrapper.requestUpdateCommits();
    assert.equal(wrapper.headName, null);
    assert.equal(wrapper.headSha, sha);
    assert.equal(wrapper.head, null);
  });

  it('shows a detached head that no reference points to', async () => {
    await repo.commit('A');
    await repo.git('checkout', '--quiet', '--detach');
    await repo.commit('Detached');
    await repo.git('checkout', '--quiet', 'main');
    await repo.git('checkout', '--quiet', '--detach', 'HEAD');
    const detached = await repo.commit('Detached 2');
    const { wrapper } = await load();
    assert.equal(wrapper.head, null);
    assert.equal(wrapper.headCommit!.sha(), detached);
    assert.ok(summaries(wrapper).includes('Detached 2'));
    // A commit nothing points to anymore is not loaded
    assert.ok(!summaries(wrapper).includes('Detached'));
  });

  it('loads stashes linked to the commit they were created on', async () => {
    const base = await repo.commit('Base', { 'file.txt': 'a\n' });
    repo.write('file.txt', 'b\n');
    await repo.git('stash', 'push', '--quiet', '-m', 'first stash');
    repo.write('file.txt', 'c\n');
    await repo.git('stash', 'push', '--quiet', '-m', 'second stash');
    const { wrapper } = await load();
    const stashes = [...wrapper.stashes.values()];
    assert.deepEqual(stashes.map((stash) => [stash.index, stash.commit.summary()]), [
      [0, 'On main: second stash'],
      [1, 'On main: first stash']
    ]);
    for (const stash of stashes) {
      // The index commit of the stash is hidden
      assert.deepEqual(wrapper.parents.get(stash.commit.sha()), [base]);
    }
    assert.equal(wrapper.commits.length, 3);
  });
});

describe('index', () => {
  beforeEach(async () => {
    await repo.commit('Initial', {
      'modified.txt': lines('1', '2', '3'),
      'deleted.txt': 'deleted\n',
      'renamed.txt': lines('a', 'b', 'c', 'd', 'e', 'f'),
      'staged.txt': 'old\n'
    });
  });

  it('lists unstaged and staged patches', async () => {
    repo.write('modified.txt', lines('1', 'two', '3'));
    fs.unlinkSync(repo.path('deleted.txt'));
    repo.write('untracked dir/new file.txt', 'new\n');
    repo.write('.gitignore', 'ignored.log\n');
    repo.write('ignored.log', 'ignored\n');
    repo.write('staged.txt', 'new\n');
    await repo.git('add', 'staged.txt');
    await repo.git('mv', 'renamed.txt', 'moved.txt');
    const { wrapper } = await load();
    assert.deepEqual(patchList(wrapper.unstagedPatches), [
      [PatchStatus.Deleted, 'deleted.txt'],
      [PatchStatus.Modified, 'modified.txt'],
      [PatchStatus.Untracked, '.gitignore'],
      [PatchStatus.Untracked, 'untracked dir/new file.txt']
    ]);
    assert.deepEqual(patchList(wrapper.stagedPatches), [
      [PatchStatus.Renamed, 'moved.txt'],
      [PatchStatus.Modified, 'staged.txt']
    ]);
    const renamed = wrapper.stagedPatches[0];
    assert.equal(renamed.oldFile.path, 'renamed.txt');
    assert.ok(renamed.isRenamed());
    // Working directory files are hashed so that patches can be compared
    const modified = wrapper.unstagedPatches[1];
    assert.equal(modified.newFile.id, (await repo.git('hash-object', 'modified.txt')).trim());
    assert.equal(modified.oldFile.id, (await repo.git('rev-parse', ':modified.txt')).trim());
    assert.equal(wrapper.unstagedPatches[0].newFile.exists, false);
  });

  it('loads hunks of unstaged, untracked and staged patches', async () => {
    repo.write('modified.txt', lines('1', 'two', '3'));
    repo.write('new.txt', lines('x', 'y'));
    repo.write('staged.txt', 'new\n');
    await repo.git('add', 'staged.txt');
    const { wrapper } = await load();
    const [modified, untracked] = wrapper.unstagedPatches;
    const [modifiedHunk] = await modified.hunks();
    assert.deepEqual(modifiedHunk.lines.map((line) => line.origin + line.content), [' 1', '-2', '+two', ' 3']);
    // Hunks are cached so that lines can be selected
    assert.equal((await modified.hunks())[0], modifiedHunk);
    const [untrackedHunk] = await untracked.hunks();
    assert.deepEqual(untrackedHunk.lines.map((line) => line.origin + line.content), ['+x', '+y']);
    const [stagedHunk] = await wrapper.stagedPatches[0].hunks();
    assert.deepEqual(stagedHunk.lines.map((line) => line.origin + line.content), ['-old', '+new']);
  });

  it('reads both sides of a patch', async () => {
    repo.write('modified.txt', lines('1', 'two', '3'));
    const { wrapper } = await load();
    const [patch] = wrapper.unstagedPatches;
    assert.equal((await wrapper.readFile(patch.oldFile)).toString(), lines('1', '2', '3'));
    assert.equal((await wrapper.readFile(patch.newFile)).toString(), lines('1', 'two', '3'));
  });

  it('stages and unstages whole files', async () => {
    repo.write('modified.txt', lines('1', 'two', '3'));
    fs.unlinkSync(repo.path('deleted.txt'));
    repo.write('new.txt', 'new\n');
    const { wrapper, errors } = await load();
    await wrapper.stageAll(wrapper.unstagedPatches);
    await wrapper.updateIndex();
    assert.deepEqual(wrapper.unstagedPatches, []);
    assert.deepEqual(patchList(wrapper.stagedPatches), [
      [PatchStatus.Deleted, 'deleted.txt'],
      [PatchStatus.Modified, 'modified.txt'],
      [PatchStatus.Added, 'new.txt']
    ]);
    await wrapper.unstagePatch(wrapper.stagedPatches[1]);
    await wrapper.updateIndex();
    assert.deepEqual(patchList(wrapper.unstagedPatches), [[PatchStatus.Modified, 'modified.txt']]);
    await wrapper.unstageAll(wrapper.stagedPatches);
    await wrapper.updateIndex();
    assert.deepEqual(wrapper.stagedPatches, []);
    assert.deepEqual(errors(), []);
  });

  it('stages and unstages both sides of a rename', async () => {
    fs.renameSync(repo.path('renamed.txt'), repo.path('moved.txt'));
    const { wrapper } = await load();
    await wrapper.stageAll(wrapper.unstagedPatches);
    await wrapper.updateIndex();
    assert.deepEqual(patchList(wrapper.stagedPatches), [[PatchStatus.Renamed, 'moved.txt']]);
    await wrapper.unstagePatch(wrapper.stagedPatches[0]);
    await wrapper.updateIndex();
    assert.deepEqual(wrapper.stagedPatches, []);
  });

  it('unstages files when nothing is committed yet', async () => {
    const empty = await TestRepo.create();
    empty.write('first.txt', 'first\n');
    await empty.git('add', 'first.txt');
    const { wrapper, errors } = empty.wrapper();
    await wrapper.init();
    assert.deepEqual(patchList(wrapper.stagedPatches), [[PatchStatus.Added, 'first.txt']]);
    await wrapper.unstageAll(wrapper.stagedPatches);
    await wrapper.updateIndex();
    assert.deepEqual(wrapper.stagedPatches, []);
    assert.deepEqual(patchList(wrapper.unstagedPatches), [[PatchStatus.Untracked, 'first.txt']]);
    assert.deepEqual(errors(), []);
    empty.remove();
  });

  it('stages, unstages and discards selected lines', async () => {
    repo.write('modified.txt', lines('one', '2', 'three'));
    const { wrapper, errors } = await load();
    let [patch] = wrapper.unstagedPatches;
    let [hunk] = await patch.hunks();
    // Stage the change of the first line
    await wrapper.stageLines(patch, hunk.lines.filter((line) => line.content === '1' || line.content === 'one'));
    assert.equal(await repo.staged('modified.txt'), lines('one', '2', '3'));
    // Unstage it
    await wrapper.updateIndex();
    [patch] = wrapper.stagedPatches;
    [hunk] = await patch.hunks();
    await wrapper.unstageLines(patch, hunk.lines.filter((line) => line.origin !== ' '));
    assert.equal(await repo.staged('modified.txt'), lines('1', '2', '3'));
    // Discard the change of the last line
    await wrapper.updateIndex();
    [patch] = wrapper.unstagedPatches;
    [hunk] = await patch.hunks();
    await wrapper.discardLines(patch, hunk.lines.filter((line) => line.content === '3' || line.content === 'three'));
    assert.equal(repo.read('modified.txt'), lines('one', '2', '3'));
    assert.deepEqual(errors(), []);
  });

  it('stages a hunk and selected lines of an untracked file', async () => {
    repo.write('new.txt', lines('a', 'b', 'c'));
    const { wrapper, errors } = await load();
    const patch = wrapper.unstagedPatches.find((p) => p.isUntracked())!;
    const [hunk] = await patch.hunks();
    await wrapper.stageLines(patch, hunk.lines.filter((line) => line.content !== 'b'));
    assert.equal(await repo.staged('new.txt'), lines('a', 'c'));
    await wrapper.updateIndex();
    const unstaged = wrapper.unstagedPatches.find((p) => p.newFile.path === 'new.txt')!;
    await wrapper.stageHunk(unstaged, (await unstaged.hunks())[0]);
    assert.equal(await repo.staged('new.txt'), lines('a', 'b', 'c'));
    assert.deepEqual(errors(), []);
  });

  it('discards whole files', async () => {
    repo.write('modified.txt', 'changed\n');
    repo.write('untracked.txt', 'new\n');
    const { wrapper, errors } = await load();
    for (const patch of wrapper.unstagedPatches) {
      await wrapper.discardPatch(patch);
    }
    assert.equal(repo.read('modified.txt'), lines('1', '2', '3'));
    assert.equal(repo.exists('untracked.txt'), false);
    assert.equal(await repo.status(), '');
    assert.deepEqual(errors(), []);
  });

  it('reports git errors as notifications', async () => {
    repo.write('modified.txt', 'changed\n');
    const { wrapper, errors } = await load();
    const [patch] = wrapper.unstagedPatches;
    const [hunk] = await patch.hunks();
    // The working directory changed since the patch was loaded
    repo.write('modified.txt', 'something else\n');
    await repo.git('add', 'modified.txt');
    await wrapper.stageHunk(patch, hunk);
    assert.equal(errors().length, 1);
    assert.match(errors()[0].message, /^Unable to stage lines: /);
  });
});

describe('commits', () => {
  it('commits the index with the identity from the preferences', async () => {
    await repo.commit('Initial', { 'file.txt': 'a\n' });
    repo.write('file.txt', 'b\n');
    await repo.git('add', 'file.txt');
    const { wrapper, errors } = await load();
    await wrapper.commit('Change the file\n\nWith a description #1');
    assert.deepEqual(errors(), []);
    assert.equal(await repo.git('log', '-1', '--format=%an <%ae>|%cn <%ce>|%B'),
      `${IDENTITY.name} <${IDENTITY.email}>|${IDENTITY.name} <${IDENTITY.email}>|Change the file\n\nWith a description #1\n\n`);
  });

  it('creates the first commit of a repository', async () => {
    repo.write('file.txt', 'a\n');
    await repo.git('add', 'file.txt');
    const { wrapper, errors } = await load();
    await wrapper.commit('Root');
    assert.deepEqual(errors(), []);
    assert.equal((await repo.git('log', '--format=%s')).trim(), 'Root');
  });

  it('falls back to the git configuration without preferences', async () => {
    await repo.commit('Initial', { 'file.txt': 'a\n' });
    const wrapper = new RepoWrapper({ workdir: repo.workdir, gitDir: repo.path('.git') }, () => {}, { getIdentity: () => null });
    repo.write('file.txt', 'b\n');
    await repo.git('add', 'file.txt');
    await wrapper.commit('Configured');
    assert.equal((await repo.git('log', '-1', '--format=%an')).trim(), 'Config User');
  });

  it('amends the last commit and keeps its author', async () => {
    await repo.commit('Initial', { 'file.txt': 'a\n' });
    repo.write('file.txt', 'b\n');
    await repo.git('add', 'file.txt');
    const { wrapper, errors } = await load();
    await wrapper.amend('Amended');
    assert.deepEqual(errors(), []);
    assert.equal((await repo.git('rev-list', '--count', 'HEAD')).trim(), '1');
    assert.equal((await repo.git('log', '-1', '--format=%s|%an|%cn')).trim(), `Amended|Config User|${IDENTITY.name}`);
    assert.equal(await repo.git('show', 'HEAD:file.txt'), 'b\n');
  });

  it('reports an error when there is nothing to commit', async () => {
    await repo.commit('Initial');
    const { wrapper, errors } = await load();
    await wrapper.commit('Nothing');
    assert.equal(errors().length, 1);
    assert.match(errors()[0].message, /^Unable to commit/);
  });

  it('cherry-picks and reverts commits', async () => {
    await repo.commit('Initial', { 'file.txt': lines('a', 'b') });
    await repo.git('checkout', '--quiet', '-b', 'feature');
    const picked = await repo.commit('Add c', { 'other.txt': 'c\n' });
    await repo.git('checkout', '--quiet', 'main');
    const { wrapper, errors } = await load();
    await wrapper.cherrypick(wrapper.shaToCommit.get(picked)!);
    assert.equal(repo.read('other.txt'), 'c\n');
    assert.equal((await repo.git('log', '-1', '--format=%s|%an')).trim(), 'Add c|Config User');
    await wrapper.requestUpdateCommits();
    await wrapper.updateHead();
    await wrapper.revert(wrapper.headCommit!);
    assert.equal(repo.exists('other.txt'), false);
    assert.equal((await repo.git('log', '-1', '--format=%s')).trim(), 'Revert "Add c"');
    assert.deepEqual(errors(), []);
  });

  it('resets the current branch', async () => {
    const first = await repo.commit('First', { 'file.txt': 'a\n' });
    await repo.commit('Second', { 'file.txt': 'b\n' });
    const { wrapper } = await load();
    const target = wrapper.shaToCommit.get(first)!;
    await wrapper.reset(target, ResetType.Soft);
    assert.equal(await repo.sha('HEAD'), first);
    assert.equal(await repo.staged('file.txt'), 'b\n');
    await wrapper.reset(target, ResetType.Mixed);
    assert.equal(await repo.staged('file.txt'), 'a\n');
    assert.equal(repo.read('file.txt'), 'b\n');
    await wrapper.reset(target, ResetType.Hard);
    assert.equal(repo.read('file.txt'), 'a\n');
  });

  it('lists the patches of a commit compared to its first parent', async () => {
    await repo.commit('Root', { 'a.txt': 'a\n', 'image.bin': Buffer.from([0, 1, 2]).toString() });
    await repo.commit('Change', { 'a.txt': 'A\n', 'b.txt': 'b\n' });
    const { wrapper } = await load();
    const [change, root] = wrapper.commits;
    assert.deepEqual(patchList(await wrapper.getPatches(root)), [[PatchStatus.Added, 'a.txt'], [PatchStatus.Added, 'image.bin']]);
    const patches = await wrapper.getPatches(change);
    assert.deepEqual(patchList(patches), [[PatchStatus.Modified, 'a.txt'], [PatchStatus.Added, 'b.txt']]);
    const [hunk] = await patches[0].hunks();
    assert.deepEqual(hunk.lines.map((line) => line.origin + line.content), ['-a', '+A']);
    assert.equal((await wrapper.readFile(patches[0].oldFile)).toString(), 'a\n');
    assert.equal((await wrapper.readFile(patches[0].newFile)).toString(), 'A\n');
    const rootPatches = await wrapper.getPatches(root);
    assert.equal(rootPatches[1].isBinary, true);
    assert.deepEqual(await rootPatches[1].hunks(), []);
  });
});

describe('references', () => {
  beforeEach(async () => {
    await repo.commit('Initial', { 'file.txt': 'a\n' });
  });

  it('creates, checks out, renames and removes branches', async () => {
    const { wrapper, notifications, errors } = await load();
    const reference = await wrapper.createBranch('feature/x', wrapper.headCommit!);
    assert.equal(reference!.name(), 'refs/heads/feature/x');
    await wrapper.checkoutReference(reference!);
    assert.equal((await repo.git('symbolic-ref', 'HEAD')).trim(), 'refs/heads/feature/x');
    assert.deepEqual(notifications.map((notification) => notification.message), ['Checked out feature/x']);
    await repo.git('checkout', '--quiet', 'main');
    await wrapper.renameReference(reference!, 'feature/y');
    assert.equal((await repo.git('branch', '--format=%(refname:short)')).trim(), 'feature/y\nmain');
    await wrapper.requestUpdateCommits();
    await wrapper.removeReference(wrapper.references.get('refs/heads/feature/y')!);
    assert.equal((await repo.git('branch', '--format=%(refname:short)')).trim(), 'main');
    assert.deepEqual(errors(), []);
  });

  it('reports an invalid branch name', async () => {
    const { wrapper, errors } = await load();
    assert.equal(await wrapper.createBranch('bad..name', wrapper.headCommit!), null);
    assert.equal(errors().length, 1);
  });

  it('checks out a remote branch as a detached head', async () => {
    await repo.git('update-ref', 'refs/remotes/origin/main', 'HEAD');
    await repo.commit('Second');
    const { wrapper, errors } = await load();
    await wrapper.checkoutReference(wrapper.references.get('refs/remotes/origin/main')!);
    assert.deepEqual(errors(), []);
    assert.equal(await repo.sha('HEAD'), await repo.sha('origin/main'));
    await wrapper.updateHead();
    assert.equal(wrapper.head, null);
  });

  it('creates, renames and removes tags', async () => {
    const { wrapper, errors } = await load();
    await wrapper.createTag('v1', wrapper.headCommit!);
    await wrapper.requestUpdateCommits();
    await wrapper.renameReference(wrapper.references.get('refs/tags/v1')!, 'v2');
    assert.equal((await repo.git('tag')).trim(), 'v2');
    await wrapper.requestUpdateCommits();
    await wrapper.removeReference(wrapper.references.get('refs/tags/v2')!);
    assert.equal((await repo.git('tag')).trim(), '');
    assert.deepEqual(errors(), []);
  });
});

describe('merges', () => {
  beforeEach(async () => {
    await repo.commit('Initial', { 'file.txt': lines('a', 'b', 'c') });
    await repo.git('checkout', '--quiet', '-b', 'feature');
    await repo.commit('Feature', { 'file.txt': lines('a', 'feature', 'c') });
    await repo.git('checkout', '--quiet', 'main');
  });

  it('merges a branch into the current branch', async () => {
    await repo.commit('Other', { 'other.txt': 'other\n' });
    const { wrapper, notifications, errors } = await load();
    await wrapper.merge('refs/heads/main', 'refs/heads/feature');
    assert.deepEqual(errors(), []);
    assert.equal(notifications[0].message, 'Merged successfully');
    assert.equal((await repo.git('log', '-1', '--format=%s|%p')).split('|')[0], "Merge branch 'feature'");
    assert.equal(repo.read('file.txt'), lines('a', 'feature', 'c'));
  });

  it('only merges into the current branch', async () => {
    const { wrapper, errors } = await load();
    await wrapper.merge('refs/heads/feature', 'refs/heads/main');
    assert.match(errors()[0].message, /is not the current branch/);
  });

  it('resolves a conflict and finishes the merge', async () => {
    await repo.commit('Main', { 'file.txt': lines('a', 'main', 'c') });
    const { wrapper, errors } = await load();
    await wrapper.merge('refs/heads/main', 'refs/heads/feature');
    assert.equal(errors().length, 1);
    assert.equal(wrapper.getState(), RepoState.Merge);
    assert.equal(await wrapper.getMergeMessage(), "Merge branch 'feature'");
    assert.deepEqual(await wrapper.getMergeHeads(), [await repo.sha('feature')]);
    await wrapper.updateIndex();
    assert.deepEqual(patchList(wrapper.unstagedPatches), [[PatchStatus.Conflicted, 'file.txt']]);
    assert.deepEqual(wrapper.stagedPatches, []);
    const conflict = wrapper.unstagedPatches[0];
    assert.match((await wrapper.readFile(conflict.newFile)).toString(), /<<<<<<< HEAD\nmain\n=======\nfeature\n>>>>>>> refs\/heads\/feature/);
    // Resolve
    repo.write('file.txt', lines('a', 'both', 'c'));
    await wrapper.stagePatch(conflict);
    await wrapper.finishMerge('Merge feature');
    assert.equal(wrapper.getState(), RepoState.Commit);
    assert.equal((await repo.git('log', '-1', '--format=%s|%P')).trim(),
      `Merge feature|${await repo.sha('HEAD~1')} ${await repo.sha('feature')}`);
  });

  // Merges feature into main, which changed the same line
  async function loadConflict() {
    await repo.commit('Main', { 'file.txt': lines('a', 'main', 'c') });
    await assert.rejects(repo.git('merge', '--quiet', 'feature'));
    const result = await load();
    return { ...result, conflict: result.wrapper.unstagedPatches[0] };
  }

  it('keeps the current version of a conflicted file', async () => {
    const { wrapper, errors, conflict } = await loadConflict();
    await wrapper.checkoutConflictVersion(conflict, ConflictVersion.Current);
    assert.equal(repo.read('file.txt'), lines('a', 'main', 'c'));
    // The file stays conflicted until it is marked as resolved
    await wrapper.updateIndex();
    assert.deepEqual(patchList(wrapper.unstagedPatches), [[PatchStatus.Conflicted, 'file.txt']]);
    await wrapper.stagePatch(conflict);
    await wrapper.finishMerge('Merge feature');
    assert.equal(await repo.git('show', 'HEAD:file.txt'), lines('a', 'main', 'c'));
    assert.deepEqual(errors(), []);
  });

  it('takes the incoming version of a conflicted file in place of its edits', async () => {
    const { wrapper, errors, conflict } = await loadConflict();
    repo.write('file.txt', 'edited\n');
    await wrapper.checkoutConflictVersion(conflict, ConflictVersion.Incoming);
    assert.equal(repo.read('file.txt'), lines('a', 'feature', 'c'));
    await wrapper.updateIndex();
    assert.deepEqual(patchList(wrapper.unstagedPatches), [[PatchStatus.Conflicted, 'file.txt']]);
    assert.deepEqual(errors(), []);
  });

  it('reports a version that deleted the conflicted file', async () => {
    await repo.git('rm', '--quiet', 'file.txt');
    await repo.commit('Delete');
    await assert.rejects(repo.git('merge', '--quiet', 'feature'));
    const { wrapper, errors } = await load();
    await wrapper.checkoutConflictVersion(wrapper.unstagedPatches[0], ConflictVersion.Current);
    assert.equal(errors().length, 1);
    assert.match(errors()[0].message, /^Unable to keep the current version: .*does not have our version/);
    // The file is left as it was, with the incoming version
    assert.equal(repo.read('file.txt'), lines('a', 'feature', 'c'));
  });

  it('aborts a merge', async () => {
    await repo.commit('Main', { 'file.txt': lines('a', 'main', 'c') });
    const { wrapper } = await load();
    await wrapper.merge('refs/heads/main', 'refs/heads/feature');
    await wrapper.abortMerge();
    assert.equal(wrapper.getState(), RepoState.Commit);
    assert.equal(repo.read('file.txt'), lines('a', 'main', 'c'));
  });

  it('detects the other repository states', async () => {
    const { wrapper } = await load();
    const gitDir = repo.path('.git');
    for (const [file, state] of [['CHERRY_PICK_HEAD', RepoState.Cherrypick], ['REVERT_HEAD', RepoState.Revert]] as const) {
      fs.writeFileSync(Path.join(gitDir, file), '');
      assert.equal(wrapper.getState(), state);
      fs.unlinkSync(Path.join(gitDir, file));
    }
    fs.mkdirSync(Path.join(gitDir, 'rebase-merge'));
    assert.equal(wrapper.getState(), RepoState.Rebase);
  });
});

describe('remotes', () => {
  let remote: TestRepo;
  let clone: string;

  beforeEach(async () => {
    remote = repo;
    await remote.commit('Initial', { 'file.txt': 'a\n' });
    clone = Path.join(fs.realpathSync.native(os.tmpdir()), `gitadmin-remote-${process.pid}-${Date.now()}`);
    await remote.git('clone', '--quiet', remote.workdir, clone);
  });

  afterEach(() => {
    fs.rmSync(clone, { recursive: true, force: true });
  });

  it('fetches, pulls and pushes the current branch', async () => {
    const wrapper = new RepoWrapper(await RepoWrapper.open(clone), () => {}, { getIdentity: () => IDENTITY });
    await wrapper.init();
    await remote.commit('Remote change', { 'file.txt': 'b\n' });
    await wrapper.fetchAll();
    await wrapper.requestUpdateCommits();
    assert.ok(wrapper.references.has('refs/remotes/origin/main'));
    await wrapper.pull('main');
    assert.equal(fs.readFileSync(Path.join(clone, 'file.txt')).toString(), 'b\n');
    // Push to a new branch of the remote
    await remote.git('checkout', '--quiet', '--detach');
    fs.writeFileSync(Path.join(clone, 'file.txt'), 'c\n');
    await wrapper.stageAll((await wrapper.getUnstagedPatches()));
    await wrapper.commit('Local change');
    const notifications: string[] = [];
    wrapper.onNotification = (message) => notifications.push(message);
    await wrapper.push();
    assert.deepEqual(notifications, ['Pushed successfully']);
    assert.equal((await remote.git('log', '-1', '--format=%s', 'main')).trim(), 'Local change');
  });
});

describe('stashes', () => {
  it('stashes, applies, pops and drops', async () => {
    await repo.commit('Initial', { 'file.txt': 'a\n' });
    repo.write('file.txt', 'b\n');
    const { wrapper, errors } = await load();
    await wrapper.stash();
    assert.equal(repo.read('file.txt'), 'a\n');
    await wrapper.applyStash(0);
    assert.equal(repo.read('file.txt'), 'b\n');
    await repo.git('checkout', '--', 'file.txt');
    await wrapper.popStash();
    assert.equal(repo.read('file.txt'), 'b\n');
    assert.equal((await repo.git('stash', 'list')).trim(), '');
    await wrapper.stash();
    await wrapper.dropStash(0);
    assert.equal((await repo.git('stash', 'list')).trim(), '');
    assert.deepEqual(errors(), []);
  });
});

describe('ignore', () => {
  it('uses the .gitignore of the working directory', async () => {
    await repo.commit('Initial', { '.gitignore': 'build/\n*.log\n' });
    const { wrapper } = await load();
    assert.equal(wrapper.isIgnored('build/out.js'), true);
    assert.equal(wrapper.isIgnored('debug.log'), true);
    assert.equal(wrapper.isIgnored('src/main.ts'), false);
    assert.equal(wrapper.isIgnored('.gitignore'), false);
  });
});
