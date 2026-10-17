import { PatchStatus } from './git/model';

// How the status of a file is shown in the patch lists
export interface PatchStatusDisplay {
  // Letter drawn in the badge, hidden from screen readers
  letter: string;
  // Word read by screen readers and shown in the tooltip of the badge
  label: string;
  // Class of the badge, it sets its colors
  className: string;
}

const ADDED = { letter: 'A', label: 'Added', className: 'patch-status-added' };
const UNTRACKED = { letter: 'U', label: 'Untracked', className: 'patch-status-untracked' };
const MODIFIED = { letter: 'M', label: 'Modified', className: 'patch-status-modified' };
const DELETED = { letter: 'D', label: 'Deleted', className: 'patch-status-deleted' };
const RENAMED = { letter: 'R', label: 'Renamed', className: 'patch-status-renamed' };
const CONFLICTED = { letter: '!', label: 'Conflicted', className: 'patch-status-conflicted' };

// Copies and type changes have no badge of their own, the tooltip of the path tells the source of a copy
const DISPLAYS: Record<PatchStatus, PatchStatusDisplay> = {
  [PatchStatus.Added]: ADDED,
  [PatchStatus.Untracked]: UNTRACKED,
  [PatchStatus.Modified]: MODIFIED,
  [PatchStatus.Copied]: MODIFIED,
  [PatchStatus.TypeChanged]: MODIFIED,
  [PatchStatus.Deleted]: DELETED,
  [PatchStatus.Renamed]: RENAMED,
  [PatchStatus.Conflicted]: CONFLICTED
};

export function getPatchStatusDisplay(status: PatchStatus): PatchStatusDisplay {
  // The status comes from the letter of git, which has a few more rare ones (X for unknown changes)
  return DISPLAYS[status] || MODIFIED;
}

// Splits a path into its folder, with the final slash, and its file name
export function splitPath(path: string): [string, string] {
  const i = path.lastIndexOf('/') + 1;
  return [path.substring(0, i), path.substring(i)];
}

// Full path shown in the tooltip of a file, with the path it comes from when it was renamed or copied
export function describePatchPath(status: PatchStatus, oldPath: string, newPath: string) {
  if (status === PatchStatus.Renamed && oldPath !== newPath) {
    return `${newPath}, renamed from ${oldPath}`;
  } else if (status === PatchStatus.Copied && oldPath !== newPath) {
    return `${newPath}, copied from ${oldPath}`;
  }
  return newPath;
}
