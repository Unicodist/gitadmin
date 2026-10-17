import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { PatchStatus } from '../src/renderer/helpers/git/model';
import { describePatchPath, getPatchStatusDisplay, splitPath } from '../src/renderer/helpers/patch-status';

describe('getPatchStatusDisplay', () => {
  it('gives a letter, a word and a class to each status', () => {
    const displays = Object.values(PatchStatus).map((status) => {
      const display = getPatchStatusDisplay(status);
      return [status, display.letter, display.label, display.className];
    });
    assert.deepEqual(displays, [
      ['A', 'A', 'Added', 'patch-status-added'],
      ['C', 'M', 'Modified', 'patch-status-modified'],
      ['D', 'D', 'Deleted', 'patch-status-deleted'],
      ['M', 'M', 'Modified', 'patch-status-modified'],
      ['R', 'R', 'Renamed', 'patch-status-renamed'],
      ['T', 'M', 'Modified', 'patch-status-modified'],
      ['U', '!', 'Conflicted', 'patch-status-conflicted'],
      ['?', 'U', 'Untracked', 'patch-status-untracked']
    ]);
  });

  it('shows the statuses that it does not know as modifications', () => {
    assert.deepEqual(getPatchStatusDisplay('X' as PatchStatus), getPatchStatusDisplay(PatchStatus.Modified));
  });

  it('uses one letter for each word', () => {
    const displays = Object.values(PatchStatus).map(getPatchStatusDisplay);
    const letters = new Map(displays.map((display) => [display.label, display.letter]));
    assert.equal(new Set(letters.values()).size, letters.size);
  });
});

describe('splitPath', () => {
  it('splits the folder, with its slash, from the name of the file', () => {
    assert.deepEqual(splitPath('src/renderer/app.tsx'), ['src/renderer/', 'app.tsx']);
    assert.deepEqual(splitPath('engine.txt'), ['', 'engine.txt']);
    assert.deepEqual(splitPath('.github/'), ['.github/', '']);
  });
});

describe('describePatchPath', () => {
  it('tells where a renamed or copied file comes from', () => {
    assert.equal(describePatchPath(PatchStatus.Renamed, 'notes.txt', 'docs/notes.md'), 'docs/notes.md, renamed from notes.txt');
    assert.equal(describePatchPath(PatchStatus.Copied, 'a.txt', 'b.txt'), 'b.txt, copied from a.txt');
  });

  it('gives the path of the other files', () => {
    assert.equal(describePatchPath(PatchStatus.Modified, 'engine.txt', 'engine.txt'), 'engine.txt');
    assert.equal(describePatchPath(PatchStatus.Deleted, 'cards.txt', 'cards.txt'), 'cards.txt');
  });
});
