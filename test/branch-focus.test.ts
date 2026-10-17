import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as Path from 'path';
import {
  MAX_FOCUSED_REFERENCES, RelationKind, SHARED, addToFocus, computeFocusLayout, describeComparison, describeFocus,
  describeMissingMergeBase, getRelationLabels, joinNames, loadFocus, pruneFocus, removeFromFocus, renameInFocus, saveFocus,
  toggleFocus
} from '../src/renderer/helpers/branch-focus';
import { createReferenceContextMenu } from '../src/renderer/helpers/reference-context-menu';
import { BRANCH_COLORS, getCommitColor, getBranchColor, isSharedCommit, SHARED_COLOR } from '../src/renderer/helpers/commit-graph';
import { Commit } from '../src/renderer/helpers/git/model';
import { RepoWrapper } from '../src/renderer/helpers/repo-wrapper';
import { Field, Settings } from '../src/shared/settings';
import { TestRepo } from './helpers';

const MAIN = 'refs/heads/main';
const FEATURE = 'refs/heads/feature';
const OTHER = 'refs/heads/other';

describe('focus list', () => {
  it('adds, removes and toggles references without changing the list', () => {
    const focus = [MAIN];
    assert.deepEqual(addToFocus(focus, FEATURE), [MAIN, FEATURE]);
    assert.deepEqual(addToFocus(focus, MAIN), [MAIN]);
    assert.deepEqual(removeFromFocus([MAIN, FEATURE], MAIN), [FEATURE]);
    assert.deepEqual(toggleFocus([MAIN, FEATURE], FEATURE), [MAIN]);
    assert.deepEqual(toggleFocus([MAIN], FEATURE), [MAIN, FEATURE]);
    assert.deepEqual(focus, [MAIN]);
  });

  it('keeps one color per reference', () => {
    assert.equal(MAX_FOCUSED_REFERENCES, BRANCH_COLORS.length);
    const full = Array.from({ length: MAX_FOCUSED_REFERENCES }, (_value, i) => `refs/heads/b${i}`);
    assert.deepEqual(addToFocus(full, FEATURE), full);
    assert.deepEqual(toggleFocus(full, FEATURE), full);
  });

  it('prunes the references that do not exist anymore', () => {
    const focus = [MAIN, FEATURE];
    assert.equal(pruneFocus(focus, new Set([MAIN, FEATURE, OTHER])), focus);
    assert.deepEqual(pruneFocus(focus, new Set([FEATURE])), [FEATURE]);
  });

  it('keeps the place of a renamed reference', () => {
    assert.deepEqual(renameInFocus([MAIN, FEATURE, OTHER], FEATURE, 'refs/heads/topic'), [MAIN, 'refs/heads/topic', OTHER]);
  });

  it('describes the focus and the comparisons', () => {
    assert.equal(describeFocus([MAIN]), 'Showing 1 branch');
    assert.equal(describeFocus([MAIN, FEATURE]), 'Showing 2 branches');
    assert.equal(joinNames(['a']), 'a');
    assert.equal(joinNames(['a', 'b', 'c']), 'a, b and c');
    const compare = (ahead: number, behind: number) =>
      describeComparison({ left: FEATURE, right: 'refs/remotes/origin/main', related: true, ahead, behind });
    assert.equal(compare(0, 0), 'feature and origin/main are at the same commit');
    assert.equal(compare(1, 0), 'feature is 1 commit ahead of origin/main');
    assert.equal(compare(0, 4), 'feature is 4 commits behind origin/main');
    assert.equal(compare(3, 2), 'feature is 3 commits ahead of and 2 behind origin/main');
  });
});

describe('focus persistence', () => {
  const dir = fs.mkdtempSync(Path.join(os.tmpdir(), 'gitadmin-settings-'));
  const path = Path.join(dir, 'Settings');

  beforeEach(() => {
    Settings.setPath(path);
  });

  afterEach(() => {
    fs.rmSync(path, { force: true });
  });

  it('remembers the focus of each repository', () => {
    assert.deepEqual(loadFocus('/repos/engine'), []);
    saveFocus('/repos/engine', [MAIN, FEATURE]);
    saveFocus('/repos/mill', [OTHER]);
    assert.deepEqual(loadFocus('/repos/engine'), [MAIN, FEATURE]);
    assert.deepEqual(loadFocus('/repos/mill'), [OTHER]);
    // An empty focus is not stored
    saveFocus('/repos/engine', []);
    assert.deepEqual(Settings.get(Field.BranchFocus), { '/repos/mill': [OTHER] });
  });

  it('ignores invalid values', () => {
    Settings.set(Field.BranchFocus, { '/repos/engine': [MAIN, 3, null], '/repos/mill': 'main' });
    assert.deepEqual(loadFocus('/repos/engine'), [MAIN]);
    assert.deepEqual(loadFocus('/repos/mill'), []);
    Settings.set(Field.BranchFocus, ['main']);
    assert.deepEqual(loadFocus('/repos/engine'), []);
    saveFocus('/repos/engine', [MAIN]);
    assert.deepEqual(loadFocus('/repos/engine'), [MAIN]);
  });
});

describe('computeFocusLayout', () => {
  // Builds a history from the parents of each commit, the commits are given children first
  function history(graph: [string, string[]][], tips: Record<string, string>) {
    const signature = { name: 'Ada', email: 'ada@example.com', date: new Date(0) };
    const commits = graph.map(([sha, parents]) => new Commit(sha, parents, signature, signature, sha));
    const children = new Map<string, string[]>(graph.map(([sha]) => [sha, []]));
    for (const [sha, parents] of graph) {
      for (const parent of parents) {
        children.get(parent)!.push(sha);
      }
    }
    return { commits, parents: new Map(graph), children, tips: new Map(Object.entries(tips)) };
  }

  // main: a - b - c, feature: b - d - e, other: d - f - g
  const forked = history([
    ['g', ['f']],
    ['f', ['d']],
    ['e', ['d']],
    ['d', ['b']],
    ['c', ['b']],
    ['b', ['a']],
    ['a', []]
  ], { [MAIN]: 'c', [FEATURE]: 'e', [OTHER]: 'g' });

  it('keeps the colors of the lanes for less than two references', () => {
    assert.equal(computeFocusLayout([], forked), null);
    assert.equal(computeFocusLayout([MAIN], forked), null);
    // A reference that does not exist does not count
    assert.equal(computeFocusLayout([MAIN, 'refs/heads/gone'], forked), null);
  });

  it('colors the commits by reference and marks the shared ones', () => {
    const layout = computeFocusLayout([MAIN, FEATURE], forked)!;
    assert.deepEqual(layout.references, [MAIN, FEATURE]);
    assert.equal(layout.owners.get('c'), 0);
    assert.equal(layout.owners.get('d'), 1);
    assert.equal(layout.owners.get('e'), 1);
    assert.equal(layout.owners.get('b'), SHARED);
    assert.equal(layout.owners.get('a'), SHARED);
    // Not in the history of the focused references
    assert.equal(layout.owners.has('g'), false);
    assert.equal(layout.merges.size, 0);
  });

  it('colors the commits that some references share like the smallest of them', () => {
    // d is in feature and in other, it was made on feature
    const layout = computeFocusLayout([OTHER, MAIN, FEATURE], forked)!;
    assert.equal(layout.owners.get('g'), 0);
    assert.equal(layout.owners.get('c'), 1);
    assert.equal(layout.owners.get('d'), 2);
    assert.equal(layout.owners.get('e'), 2);
    assert.equal(layout.owners.get('b'), SHARED);
  });

  it('finds the merges that bring a reference into another', () => {
    // main: a - b - m (merges d without commits of its own), feature: b - d - e (merges c of other)
    const merged = history([
      ['m', ['b', 'd']],
      ['e', ['d', 'c']],
      ['d', ['b']],
      ['c', ['b']],
      ['b', ['a']],
      ['a', []]
    ], { [MAIN]: 'm', [FEATURE]: 'e', [OTHER]: 'c' });
    const layout = computeFocusLayout([MAIN, FEATURE, OTHER], merged)!;
    assert.deepEqual(layout.merges.get('m'), [{ from: 1, into: 0 }]);
    assert.deepEqual(layout.merges.get('e'), [{ from: 2, into: 1 }]);
    // Merges of references that are not focused are not highlighted
    const withoutOther = computeFocusLayout([MAIN, FEATURE], merged)!;
    assert.equal(withoutOther.merges.has('e'), false);
  });
});

describe('getRelationLabels', () => {
  const relations = {
    references: [MAIN, FEATURE, OTHER],
    mergeBase: 'b',
    forkPoints: [{ reference: MAIN, sha: 'b' }, { reference: FEATURE, sha: 'b' }, { reference: OTHER, sha: 'd' }],
    comparisons: []
  };

  it('labels the merge base and the other fork points', () => {
    assert.deepEqual(getRelationLabels('b', relations, null), [
      { kind: RelationKind.MergeBase, text: 'Merge base', description: 'Merge base of main, feature and other' }
    ]);
    assert.deepEqual(getRelationLabels('d', relations, null), [
      { kind: RelationKind.Fork, text: 'other forked', description: 'other forks from this commit' }
    ]);
    assert.deepEqual(getRelationLabels('a', relations, null), []);
    assert.deepEqual(getRelationLabels('b', null, null), []);
  });

  it('labels the merges', () => {
    const layout = {
      references: [MAIN, FEATURE],
      owners: new Map<string, number>(),
      merges: new Map([['m', [{ from: 1, into: 0 }]], ['n', [{ from: 0, into: null }]]])
    };
    assert.deepEqual(getRelationLabels('m', null, layout), [
      { kind: RelationKind.Merge, text: 'feature into main', description: 'Merges feature into main' }
    ]);
    assert.deepEqual(getRelationLabels('n', null, layout), [
      { kind: RelationKind.Merge, text: 'main merged', description: 'Merges main' }
    ]);
  });
});

describe('focused history', () => {
  let repo: TestRepo;

  beforeEach(async () => {
    repo = await TestRepo.create();
  });

  afterEach(() => {
    repo.remove();
  });

  async function load(focus: string[] = []) {
    const result = repo.wrapper();
    result.wrapper.focus = focus;
    await result.wrapper.init();
    return result;
  }

  function summaries(wrapper: RepoWrapper) {
    return wrapper.commits.map((commit) => commit.summary()).sort();
  }

  // Lanes used by the commits and by the index when it is linked to the head
  function usedLanes(wrapper: RepoWrapper) {
    const lanes = new Set(Array.from(wrapper.graph.positions.values(), ([, j]) => j));
    if (wrapper.isHeadInGraph()) {
      lanes.add(0);
    }
    return [...lanes].sort((lhs, rhs) => lhs - rhs);
  }

  function range(n: number) {
    return Array.from({ length: n }, (_value, i) => i);
  }

  // main: A - B - C, feature: B - D - E, other: A - X, and a stash on main
  async function createBranches() {
    await repo.commit('A', { 'file.txt': 'a\n' });
    await repo.git('branch', 'other');
    await repo.commit('B', { 'file.txt': 'b\n' });
    await repo.git('checkout', '--quiet', '-b', 'feature');
    await repo.commit('D', { 'feature.txt': 'd\n' });
    await repo.commit('E', { 'feature.txt': 'e\n' });
    await repo.git('checkout', '--quiet', 'other');
    await repo.commit('X', { 'other.txt': 'x\n' });
    await repo.git('checkout', '--quiet', 'main');
    await repo.commit('C', { 'file.txt': 'c\n' });
    repo.write('file.txt', 'stashed\n');
    await repo.git('stash', 'push', '--quiet');
  }

  it('loads only the history of the focused references', async () => {
    await createBranches();
    const { wrapper, errors } = await load([MAIN, FEATURE]);
    assert.deepEqual(summaries(wrapper), ['A', 'B', 'C', 'D', 'E']);
    assert.equal(wrapper.graph.positions.size, 5);
    // The stash and the other references are still known, for the reference explorer
    assert.equal(wrapper.stashes.size, 1);
    assert.equal(wrapper.isHidden(wrapper.references.get(OTHER)!), true);
    assert.equal(wrapper.isHidden(wrapper.references.get(FEATURE)!), false);
    assert.equal(wrapper.getReferenceCommit(wrapper.references.get(OTHER)!), undefined);
    assert.deepEqual(errors(), []);
  });

  it('shows everything again without a focus', async () => {
    await createBranches();
    const { wrapper } = await load([FEATURE]);
    assert.deepEqual(summaries(wrapper), ['A', 'B', 'D', 'E']);
    await wrapper.setFocus([]);
    assert.equal(wrapper.isFocused(), false);
    assert.equal(wrapper.commits.length, 7);
    assert.ok(summaries(wrapper).includes('X'));
    assert.ok(wrapper.commits.some((commit) => wrapper.stashes.has(commit.sha())));
    assert.equal(wrapper.graph.positions.size, 7);
    assert.equal(wrapper.relations, null);
    assert.equal(wrapper.focusLayout, null);
    await wrapper.setFocus([OTHER, MAIN]);
    assert.deepEqual(summaries(wrapper), ['A', 'B', 'C', 'X']);
    assert.deepEqual(wrapper.focus, [OTHER, MAIN]);
  });

  it('keeps the commit of a head that the focus hides', async () => {
    await createBranches();
    const { wrapper } = await load([FEATURE, OTHER]);
    assert.equal(wrapper.head!.name(), MAIN);
    assert.equal(wrapper.headCommit!.summary(), 'C');
    assert.equal(wrapper.isHeadInGraph(), false);
    assert.equal(wrapper.graph.positions.has(wrapper.headCommit!.sha()), false);
  });

  it('assigns the lanes of the focused history without gaps', async () => {
    await createBranches();
    for (const name of ['one', 'two', 'three']) {
      await repo.git('checkout', '--quiet', '-b', name, 'main~1');
      await repo.commit(`On ${name}`);
    }
    await repo.git('checkout', '--quiet', 'main');
    const { wrapper } = await load();
    const fullWidth = wrapper.graph.width;
    for (const focus of [[MAIN, FEATURE], [FEATURE, OTHER], [OTHER], ['refs/heads/three', OTHER]]) {
      await wrapper.setFocus(focus);
      assert.deepEqual(usedLanes(wrapper), range(wrapper.graph.width), focus.join(', '));
      assert.ok(wrapper.graph.width < fullWidth);
      // Rows follow the order of the commits, the index takes the first row
      for (const [i, commit] of wrapper.commits.entries()) {
        assert.equal(wrapper.graph.positions.get(commit.sha())![0], i + 1);
      }
    }
    // The head is in the graph: the first lane leads to the index
    await wrapper.setFocus([MAIN, FEATURE]);
    assert.equal(wrapper.isHeadInGraph(), true);
    assert.equal(wrapper.graph.positions.get(wrapper.headCommit!.sha())![1], 0);
  });

  it('finds the merge base, the fork points and the commits ahead and behind', async () => {
    await createBranches();
    await repo.git('checkout', '--quiet', '-b', 'topic', 'feature~1');
    await repo.commit('T');
    await repo.git('checkout', '--quiet', 'main');
    const { wrapper } = await load([MAIN, FEATURE, 'refs/heads/topic']);
    const relations = wrapper.relations!;
    assert.equal(relations.mergeBase, await repo.sha('main~1'));
    assert.deepEqual(relations.forkPoints, [
      { reference: MAIN, sha: await repo.sha('main~1') },
      { reference: FEATURE, sha: await repo.sha('feature~1') },
      { reference: 'refs/heads/topic', sha: await repo.sha('feature~1') }
    ]);
    assert.deepEqual(relations.comparisons, [
      { left: MAIN, right: FEATURE, related: true, ahead: 1, behind: 2 },
      { left: MAIN, right: 'refs/heads/topic', related: true, ahead: 1, behind: 2 },
      { left: FEATURE, right: 'refs/heads/topic', related: true, ahead: 1, behind: 1 }
    ]);
    // D is where feature and topic split
    const labels = getRelationLabels(await repo.sha('feature~1'), relations, wrapper.focusLayout);
    assert.deepEqual(labels.map((label) => label.text), ['feature, topic forked']);
  });

  it('does not fork a reference that the others contain', async () => {
    await repo.commit('A');
    await repo.git('branch', 'old');
    await repo.commit('B');
    const { wrapper } = await load([MAIN, 'refs/heads/old']);
    const relations = wrapper.relations!;
    assert.equal(relations.mergeBase, await repo.sha('old'));
    assert.deepEqual(relations.forkPoints, [{ reference: MAIN, sha: await repo.sha('old') }]);
    assert.deepEqual(relations.comparisons, [{ left: MAIN, right: 'refs/heads/old', related: true, ahead: 1, behind: 0 }]);
  });

  it('compares references without common history', async () => {
    await repo.commit('A');
    await repo.commit('B');
    await repo.git('checkout', '--quiet', '--orphan', 'lonely');
    await repo.commit('L');
    await repo.git('checkout', '--quiet', 'main');
    const { wrapper, errors } = await load([MAIN, 'refs/heads/lonely']);
    const relations = wrapper.relations!;
    assert.equal(relations.mergeBase, null);
    assert.deepEqual(relations.forkPoints, []);
    assert.deepEqual(relations.comparisons, [{ left: MAIN, right: 'refs/heads/lonely', related: false, ahead: 2, behind: 1 }]);
    assert.equal(describeComparison(relations.comparisons[0]), 'main and lonely share no history');
    assert.equal(describeMissingMergeBase(relations), 'No common history');
    // Nothing is shared, so nothing is dimmed
    assert.equal(wrapper.commits.some((commit) => isSharedCommit(wrapper, commit.sha())), false);
    assert.deepEqual(usedLanes(wrapper), range(wrapper.graph.width));
    assert.deepEqual(errors(), []);
  });

  it('tells which references share history when one of them shares none', async () => {
    await createBranches();
    await repo.git('checkout', '--quiet', '--orphan', 'pages');
    await repo.commit('P');
    await repo.git('checkout', '--quiet', 'main');
    const { wrapper } = await load([MAIN, FEATURE, 'refs/heads/pages']);
    const relations = wrapper.relations!;
    assert.equal(relations.mergeBase, null);
    assert.equal(describeMissingMergeBase(relations), 'No base shared by all');
    // main and feature still fork from B
    assert.deepEqual(relations.forkPoints, [
      { reference: MAIN, sha: await repo.sha('main~1') },
      { reference: FEATURE, sha: await repo.sha('main~1') }
    ]);
    assert.deepEqual(relations.comparisons.map((comparison) => describeComparison(comparison)), [
      'main is 1 commit ahead of and 2 behind feature',
      'main and pages share no history',
      'feature and pages share no history'
    ]);
  });

  it('has no relations for a single reference', async () => {
    await createBranches();
    const { wrapper } = await load([FEATURE]);
    assert.equal(wrapper.relations, null);
    assert.equal(wrapper.focusLayout, null);
    // The lanes keep their colors
    const sha = await repo.sha('feature');
    assert.equal(getCommitColor(wrapper, sha), getBranchColor(wrapper.graph.positions.get(sha)![1]));
  });

  it('colors the commits of each focused reference and dims the shared ones', async () => {
    await createBranches();
    await repo.git('merge', '--quiet', '--no-edit', 'other');
    const { wrapper } = await load([MAIN, FEATURE]);
    const color = async (revision: string) => getCommitColor(wrapper, await repo.sha(revision));
    assert.equal(await color('main'), getBranchColor(0));
    assert.equal(await color('feature'), getBranchColor(1));
    assert.equal(await color('main~1~1'), SHARED_COLOR);
    assert.equal(isSharedCommit(wrapper, await repo.sha('main~1~1')), true);
    // other is merged into main but not focused, its commit belongs to main
    assert.equal(await color('other'), getBranchColor(0));
    assert.equal(wrapper.focusLayout!.merges.size, 0);
  });

  it('highlights the merges between focused references', async () => {
    await createBranches();
    await repo.git('merge', '--quiet', '--no-edit', 'feature');
    const merge = await repo.sha('main');
    const { wrapper } = await load([MAIN, FEATURE]);
    assert.deepEqual(wrapper.focusLayout!.merges.get(merge), [{ from: 1, into: 0 }]);
    assert.deepEqual(getRelationLabels(merge, wrapper.relations, wrapper.focusLayout).map((label) => label.description),
      ['Merges feature into main']);
    // feature is in main now
    assert.equal(isSharedCommit(wrapper, await repo.sha('feature')), true);
  });

  it('follows the removed and renamed references', async () => {
    await createBranches();
    const { wrapper } = await load([MAIN, FEATURE]);
    await wrapper.renameReference(wrapper.references.get(FEATURE)!, 'topic');
    await wrapper.requestUpdateCommits();
    assert.deepEqual(wrapper.focus, [MAIN, 'refs/heads/topic']);
    assert.deepEqual(summaries(wrapper), ['A', 'B', 'C', 'D', 'E']);
    await repo.git('branch', '-D', 'topic');
    await wrapper.requestUpdateCommits();
    assert.deepEqual(wrapper.focus, [MAIN]);
    assert.deepEqual(summaries(wrapper), ['A', 'B', 'C']);
    // Without focused references, everything is shown again
    await repo.git('checkout', '--quiet', 'other');
    await repo.git('branch', '-D', 'main');
    await wrapper.requestUpdateCommits();
    assert.deepEqual(wrapper.focus, []);
    assert.deepEqual(summaries(wrapper).filter((summary) => !summary.startsWith('WIP')), ['A', 'B', 'C', 'X']);
  });

  it('builds the menu of a branch with a detached head', async () => {
    await createBranches();
    await repo.git('checkout', '--quiet', '--detach');
    const { wrapper } = await load();
    assert.equal(wrapper.head, null);
    const summaries: string[] = [];
    const menu = createReferenceContextMenu(wrapper, wrapper.references.get(FEATURE)!, false, () => undefined, [MAIN], () => undefined,
      (branch) => summaries.push(branch));
    const labels = menu.template.map((item) => item.label).filter((label) => label !== undefined);
    assert.ok(labels.includes('Merge feature'));
    assert.ok(labels.includes('Focus on feature'));
    assert.ok(labels.includes('Add feature to the focus'));
    assert.equal(menu.template.find((item) => item.label === 'Merge feature')!.enabled, false);
    // The summary opens with the full name of the branch
    menu.template.find((item) => item.label === 'See branch summary')!.click!();
    assert.deepEqual(summaries, [FEATURE]);
  });

  it('offers the summary of the branches but not of the tags', async () => {
    await createBranches();
    await repo.git('tag', 'v1.0', 'main');
    const { wrapper } = await load();
    const labels = (name: string) => createReferenceContextMenu(wrapper, wrapper.references.get(name)!, false, () => undefined, [],
      () => undefined, () => undefined).template.map((item) => item.label);
    assert.ok(labels(MAIN).includes('See branch summary'));
    assert.ok(!labels('refs/tags/v1.0').includes('See branch summary'));
  });

  it('loads the new commits of the focused references only', async () => {
    await createBranches();
    const { wrapper } = await load([MAIN]);
    await repo.git('checkout', '--quiet', 'other');
    await repo.commit('Y');
    await repo.git('checkout', '--quiet', 'main');
    await repo.commit('F');
    await wrapper.requestUpdateCommits();
    await wrapper.updateHead();
    wrapper.updateGraph();
    assert.deepEqual(summaries(wrapper), ['A', 'B', 'C', 'F']);
    assert.equal(wrapper.graph.positions.size, 4);
  });
});
