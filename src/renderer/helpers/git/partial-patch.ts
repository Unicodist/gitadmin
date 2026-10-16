import { DiffLine, Hunk } from './model';

export enum ApplyDirection {
  // The patch is applied as is (staging lines)
  Forward,
  // The patch is applied with --reverse (unstaging or discarding lines)
  Reverse
}

export interface PartialPatchOptions {
  oldPath: string;
  newPath: string;
  // Set to create the file (the old side does not exist)
  newFileMode?: string;
}

// Quote a path the way git does when it contains special characters
export function quotePath(path: string) {
  // eslint-disable-next-line no-control-regex
  if (!/["\\\t\n\r\x00-\x1f]/.test(path)) {
    return path;
  }
  // eslint-disable-next-line no-control-regex
  const escaped = path.replace(/["\\\t\n\r\x00-\x1f]/g, (c) => {
    switch (c) {
      case '"': return '\\"';
      case '\\': return '\\\\';
      case '\t': return '\\t';
      case '\n': return '\\n';
      case '\r': return '\\r';
      default: return `\\${c.charCodeAt(0).toString(8).padStart(3, '0')}`;
    }
  });
  return `"${escaped}"`;
}

function formatRange(start: number, count: number) {
  // An empty range starts at the line before it, a non empty one at its first line
  start = count === 0 ? Math.max(start, 0) : Math.max(start, 1);
  return count === 1 ? `${start}` : `${start},${count}`;
}

// Builds a patch that only contains the selected lines of the hunks.
//
// The patch is meant to be applied with `git apply` in the given direction:
// - Forward: the old side must match the target, so unselected removed lines
//   become context and unselected added lines are dropped.
// - Reverse: the new side must match the target, so unselected added lines
//   become context and unselected removed lines are dropped.
//
// Returns null if no changed line is selected. Apply the result with --recount.
export function buildPartialPatch(hunks: Hunk[], selectedLines: Set<DiffLine>, direction: ApplyDirection, options: PartialPatchOptions) {
  const body: string[] = [];
  let offset = 0;
  for (const hunk of hunks) {
    const lines: string[] = [];
    let oldCount = 0;
    let newCount = 0;
    let hasChange = false;
    for (const line of hunk.lines) {
      const selected = selectedLines.has(line);
      let origin: string | null;
      if (line.origin === ' ') {
        origin = ' ';
      } else if (selected) {
        origin = line.origin;
        hasChange = true;
      } else if ((line.origin === '-') === (direction === ApplyDirection.Forward)) {
        origin = ' ';
      } else {
        origin = null;
      }
      if (origin === null) {
        continue;
      }
      if (origin !== '+') {
        oldCount += 1;
      }
      if (origin !== '-') {
        newCount += 1;
      }
      lines.push(`${origin}${line.content}`);
      if (line.noNewline) {
        lines.push('\\ No newline at end of file');
      }
    }
    if (!hasChange) {
      continue;
    }
    // The side matching the target is identical to the original hunk,
    // the other side is shifted by the lines dropped from previous hunks
    let oldStart: number;
    let newStart: number;
    if (direction === ApplyDirection.Forward) {
      oldStart = hunk.oldStart;
      newStart = hunk.newStart + offset;
      offset += newCount - hunk.newLines;
    } else {
      oldStart = hunk.oldStart + offset;
      newStart = hunk.newStart;
      offset += oldCount - hunk.oldLines;
    }
    body.push(`@@ -${formatRange(oldStart, oldCount)} +${formatRange(newStart, newCount)} @@`, ...lines);
  }
  if (body.length === 0) {
    return null;
  }
  const oldPath = quotePath(`a/${options.oldPath}`);
  const newPath = quotePath(`b/${options.newPath}`);
  const header = [`diff --git ${oldPath} ${newPath}`];
  if (options.newFileMode) {
    header.push(`new file mode ${options.newFileMode}`, '--- /dev/null');
  } else {
    header.push(`--- ${oldPath}`);
  }
  header.push(`+++ ${newPath}`);
  return [...header, ...body].join('\n') + '\n';
}
