import * as Path from 'path';

export interface ShortenedPath {
  // Parent folders, they are shortened first when the path is too long
  folder: string;
  // Last segment, with its leading separator
  name: string;
}

export interface Shortcut {
  // Keys as printed on the keyboard, for instance Ctrl and O
  keys: string[];
  // Value of aria-keyshortcuts, for instance Control+O
  aria: string;
}

// Older versions saved the path of the .git folder in the recently opened repositories
export function getWorkingDirectory(path: string, pathModule: Path.PlatformPath = Path) {
  // Joining the parts drops the trailing separators but keeps a root as it is
  const trimmedPath = pathModule.join(pathModule.dirname(path), pathModule.basename(path));
  return pathModule.basename(trimmedPath) === '.git' ? pathModule.dirname(trimmedPath) : trimmedPath;
}

// Path of a repository relative to the home directory (~/projects/gitadmin), or its absolute path outside of it
export function shortenRepoPath(path: string, homeDir: string, pathModule: Path.PlatformPath = Path): ShortenedPath {
  const workdir = getWorkingDirectory(path, pathModule);
  const relativePath = pathModule.relative(homeDir, workdir);
  let shortenedPath: string;
  if (relativePath === '') {
    shortenedPath = '~';
  } else if (relativePath === '..' || relativePath.startsWith(`..${pathModule.sep}`) || pathModule.isAbsolute(relativePath)) {
    // On Windows, the relative path to another drive is absolute
    shortenedPath = workdir;
  } else {
    shortenedPath = `~${pathModule.sep}${relativePath}`;
  }
  const i = Math.max(shortenedPath.lastIndexOf(pathModule.sep), 0);
  return {
    folder: shortenedPath.substring(0, i),
    name: shortenedPath.substring(i)
  };
}

// Shortcut of a CmdOrCtrl accelerator of the application menu (see src/main/menu.ts)
export function getCommandShortcut(key: string, platform: string = process.platform): Shortcut {
  if (platform === 'darwin') {
    return { keys: ['⌘', key], aria: `Meta+${key}` };
  }
  return { keys: ['Ctrl', key], aria: `Control+${key}` };
}
