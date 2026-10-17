import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as Path from 'path';
import {
  DEFAULT_FILTERS, DEFAULT_GRAPH_VIEW, GraphFilters, GraphMode, findMatches, hasActiveFilters, isBadgeShown, isFilterOn,
  isReferenceShown, loadGraphView, matchesCommitQuery, parseCommitQuery, sanitizeFilters, saveGraphView, showsStashes
} from '../src/renderer/helpers/graph-filters';
import { Commit, Reference } from '../src/renderer/helpers/git/model';
import { RepoWrapper } from '../src/renderer/helpers/repo-wrapper';
import { Field, Settings } from '../src/shared/settings';
import { TestRepo } from './helpers';

const MAIN = new Reference('refs/heads/main', 'a', 'a');
const FEATURE = new Reference('refs/heads/feature', 'b', 'b');
const ORIGIN = new Reference('refs/remotes/origin/main', 'c', 'c');
const TAG = new Reference('refs/tags/v1.0', 'd', 'd');
const NOTES = new Reference('refs/notes/commits', 'e', 'e');
const ALL = [MAIN, FEATURE, ORIGIN, TAG, NOTES];

function filters(values: Partial<GraphFilters>): GraphFilters {
  return { ...DEFAULT_FILTERS, ...values };
}

function shown(values: Partial<GraphFilters>, headName: string | null = MAIN.name()) {
  return ALL.filter((reference) => isReferenceShown(reference, filters(values), headName)).map((reference) => reference.shorthand());
}

function commit(sha: string, message: string, name = 'Ada Lovelace', date = new Date(2024, 2, 10, 12)) {
  const signature = { name, email: `${name.split(' ')[0].toLowerCase()}@example.com`, date };
  return new Commit(sha, [], signature, signature, message);
}

describe('graph filters', () => {
  it('shows every reference by default', () => {
    assert.equal(hasActiveFilters(DEFAULT_FILTERS), false);
    assert.deepEqual(shown({}), ['main', 'feature', 'origin/main', 'v1.0', 'refs/notes/commits']);
    assert.equal(showsStashes(DEFAULT_FILTERS), true);
  });

  it('hides the remote branches, the tags and the stashes', () => {
    assert.deepEqual(shown({ hideRemotes: true }), ['main', 'feature', 'v1.0', 'refs/notes/commits']);
    assert.deepEqual(shown({ hideTags: true }), ['main', 'feature', 'origin/main', 'refs/notes/commits']);
    assert.deepEqual(shown({ hideRemotes: true, hideTags: true }), ['main', 'feature', 'refs/notes/commits']);
    assert.equal(showsStashes(filters({ hideStashes: true })), false);
    assert.equal(hasActiveFilters(filters({ hideStashes: true })), true);
  });

  it('keeps only the local branches, or only the current one', () => {
    assert.deepEqual(shown({ localOnly: true }), ['main', 'feature']);
    assert.deepEqual(shown({ currentBranchOnly: true }), ['main']);
    assert.deepEqual(shown({ currentBranchOnly: true }, FEATURE.name()), ['feature']);
    // A detached head has no branch, only its own history is loaded
    assert.deepEqual(shown({ currentBranchOnly: true }, null), []);
    assert.equal(showsStashes(filters({ currentBranchOnly: true })), false);
  });

  it('tells which filters the broader ones turn on', () => {
    const local = filters({ localOnly: true });
    assert.equal(isFilterOn(local, 'hideRemotes'), true);
    assert.equal(isFilterOn(local, 'hideTags'), true);
    assert.equal(isFilterOn(local, 'hideStashes'), false);
    assert.equal(isFilterOn(local, 'currentBranchOnly'), false);
    assert.equal(isFilterOn(filters({ currentBranchOnly: true }), 'localOnly'), true);
  });

  it('keeps the badges of the other local branches of the current branch', () => {
    const current = filters({ currentBranchOnly: true });
    assert.equal(isBadgeShown(FEATURE, current), true);
    assert.equal(isBadgeShown(ORIGIN, current), false);
    assert.equal(isBadgeShown(TAG, filters({ hideTags: true })), false);
    assert.equal(isBadgeShown(ORIGIN, filters({ hideTags: true })), true);
  });

  it('ignores invalid values', () => {
    assert.deepEqual(sanitizeFilters(null), DEFAULT_FILTERS);
    assert.deepEqual(sanitizeFilters({ hideTags: true, hideRemotes: 'yes', unknown: true }), filters({ hideTags: true }));
  });
});

describe('commit queries', () => {
  const parser = commit('1234abcd', 'Write the parser\n\nIt reads the cards');
  const notes = commit('9876fedc', 'Add the notes', 'Charles Babbage', new Date(2024, 0, 31, 23));

  it('searches nothing for an empty text', () => {
    assert.equal(parseCommitQuery(''), null);
    assert.equal(parseCommitQuery('   '), null);
    assert.equal(findMatches([parser, notes], null), null);
  });

  it('matches every word in the message, the author or the SHA, ignoring the case', () => {
    assert.equal(matchesCommitQuery(parser, parseCommitQuery('PARSER')!), true);
    assert.equal(matchesCommitQuery(parser, parseCommitQuery('cards')!), true);
    assert.equal(matchesCommitQuery(parser, parseCommitQuery('ada parser')!), true);
    assert.equal(matchesCommitQuery(parser, parseCommitQuery('babbage parser')!), false);
    assert.equal(matchesCommitQuery(notes, parseCommitQuery('charles@example')!), true);
    assert.equal(matchesCommitQuery(notes, parseCommitQuery('9876')!), true);
    assert.deepEqual(findMatches([parser, notes], parseCommitQuery('the')), new Set(['1234abcd', '9876fedc']));
  });

  it('filters the dates of the authors, by day or by month', () => {
    const query = parseCommitQuery('after:2024-02')!;
    assert.deepEqual(query.terms, []);
    assert.deepEqual(query.after, new Date(2024, 1, 1));
    assert.equal(matchesCommitQuery(parser, query), true);
    assert.equal(matchesCommitQuery(notes, query), false);
    // The last day is included
    assert.equal(matchesCommitQuery(notes, parseCommitQuery('before:2024-01-31')!), true);
    assert.equal(matchesCommitQuery(notes, parseCommitQuery('until:2024-01')!), true);
    assert.equal(matchesCommitQuery(parser, parseCommitQuery('since:2024-01-01 before:2024-03-09')!), false);
    // Not a date, it is searched as text
    assert.deepEqual(parseCommitQuery('after:tomorrow')!.terms, ['after:tomorrow']);
  });
});

describe('graph view persistence', () => {
  const dir = fs.mkdtempSync(Path.join(os.tmpdir(), 'gitadmin-settings-'));
  const path = Path.join(dir, 'Settings');

  beforeEach(() => {
    Settings.setPath(path);
  });

  afterEach(() => {
    fs.rmSync(path, { force: true });
  });

  it('remembers the view of each repository', () => {
    assert.deepEqual(loadGraphView('/repos/engine'), DEFAULT_GRAPH_VIEW);
    const view = { mode: GraphMode.Canvas, filters: filters({ hideTags: true }), minimap: false };
    saveGraphView('/repos/engine', view);
    saveGraphView('/repos/mill', { ...DEFAULT_GRAPH_VIEW, filters: filters({ localOnly: true }) });
    assert.deepEqual(loadGraphView('/repos/engine'), view);
    assert.deepEqual(loadGraphView('/repos/mill').filters, filters({ localOnly: true }));
    // The default view is not stored
    saveGraphView('/repos/engine', DEFAULT_GRAPH_VIEW);
    assert.deepEqual(Object.keys(Settings.get(Field.GraphView)), ['/repos/mill']);
  });

  it('ignores invalid values', () => {
    Settings.set(Field.GraphView, { '/repos/engine': { mode: 'tree', filters: 'all', minimap: 1 }, '/repos/mill': 3 });
    assert.deepEqual(loadGraphView('/repos/engine'), DEFAULT_GRAPH_VIEW);
    assert.deepEqual(loadGraphView('/repos/mill'), DEFAULT_GRAPH_VIEW);
    Settings.set(Field.GraphView, ['engine']);
    assert.deepEqual(loadGraphView('/repos/engine'), DEFAULT_GRAPH_VIEW);
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

  function summaries(wrapper: RepoWrapper) {
    return wrapper.commits.filter((commit) => !wrapper.stashes.has(commit.sha())).map((commit) => commit.summary()).sort();
  }

  function stashCount(wrapper: RepoWrapper) {
    return wrapper.commits.filter((commit) => wrapper.stashes.has(commit.sha())).length;
  }

  // main: A - B, feature: A - F, a tag on T (A - T) and a remote branch on R (A - R), a stash on main
  async function createHistory() {
    await repo.commit('A', { 'file.txt': 'a\n' });
    for (const name of ['feature', 'tagged', 'remote']) {
      await repo.git('checkout', '--quiet', '-b', name, 'main');
      await repo.commit(name === 'feature' ? 'F' : name === 'tagged' ? 'T' : 'R', { [`${name}.txt`]: 'x\n' });
    }
    await repo.git('tag', 'v1.0', 'tagged');
    await repo.git('update-ref', 'refs/remotes/origin/remote', 'remote');
    await repo.git('checkout', '--quiet', 'main');
    await repo.git('branch', '-D', 'tagged', 'remote');
    await repo.commit('B', { 'file.txt': 'b\n' });
    repo.write('file.txt', 'stashed\n');
    await repo.git('stash', 'push', '--quiet');
  }

  it('loads only the history that the filters leave, and the graph compacts', async () => {
    await createHistory();
    const { wrapper, errors } = repo.wrapper();
    await wrapper.init();
    assert.deepEqual(summaries(wrapper), ['A', 'B', 'F', 'R', 'T']);
    assert.equal(stashCount(wrapper), 1);
    const fullWidth = wrapper.graph.width;

    await wrapper.setFilters(filters({ hideTags: true, hideStashes: true }));
    assert.equal(wrapper.isFiltered(), true);
    assert.deepEqual(summaries(wrapper), ['A', 'B', 'F', 'R']);
    assert.equal(stashCount(wrapper), 0);
    assert.equal(wrapper.isBadgeShown(wrapper.references.get('refs/tags/v1.0')!), false);

    await wrapper.setFilters(filters({ localOnly: true }));
    assert.deepEqual(summaries(wrapper), ['A', 'B', 'F']);
    assert.ok(wrapper.graph.width < fullWidth);
    assert.equal(wrapper.graph.positions.size, wrapper.commits.length);

    await wrapper.setFilters(filters({ currentBranchOnly: true }));
    assert.deepEqual(summaries(wrapper), ['A', 'B']);
    assert.equal(wrapper.graph.width, 1);

    await wrapper.setFilters(DEFAULT_FILTERS);
    assert.equal(wrapper.isFiltered(), false);
    assert.deepEqual(summaries(wrapper), ['A', 'B', 'F', 'R', 'T']);
    assert.equal(stashCount(wrapper), 1);
    assert.deepEqual(errors(), []);
  });

  it('follows the head with the current branch filter and keeps new commits', async () => {
    await createHistory();
    const { wrapper } = repo.wrapper();
    wrapper.filters = filters({ currentBranchOnly: true });
    await wrapper.init();
    assert.deepEqual(summaries(wrapper), ['A', 'B']);
    await repo.commit('C');
    await wrapper.requestUpdateCommits();
    assert.deepEqual(summaries(wrapper), ['A', 'B', 'C']);
    await repo.git('checkout', '--quiet', 'feature');
    await wrapper.requestUpdateCommits();
    assert.deepEqual(summaries(wrapper), ['A', 'F']);
  });

  it('does not apply the filters while references are focused', async () => {
    await createHistory();
    const { wrapper } = repo.wrapper();
    wrapper.filters = filters({ hideTags: true });
    wrapper.focus = ['refs/tags/v1.0'];
    await wrapper.init();
    assert.deepEqual(summaries(wrapper), ['A', 'T']);
    assert.equal(wrapper.isFiltered(), false);
    assert.equal(wrapper.isBadgeShown(wrapper.references.get('refs/tags/v1.0')!), true);
  });
});
