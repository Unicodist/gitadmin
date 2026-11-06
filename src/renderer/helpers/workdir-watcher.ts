import * as Path from 'path';
import * as fs from 'fs';
import * as chokidar from 'chokidar';

export interface WorkdirWatcherOptions {
  // Paths are relative to the working directory, with forward slashes
  isIgnored: (path: string, isDirectory?: boolean) => boolean;
  // Called for a .gitignore that changed, before onChange
  onIgnoreFileChange: (path: string) => void;
  // The path is null when the system did not say what changed
  onChange: (path: string | null) => void;
  native: boolean;
}

export interface WorkdirWatcher {
  // Resolves once the changes are seen
  ready: Promise<void>;
  close: () => void;
}

// Windows and macOS watch a whole tree with one handle. On Linux, Node walks the tree in JavaScript and
// watches every directory, as chokidar does, but chokidar does not go into the ignored directories.
export function usesNativeWatcher(platform: NodeJS.Platform = process.platform) {
  return platform === 'win32' || platform === 'darwin';
}

export function watchWorkingDirectory(workdir: string, options: WorkdirWatcherOptions): WorkdirWatcher {
  const relative = (path: string) => path.split(Path.sep).join('/');
  const handle = (path: string, isDirectory?: boolean) => {
    if (options.isIgnored(path, isDirectory)) {
      return;
    }
    if (Path.posix.basename(path) === '.gitignore') {
      options.onIgnoreFileChange(path);
    }
    options.onChange(path);
  };

  if (options.native) {
    const watcher = fs.watch(workdir, { recursive: true }, (_event, filename) => {
      if (filename === null) {
        options.onChange(null);
      } else {
        handle(relative(filename));
      }
    });
    // Windows reports an error when the working directory is deleted, the repository is closed then
    watcher.on('error', () => undefined);
    return { ready: Promise.resolve(), close: () => watcher.close() };
  }

  const watcher = chokidar.watch(workdir, {
    ignoreInitial: true,
    // The stats are there when chokidar already has them, otherwise the matcher looks
    ignored: (path: string, stats?: fs.Stats) => options.isIgnored(relative(Path.relative(workdir, path)), stats && stats.isDirectory()),
    followSymlinks: false
  });
  watcher.on('all', (event: string, path: string) => {
    handle(relative(Path.relative(workdir, path)), event === 'addDir' || event === 'unlinkDir');
  });
  const ready = new Promise<void>((resolve) => watcher.once('ready', () => resolve()));
  return { ready, close: () => void watcher.close() };
}
