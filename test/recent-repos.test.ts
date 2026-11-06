import { describe, it, after } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as Path from 'path';
import {
  addRecentRepo, getMissingFolderMessage, isFolderMissing, MAX_RECENT_REPOS, removeRecentRepo
} from '../src/renderer/helpers/recent-repos';
import { splitNotificationMessage } from '../src/renderer/helpers/notifications';

describe('recent repositories', () => {
  it('puts the opened repository first without duplicates', () => {
    assert.deepEqual(addRecentRepo([], '/a'), ['/a']);
    assert.deepEqual(addRecentRepo(['/a', '/b', '/c'], '/b'), ['/b', '/a', '/c']);
    assert.deepEqual(addRecentRepo(['/a', '/b', '/c'], '/d'), ['/d', '/a', '/b']);
    assert.equal(addRecentRepo(['/a', '/b', '/c'], '/d').length, MAX_RECENT_REPOS);
  });

  it('removes a repository', () => {
    const recentRepos = ['/a', '/b', '/c'];
    assert.deepEqual(removeRecentRepo(recentRepos, '/b'), ['/a', '/c']);
    assert.deepEqual(removeRecentRepo(recentRepos, '/d'), ['/a', '/b', '/c']);
    // The list is not changed in place
    assert.deepEqual(recentRepos, ['/a', '/b', '/c']);
  });
});

describe('isFolderMissing', () => {
  const dir = fs.mkdtempSync(Path.join(os.tmpdir(), 'gitadmin-recent-'));

  after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('finds a folder that exists', async () => {
    assert.equal(await isFolderMissing(dir), false);
  });

  it('detects a folder that was deleted or replaced by a file', async () => {
    assert.equal(await isFolderMissing(Path.join(dir, 'deleted')), true);
    const file = Path.join(dir, 'file');
    fs.writeFileSync(file, '');
    assert.equal(await isFolderMissing(file), true);
    assert.equal(await isFolderMissing(Path.join(file, 'below-a-file')), true);
  });

  it('explains the missing folder instead of the error of git', () => {
    const text = splitNotificationMessage(getMissingFolderMessage('/home/ada/engine'));
    assert.equal(text.title, 'Repository not found');
    assert.equal(text.details, '/home/ada/engine was moved, renamed or deleted');
  });
});
