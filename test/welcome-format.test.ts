import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import * as Path from 'path';
import { getCommandShortcut, getWorkingDirectory, shortenRepoPath } from '../src/renderer/helpers/welcome-format';

describe('getWorkingDirectory', () => {
  it('returns the folder of a repository', () => {
    assert.equal(getWorkingDirectory('/home/ada/gitadmin', Path.posix), '/home/ada/gitadmin');
    assert.equal(getWorkingDirectory('/home/ada/gitadmin/', Path.posix), '/home/ada/gitadmin');
    assert.equal(getWorkingDirectory('C:\\Users\\ada\\gitadmin', Path.win32), 'C:\\Users\\ada\\gitadmin');
  });

  it('returns the working directory of the .git folders saved by older versions', () => {
    assert.equal(getWorkingDirectory('/home/ada/gitadmin/.git', Path.posix), '/home/ada/gitadmin');
    assert.equal(getWorkingDirectory('/home/ada/gitadmin/.git/', Path.posix), '/home/ada/gitadmin');
    assert.equal(getWorkingDirectory('C:\\Users\\ada\\gitadmin\\.git', Path.win32), 'C:\\Users\\ada\\gitadmin');
  });

  it('keeps a root as it is', () => {
    assert.equal(getWorkingDirectory('/', Path.posix), '/');
    assert.equal(getWorkingDirectory('C:\\', Path.win32), 'C:\\');
  });
});

describe('shortenRepoPath', () => {
  it('replaces the home directory by a tilde', () => {
    assert.deepEqual(shortenRepoPath('/home/ada/projects/gitadmin', '/home/ada', Path.posix), { folder: '~/projects', name: '/gitadmin' });
    assert.deepEqual(shortenRepoPath('/home/ada/gitadmin/.git', '/home/ada', Path.posix), { folder: '~', name: '/gitadmin' });
    assert.deepEqual(shortenRepoPath('/home/ada', '/home/ada', Path.posix), { folder: '', name: '~' });
    assert.deepEqual(shortenRepoPath('C:\\Users\\ada\\code\\gitadmin', 'C:\\Users\\ada', Path.win32), { folder: '~\\code', name: '\\gitadmin' });
  });

  it('keeps the absolute path of the repositories outside of the home directory', () => {
    assert.deepEqual(shortenRepoPath('/tmp/gitadmin', '/home/ada', Path.posix), { folder: '/tmp', name: '/gitadmin' });
    assert.deepEqual(shortenRepoPath('/gitadmin', '/home/ada', Path.posix), { folder: '', name: '/gitadmin' });
    // The home directory of another user starts like the home directory
    assert.deepEqual(shortenRepoPath('/home/adam/gitadmin', '/home/ada', Path.posix), { folder: '/home/adam', name: '/gitadmin' });
    // The path to another drive is not relative
    assert.deepEqual(shortenRepoPath('D:\\code\\gitadmin', 'C:\\Users\\ada', Path.win32), { folder: 'D:\\code', name: '\\gitadmin' });
  });

  it('shortens the folders whose name starts with two dots', () => {
    assert.deepEqual(shortenRepoPath('/home/ada/..notes', '/home/ada', Path.posix), { folder: '~', name: '/..notes' });
  });
});

describe('getCommandShortcut', () => {
  it('uses the command key on macOS', () => {
    assert.deepEqual(getCommandShortcut('O', 'darwin'), { keys: ['⌘', 'O'], aria: 'Meta+O' });
  });

  it('uses the control key on the other platforms', () => {
    assert.deepEqual(getCommandShortcut('N', 'linux'), { keys: ['Ctrl', 'N'], aria: 'Control+N' });
    assert.deepEqual(getCommandShortcut('I', 'win32'), { keys: ['Ctrl', 'I'], aria: 'Control+I' });
  });
});
