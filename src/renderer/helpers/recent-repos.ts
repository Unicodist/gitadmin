import * as fs from 'fs';

// Number of repositories that the welcome screen lists
export const MAX_RECENT_REPOS = 3;

// Puts a repository first in the recent repositories, without duplicates
export function addRecentRepo(recentRepos: readonly string[], path: string) {
  return [path, ...recentRepos.filter((recentPath) => recentPath !== path)].slice(0, MAX_RECENT_REPOS);
}

export function removeRecentRepo(recentRepos: readonly string[], path: string) {
  return recentRepos.filter((recentPath) => recentPath !== path);
}

// True if the folder of a repository is gone: it was moved, renamed or deleted
export async function isFolderMissing(path: string) {
  try {
    return !(await fs.promises.stat(path)).isDirectory();
  } catch (e) {
    // Other errors, like a denied access, are reported when the repository is opened
    return e.code === 'ENOENT' || e.code === 'ENOTDIR';
  }
}

// Message of the notification when the folder of a repository is missing, git only says ENOENT
export function getMissingFolderMessage(path: string) {
  return `Repository not found: ${path} was moved, renamed or deleted`;
}
