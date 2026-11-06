import * as Path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import ignore, { Ignore } from 'ignore';
import { git } from './git/runner';

export interface IgnoreSettings {
  // core.ignoreCase, git sets it when it creates a repository on a case-insensitive file system
  ignoreCase: boolean;
  // Absolute path of core.excludesFile, or of its default location when it is not set
  excludesFile: string | null;
}

export const DEFAULT_IGNORE_SETTINGS: IgnoreSettings = { ignoreCase: false, excludesFile: null };

interface Source {
  rules: Ignore;
  // Copies of the rules that include the parent directories of the paths tested in them, see testAlone
  isolated: Map<string, Ignore>;
}

function parseBoolean(value: string | null) {
  // A key without a value is true for git
  return value === null || ['true', 'yes', 'on', '1'].includes(value.toLowerCase());
}

function expandHome(path: string) {
  if (path === '~' || path.startsWith('~/')) {
    return Path.join(os.homedir(), path.substring(1));
  }
  return path;
}

function defaultExcludesFile() {
  const config = process.env.XDG_CONFIG_HOME || Path.join(os.homedir(), '.config');
  return Path.join(config, 'git', 'ignore');
}

// Parses the output of git config -z --get-regexp, each entry is the key, a new line and the value
export function parseIgnoreSettings(output: string, workdir: string): IgnoreSettings {
  let ignoreCase = false;
  let excludesFile: string | null = null;
  for (const entry of output.split('\0')) {
    if (!entry) {
      continue;
    }
    const newLine = entry.indexOf('\n');
    const key = (newLine < 0 ? entry : entry.substring(0, newLine)).toLowerCase();
    const value = newLine < 0 ? null : entry.substring(newLine + 1);
    // The last value wins, as with git
    if (key === 'core.ignorecase') {
      ignoreCase = parseBoolean(value);
    } else if (key === 'core.excludesfile' && value !== null) {
      excludesFile = value ? Path.resolve(workdir, expandHome(value)) : null;
    }
  }
  return { ignoreCase, excludesFile: excludesFile || defaultExcludesFile() };
}

// One git process when the repository opens, the matcher then reads the files itself
export async function readIgnoreSettings(workdir: string): Promise<IgnoreSettings> {
  try {
    const output = await git(['config', '-z', '--get-regexp', '^core\\.(ignorecase|excludesfile)$'], workdir, { okExitCodes: [1] });
    return parseIgnoreSettings(output, workdir);
  } catch {
    return { ...DEFAULT_IGNORE_SETTINGS, excludesFile: defaultExcludesFile() };
  }
}

// A linked worktree shares info/exclude with the main repository
function getCommonDir(gitDir: string) {
  try {
    return Path.resolve(gitDir, fs.readFileSync(Path.join(gitDir, 'commondir'), 'utf8').trim());
  } catch {
    return gitDir;
  }
}

// Escapes a directory name so that a pattern matches it literally
function escapePattern(path: string) {
  return path.replace(/[\\*?[\]]/g, '\\$&').replace(/ $/, '\\ ');
}

// Tells whether a path of the working directory is ignored, with the rules of git: the patterns of
// core.excludesFile, then of .git/info/exclude, then of the .gitignore files from the root to the
// directory of the path, each one overriding the previous ones. In a file, the last matching pattern
// wins. A path inside an ignored directory is ignored, whatever the patterns say about it.
export class IgnoreMatcher {
  readonly workdir: string;
  readonly gitDir: string;
  private settings: IgnoreSettings;
  private excludes: Source[]; // core.excludesFile then info/exclude
  private directories: Map<string, Source | null>; // .gitignore of each directory, read when first needed
  private ignoredDirectories: Map<string, boolean>;

  constructor(workdir: string, gitDir: string, settings: IgnoreSettings = DEFAULT_IGNORE_SETTINGS) {
    this.workdir = workdir;
    this.gitDir = gitDir;
    this.settings = settings;
    this.excludes = [];
    this.directories = new Map();
    this.ignoredDirectories = new Map();
    this.reset();
  }

  setSettings(settings: IgnoreSettings) {
    this.settings = settings;
    this.reset();
  }

  // Reads the exclude files again and forgets the .gitignore files
  reset() {
    const files = [this.settings.excludesFile, Path.join(getCommonDir(this.gitDir), 'info', 'exclude')];
    this.excludes = files.map((file) => file ? this.readSource(file) : null).filter((source) => source !== null);
    this.directories.clear();
    this.ignoredDirectories.clear();
  }

  // Forgets the .gitignore of a directory, relative to the working directory ('' for the root)
  invalidate(directory: string) {
    this.directories.delete(this.normalize(directory).join('/'));
    // The decisions about the directories below it may change
    this.ignoredDirectories.clear();
  }

  // Path relative to the working directory, isDirectory is looked up on the disk when it is not given
  isIgnored(path: string, isDirectory?: boolean) {
    const segments = this.normalize(path);
    // The working directory itself, or a path outside of it
    if (segments.length === 0 || segments[0] === '..') {
      return false;
    }
    if (segments.includes('.git')) {
      return true;
    }
    // Git does not look into an ignored directory, so the parents decide first
    let directory = '';
    for (let i = 0; i < segments.length - 1; ++i) {
      directory = i === 0 ? segments[0] : `${directory}/${segments[i]}`;
      if (this.isDirectoryIgnored(directory)) {
        return true;
      }
    }
    // Its changes tell that the patterns changed
    if (segments[segments.length - 1] === '.gitignore') {
      return false;
    }
    const fullPath = segments.join('/');
    if (isDirectory === undefined) {
      isDirectory = this.isDirectoryOnDisk(fullPath);
    }
    return isDirectory ? this.isDirectoryIgnored(fullPath) : this.match(fullPath, false);
  }

  private normalize(path: string) {
    if (Path.sep === '\\') {
      path = path.replace(/\\/g, '/');
    }
    return path.split('/').filter((segment) => segment !== '' && segment !== '.');
  }

  private isDirectoryOnDisk(path: string) {
    // Like git, a symbolic link is not a directory, and a path that is gone is a file
    try {
      return fs.lstatSync(Path.join(this.workdir, path)).isDirectory();
    } catch {
      return false;
    }
  }

  // The parents of the directory must not be ignored
  private isDirectoryIgnored(directory: string) {
    let ignored = this.ignoredDirectories.get(directory);
    if (ignored === undefined) {
      ignored = this.match(directory, true);
      this.ignoredDirectories.set(directory, ignored);
    }
    return ignored;
  }

  // Decides for the path alone, its parents are known not to be ignored
  private match(path: string, isDirectory: boolean) {
    // The .gitignore files of the parent directories, the deepest first
    let end = path.lastIndexOf('/');
    for (;;) {
      const source = this.getDirectorySource(end < 0 ? '' : path.substring(0, end));
      if (source) {
        const result = this.testAlone(source, path.substring(end + 1), isDirectory);
        if (result.ignored || result.unignored) {
          return result.ignored;
        }
      }
      if (end < 0) {
        break;
      }
      end = path.lastIndexOf('/', end - 1);
    }
    for (let i = this.excludes.length - 1; i >= 0; --i) {
      const result = this.testAlone(this.excludes[i], path, isDirectory);
      if (result.ignored || result.unignored) {
        return result.ignored;
      }
    }
    return false;
  }

  // The package treats a path as ignored when the rules exclude one of its parents, but git checks each
  // file separately: a deeper .gitignore can include a directory that a shallower one excludes.
  private testAlone(source: Source, path: string, isDirectory: boolean) {
    const tested = isDirectory ? `${path}/` : path;
    const slash = path.lastIndexOf('/');
    if (slash < 0) {
      return source.rules.test(tested);
    }
    const parent = path.substring(0, slash + 1);
    if (!source.rules.test(parent).ignored) {
      return source.rules.test(tested);
    }
    // Rare, so the copy that includes the parents again is made only then
    let isolated = source.isolated.get(parent);
    if (!isolated) {
      const parents: string[] = [];
      for (let index = parent.indexOf('/'); index >= 0; index = parent.indexOf('/', index + 1)) {
        parents.push(`!/${escapePattern(parent.substring(0, index))}/`);
      }
      isolated = this.createRules().add(source.rules).add(parents);
      source.isolated.set(parent, isolated);
    }
    return isolated.test(tested);
  }

  private getDirectorySource(directory: string) {
    let source = this.directories.get(directory);
    if (source === undefined) {
      source = this.readSource(Path.join(this.workdir, directory, '.gitignore'));
      this.directories.set(directory, source);
    }
    return source;
  }

  private readSource(file: string): Source | null {
    let content: string;
    try {
      content = fs.readFileSync(file, 'utf8');
    } catch {
      return null;
    }
    return { rules: this.createRules().add(content), isolated: new Map() };
  }

  private createRules() {
    return ignore({ ignorecase: this.settings.ignoreCase });
  }
}
