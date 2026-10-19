import * as fs from 'fs';
import * as Path from 'path';
import { Field, Settings } from '../../shared/settings';

// Folder where the directory dialogs start, undefined lets the system choose
export function getDialogStartDirectory(): string | undefined {
  const directory = Settings.get(Field.RecentDirectory);
  if (typeof directory !== 'string') {
    return undefined;
  }
  // The folder may have been moved or removed since
  try {
    return fs.statSync(directory).isDirectory() ? directory : undefined;
  } catch (e) {
    return undefined;
  }
}

// Saves the parent of the picked directory, so the next dialog shows it next to its siblings
export function rememberPickedDirectory(path: string) {
  Settings.set(Field.RecentDirectory, Path.dirname(path));
}
