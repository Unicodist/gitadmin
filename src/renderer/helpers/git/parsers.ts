import { Commit, DiffLine, Hunk, PatchStatus, Reference } from './model';

// References

export const REFERENCE_FORMAT = [
  '%(refname)',
  '%(objectname)',
  '%(objecttype)',
  '%(*objectname)',
  '%(*objecttype)',
  '%(symref)'
].join('%00');

// Parses the output of `git for-each-ref --format=REFERENCE_FORMAT`.
// Symbolic references and references that do not resolve to a commit are skipped.
export function parseReferences(output: string) {
  const references: Reference[] = [];
  for (const line of output.split('\n')) {
    if (!line) {
      continue;
    }
    const [name, id, type, peeledId, peeledType, symref] = line.split('\0');
    if (symref) {
      continue;
    }
    if (type === 'commit') {
      references.push(new Reference(name, id, id));
    } else if (type === 'tag' && peeledType === 'commit') {
      references.push(new Reference(name, id, peeledId));
    }
  }
  return references;
}

// Commits

export const COMMIT_FORMAT = ['%H', '%P', '%an', '%ae', '%at', '%cn', '%ce', '%ct', '%B'].join('%x00');
const COMMIT_FIELD_COUNT = 9;

// Parses the output of `git log -z --format=COMMIT_FORMAT`
export function parseCommits(output: string) {
  const fields = output.split('\0');
  const commits: Commit[] = [];
  for (let i = 0; i + COMMIT_FIELD_COUNT <= fields.length; i += COMMIT_FIELD_COUNT) {
    const [sha, parents, authorName, authorEmail, authorTime, committerName, committerEmail, committerTime, message] =
      fields.slice(i, i + COMMIT_FIELD_COUNT);
    // With -z, git separates records with NUL, the record separator is also
    // printed after the message (and newlines between records may remain)
    const id = sha.trim();
    commits.push(new Commit(
      id,
      parents ? parents.split(' ') : [],
      { name: authorName, email: authorEmail, date: new Date(parseInt(authorTime, 10) * 1000) },
      { name: committerName, email: committerEmail, date: new Date(parseInt(committerTime, 10) * 1000) },
      message
    ));
  }
  return commits;
}

// Diff summaries

export interface DiffEntry {
  status: PatchStatus;
  oldPath: string;
  newPath: string;
  oldMode: string;
  newMode: string;
  // null for the null object id (file missing or not hashed yet)
  oldId: string | null;
  newId: string | null;
  binary: boolean;
}

function parseObjectId(id: string) {
  return /^0+$/.test(id) ? null : id;
}

// Parses the output of `git diff --raw --numstat -z --no-abbrev` (and diff-tree/diff-index equivalents)
export function parseDiffSummary(output: string) {
  const tokens = output.split('\0');
  const entries: DiffEntry[] = [];
  const binaryPaths = new Set<string>();
  let i = 0;
  // Raw entries come first
  while (i < tokens.length && tokens[i].startsWith(':')) {
    const header = tokens[i].substring(1).split(' ');
    const [oldMode, newMode, oldId, newId, statusWithScore] = header;
    const status = statusWithScore[0] as PatchStatus;
    const oldPath = tokens[i + 1];
    let newPath = oldPath;
    i += 2;
    if (status === PatchStatus.Renamed || status === PatchStatus.Copied) {
      newPath = tokens[i];
      i += 1;
    }
    entries.push({
      status: status,
      oldPath: oldPath,
      newPath: newPath,
      oldMode: oldMode,
      newMode: newMode,
      oldId: parseObjectId(oldId),
      newId: parseObjectId(newId),
      binary: false
    });
  }
  // Then numstat entries, binary files have '-' as counts
  while (i < tokens.length) {
    const match = /^(\d+|-)\t(\d+|-)\t(.*)$/s.exec(tokens[i]);
    i += 1;
    if (!match) {
      continue;
    }
    let path = match[3];
    if (path === '') {
      // Renames and copies: the paths follow in their own tokens
      path = tokens[i + 1];
      i += 2;
    }
    if (match[1] === '-' && match[2] === '-') {
      binaryPaths.add(path);
    }
  }
  // When a path is unmerged, git also reports a diff against "ours", keep only the conflict
  const conflictedPaths = new Set(entries.filter((entry) => entry.status === PatchStatus.Conflicted).map((entry) => entry.newPath));
  return entries
    .filter((entry) => entry.status === PatchStatus.Conflicted || !conflictedPaths.has(entry.newPath))
    .map((entry) => ({ ...entry, binary: binaryPaths.has(entry.newPath) }));
}

// Unified diffs

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/;

// Parses the hunks of a unified diff. The diff is expected to concern a single file.
export function parseHunks(diff: string) {
  const lines = diff.split('\n');
  const hunks: Hunk[] = [];
  let i = 0;
  while (i < lines.length) {
    const match = HUNK_HEADER.exec(lines[i]);
    i += 1;
    if (!match) {
      continue;
    }
    const hunk: Hunk = {
      header: match[0],
      oldStart: parseInt(match[1], 10),
      oldLines: match[2] !== undefined ? parseInt(match[2], 10) : 1,
      newStart: parseInt(match[3], 10),
      newLines: match[4] !== undefined ? parseInt(match[4], 10) : 1,
      lines: []
    };
    let oldLineno = hunk.oldStart;
    let newLineno = hunk.newStart;
    let oldRemaining = hunk.oldLines;
    let newRemaining = hunk.newLines;
    while (i < lines.length && (oldRemaining > 0 || newRemaining > 0 || lines[i].startsWith('\\'))) {
      const line = lines[i];
      i += 1;
      if (line.startsWith('\\')) {
        if (hunk.lines.length > 0) {
          hunk.lines[hunk.lines.length - 1].noNewline = true;
        }
        continue;
      }
      // An empty context line may lose its leading space in some outputs
      const origin = (line.length > 0 ? line[0] : ' ') as DiffLine['origin'];
      const content = line.substring(1);
      if (origin === '+') {
        hunk.lines.push({ origin, content, oldLineno: -1, newLineno: newLineno++, noNewline: false });
        newRemaining -= 1;
      } else if (origin === '-') {
        hunk.lines.push({ origin, content, oldLineno: oldLineno++, newLineno: -1, noNewline: false });
        oldRemaining -= 1;
      } else {
        hunk.lines.push({ origin: ' ', content, oldLineno: oldLineno++, newLineno: newLineno++, noNewline: false });
        oldRemaining -= 1;
        newRemaining -= 1;
      }
    }
    hunks.push(hunk);
  }
  return hunks;
}
