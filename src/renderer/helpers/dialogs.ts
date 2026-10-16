import * as Path from 'path';
import { SYSTEM_THEME } from '../../shared/theme-manager';

export interface ThemeOption {
  value: string;
  label: string;
}

// Names of the built-in themes, which come first after the system setting
const THEME_LABELS: Record<string, string> = {
  light: 'Light',
  dark: 'Dark'
};

// Options of the theme setting: the system setting, the built-in themes, then the other themes by the names of their files.
// The current setting is always one of them, even before the themes are listed or if its file was removed.
export function getThemeOptions(themes: string[], current: string): ThemeOption[] {
  const names = new Set(themes);
  if (current !== SYSTEM_THEME) {
    names.add(current);
  }
  const builtIn = Object.keys(THEME_LABELS).filter((name) => names.has(name));
  const others = [...names].filter((name) => !(name in THEME_LABELS))
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  return [
    { value: SYSTEM_THEME, label: 'System' },
    ...builtIn.map((name) => ({ value: name, label: THEME_LABELS[name] })),
    ...others.map((name) => ({ value: name, label: name }))
  ];
}

// Name of the folder of a clone, from the URL of the repository: https://example.com/owner/repo.git gives repo
export function getCloneFolderName(url: string, pathModule: Path.PlatformPath = Path) {
  return pathModule.parse(url.trim()).name;
}

export interface RepoPath {
  // Folder that contains the repository, with its final separator
  location: string;
  name: string;
  fullPath: string;
}

// Path of the repository that a dialog creates, null until the location and the name of its folder are known
export function getRepoPath(location: string, folderName: string, pathModule: Path.PlatformPath = Path): RepoPath | null {
  if (!location || !folderName) {
    return null;
  }
  const fullPath = pathModule.join(location, folderName);
  const name = pathModule.basename(fullPath);
  return {
    location: fullPath.substring(0, fullPath.length - name.length),
    name: name,
    fullPath: fullPath
  };
}
