import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import * as Path from 'path';
import { IgnoreMatcher } from '../src/renderer/helpers/ignore-matcher';
import { WorkdirWatcher, usesNativeWatcher, watchWorkingDirectory } from '../src/renderer/helpers/workdir-watcher';
import { TestRepo, lines } from './helpers';

let repo: TestRepo;
let watcher: WorkdirWatcher | null;

beforeEach(async () => {
  repo = await TestRepo.create();
  watcher = null;
});

afterEach(() => {
  // Windows does not delete a directory that is watched
  if (watcher) {
    watcher.close();
  }
  repo.remove();
});

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(condition: () => boolean) {
  for (let elapsed = 0; !condition(); elapsed += 20) {
    if (elapsed > 5000) {
      throw new Error('Timed out');
    }
    await wait(20);
  }
}

async function watch(native: boolean) {
  const matcher = new IgnoreMatcher(repo.workdir, Path.join(repo.workdir, '.git'));
  const changes: (string | null)[] = [];
  const ignoreFiles: string[] = [];
  watcher = watchWorkingDirectory(repo.workdir, {
    isIgnored: (path, isDirectory) => matcher.isIgnored(path, isDirectory),
    onIgnoreFileChange: (path) => {
      ignoreFiles.push(path);
      matcher.invalidate(Path.posix.dirname(path));
    },
    onChange: (path) => changes.push(path),
    native
  });
  await watcher.ready;
  // The native watchers can start a little after the call
  await wait(100);
  return { changes, ignoreFiles };
}

describe('usesNativeWatcher', () => {
  it('watches the whole tree natively on Windows and macOS only', () => {
    assert.equal(usesNativeWatcher('win32'), true);
    assert.equal(usesNativeWatcher('darwin'), true);
    assert.equal(usesNativeWatcher('linux'), false);
  });
});

for (const native of [true, false]) {
  describe(`watchWorkingDirectory (${native ? 'fs.watch' : 'chokidar'})`, () => {
    it('reports the changes of the files that are not ignored', async () => {
      repo.write('.gitignore', lines('*.log', 'build/'));
      repo.write('src/.gitignore', lines('gen/'));
      repo.write('build/old.js', '');
      repo.write('src/gen/old.js', '');
      repo.write('src/main.ts', '');
      const { changes } = await watch(native);
      repo.write('debug.log', 'a');
      repo.write('build/out.js', 'a');
      repo.write('src/gen/new.js', 'a');
      repo.write('src/main.ts', 'a');
      await waitFor(() => changes.includes('src/main.ts'));
      await repo.git('add', 'src/main.ts');
      repo.write('marker.txt', 'a');
      await waitFor(() => changes.includes('marker.txt'));
      const ignored = changes.filter((path) => path !== null &&
        (path.endsWith('.log') || path.startsWith('build') || path.startsWith('src/gen') || path.startsWith('.git/')));
      assert.deepEqual(ignored, []);
    });

    it('reports the .gitignore files that change', async () => {
      repo.write('src/main.ts', '');
      const { changes, ignoreFiles } = await watch(native);
      repo.write('src/.gitignore', lines('*.tmp'));
      await waitFor(() => ignoreFiles.includes('src/.gitignore'));
      // The new patterns apply at once
      repo.write('src/cache.tmp', 'a');
      repo.write('marker.txt', 'a');
      await waitFor(() => changes.includes('marker.txt'));
      assert.equal(changes.includes('src/cache.tmp'), false);
    });
  });
}
