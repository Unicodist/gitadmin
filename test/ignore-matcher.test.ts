import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import * as os from 'os';
import * as Path from 'path';
import { IgnoreMatcher, IgnoreSettings, parseIgnoreSettings, readIgnoreSettings } from '../src/renderer/helpers/ignore-matcher';
import { git } from '../src/renderer/helpers/git/runner';
import { TestRepo, lines } from './helpers';

let repo: TestRepo;

beforeEach(async () => {
  repo = await TestRepo.create();
});

afterEach(() => {
  repo.remove();
});

function matcher(settings: IgnoreSettings = { ignoreCase: false, excludesFile: null }) {
  return new IgnoreMatcher(repo.workdir, Path.join(repo.workdir, '.git'), settings);
}

describe('IgnoreMatcher', () => {
  it('uses the patterns of the root .gitignore', () => {
    repo.write('.gitignore', lines('*.log', '/dist'));
    const ignores = matcher();
    assert.equal(ignores.isIgnored('debug.log'), true);
    assert.equal(ignores.isIgnored('src/debug.log'), true);
    assert.equal(ignores.isIgnored('dist', true), true);
    assert.equal(ignores.isIgnored('src/dist', true), false);
    assert.equal(ignores.isIgnored('src/main.ts'), false);
    assert.equal(ignores.isIgnored(''), false);
  });

  it('lets a nested .gitignore override the root one', () => {
    repo.write('.gitignore', lines('*.log', 'tmp/'));
    repo.write('src/.gitignore', lines('!keep.log', '*.ts'));
    const ignores = matcher();
    assert.equal(ignores.isIgnored('src/keep.log'), false);
    assert.equal(ignores.isIgnored('src/other.log'), true);
    assert.equal(ignores.isIgnored('keep.log'), true);
    assert.equal(ignores.isIgnored('src/main.ts'), true);
    assert.equal(ignores.isIgnored('main.ts'), false);
  });

  it('includes a directory that a shallower file excludes', () => {
    repo.write('.gitignore', lines('build/'));
    repo.write('src/.gitignore', lines('!build/'));
    const ignores = matcher();
    assert.equal(ignores.isIgnored('build/out.js'), true);
    assert.equal(ignores.isIgnored('src/build', true), false);
    assert.equal(ignores.isIgnored('src/build/out.js'), false);
    assert.equal(ignores.isIgnored('src/lib/build/out.js'), false);
  });

  it('lets the last matching pattern of a file win and supports negations', () => {
    repo.write('.gitignore', lines('!first.txt', '*.txt', '!important.txt'));
    const ignores = matcher();
    assert.equal(ignores.isIgnored('first.txt'), true);
    assert.equal(ignores.isIgnored('notes.txt'), true);
    assert.equal(ignores.isIgnored('important.txt'), false);
    assert.equal(ignores.isIgnored('docs/important.txt'), false);
  });

  it('matches the patterns that end with a slash only with directories', () => {
    repo.write('.gitignore', lines('build/'));
    repo.write('build/out.js', '');
    repo.write('src/build', '');
    const ignores = matcher();
    assert.equal(ignores.isIgnored('build', true), true);
    assert.equal(ignores.isIgnored('build', false), false);
    // Looked up on the disk
    assert.equal(ignores.isIgnored('build'), true);
    assert.equal(ignores.isIgnored('src/build'), false);
    assert.equal(ignores.isIgnored('build/out.js'), true);
  });

  it('uses info/exclude below the .gitignore files', () => {
    repo.write('.git/info/exclude', lines('secret.txt', '*.bak', 'vendor/'));
    repo.write('.gitignore', lines('!secret.txt'));
    repo.write('lib/.gitignore', lines('!vendor/'));
    const ignores = matcher();
    assert.equal(ignores.isIgnored('notes.bak'), true);
    assert.equal(ignores.isIgnored('secret.txt'), false);
    assert.equal(ignores.isIgnored('vendor/a.js'), true);
    assert.equal(ignores.isIgnored('lib/vendor/a.js'), false);
  });

  it('uses core.excludesFile below info/exclude', () => {
    const excludesFile = repo.path('.git/global-ignore');
    repo.write('.git/global-ignore', lines('*.swp', '*.tmp'));
    repo.write('.git/info/exclude', lines('!*.tmp'));
    const ignores = matcher({ ignoreCase: false, excludesFile });
    assert.equal(ignores.isIgnored('main.ts.swp'), true);
    assert.equal(ignores.isIgnored('cache.tmp'), false);
  });

  it('ignores the paths inside an ignored directory', () => {
    repo.write('.gitignore', lines('logs/', '!logs/keep.txt'));
    repo.write('logs/.gitignore', lines('!*'));
    const ignores = matcher();
    assert.equal(ignores.isIgnored('logs/keep.txt'), true);
    assert.equal(ignores.isIgnored('logs/deep/file.txt'), true);
    // Git does not read it
    assert.equal(ignores.isIgnored('logs/.gitignore'), true);
  });

  it('reads a .gitignore again once its directory is invalidated', () => {
    repo.write('src/main.ts', '');
    const ignores = matcher();
    assert.equal(ignores.isIgnored('src/cache.tmp'), false);
    assert.equal(ignores.isIgnored('src/gen', true), false);
    repo.write('src/.gitignore', lines('*.tmp', 'gen/'));
    // Still cached
    assert.equal(ignores.isIgnored('src/cache.tmp'), false);
    ignores.invalidate('src');
    assert.equal(ignores.isIgnored('src/cache.tmp'), true);
    assert.equal(ignores.isIgnored('src/gen/file.ts'), true);
    repo.write('.gitignore', lines('src/'));
    ignores.invalidate('');
    assert.equal(ignores.isIgnored('src/main.ts'), true);
    repo.write('.git/info/exclude', lines('*.ts'));
    ignores.reset();
    assert.equal(ignores.isIgnored('main.ts'), true);
  });

  it('never ignores the .gitignore files', () => {
    repo.write('.gitignore', lines('.gitignore', '*ignore'));
    const ignores = matcher();
    assert.equal(ignores.isIgnored('.gitignore'), false);
    assert.equal(ignores.isIgnored('src/.gitignore'), false);
    assert.equal(ignores.isIgnored('.npmignore'), true);
  });

  it('ignores the .git directories', () => {
    const ignores = matcher();
    assert.equal(ignores.isIgnored('.git', true), true);
    assert.equal(ignores.isIgnored('.git/index'), true);
    assert.equal(ignores.isIgnored('lib/sub/.git/HEAD'), true);
    assert.equal(ignores.isIgnored('.github/workflows/ci.yml'), false);
    assert.equal(ignores.isIgnored('repo.git/file'), false);
  });

  it('follows core.ignoreCase', () => {
    repo.write('.gitignore', lines('build/'));
    assert.equal(matcher().isIgnored('Build/out.js'), false);
    assert.equal(matcher({ ignoreCase: true, excludesFile: null }).isIgnored('Build/out.js'), true);
  });

  it('agrees with git check-ignore', async () => {
    repo.write('.gitignore', lines('*.log', '!keep.log', 'build/', 'out', '/root-only.txt', 'docs/**/draft*', 'logs/', '!logs/keep.txt'));
    repo.write('.git/info/exclude', lines('secret*', 'vendor/', '!*.md'));
    repo.write('src/.gitignore', lines('!build/', 'generated/', '!debug.log', '*.ts', '!index.ts'));
    repo.write('src/lib/.gitignore', lines('!*.ts', 'cache'));
    repo.write('lib/.gitignore', lines('!vendor/', '*.md'));
    const files = [
      'app.log', 'keep.log', 'build/out.js', 'out/file.txt', 'root-only.txt', 'src/root-only.txt',
      'docs/a/b/draft1.md', 'docs/draft2.md', 'docs/final.md', 'logs/keep.txt', 'logs/sub/a.txt',
      'secret.txt', 'src/secret.md', 'vendor/a.js', 'lib/vendor/a.js', 'lib/readme.md', 'readme.md',
      'src/build/out.js', 'src/generated/a.js', 'src/debug.log', 'src/app.log', 'src/main.ts', 'src/index.ts',
      'src/lib/util.ts', 'src/lib/cache/data','src/lib/deep/cache/x', 'src/lib/deep/out/y',
      'src/out', '.gitignore', 'src/.gitignore'
    ];
    for (const file of files) {
      if (!repo.exists(file)) {
        repo.write(file, '');
      }
    }
    // The directories as well
    const paths = [...new Set(files.flatMap((file) => file.split('/').map((_part, i, parts) => parts.slice(0, i + 1).join('/'))))];
    const output = await git(['check-ignore', '--no-index', '-z', '--stdin'], repo.workdir, {
      stdin: paths.map((path) => `${path}\0`).join(''),
      // check-ignore refuses the literal pathspecs that the runner asks for, the paths have no glob characters
      env: { GIT_LITERAL_PATHSPECS: '0' },
      okExitCodes: [1]
    });
    const expected = output.split('\0').filter((path) => path !== '');
    const ignores = matcher(await readIgnoreSettings(repo.workdir));
    const actual = paths.filter((path) => ignores.isIgnored(path));
    assert.deepEqual(actual.sort(), expected.sort());
    // Not every path is ignored or included
    assert.ok(expected.length > 10 && expected.length < paths.length - 10);
  });
});

describe('parseIgnoreSettings', () => {
  it('reads core.ignoreCase and core.excludesFile', () => {
    const settings = parseIgnoreSettings('core.ignorecase\ntrue\0core.excludesfile\n~/global-ignore\0', '/repo');
    assert.deepEqual(settings, { ignoreCase: true, excludesFile: Path.join(os.homedir(), 'global-ignore') });
  });

  it('uses the last value and the defaults of git', () => {
    const settings = parseIgnoreSettings('core.ignorecase\0core.ignorecase\nfalse\0', '/repo');
    assert.equal(settings.ignoreCase, false);
    assert.equal(Path.basename(settings.excludesFile!), 'ignore');
    assert.equal(parseIgnoreSettings('core.ignorecase\0', '/repo').ignoreCase, true);
  });
});
