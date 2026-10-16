import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import * as Path from 'path';
import { getCloneFolderName, getRepoPath, getThemeOptions } from '../src/renderer/helpers/dialogs';
import { DEFAULT_THEME, SYSTEM_THEME } from '../src/shared/theme-manager';

describe('getThemeOptions', () => {
  it('starts with the system setting, then the built-in themes', () => {
    assert.deepEqual(getThemeOptions(['dark', 'light'], DEFAULT_THEME), [
      { value: SYSTEM_THEME, label: 'System' },
      { value: 'light', label: 'Light' },
      { value: 'dark', label: 'Dark' }
    ]);
  });

  it('names the other themes after their files, in alphabetical order', () => {
    const options = getThemeOptions(['Solarized Dark', 'dark', 'light', 'nord'], 'light');
    assert.deepEqual(options.map((option) => option.value), [SYSTEM_THEME, 'light', 'dark', 'nord', 'Solarized Dark']);
    assert.deepEqual(options.map((option) => option.label), ['System', 'Light', 'Dark', 'nord', 'Solarized Dark']);
  });

  it('always has an option for the current setting', () => {
    // Before the themes are listed
    assert.deepEqual(getThemeOptions([], 'dark').map((option) => option.value), [SYSTEM_THEME, 'dark']);
    assert.deepEqual(getThemeOptions([], SYSTEM_THEME).map((option) => option.value), [SYSTEM_THEME]);
    // The file of the theme was removed
    assert.deepEqual(getThemeOptions(['dark', 'light'], 'removed').map((option) => option.value), [SYSTEM_THEME, 'light', 'dark', 'removed']);
  });
});

describe('getCloneFolderName', () => {
  it('takes the name of the repository from its URL', () => {
    assert.equal(getCloneFolderName('https://example.com/ada/analytical-engine.git', Path.posix), 'analytical-engine');
    assert.equal(getCloneFolderName('git@example.com:ada/analytical-engine.git', Path.posix), 'analytical-engine');
    assert.equal(getCloneFolderName('https://example.com/ada/analytical-engine/ ', Path.posix), 'analytical-engine');
    assert.equal(getCloneFolderName('/srv/git/notes', Path.posix), 'notes');
    assert.equal(getCloneFolderName('C:\\repos\\notes.git', Path.win32), 'notes');
  });

  it('returns an empty name without a URL', () => {
    assert.equal(getCloneFolderName('', Path.posix), '');
  });
});

describe('getRepoPath', () => {
  it('joins the location and the name of the folder', () => {
    assert.deepEqual(getRepoPath('/home/ada/projects', 'analytical-engine', Path.posix), {
      location: '/home/ada/projects/',
      name: 'analytical-engine',
      fullPath: '/home/ada/projects/analytical-engine'
    });
    assert.deepEqual(getRepoPath('/home/ada/projects/', 'notes', Path.posix)!.fullPath, '/home/ada/projects/notes');
    assert.deepEqual(getRepoPath('/', 'notes', Path.posix), { location: '/', name: 'notes', fullPath: '/notes' });
    assert.deepEqual(getRepoPath('C:\\Users\\ada', 'notes', Path.win32), {
      location: 'C:\\Users\\ada\\',
      name: 'notes',
      fullPath: 'C:\\Users\\ada\\notes'
    });
  });

  it('returns null until the location and the name are known', () => {
    assert.equal(getRepoPath('', 'notes', Path.posix), null);
    assert.equal(getRepoPath('/home/ada', '', Path.posix), null);
  });
});
