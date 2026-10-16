import { describe, it, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as Path from 'path';
import { findConflictHunks } from '../src/renderer/helpers/conflict-parser';
import { arePatchesEqual, arePatchesSimilar } from '../src/renderer/helpers/patch-comparison';
import { getMergeMessage, removeReferencePrefix, shortenSha } from '../src/renderer/helpers/repo-wrapper';
import { Patch, PatchStatus } from '../src/renderer/helpers/git/model';
import { Field, Settings } from '../src/shared/settings';
import { NodeType } from '../src/renderer/helpers/commit-graph';
import { TestRepo } from './helpers';

describe('findConflictHunks', () => {
  it('finds the markers of each conflict with 1-based line numbers', () => {
    const content = [
      'a',
      '<<<<<<< HEAD',
      'ours',
      '||||||| base',
      'base',
      '=======',
      'theirs',
      '>>>>>>> feature',
      'b',
      '<<<<<<< HEAD',
      '=======',
      '>>>>>>> feature',
      '<<<<<<< incomplete'
    ].join('\n');
    const hunks = findConflictHunks(content);
    assert.deepEqual(hunks.map((h) => [h.start, h.ancestors, h.separator, h.end]), [
      [2, [4], 6, 8],
      [10, [], 11, 12]
    ]);
  });
});

describe('patch comparison', () => {
  const file = (path: string, id: string | null) => ({ path, id, mode: '100644', exists: true });
  const patch = (oldId: string | null, newId: string | null, path = 'file.txt') =>
    new Patch(PatchStatus.Modified, file(path, oldId), file(path, newId), false, async () => []);

  it('compares the content of the patches', () => {
    assert.equal(arePatchesEqual(patch('a', 'b'), patch('a', 'b')), true);
    assert.equal(arePatchesEqual(patch('a', 'b'), patch('a', 'c')), false);
    assert.equal(arePatchesEqual(patch('a', 'b'), patch('a', 'b', 'other.txt')), false);
  });

  it('never considers patches without ids equal', () => {
    assert.equal(arePatchesEqual(patch('a', null), patch('a', null)), false);
  });

  it('considers patches of the same file similar', () => {
    assert.equal(arePatchesSimilar(patch('a', 'b'), patch('c', 'd')), true);
    assert.equal(arePatchesSimilar(patch('a', 'b'), patch('a', 'b', 'other.txt')), false);
  });
});

describe('reference helpers', () => {
  it('shortens shas and reference names', () => {
    assert.equal(shortenSha('0123456789abcdef'), '012345');
    assert.equal(removeReferencePrefix('refs/heads/feature/x'), 'feature/x');
  });

  it('writes merge messages like git', () => {
    assert.equal(getMergeMessage('refs/heads/feature'), "Merge branch 'feature'");
    assert.equal(getMergeMessage('refs/remotes/origin/main'), "Merge remote-tracking branch 'origin/main'");
    assert.equal(getMergeMessage('refs/tags/v1'), "Merge tag 'v1'");
  });
});

describe('Settings', () => {
  const dir = fs.mkdtempSync(Path.join(os.tmpdir(), 'gitamine-settings-'));
  const path = Path.join(dir, 'Settings');

  afterEach(() => {
    fs.rmSync(path, { force: true });
  });

  it('reads and writes values in the namespace of the app', () => {
    Settings.setPath(path);
    assert.equal(Settings.exists(), false);
    assert.equal(Settings.get(Field.Theme, 'light'), 'light');
    Settings.set(Field.Theme, 'dark');
    Settings.set(Field.RecentlyOpened, ['/repo']);
    assert.equal(Settings.get(Field.Theme), 'dark');
    assert.deepEqual(Settings.getAll(), { theme: 'dark', recentlyOpened: ['/repo'] });
    Settings.setAll({ name: 'Ada' });
    assert.deepEqual(Settings.getAll(), { name: 'Ada' });
  });

  it('reads the file written by electron-settings', () => {
    fs.writeFileSync(path, JSON.stringify({ gitamine: { email: 'ada@example.com' }, other: 1 }));
    Settings.setPath(path);
    assert.equal(Settings.get(Field.Email), 'ada@example.com');
    Settings.set(Field.Name, 'Ada');
    assert.deepEqual(JSON.parse(fs.readFileSync(path).toString()), { gitamine: { email: 'ada@example.com', name: 'Ada' }, other: 1 });
  });

  it('ignores a corrupted file', () => {
    fs.writeFileSync(path, '{');
    Settings.setPath(path);
    assert.equal(Settings.get(Field.FontSize, 14), 14);
  });
});

describe('CommitGraph', () => {
  it('places branches in separate columns and stashes as stash nodes', async () => {
    const repo = await TestRepo.create();
    try {
      await repo.commit('A', { 'file.txt': 'a\n' });
      await repo.git('checkout', '--quiet', '-b', 'feature');
      await repo.commit('B');
      await repo.git('checkout', '--quiet', 'main');
      await repo.commit('C', { 'file.txt': 'c\n' });
      repo.write('file.txt', 'stashed\n');
      await repo.git('stash', 'push', '--quiet');
      const { wrapper } = repo.wrapper();
      await wrapper.init();
      const positions = wrapper.graph.positions;
      const sha = (summary: string) => wrapper.commits.find((commit) => commit.summary() === summary)!.sha();
      const [stash] = wrapper.stashes.keys();
      assert.equal(positions.size, 4);
      assert.equal(positions.get(stash)![2], NodeType.Stash);
      assert.equal(positions.get(sha('C'))![2], NodeType.Commit);
      // Rows follow the order of the commits, the index takes the first row
      for (const [i, commit] of wrapper.commits.entries()) {
        assert.equal(positions.get(commit.sha())![0], i + 1);
      }
      assert.notEqual(positions.get(sha('B'))![1], positions.get(sha('C'))![1]);
      assert.ok(wrapper.graph.width >= 2);
      // One edge per parent link
      assert.equal(wrapper.graph.edges.count, 3);
    } finally {
      repo.remove();
    }
  });
});
