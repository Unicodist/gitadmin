import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  describeAutomaticSource, describeCommitCount, describeLineChanges, describeMergeCheck, describeMissingFork, getSummaryKey,
  resolveSavedSource
} from '../src/renderer/helpers/branch-summary-format';

const MAIN = 'refs/heads/main';
const FEATURE = 'refs/heads/feature';
const ORIGIN_MAIN = 'refs/remotes/origin/main';

describe('branch summary texts', () => {
  it('names the detected source in the automatic choice', () => {
    assert.equal(describeAutomaticSource(MAIN), 'Detect automatically (main)');
    assert.equal(describeAutomaticSource(ORIGIN_MAIN), 'Detect automatically (origin/main)');
    assert.equal(describeAutomaticSource(null), 'Detect automatically');
  });

  it('describes the counts', () => {
    assert.equal(describeLineChanges(12, 3), '+12 -3');
    assert.equal(describeLineChanges(0, 0), '+0 -0');
    assert.equal(describeCommitCount(1), '1 commit');
    assert.equal(describeCommitCount(0), '0 commits');
    assert.equal(describeCommitCount(3), '3 commits');
  });

  it('describes the merge check', () => {
    assert.equal(describeMergeCheck({ clean: true, conflicts: [] }, MAIN), 'Merges cleanly into main');
    assert.equal(describeMergeCheck({ clean: false, conflicts: ['a.txt'] }, ORIGIN_MAIN), 'Conflicts with origin/main in 1 file');
    assert.equal(describeMergeCheck({ clean: false, conflicts: ['a.txt', 'b.txt'] }, MAIN), 'Conflicts with main in 2 files');
  });

  it('tells why there is no fork point', () => {
    assert.equal(describeMissingFork(null), 'No source branch found, choose one above');
    assert.equal(describeMissingFork(MAIN), 'main shares no history with this branch');
  });
});

describe('branch summary source', () => {
  it('uses the saved source only while it exists', () => {
    const references = new Set([MAIN, FEATURE]);
    assert.equal(resolveSavedSource(MAIN, references), MAIN);
    assert.equal(resolveSavedSource(ORIGIN_MAIN, references), null);
    assert.equal(resolveSavedSource(null, references), null);
  });

  it('changes its key when the branch or the source moves', () => {
    const references = new Map([[MAIN, { commitId: 'a' }], [FEATURE, { commitId: 'b' }]]);
    const key = getSummaryKey(references, FEATURE, MAIN);
    assert.equal(key, 'b a');
    assert.equal(getSummaryKey(references, FEATURE, null), 'b ');
    references.set(MAIN, { commitId: 'c' });
    assert.notEqual(getSummaryKey(references, FEATURE, MAIN), key);
    // A removed source changes the key too
    references.delete(MAIN);
    assert.equal(getSummaryKey(references, FEATURE, MAIN), 'b ');
  });
});
