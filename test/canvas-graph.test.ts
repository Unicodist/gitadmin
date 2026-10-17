import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  MAX_ZOOM, MIN_ZOOM, centerOn, clampViewport, fitBounds, getVisibleRows, getWheelZoom, isVisible, panBy, toScreen, toWorld,
  zoomAt
} from '../src/renderer/helpers/viewport';
import {
  STASH_KEY, computeBranchKeys, computeLaneLabels, getBranchKey, getInitials, getKeyColor, getMergedBranchName, getPinnedLabels
} from '../src/renderer/helpers/canvas-layout';
import { BRANCH_COLORS } from '../src/renderer/helpers/commit-graph';
import { Commit, Reference } from '../src/renderer/helpers/git/model';
import { TestRepo } from './helpers';

function close(actual: number, expected: number) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} is not ${expected}`);
}

describe('viewport', () => {
  it('converts between the screen and the graph', () => {
    const viewport = { x: 100, y: 50, zoom: 2 };
    assert.deepEqual(toScreen(viewport, 110, 60), [20, 20]);
    assert.deepEqual(toWorld(viewport, 20, 20), [110, 60]);
    assert.deepEqual(panBy(viewport, 20, -10), { x: 90, y: 55, zoom: 2 });
  });

  it('zooms around the pointer, within the limits', () => {
    const viewport = { x: 0, y: 0, zoom: 1 };
    const zoomed = zoomAt(viewport, 2, 100, 40);
    assert.equal(zoomed.zoom, 2);
    // The point under the pointer stays there
    const [x, y] = toScreen(zoomed, 100, 40);
    close(x, 100);
    close(y, 40);
    assert.equal(zoomAt(viewport, 100, 0, 0).zoom, MAX_ZOOM);
    assert.equal(zoomAt(viewport, 0, 0, 0).zoom, MIN_ZOOM);
    // A pinch zooms in, a scroll down zooms out
    assert.ok(getWheelZoom(1, -50, 0) > 1);
    assert.ok(getWheelZoom(1, 3, 1) < 1);
  });

  it('centers on a point and tells whether it is visible', () => {
    const viewport = centerOn({ x: 0, y: 0, zoom: 0.5 }, 1000, 2000, 400, 300);
    assert.deepEqual(toScreen(viewport, 1000, 2000), [200, 150]);
    assert.equal(isVisible(viewport, 1000, 2000, 400, 300, 20), true);
    assert.equal(isVisible(viewport, 0, 0, 400, 300), false);
  });

  it('fits a small graph in the middle and the top of a big one', () => {
    const small = fitBounds({ x: 0, y: 0, width: 200, height: 100 }, 400, 400, 20);
    // The zoom never goes above 1 to fit
    assert.equal(small.zoom, 1);
    assert.deepEqual(toScreen(small, 100, 50), [200, 200]);
    const tall = fitBounds({ x: 0, y: 0, width: 300, height: 36 * 50000 }, 400, 600, 20);
    assert.equal(tall.zoom, MIN_ZOOM);
    // Too tall even at the smallest zoom: its top is shown, below the padding
    assert.deepEqual(toScreen(tall, 0, 0).map(Math.round), [Math.round((400 - 300 * MIN_ZOOM) / 2), 20]);
  });

  it('keeps part of the graph in sight', () => {
    const bounds = { x: 0, y: 0, width: 500, height: 1000 };
    const lost = clampViewport({ x: 5000, y: -5000, zoom: 1 }, bounds, 400, 300, 50);
    assert.deepEqual(lost, { x: 450, y: -250, zoom: 1 });
    const fine = { x: 10, y: 20, zoom: 1 };
    assert.deepEqual(clampViewport(fine, bounds, 400, 300, 50), fine);
  });

  it('finds the visible rows', () => {
    assert.deepEqual(getVisibleRows({ x: 0, y: 0, zoom: 1 }, 100, 36, 10), [0, 3]);
    assert.deepEqual(getVisibleRows({ x: 0, y: 72, zoom: 0.5 }, 100, 36, 10), [2, 8]);
    assert.deepEqual(getVisibleRows({ x: 0, y: -500, zoom: 1 }, 100, 36, 10), [0, 0]);
    assert.deepEqual(getVisibleRows({ x: 0, y: 1000, zoom: 1 }, 100, 36, 10), [27, 27]);
  });
});

describe('canvas layout', () => {
  it('gives the initials of the authors', () => {
    assert.equal(getInitials('Ada Lovelace'), 'AL');
    assert.equal(getInitials('Augusta Ada King-Noel'), 'AN');
    assert.equal(getInitials('charles'), 'C');
    assert.equal(getInitials('élodie dupont'), 'ÉD');
    assert.equal(getInitials('  '), '?');
  });

  it('reads the branch of the merges', () => {
    assert.equal(getMergedBranchName("Merge branch 'feature/cards'"), 'feature/cards');
    assert.equal(getMergedBranchName("Merge branch 'notes' into main"), 'notes');
    assert.equal(getMergedBranchName("Merge remote-tracking branch 'origin/main'"), 'origin/main');
    assert.equal(getMergedBranchName('Merge pull request #12 from ada/bernoulli'), 'bernoulli');
    assert.equal(getMergedBranchName('Add the notes'), null);
  });

  it('colors a branch and its remote branches alike', () => {
    assert.equal(getBranchKey(new Reference('refs/remotes/origin/main', '', '')), 'main');
    assert.equal(getBranchKey(new Reference('refs/heads/main', '', '')), 'main');
    assert.equal(getBranchKey(new Reference('refs/tags/v1.0', '', '')), 'v1.0');
    assert.equal(getKeyColor('main'), getKeyColor('main'));
    assert.ok(BRANCH_COLORS.includes(getKeyColor('feature')));
  });
});

describe('branches of the commits', () => {
  // Builds a history from the parents of each commit, children first
  function history(graph: [string, string[], string?][]) {
    const signature = { name: 'Ada', email: 'ada@example.com', date: new Date(0) };
    const commits = graph.map(([sha, parents, message]) => new Commit(sha, parents, signature, signature, message || sha));
    const parents = new Map(graph.map(([sha, shaParents]) => [sha, shaParents] as [string, string[]]));
    const children = new Map(graph.map(([sha]) => [sha, [] as string[]]));
    for (const [sha, shaParents] of graph) {
      shaParents.forEach((parent) => children.get(parent)!.push(sha));
    }
    return { commits, parents, children };
  }

  const ref = (name: string, sha: string) => new Reference(name, sha, sha);

  it('gives each commit the branch that reaches it first by first parents', () => {
    // main: a - b - m (merges f2), feature merged: a - f1 - f2, topic: b - t, a stash on b
    const input = {
      ...history([
        ['s', ['b']],
        ['t', ['b']],
        ['m', ['b', 'f2'], "Merge branch 'feature'"],
        ['f2', ['f1']],
        ['f1', ['a']],
        ['b', ['a']],
        ['a', []]
      ]),
      references: [ref('refs/remotes/origin/topic', 't'), ref('refs/heads/main', 'm')],
      headName: 'refs/heads/main',
      stashes: new Set(['s'])
    };
    const keys = computeBranchKeys(input);
    assert.deepEqual(Object.fromEntries(keys), {
      m: 'main', b: 'main', a: 'main', t: 'topic', f2: 'feature', f1: 'feature', s: STASH_KEY
    });
  });

  it('falls back to the SHA of a line that nothing names', () => {
    const keys = computeBranchKeys({
      ...history([['m', ['a', 'x2'], 'Merge the work'], ['x2', ['x1']], ['x1', ['a']], ['a', []]]),
      references: [ref('refs/heads/main', 'm')],
      headName: null,
      stashes: new Set()
    });
    assert.equal(keys.get('x2'), 'x2');
    assert.equal(keys.get('x1'), 'x2');
  });
});

describe('lane labels', () => {
  let repo: TestRepo;

  beforeEach(async () => {
    repo = await TestRepo.create();
  });

  afterEach(() => {
    repo.remove();
  });

  it('follows the lanes of the references and pins the ones whose tip scrolled away', async () => {
    await repo.commit('A');
    await repo.commit('B');
    await repo.git('checkout', '--quiet', '-b', 'feature', 'main~1');
    await repo.commit('F1');
    await repo.commit('F2');
    await repo.git('tag', 'v1.0');
    await repo.git('checkout', '--quiet', 'main');
    const { wrapper } = repo.wrapper();
    await wrapper.init();
    const labels = computeLaneLabels(wrapper.graph.positions, wrapper.parents, wrapper.references.values());
    const row = (summary: string) => wrapper.graph.positions.get(wrapper.commits.find((commit) => commit.summary() === summary)!.sha())!;
    const feature = labels.find((label) => label.names.includes('feature'))!;
    assert.deepEqual(feature.names.sort(), ['feature', 'v1.0']);
    assert.equal(feature.start, row('F2')[0]);
    assert.equal(feature.end, row('F1')[0]);
    const main = labels.find((label) => label.names.includes('main'))!;
    // A shares the lane of main
    assert.equal(main.end, row('A')[0]);
    assert.deepEqual(getPinnedLabels(labels, 0), []);
    assert.deepEqual(getPinnedLabels(labels, row('F1')[0]).map((label) => label.names[0]), [feature.names[0]]);
    assert.deepEqual(getPinnedLabels(labels, row('A')[0]).map((label) => label.lane), [main.lane]);
  });
});
