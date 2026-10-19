import { describe, it, beforeEach, after } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as Path from 'path';
import { Field, Settings } from '../src/shared/settings';
import { getDialogStartDirectory, rememberPickedDirectory } from '../src/renderer/helpers/recent-directory';

describe('recent directory', () => {
  const dir = fs.mkdtempSync(Path.join(os.tmpdir(), 'gitadmin-settings-'));
  const path = Path.join(dir, 'Settings');
  const projects = Path.join(dir, 'projects');
  const repo = Path.join(projects, 'engine');

  beforeEach(() => {
    Settings.setPath(path);
    fs.rmSync(path, { force: true });
    fs.mkdirSync(repo, { recursive: true });
  });

  after(() => {
    Settings.setPath(null);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('lets the system choose before a directory is picked', () => {
    assert.equal(getDialogStartDirectory(), undefined);
  });

  it('starts in the parent of the directory picked last time', () => {
    rememberPickedDirectory(repo);
    assert.equal(Settings.get(Field.RecentDirectory), projects);
    assert.equal(getDialogStartDirectory(), projects);
  });

  it('lets the system choose when the folder no longer exists', () => {
    rememberPickedDirectory(repo);
    fs.rmSync(projects, { recursive: true });
    assert.equal(getDialogStartDirectory(), undefined);
  });

  it('ignores a saved value that is not a folder', () => {
    fs.writeFileSync(Path.join(dir, 'file.txt'), '');
    Settings.set(Field.RecentDirectory, Path.join(dir, 'file.txt'));
    assert.equal(getDialogStartDirectory(), undefined);
    Settings.set(Field.RecentDirectory, 42);
    assert.equal(getDialogStartDirectory(), undefined);
  });
});
