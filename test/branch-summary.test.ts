import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as Path from 'path';
import {
  BranchSummary, FileChange, countAuthors, describeAheadBehind, describeTimeSpan, formatSummaryMarkdown, getBranchName,
  getMostChangedDirectories, getMostChangedFiles, getSourceCandidates, getSourceChoices, getTimeSpan, loadSource, saveSource
} from '../src/renderer/helpers/branch-summary';
import { parseLineCounts } from '../src/renderer/helpers/git/parsers';
import { Commit } from '../src/renderer/helpers/git/model';
import { RepoWrapper } from '../src/renderer/helpers/repo-wrapper';
import { Field, Settings } from '../src/shared/settings';
import { TestRepo, lines } from './helpers';

const MAIN = 'refs/heads/main';
const FEATURE = 'refs/heads/feature';
const DEVELOP = 'refs/heads/develop';

function commit(sha: string, author: string, time: number, parents: string[] = []) {
  const signature = { name: author, email: `${author.toLowerCase()}@example.com`, date: new Date(time * 1000) };
  return new Commit(sha, parents, signature, signature, `Commit ${sha}`);
}

function change(path: string, added: number, removed: number, binary = false): FileChange {
  return { path, added, removed, binary };
}

describe('source candidates', () => {
  it('keeps the main branches, local ones first, without the branch itself', () => {
    const references = ['refs/remotes/origin/main', 'refs/heads/feature', 'refs/heads/develop', 'refs/tags/main',
      'refs/heads/main', 'refs/remotes/origin/master', 'refs/remotes/upstream/main', 'refs/heads/mainline'];
    assert.deepEqual(getSourceCandidates(references, FEATURE),
      ['refs/heads/main', 'refs/heads/develop', 'refs/remotes/origin/main', 'refs/remotes/upstream/main', 'refs/remotes/origin/master']);
  });

  it('leaves out the remote counterparts of a main branch', () => {
    const references = ['refs/heads/main', 'refs/remotes/origin/main', 'refs/heads/develop', 'refs/remotes/origin/develop'];
    assert.deepEqual(getSourceCandidates(references, DEVELOP), ['refs/heads/main', 'refs/remotes/origin/main']);
  });

  it('names branches without their remote', () => {
    assert.equal(getBranchName('refs/heads/team/feature'), 'team/feature');
    assert.equal(getBranchName('refs/remotes/origin/team/feature'), 'team/feature');
    assert.equal(getBranchName('refs/tags/v1.0'), 'v1.0');
  });

  it('offers the other branches as sources', () => {
    const references = ['refs/remotes/origin/main', 'refs/remotes/origin/HEAD', 'refs/heads/feature', 'refs/tags/v1.0',
      'refs/heads/main', 'refs/heads/develop'];
    assert.deepEqual(getSourceChoices(references, FEATURE), ['refs/heads/develop', 'refs/heads/main', 'refs/remotes/origin/main']);
  });
});

describe('summary statistics', () => {
  it('counts the commits of each author, most commits first', () => {
    const commits = [commit('d', 'Grace', 400), commit('c', 'Ada', 300), commit('b', 'Grace', 200), commit('a', 'Charles', 100)];
    assert.deepEqual(countAuthors(commits).map((author) => [author.name, author.commits]), [['Grace', 2], ['Ada', 1], ['Charles', 1]]);
    assert.equal(countAuthors(commits)[0].email, 'grace@example.com');
    assert.deepEqual(countAuthors([]), []);
  });

  it('spans the author dates of the commits', () => {
    const [first, last] = getTimeSpan([commit('b', 'Ada', 1700086400), commit('a', 'Ada', 1700000000), commit('c', 'Ada', 1700050000)]);
    assert.equal(first!.valueOf(), 1700000000000);
    assert.equal(last!.valueOf(), 1700086400000);
    assert.deepEqual(getTimeSpan([]), [null, null]);
    assert.equal(describeTimeSpan(first, last), '2023-11-14 to 2023-11-15');
    assert.equal(describeTimeSpan(first, first), '2023-11-14');
    assert.equal(describeTimeSpan(null, null), 'No commits');
  });

  it('describes the commits ahead and behind', () => {
    assert.equal(describeAheadBehind(1, 0), '1 commit ahead, 0 behind');
    assert.equal(describeAheadBehind(3, 2), '3 commits ahead, 2 behind');
  });

  it('finds the most changed files, binary files last', () => {
    const changes = [change('a.txt', 1, 1), change('image.png', 0, 0, true), change('b.txt', 10, 0), change('c.txt', 0, 2)];
    // Ties are sorted by path
    assert.deepEqual(getMostChangedFiles(changes).map((file) => file.path), ['b.txt', 'a.txt', 'c.txt', 'image.png']);
    assert.deepEqual(getMostChangedFiles(changes, 2).map((file) => file.path), ['b.txt', 'a.txt']);
  });

  it('adds the changes of the files to their directories', () => {
    const changes = [
      change('README.md', 1, 0),
      change('src/app/main.ts', 5, 1),
      change('src/app/view.ts', 2, 2),
      change('src/lib/util.ts', 1, 0),
      change('docs/guide/intro.md', 3, 0)
    ];
    const directories = getMostChangedDirectories(changes);
    assert.deepEqual(directories.map((directory) => [directory.path, directory.added, directory.removed]), [
      ['src/', 8, 3],
      ['src/app/', 7, 3],
      // docs/ only holds docs/guide/, it tells the same
      ['docs/guide/', 3, 0],
      ['./', 1, 0],
      ['src/lib/', 1, 0]
    ]);
  });
});

describe('summary as Markdown', () => {
  const fork = commit('f0f0f0f0f0', 'Ada', 1700000000);
  const merge = new Commit('m1m1m1m1m1', ['c2', 'x9'], fork.author(), fork.committer(), 'Merge branch \'main\' into feature');
  const work = commit('c2c2c2c2c2', 'Grace', 1700086400);
  const summary: BranchSummary = {
    branch: FEATURE,
    source: MAIN,
    forkPoint: fork,
    base: 'x9',
    ahead: 2,
    behind: 1,
    commits: [{ commit: merge, syncedWithSource: true }, { commit: work, syncedWithSource: false }],
    authors: [{ name: 'Ada', email: 'ada@example.com', commits: 1 }, { name: 'Grace_H', email: 'grace@example.com', commits: 1 }],
    firstDate: fork.date(),
    lastDate: work.date(),
    patches: [],
    changes: [change('src/main.ts', 4, 1), change('logo.png', 0, 0, true)],
    added: 4,
    removed: 1,
    mergeCheck: { clean: false, conflicts: ['src/main.ts'] }
  };

  it('tells the fork, the statistics, the commits and the files', () => {
    assert.equal(formatSummaryMarkdown(summary), lines(
      '## Summary of feature',
      '',
      'Forked from `main` at `f0f0f0f` on 2023-11-14, 2 commits ahead, 1 behind `main`.',
      '',
      '- 2 commits by 2 authors, 2023-11-14 to 2023-11-15',
      '- 2 files changed, +4 -1',
      '- Conflicts with the source in 1 file: `src/main.ts`',
      '',
      '### Authors',
      '',
      '- Ada (1 commit)',
      '- Grace\\_H (1 commit)',
      '',
      '### Commits',
      '',
      '- `m1m1m1m` Merge branch \'main\' into feature (synced with source)',
      '- `c2c2c2c` Commit c2c2c2c2c2',
      '',
      '### Most changed files',
      '',
      '- `src/main.ts` +4 -1',
      '- `logo.png` (binary)'
    ));
  });

  it('tells when there is no source or no shared history', () => {
    const empty = {
      ...summary, forkPoint: null, base: null, commits: [], authors: [], firstDate: null, lastDate: null, changes: [], added: 0, removed: 0,
      mergeCheck: null
    };
    assert.equal(formatSummaryMarkdown(empty), lines('## Summary of feature', '', 'Shares no history with `main`.', '', '- No commits',
      '- 0 files changed, +0 -0'));
    assert.match(formatSummaryMarkdown({ ...empty, source: null }), /\nNo source branch found\.\n/);
    assert.match(formatSummaryMarkdown({ ...summary, mergeCheck: { clean: true, conflicts: [] } }), /\n- Merges cleanly into the source\n/);
  });
});

describe('source persistence', () => {
  const dir = fs.mkdtempSync(Path.join(os.tmpdir(), 'gitadmin-settings-'));
  const path = Path.join(dir, 'Settings');

  beforeEach(() => {
    Settings.setPath(path);
  });

  afterEach(() => {
    fs.rmSync(path, { force: true });
  });

  it('remembers the source chosen for each branch of each repository', () => {
    assert.equal(loadSource('/repos/engine', FEATURE), null);
    saveSource('/repos/engine', FEATURE, DEVELOP);
    saveSource('/repos/engine', DEVELOP, MAIN);
    saveSource('/repos/mill', FEATURE, MAIN);
    assert.equal(loadSource('/repos/engine', FEATURE), DEVELOP);
    assert.equal(loadSource('/repos/engine', DEVELOP), MAIN);
    assert.equal(loadSource('/repos/mill', FEATURE), MAIN);
    // Going back to the detected source forgets the choice
    saveSource('/repos/engine', FEATURE, null);
    saveSource('/repos/engine', DEVELOP, null);
    assert.equal(loadSource('/repos/engine', FEATURE), null);
    assert.deepEqual(Settings.get(Field.BranchSummarySources), { '/repos/mill': { [FEATURE]: MAIN } });
  });

  it('ignores invalid values', () => {
    Settings.set(Field.BranchSummarySources, { '/repos/engine': { [FEATURE]: 3 }, '/repos/mill': 'main' });
    assert.equal(loadSource('/repos/engine', FEATURE), null);
    assert.equal(loadSource('/repos/mill', FEATURE), null);
    Settings.set(Field.BranchSummarySources, ['main']);
    assert.equal(loadSource('/repos/engine', FEATURE), null);
    saveSource('/repos/engine', FEATURE, MAIN);
    assert.equal(loadSource('/repos/engine', FEATURE), MAIN);
  });
});

describe('line counts', () => {
  it('reads the numstat entries after the raw entries', () => {
    const output = [
      ':100644 100644 aaaa bbbb M', 'file.txt',
      ':100644 100644 cccc cccc R100', 'old.txt', 'new.txt',
      ':000000 100644 0000 dddd A', 'image.png',
      '3\t1\tfile.txt',
      '0\t0\t', 'old.txt', 'new.txt',
      '-\t-\timage.png',
      ''
    ].join('\0');
    assert.deepEqual([...parseLineCounts(output)], [
      ['file.txt', { added: 3, removed: 1, binary: false }],
      ['new.txt', { added: 0, removed: 0, binary: false }],
      ['image.png', { added: 0, removed: 0, binary: true }]
    ]);
  });
});

describe('branch summary', () => {
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
    return result.wrapper;
  }

  function summaries(summary: BranchSummary) {
    return summary.commits.map(({ commit, syncedWithSource }) => `${commit.summary()}${syncedWithSource ? ' (synced)' : ''}`);
  }

  // main: A - B, feature forks from A: C - D
  async function createFork() {
    const a = await repo.commit('A', { 'engine.txt': lines('analytical', 'engine') });
    await repo.git('checkout', '--quiet', '-b', 'feature');
    await repo.commit('C', { 'cards.txt': lines('operation') });
    await repo.commit('D', { 'cards.txt': lines('operation', 'variable'), 'src/mill/store.txt': lines('column') });
    await repo.git('checkout', '--quiet', 'main');
    await repo.commit('B', { 'notes.txt': lines('note G') });
    return a;
  }

  it('summarizes a branch taken out of main', async () => {
    const a = await createFork();
    const wrapper = await load();
    assert.equal(await wrapper.detectSource(FEATURE), MAIN);
    const summary = await wrapper.getBranchSummary(FEATURE, MAIN);
    assert.equal(summary.branch, FEATURE);
    assert.equal(summary.source, MAIN);
    assert.equal(summary.forkPoint!.sha(), a);
    assert.equal(summary.base, a);
    assert.equal(summary.ahead, 2);
    assert.equal(summary.behind, 1);
    assert.deepEqual(summaries(summary), ['D', 'C']);
    assert.deepEqual(summary.authors, [{ name: 'Config User', email: 'config@example.com', commits: 2 }]);
    assert.equal(summary.lastDate!.valueOf() - summary.firstDate!.valueOf(), 60000);
    // The net change: cards.txt is created once with its two lines
    assert.deepEqual(summary.changes, [change('cards.txt', 2, 0), change('src/mill/store.txt', 1, 0)]);
    assert.deepEqual(summary.patches.map((patch) => [patch.status, patch.newFile.path]), [['A', 'cards.txt'], ['A', 'src/mill/store.txt']]);
    assert.deepEqual((await summary.patches[0].hunks())[0].lines.map((line) => line.content), ['operation', 'variable']);
    assert.equal(summary.added, 3);
    assert.equal(summary.removed, 0);
    assert.deepEqual(summary.mergeCheck, { clean: true, conflicts: [] });
  });

  it('starts from the original fork point of a branch that merged the source in', async () => {
    const a = await createFork();
    const b = await repo.sha('main');
    await repo.git('checkout', '--quiet', 'feature');
    await repo.git('merge', '--quiet', '--no-edit', 'main');
    await repo.commit('E', { 'cards.txt': lines('operation', 'variable', 'number') });
    await repo.git('checkout', '--quiet', 'main');
    const wrapper = await load();
    assert.equal(await wrapper.detectSource(FEATURE), MAIN);
    const summary = await wrapper.getBranchSummary(FEATURE, MAIN);
    assert.equal(summary.forkPoint!.sha(), a);
    // The diff starts from the last commit of main that the branch merged, notes.txt is not a change of the branch
    assert.equal(summary.base, b);
    assert.deepEqual(summaries(summary), ['E', 'Merge branch \'main\' into feature (synced)', 'D', 'C']);
    assert.deepEqual(summary.changes.map((file) => file.path), ['cards.txt', 'src/mill/store.txt']);
    assert.equal(summary.ahead, 4);
    assert.equal(summary.behind, 0);
  });

  it('does not mark the merges of other branches as synced', async () => {
    await createFork();
    await repo.git('checkout', '--quiet', '-b', 'topic', 'feature');
    await repo.commit('T', { 'topic.txt': lines('topic') });
    await repo.git('checkout', '--quiet', 'feature');
    await repo.commit('E', { 'other.txt': lines('other') });
    await repo.git('merge', '--quiet', '--no-edit', 'topic');
    const wrapper = await load();
    const summary = await wrapper.getBranchSummary(FEATURE, MAIN);
    assert.deepEqual(summaries(summary), ['Merge branch \'topic\' into feature', 'E', 'T', 'D', 'C']);
  });

  it('forks a rebased branch from where it was rebased', async () => {
    await createFork();
    const b = await repo.sha('main');
    await repo.git('rebase', '--quiet', 'main', 'feature');
    const wrapper = await load();
    const summary = await wrapper.getBranchSummary(FEATURE, MAIN);
    assert.equal(summary.forkPoint!.sha(), b);
    assert.equal(summary.base, b);
    assert.deepEqual(summaries(summary), ['D', 'C']);
    assert.equal(summary.behind, 0);
  });

  it('forks from a commit that the source dropped since, using its reflog', async () => {
    await repo.commit('A', { 'engine.txt': lines('analytical') });
    const b = await repo.commit('B', { 'engine.txt': lines('analytical', 'engine') });
    await repo.git('checkout', '--quiet', '-b', 'feature');
    await repo.commit('C', { 'cards.txt': lines('operation') });
    await repo.git('checkout', '--quiet', 'main');
    // main is rewritten: B is replaced with B'
    await repo.git('reset', '--quiet', '--hard', 'HEAD~1');
    await repo.commit('B\'', { 'engine.txt': lines('analytical', 'difference engine') });
    const wrapper = await load();
    const summary = await wrapper.getBranchSummary(FEATURE, MAIN);
    assert.equal(summary.forkPoint!.sha(), b);
    assert.deepEqual(summaries(summary), ['C']);
    assert.deepEqual(summary.changes.map((file) => file.path), ['cards.txt']);
  });

  it('summarizes a branch that the source contains', async () => {
    await repo.commit('A');
    await repo.git('branch', 'feature');
    await repo.commit('B');
    const wrapper = await load();
    const summary = await wrapper.getBranchSummary(FEATURE, MAIN);
    assert.equal(summary.forkPoint!.sha(), await repo.sha('feature'));
    assert.deepEqual(summary.commits, []);
    assert.deepEqual(summary.changes, []);
    assert.equal(summary.firstDate, null);
    assert.equal(summary.behind, 1);
  });

  it('tells a branch with no common history', async () => {
    await repo.commit('A', { 'engine.txt': lines('analytical') });
    await repo.git('checkout', '--quiet', '--orphan', 'feature');
    await repo.commit('Orphan', { 'other.txt': lines('other') });
    const wrapper = await load();
    assert.equal(await wrapper.detectSource(FEATURE), null);
    const summary = await wrapper.getBranchSummary(FEATURE, MAIN);
    assert.equal(summary.forkPoint, null);
    assert.equal(summary.base, null);
    assert.deepEqual(summary.commits, []);
    assert.equal(summary.mergeCheck, null);
    assert.equal(summary.ahead, 1);
    assert.equal(summary.behind, 1);
  });

  it('lists the files that conflict with the source', async () => {
    await repo.commit('A', { 'engine.txt': lines('analytical'), 'mill.txt': lines('store') });
    await repo.git('checkout', '--quiet', '-b', 'feature');
    await repo.commit('C', { 'engine.txt': lines('difference'), 'mill.txt': lines('store', 'column'), 'cards.txt': lines('punched') });
    await repo.git('checkout', '--quiet', 'main');
    await repo.commit('B', { 'engine.txt': lines('analytical engine'), 'cards.txt': lines('blank') });
    const wrapper = await load();
    const summary = await wrapper.getBranchSummary(FEATURE, MAIN);
    assert.deepEqual(summary.mergeCheck, { clean: false, conflicts: ['cards.txt', 'engine.txt'] });
    // Nothing is touched
    assert.equal(await repo.status(), '');
  });

  it('counts the commits of each author and the removed lines', async () => {
    await repo.commit('A', { 'engine.txt': lines('analytical', 'engine', 'mill') });
    await repo.git('checkout', '--quiet', '-b', 'feature');
    await repo.commit('C', { 'engine.txt': lines('analytical', 'engine') });
    repo.write('engine.txt', lines('difference engine'));
    await repo.git('commit', '--quiet', '--all', '--author=Grace Hopper <grace@example.com>', '-m', 'D');
    repo.write('cards.txt', lines('punched'));
    await repo.git('add', 'cards.txt');
    await repo.git('commit', '--quiet', '--author=Grace Hopper <grace@example.com>', '-m', 'E');
    const wrapper = await load();
    const summary = await wrapper.getBranchSummary(FEATURE, MAIN);
    assert.deepEqual(summary.authors.map((author) => [author.name, author.commits]), [['Grace Hopper', 2], ['Config User', 1]]);
    assert.deepEqual(summary.changes, [change('cards.txt', 1, 0), change('engine.txt', 1, 3)]);
    assert.equal(summary.added, 2);
    assert.equal(summary.removed, 3);
  });

  it('detects the closest main branch, a local one before its remote', async () => {
    await repo.commit('A');
    await repo.git('branch', 'develop');
    await repo.git('checkout', '--quiet', 'develop');
    await repo.commit('Dev 1');
    await repo.git('checkout', '--quiet', '-b', 'feature');
    await repo.commit('C');
    // origin/develop is at the same commit as develop
    await repo.git('update-ref', 'refs/remotes/origin/develop', 'develop');
    await repo.git('checkout', '--quiet', 'main');
    await repo.commit('B');
    const wrapper = await load();
    // feature has 1 commit since develop and 2 since main
    assert.equal(await wrapper.detectSource(FEATURE), DEVELOP);
    // main has no main branch other than develop to come from
    assert.equal(await wrapper.detectSource(MAIN), DEVELOP);
    await repo.git('branch', '-D', 'develop');
    await wrapper.requestUpdateCommits();
    assert.equal(await wrapper.detectSource(FEATURE), 'refs/remotes/origin/develop');
  });

  it('returns an empty summary without a source', async () => {
    await repo.commit('A');
    await repo.git('branch', 'feature');
    const wrapper: RepoWrapper = await load();
    assert.equal(await wrapper.detectSource(MAIN), null);
    const summary = await wrapper.getBranchSummary(FEATURE, null);
    assert.equal(summary.source, null);
    assert.equal(summary.forkPoint, null);
    assert.deepEqual(summary.commits, []);
  });
});
