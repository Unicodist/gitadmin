import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import { ApplyDirection, buildPartialPatch, quotePath } from '../src/renderer/helpers/git/partial-patch';
import { parseHunks } from '../src/renderer/helpers/git/parsers';
import { DiffLine } from '../src/renderer/helpers/git/model';
import { git } from '../src/renderer/helpers/git/runner';
import { TestRepo, lines } from './helpers';

const DIFF = [
  '@@ -1,4 +1,4 @@',
  ' a',
  '-b',
  '-c',
  '+B',
  '+C',
  ' d',
  ''
].join('\n');

function select(diff: string, predicate: (line: DiffLine) => boolean) {
  const hunks = parseHunks(diff);
  const selected = new Set(hunks.flatMap((hunk) => hunk.lines).filter(predicate));
  return { hunks, selected };
}

describe('quotePath', () => {
  it('leaves regular paths unchanged', () => {
    assert.equal(quotePath('dir/file name.txt'), 'dir/file name.txt');
  });

  it('quotes special characters like git', () => {
    assert.equal(quotePath('a"b\\c\td\n'), '"a\\"b\\\\c\\td\\n"');
  });
});

describe('buildPartialPatch', () => {
  const options = { oldPath: 'file.txt', newPath: 'file.txt' };

  it('returns null when no changed line is selected', () => {
    const { hunks, selected } = select(DIFF, (line) => line.origin === ' ');
    assert.equal(buildPartialPatch(hunks, selected, ApplyDirection.Forward, options), null);
  });

  it('turns unselected removed lines into context when applied forward', () => {
    const { hunks, selected } = select(DIFF, (line) => line.content === 'b' || line.content === 'B');
    const patch = buildPartialPatch(hunks, selected, ApplyDirection.Forward, options);
    assert.equal(patch, [
      'diff --git a/file.txt b/file.txt',
      '--- a/file.txt',
      '+++ b/file.txt',
      '@@ -1,4 +1,4 @@',
      ' a',
      '-b',
      ' c',
      '+B',
      ' d',
      ''
    ].join('\n'));
  });

  it('turns unselected added lines into context when applied in reverse', () => {
    const { hunks, selected } = select(DIFF, (line) => line.content === 'c' || line.content === 'C');
    const patch = buildPartialPatch(hunks, selected, ApplyDirection.Reverse, options);
    assert.equal(patch, [
      'diff --git a/file.txt b/file.txt',
      '--- a/file.txt',
      '+++ b/file.txt',
      '@@ -1,4 +1,4 @@',
      ' a',
      '-c',
      ' B',
      '+C',
      ' d',
      ''
    ].join('\n'));
  });

  it('creates new files with a new file header', () => {
    const { hunks, selected } = select('@@ -0,0 +1,2 @@\n+x\n+y\n', (line) => line.content === 'y');
    const patch = buildPartialPatch(hunks, selected, ApplyDirection.Forward, { ...options, newFileMode: '100644' });
    assert.equal(patch, [
      'diff --git a/file.txt b/file.txt',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/file.txt',
      '@@ -0,0 +1 @@',
      '+y',
      ''
    ].join('\n'));
  });

  it('keeps the missing newline marker', () => {
    const { hunks, selected } = select('@@ -1 +1 @@\n-a\n\\ No newline at end of file\n+b\n', (line) => line.origin !== ' ');
    const patch = buildPartialPatch(hunks, selected, ApplyDirection.Forward, options)!;
    assert.match(patch, /-a\n\\ No newline at end of file\n\+b\n$/);
  });
});

describe('buildPartialPatch with git apply', () => {
  let repo: TestRepo;

  beforeEach(async () => {
    repo = await TestRepo.create();
    await repo.commit('Initial', { 'file.txt': lines('1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12') });
  });

  afterEach(() => repo.remove());

  async function diff(...args: string[]) {
    return parseHunks(await repo.git('diff', '--no-color', '-U3', ...args, '--', 'file.txt'));
  }

  async function apply(patch: string | null, ...args: string[]) {
    assert.notEqual(patch, null);
    await git(['apply', '--recount', ...args, '-'], repo.workdir, { stdin: patch! });
  }

  it('stages a single line out of several hunks', async () => {
    repo.write('file.txt', lines('one', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', 'twelve'));
    const hunks = await diff();
    assert.equal(hunks.length, 2);
    const selected = new Set(hunks[1].lines.filter((line) => line.origin !== ' '));
    await apply(buildPartialPatch(hunks, selected, ApplyDirection.Forward, { oldPath: 'file.txt', newPath: 'file.txt' }), '--cached');
    assert.equal(await repo.staged('file.txt'), lines('1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', 'twelve'));
    assert.equal(repo.read('file.txt'), lines('one', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', 'twelve'));
  });

  it('unstages an added line in a later hunk after lines were added before it', async () => {
    repo.write('file.txt', lines('0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13'));
    await repo.git('add', 'file.txt');
    const hunks = await diff('--cached');
    const selected = new Set(hunks[hunks.length - 1].lines.filter((line) => line.origin === '+'));
    await apply(buildPartialPatch(hunks, selected, ApplyDirection.Reverse, { oldPath: 'file.txt', newPath: 'file.txt' }), '--cached', '--reverse');
    assert.equal(await repo.staged('file.txt'), lines('0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'));
  });

  it('discards a removed line from the working directory', async () => {
    repo.write('file.txt', lines('1', '2', '4', '5', '6', '7', '8', '9', '10', '11'));
    const hunks = await diff();
    const selected = new Set(hunks.flatMap((hunk) => hunk.lines).filter((line) => line.content === '3'));
    await apply(buildPartialPatch(hunks, selected, ApplyDirection.Reverse, { oldPath: 'file.txt', newPath: 'file.txt' }), '--reverse');
    assert.equal(repo.read('file.txt'), lines('1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11'));
  });
});
