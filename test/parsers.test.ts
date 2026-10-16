import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { parseCommits, parseDiffSummary, parseHunks, parseReferences } from '../src/renderer/helpers/git/parsers';
import { PatchStatus } from '../src/renderer/helpers/git/model';

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);
const SHA_C = 'c'.repeat(40);
const ZERO = '0'.repeat(40);

describe('parseReferences', () => {
  it('parses branches, remote branches and lightweight tags', () => {
    const output = [
      `refs/heads/main\0${SHA_A}\0commit\0\0\0`,
      `refs/remotes/origin/main\0${SHA_B}\0commit\0\0\0`,
      `refs/tags/v1\0${SHA_C}\0commit\0\0\0`,
      ''
    ].join('\n');
    const references = parseReferences(output);
    assert.deepEqual(references.map((r) => [r.name(), r.shorthand(), r.commitId]), [
      ['refs/heads/main', 'main', SHA_A],
      ['refs/remotes/origin/main', 'origin/main', SHA_B],
      ['refs/tags/v1', 'v1', SHA_C]
    ]);
    assert.equal(references[0].isBranch(), true);
    assert.equal(references[1].isRemote(), true);
    assert.equal(references[2].isTag(), true);
  });

  it('peels annotated tags to their commit', () => {
    const [tag] = parseReferences(`refs/tags/v2\0${SHA_A}\0tag\0${SHA_B}\0commit\0\n`);
    assert.equal(tag.targetId, SHA_A);
    assert.equal(tag.commitId, SHA_B);
  });

  it('skips symbolic references and tags of other objects', () => {
    const output = [
      `refs/remotes/origin/HEAD\0${SHA_A}\0commit\0\0\0refs/remotes/origin/main`,
      `refs/tags/tree-tag\0${SHA_B}\0tag\0${SHA_C}\0tree\0`
    ].join('\n');
    assert.deepEqual(parseReferences(output), []);
  });
});

describe('parseCommits', () => {
  it('parses the fields of each commit', () => {
    const record = (sha: string, parents: string, message: string) =>
      [sha, parents, 'Ada', 'ada@example.com', '1700000000', 'Bob', 'bob@example.com', '1700000060', message].join('\0') + '\0';
    const output = record(SHA_A, `${SHA_B} ${SHA_C}`, 'Merge\n\nDetails\n') + record(SHA_B, '', 'Root\n');
    const [merge, root] = parseCommits(output);
    assert.equal(merge.sha(), SHA_A);
    assert.deepEqual(merge.parentIds, [SHA_B, SHA_C]);
    assert.equal(merge.author().name, 'Ada');
    assert.equal(merge.committer().email, 'bob@example.com');
    assert.equal(merge.author().date.valueOf(), 1700000000 * 1000);
    assert.equal(merge.date().valueOf(), 1700000060 * 1000);
    assert.equal(merge.summary(), 'Merge');
    assert.equal(merge.body(), 'Details');
    assert.deepEqual(root.parentIds, []);
    assert.equal(root.body(), '');
  });

  it('returns no commit for an empty output', () => {
    assert.deepEqual(parseCommits(''), []);
  });

  it('squashes a multi-line summary like libgit2', () => {
    const [commit] = parseCommits([SHA_A, '', 'a', 'a@b', '1', 'a', 'a@b', '1', 'First line\nsecond line\n\nBody'].join('\0') + '\0');
    assert.equal(commit.summary(), 'First line second line');
  });
});

describe('parseDiffSummary', () => {
  it('parses modifications, additions, deletions and renames', () => {
    const output = [
      `:100644 100644 ${SHA_A} ${SHA_B} M`, 'modified.txt',
      `:000000 100644 ${ZERO} ${SHA_C} A`, 'added.txt',
      `:100644 000000 ${SHA_A} ${ZERO} D`, 'deleted.txt',
      `:100644 100755 ${SHA_A} ${SHA_B} R087`, 'old name.txt', 'new name.txt',
      '1\t1\tmodified.txt',
      '3\t0\tadded.txt',
      '0\t2\tdeleted.txt',
      '1\t0\t', 'old name.txt', 'new name.txt',
      ''
    ].join('\0');
    const entries = parseDiffSummary(output);
    assert.deepEqual(entries.map((e) => [e.status, e.oldPath, e.newPath]), [
      [PatchStatus.Modified, 'modified.txt', 'modified.txt'],
      [PatchStatus.Added, 'added.txt', 'added.txt'],
      [PatchStatus.Deleted, 'deleted.txt', 'deleted.txt'],
      [PatchStatus.Renamed, 'old name.txt', 'new name.txt']
    ]);
    assert.equal(entries[1].oldId, null);
    assert.equal(entries[1].newId, SHA_C);
    assert.equal(entries[3].newMode, '100755');
    assert.equal(entries.some((e) => e.binary), false);
  });

  it('detects binary files from numstat', () => {
    const output = [`:100644 100644 ${SHA_A} ${SHA_B} M`, 'image.png', '-\t-\timage.png', ''].join('\0');
    assert.equal(parseDiffSummary(output)[0].binary, true);
  });

  it('keeps only the conflict for unmerged paths', () => {
    const output = [
      `:000000 000000 ${ZERO} ${ZERO} U`, 'conflict.txt',
      `:100644 100644 ${SHA_A} ${ZERO} M`, 'conflict.txt',
      `:100644 100644 ${SHA_A} ${ZERO} M`, 'other.txt',
      ''
    ].join('\0');
    assert.deepEqual(parseDiffSummary(output).map((e) => [e.status, e.newPath]), [
      [PatchStatus.Conflicted, 'conflict.txt'],
      [PatchStatus.Modified, 'other.txt']
    ]);
  });

  it('supports paths with newlines and tabs', () => {
    const output = [`:100644 100644 ${SHA_A} ${SHA_B} M`, 'a\nb\tc', '1\t1\ta\nb\tc', ''].join('\0');
    assert.equal(parseDiffSummary(output)[0].newPath, 'a\nb\tc');
  });
});

describe('parseHunks', () => {
  it('parses hunks and line numbers', () => {
    const diff = [
      'diff --git a/file.txt b/file.txt',
      'index 1111111..2222222 100644',
      '--- a/file.txt',
      '+++ b/file.txt',
      '@@ -1,3 +1,3 @@ context',
      ' one',
      '-two',
      '+TWO',
      ' three',
      '@@ -10 +10,2 @@',
      ' ten',
      '+eleven',
      ''
    ].join('\n');
    const hunks = parseHunks(diff);
    assert.equal(hunks.length, 2);
    assert.deepEqual([hunks[0].oldStart, hunks[0].oldLines, hunks[0].newStart, hunks[0].newLines], [1, 3, 1, 3]);
    assert.deepEqual(hunks[0].lines.map((l) => [l.origin, l.content, l.oldLineno, l.newLineno]), [
      [' ', 'one', 1, 1],
      ['-', 'two', 2, -1],
      ['+', 'TWO', -1, 2],
      [' ', 'three', 3, 3]
    ]);
    // Omitted counts are 1
    assert.deepEqual([hunks[1].oldStart, hunks[1].oldLines, hunks[1].newStart, hunks[1].newLines], [10, 1, 10, 2]);
    assert.deepEqual(hunks[1].lines.map((l) => [l.origin, l.oldLineno, l.newLineno]), [[' ', 10, 10], ['+', -1, 11]]);
  });

  it('flags lines without a final newline', () => {
    const diff = ['@@ -1 +1 @@', '-old', '\\ No newline at end of file', '+new', '\\ No newline at end of file', ''].join('\n');
    const [hunk] = parseHunks(diff);
    assert.deepEqual(hunk.lines.map((l) => [l.origin, l.noNewline]), [['-', true], ['+', true]]);
  });

  it('keeps lines that look like diff headers inside a hunk', () => {
    const diff = ['@@ -1 +1 @@', '---- a/file', '++++ b/file', ''].join('\n');
    const [hunk] = parseHunks(diff);
    assert.deepEqual(hunk.lines.map((l) => [l.origin, l.content]), [['-', '--- a/file'], ['+', '+++ b/file']]);
  });

  it('returns no hunk for binary files', () => {
    assert.deepEqual(parseHunks('diff --git a/x b/x\nBinary files a/x and b/x differ\n'), []);
  });
});
