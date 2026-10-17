import * as Path from 'path';
import { Field, Settings } from '../../shared/settings';
import { Commit, Patch } from './git/model';
import { shortenReferenceName } from './branch-focus';

// The summary of a branch tells what happened on it since it was taken out of its source branch,
// computed with git by RepoWrapper.getBranchSummary

// Branches that the others are usually taken out of, in the order they are preferred
export const MAIN_BRANCH_NAMES = ['main', 'master', 'develop'];

// Number of files and directories in the lists of the most changed ones
export const MOST_CHANGED_COUNT = 5;

export interface SummaryCommit {
  commit: Commit;
  // A merge that brings commits of the source into the branch
  syncedWithSource: boolean;
}

export interface AuthorCount {
  name: string;
  email: string;
  commits: number;
}

export interface FileChange {
  // Path of a file, or of a directory with a trailing slash
  path: string;
  added: number;
  removed: number;
  // Binary files have no line counts
  binary: boolean;
}

export interface MergeCheck {
  clean: boolean;
  // Files that would conflict if the branch was merged into the source
  conflicts: string[];
}

export interface BranchSummary {
  // Full names of the references (refs/heads/feature)
  branch: string;
  // Null when no source could be found
  source: string | null;
  // Commit where the branch was taken out of the source, null if they share no history
  forkPoint: Commit | null;
  // Latest commit of the source that the branch has, the combined diff starts from it. It is the fork point
  // unless the branch merged the source in since then.
  base: string | null;
  // Commits of the branch that the source does not have, and of the source that the branch does not have
  ahead: number;
  behind: number;
  // Commits of the branch since it forked, newest first
  commits: SummaryCommit[];
  // Most commits first
  authors: AuthorCount[];
  // Dates of the first and the last commits of the branch, null without commits
  firstDate: Date | null;
  lastDate: Date | null;
  // Net change of the branch, from the base to the branch
  patches: Patch[];
  // Line counts of each file of the patches, in the same order
  changes: FileChange[];
  added: number;
  removed: number;
  // Null when the branch shares no history with the source
  mergeCheck: MergeCheck | null;
}

// Main branches that can be the source of a branch, the local ones before the remote ones.
// The branch itself and its remote counterparts are left out.
export function getSourceCandidates(references: Iterable<string>, branch: string) {
  const branchName = getBranchName(branch);
  const candidates: { name: string; rank: number }[] = [];
  for (const name of references) {
    if (name === branch) {
      continue;
    }
    const shortName = getBranchName(name);
    const rank = MAIN_BRANCH_NAMES.indexOf(shortName);
    if (rank === -1 || shortName === branchName) {
      continue;
    }
    if (name.startsWith('refs/heads/')) {
      candidates.push({ name, rank });
    } else if (name.startsWith('refs/remotes/')) {
      candidates.push({ name, rank: rank + MAIN_BRANCH_NAMES.length });
    }
  }
  return candidates.sort((lhs, rhs) => lhs.rank - rhs.rank || (lhs.name < rhs.name ? -1 : 1)).map((candidate) => candidate.name);
}

// Name of a branch without its remote: refs/remotes/origin/main is main
export function getBranchName(name: string) {
  if (name.startsWith('refs/heads/')) {
    return name.substring('refs/heads/'.length);
  } else if (name.startsWith('refs/remotes/')) {
    const shortName = name.substring('refs/remotes/'.length);
    return shortName.substring(shortName.indexOf('/') + 1);
  }
  return shortenReferenceName(name);
}

// Branches that can be chosen as the source in the dropdown: the other local and remote branches
export function getSourceChoices(references: Iterable<string>, branch: string) {
  const choices = [...references].filter((name) => name !== branch &&
    (name.startsWith('refs/heads/') || name.startsWith('refs/remotes/')) && !name.endsWith('/HEAD'));
  const local = choices.filter((name) => name.startsWith('refs/heads/')).sort();
  const remote = choices.filter((name) => name.startsWith('refs/remotes/')).sort();
  return [...local, ...remote];
}

export function countAuthors(commits: Commit[]): AuthorCount[] {
  const authors = new Map<string, AuthorCount>();
  for (const commit of commits) {
    const author = commit.author();
    const key = `${author.name}\0${author.email}`;
    const count = authors.get(key);
    if (count) {
      ++count.commits;
    } else {
      authors.set(key, { name: author.name, email: author.email, commits: 1 });
    }
  }
  // Ties keep the order of the commits, the most recent author first
  return [...authors.values()].sort((lhs, rhs) => rhs.commits - lhs.commits);
}

// Dates of the oldest and the newest commits, by author date
export function getTimeSpan(commits: Commit[]): [Date | null, Date | null] {
  if (commits.length === 0) {
    return [null, null];
  }
  const times = commits.map((commit) => commit.author().date.valueOf());
  return [new Date(Math.min(...times)), new Date(Math.max(...times))];
}

function changeSize(change: FileChange) {
  return change.added + change.removed;
}

function byChangeSize(lhs: FileChange, rhs: FileChange) {
  return changeSize(rhs) - changeSize(lhs) || (lhs.path < rhs.path ? -1 : lhs.path > rhs.path ? 1 : 0);
}

// The files with the most added and removed lines, binary files come last
export function getMostChangedFiles(changes: FileChange[], count = MOST_CHANGED_COUNT) {
  return [...changes]
    .sort((lhs, rhs) => Number(lhs.binary) - Number(rhs.binary) || byChangeSize(lhs, rhs))
    .slice(0, count);
}

// The directories with the most added and removed lines in their files and subdirectories.
// The files at the root of the repository are in "./".
export function getMostChangedDirectories(changes: FileChange[], count = MOST_CHANGED_COUNT) {
  const directories = new Map<string, FileChange>();
  for (const change of changes) {
    const directory = Path.posix.dirname(change.path);
    const ancestors: string[] = [];
    if (directory === '.') {
      ancestors.push('./');
    } else {
      const parts = directory.split('/');
      for (let i = 1; i <= parts.length; ++i) {
        ancestors.push(`${parts.slice(0, i).join('/')}/`);
      }
    }
    for (const path of ancestors) {
      const total = directories.get(path) || { path, added: 0, removed: 0, binary: false };
      total.added += change.added;
      total.removed += change.removed;
      directories.set(path, total);
    }
  }
  // A directory that only holds one subdirectory tells the same as it
  const all = [...directories.values()];
  const meaningful = all.filter((directory) => !all.some((other) => other.path.length > directory.path.length &&
    other.path.startsWith(directory.path) && changeSize(other) === changeSize(directory)));
  return meaningful.sort(byChangeSize).slice(0, count);
}

function plural(n: number, word: string) {
  return `${n} ${n === 1 ? word : `${word}s`}`;
}

// "3 commits ahead, 2 behind"
export function describeAheadBehind(ahead: number, behind: number) {
  return `${plural(ahead, 'commit')} ahead, ${behind} behind`;
}

export function formatDay(date: Date) {
  return date.toISOString().substring(0, 10);
}

// "2026-10-01 to 2026-10-17", or the day alone
export function describeTimeSpan(first: Date | null, last: Date | null) {
  if (!first || !last) {
    return 'No commits';
  }
  const from = formatDay(first);
  const to = formatDay(last);
  return from === to ? from : `${from} to ${to}`;
}

function shortSha(sha: string) {
  return sha.substring(0, 7);
}

function escapeMarkdown(text: string) {
  return text.replace(/([\\`*_[\]<>|#])/g, '\\$1');
}

// The summary as Markdown, to paste in the description of a pull request
export function formatSummaryMarkdown(summary: BranchSummary) {
  const branch = shortenReferenceName(summary.branch);
  const lines: string[] = [`## Summary of ${escapeMarkdown(branch)}`, ''];
  if (summary.source && summary.forkPoint) {
    const source = shortenReferenceName(summary.source);
    lines.push(`Forked from \`${source}\` at \`${shortSha(summary.forkPoint.sha())}\` on ${formatDay(summary.forkPoint.date())}, ` +
      `${describeAheadBehind(summary.ahead, summary.behind)} \`${source}\`.`);
  } else if (summary.source) {
    lines.push(`Shares no history with \`${shortenReferenceName(summary.source)}\`.`);
  } else {
    lines.push('No source branch found.');
  }
  lines.push('');
  lines.push(summary.commits.length > 0 ?
    `- ${plural(summary.commits.length, 'commit')} by ${plural(summary.authors.length, 'author')}, ` +
      describeTimeSpan(summary.firstDate, summary.lastDate) :
    '- No commits');
  lines.push(`- ${plural(summary.changes.length, 'file')} changed, +${summary.added} -${summary.removed}`);
  if (summary.mergeCheck) {
    lines.push(summary.mergeCheck.clean ?
      '- Merges cleanly into the source' :
      `- Conflicts with the source in ${plural(summary.mergeCheck.conflicts.length, 'file')}: ` +
        summary.mergeCheck.conflicts.map((path) => `\`${path}\``).join(', '));
  }
  if (summary.authors.length > 0) {
    lines.push('', '### Authors', '');
    for (const author of summary.authors) {
      lines.push(`- ${escapeMarkdown(author.name)} (${plural(author.commits, 'commit')})`);
    }
  }
  if (summary.commits.length > 0) {
    lines.push('', '### Commits', '');
    for (const { commit, syncedWithSource } of summary.commits) {
      lines.push(`- \`${shortSha(commit.sha())}\` ${escapeMarkdown(commit.summary())}${syncedWithSource ? ' (synced with source)' : ''}`);
    }
  }
  const files = getMostChangedFiles(summary.changes);
  if (files.length > 0) {
    lines.push('', '### Most changed files', '');
    for (const file of files) {
      lines.push(`- \`${file.path}\` ${file.binary ? '(binary)' : `+${file.added} -${file.removed}`}`);
    }
  }
  return lines.join('\n') + '\n';
}

// Persistence, the source chosen for each branch is stored under the path of the working directory of its repository

function getSavedSources(): Record<string, Record<string, string>> {
  const value = Settings.get(Field.BranchSummarySources, {});
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

// The source chosen for the branch, null if it is detected
export function loadSource(workdir: string, branch: string): string | null {
  const sources = getSavedSources()[workdir];
  const source = sources && typeof sources === 'object' ? sources[branch] : undefined;
  return typeof source === 'string' ? source : null;
}

// Null goes back to the detected source
export function saveSource(workdir: string, branch: string, source: string | null) {
  const all = getSavedSources();
  const sources = { ...all[workdir] };
  if (source !== null) {
    sources[branch] = source;
  } else {
    delete sources[branch];
  }
  if (Object.keys(sources).length > 0) {
    all[workdir] = sources;
  } else {
    delete all[workdir];
  }
  Settings.set(Field.BranchSummarySources, all);
}
