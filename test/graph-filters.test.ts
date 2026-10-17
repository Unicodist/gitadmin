import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as Path from 'path';
import {
  GraphFilters, NO_FILTERS, describeFilters, isFiltering, isLocalOnly, loadFilters, saveFilters, setLocalOnly, showsReference,
  showsStashes, toggleFilter
} from '../src/renderer/helpers/graph-filters';
import { Reference } from '../src/renderer/helpers/git/model';
import { RepoWrapper } from '../src/renderer/helpers/repo-wrapper';
import { Field, Settings } from '../src/shared/settings';
import { TestRepo } from './helpers';

const MAIN = 'refs/heads/main';
const FEATURE = 'refs/heads/feature';
const ORIGIN = 'refs/remotes/origin/old';
const TAG = 'refs/tags/v1.0';

function reference(name: string) {
  return new Reference(name, '0'.repeat(40), '0'.repeat(40));
}

describe('graph filters', () => {
  it('toggles the filters without changing them', () => {
    const filters = toggleFilter(NO_FILTERS, 'hideStashes');
    assert.equal(filters.hideStashes, true);
    assert.equal(NO_FILTERS.hideStashes, false);
    assert.equal(isFiltering(NO_FILTERS), false);
    assert.equal(isFiltering(filters), true);
  });

  it('hides the remote branches and the tags for local only', () => {
    const filters = setLocalOnly(NO_FILTERS, true);
    assert.equal(isLocalOnly(filters), true);
    assert.equal(isLocalOnly(toggleFilter(filters, 'hideTags')), false);
    assert.deepEqual(setLocalOnly(filters, false), NO_FILTERS);
  });

  it('keeps the references and the stashes that the filters do not hide', () => {
    const shown = (filters: GraphFilters, headName: string | null = MAIN) =>
      [MAIN, FEATURE, ORIGIN, TAG].filter((name) => showsReference(filters, reference(name), headName));
    assert.deepEqual(shown(NO_FILTERS), [MAIN, FEATURE, ORIGIN, TAG]);
    assert.deepEqual(shown({ ...NO_FILTERS, hideRemotes: true }), [MAIN, FEATURE, TAG]);
    assert.deepEqual(shown(setLocalOnly(NO_FILTERS, true)), [MAIN, FEATURE]);
    assert.deepEqual(shown({ ...NO_FILTERS, currentBranchOnly: true }), [MAIN]);
    // A detached head is not a reference
    assert.deepEqual(shown({ ...NO_FILTERS, currentBranchOnly: true }, null), []);
    assert.equal(showsStashes(NO_FILTERS), true);
    assert.equal(showsStashes({ ...NO_FILTERS, hideStashes: true }), false);
    assert.equal(showsStashes({ ...NO_FILTERS, currentBranchOnly: true }), false);
  });

  it('describes the filters', () => {
    assert.equal(describeFilters(NO_FILTERS), 'Showing everything');
    assert.equal(describeFilters({ ...NO_FILTERS, hideStashes: true }), 'Hiding stashes');
    assert.equal(describeFilters({ ...setLocalOnly(NO_FILTERS, true), hideStashes: true }), 'Hiding remote branches, tags and stashes');
    assert.equal(describeFilters({ ...NO_FILTERS, currentBranchOnly: true, hideTags: true }), 'Showing the current branch only');
  });
});

describe('filters persistence', () => {
  const dir = fs.mkdtempSync(Path.join(os.tmpdir(), 'gitadmin-settings-'));
  const path = Path.join(dir, 'Settings');

  beforeEach(() => {
    Settings.setPath(path);
  });

  afterEach(() => {
    fs.rmSync(path, { force: true });
  });

  it('remembers the filters of each repository', () => {
    assert.deepEqual(loadFilters('/repos/engine'), NO_FILTERS);
    const localOnly = setLocalOnly(NO_FILTERS, true);
    saveFilters('/repos/engine', localOnly);
    saveFilters('/repos/mill', { ...NO_FILTERS, hideStashes: true });
    assert.deepEqual(loadFilters('/repos/engine'), localOnly);
    assert.deepEqual(loadFilters('/repos/mill'), { ...NO_FILTERS, hideStashes: true });
    // No filter is not stored
    saveFilters('/repos/engine', NO_FILTERS);
    assert.deepEqual(Object.keys(Settings.get(Field.GraphFilters)), ['/repos/mill']);
  });

  it('ignores invalid values', () => {
    Settings.set(Field.GraphFilters, { '/repos/engine': { hideTags: 'yes', hideStashes: true, unknown: true }, '/repos/mill': 3 });
    assert.deepEqual(loadFilters('/repos/engine'), { ...NO_FILTERS, hideStashes: true });
    assert.deepEqual(loadFilters('/repos/mill'), NO_FILTERS);
    Settings.set(Field.GraphFilters, ['main']);
    assert.deepEqual(loadFilters('/repos/engine'), NO_FILTERS);
  });
});

describe('filtered history', () => {
  let repo: TestRepo;

  beforeEach(async () => {
    repo = await TestRepo.create();
  });

  afterEach(() => {
    repo.remove();
  });

  async function load(filters: GraphFilters = NO_FILTERS, focus: string[] = []) {
    const result = repo.wrapper();
    result.wrapper.filters = filters;
    result.wrapper.focus = focus;
    await result.wrapper.init();
    return result;
  }

  function summaries(wrapper: RepoWrapper) {
    return wrapper.commits.map((commit) => commit.summary()).sort();
  }

  // main: A - B - C, feature: B - D, origin/old: A - R, the tag v1.0: A - T, and a stash on main
  async function createReferences() {
    await repo.commit('A', { 'file.txt': 'a\n' });
    for (const [name, summary] of [['remote', 'R'], ['tagged', 'T']]) {
      await repo.git('checkout', '--quiet', '-b', name);
      await repo.commit(summary, { [`${name}.txt`]: `${summary}\n` });
      await repo.git('checkout', '--quiet', 'main');
    }
    await repo.git('update-ref', ORIGIN, 'remote');
    await repo.git('tag', 'v1.0', 'tagged');
    await repo.git('branch', '--quiet', '-D', 'remote', 'tagged');
    await repo.commit('B', { 'file.txt': 'b\n' });
    await repo.git('checkout', '--quiet', '-b', 'feature');
    await repo.commit('D', { 'feature.txt': 'd\n' });
    await repo.git('checkout', '--quiet', 'main');
    await repo.commit('C', { 'file.txt': 'c\n' });
    repo.write('file.txt', 'stashed\n');
    await repo.git('stash', 'push', '--quiet');
  }

  function hasStash(wrapper: RepoWrapper) {
    return wrapper.commits.some((commit) => wrapper.stashes.has(commit.sha()));
  }

  it('leaves the remote branches, the tags and the stashes out', async () => {
    await createReferences();
    const { wrapper, errors } = await load({ ...setLocalOnly(NO_FILTERS, true), hideStashes: true });
    assert.deepEqual(summaries(wrapper), ['A', 'B', 'C', 'D']);
    assert.equal(hasStash(wrapper), false);
    assert.equal(wrapper.isFiltering(), true);
    assert.equal(wrapper.isHidden(wrapper.references.get(ORIGIN)!), true);
    assert.equal(wrapper.isHidden(wrapper.references.get(TAG)!), true);
    // The stashes are still known, for the reference explorer
    assert.equal(wrapper.stashes.size, 1);
    assert.equal(wrapper.graph.positions.size, 4);
    assert.deepEqual(errors(), []);
  });

  it('hides the badges of the references that the filters leave out', async () => {
    await createReferences();
    await repo.git('tag', 'v0.1', 'main');
    const { wrapper } = await load({ ...NO_FILTERS, hideTags: true });
    const head = wrapper.headCommit!.sha();
    assert.deepEqual(wrapper.shaToReferences.get(head), [MAIN]);
    await wrapper.setFilters(NO_FILTERS);
    assert.deepEqual(wrapper.shaToReferences.get(head)!.sort(), [MAIN, 'refs/tags/v0.1']);
  });

  it('shows the current branch only and follows the head', async () => {
    await createReferences();
    const { wrapper } = await load({ ...NO_FILTERS, currentBranchOnly: true });
    assert.deepEqual(summaries(wrapper), ['A', 'B', 'C']);
    assert.equal(wrapper.isHeadInGraph(), true);
    await repo.git('checkout', '--quiet', 'feature');
    await wrapper.requestUpdateCommits();
    await wrapper.updateHead();
    wrapper.updateGraph();
    assert.deepEqual(summaries(wrapper), ['A', 'B', 'D']);
    assert.equal(wrapper.isHeadInGraph(), true);
  });

  it('shows everything again and waits while the graph is focused', async () => {
    await createReferences();
    const { wrapper } = await load({ ...NO_FILTERS, hideRemotes: true });
    assert.ok(!summaries(wrapper).includes('R'));
    await wrapper.setFilters(NO_FILTERS);
    assert.deepEqual(summaries(wrapper).slice(0, 6), ['A', 'B', 'C', 'D', 'R', 'T']);
    assert.equal(wrapper.commits.length, 7);
    assert.equal(hasStash(wrapper), true);
    assert.equal(wrapper.isFiltering(), false);
    // The focus chooses the references by itself
    await wrapper.setFilters({ ...NO_FILTERS, currentBranchOnly: true });
    await wrapper.setFocus([ORIGIN, FEATURE]);
    assert.deepEqual(summaries(wrapper), ['A', 'B', 'D', 'R']);
    assert.equal(wrapper.isFiltering(), false);
    await wrapper.setFocus([]);
    assert.deepEqual(summaries(wrapper), ['A', 'B', 'C']);
    assert.equal(wrapper.isFiltering(), true);
  });

  it('assigns the lanes of the filtered history without gaps', async () => {
    await createReferences();
    const { wrapper } = await load();
    const fullWidth = wrapper.graph.width;
    await wrapper.setFilters({ ...setLocalOnly(NO_FILTERS, true), hideStashes: true });
    assert.ok(wrapper.graph.width < fullWidth);
    const lanes = new Set(Array.from(wrapper.graph.positions.values(), ([, j]) => j));
    assert.deepEqual([...lanes].sort(), Array.from({ length: wrapper.graph.width }, (_value, i) => i));
    for (const [i, commit] of wrapper.commits.entries()) {
      assert.equal(wrapper.graph.positions.get(commit.sha())![0], i + 1);
    }
  });
});
