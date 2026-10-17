import { Commit, Reference } from './git/model';
import { BRANCH_COLORS, Node } from './commit-graph';

// What the canvas graph draws besides the lanes of commit-graph.ts: a color per branch that does not change with
// the filters, the initials of the authors, and the names of the branches pinned to the top of their lanes.

// Size of the cells of the canvas graph, in pixels at a zoom of 1
export const LANE_WIDTH = 28;
export const ROW_HEIGHT = 36;

export function getLaneX(j: number) {
  return j * LANE_WIDTH + LANE_WIDTH / 2;
}

export function getRowY(i: number) {
  return i * ROW_HEIGHT + ROW_HEIGHT / 2;
}

// "Ada Lovelace" gives "AL", "ada" gives "A"
export function getInitials(name: string) {
  const words = name.trim().split(/[\s._-]+/).filter((word) => word.length > 0 && /\p{L}|\p{N}/u.test(word));
  if (words.length === 0) {
    return '?';
  }
  const first = (word: string) => Array.from(word)[0].toUpperCase();
  return words.length === 1 ? first(words[0]) : first(words[0]) + first(words[words.length - 1]);
}

// Name of the branch that a merge brings in, from the default messages of git and of the forges
export function getMergedBranchName(summary: string) {
  const patterns = [
    /^Merge (?:remote-tracking )?branch '([^']+)'/,
    /^Merge pull request #\d+ from [^/\s]+\/(\S+)/,
    /^Merge branch "([^"]+)"/
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(summary);
    if (match) {
      return match[1];
    }
  }
  return null;
}

// A local branch and its remote branches have the same color: origin/main is main
export function getBranchKey(reference: Reference) {
  if (reference.isRemote()) {
    const name = reference.shorthand();
    return name.substring(name.indexOf('/') + 1);
  }
  return reference.shorthand();
}

function removeRemote(name: string) {
  return name.replace(/^(?:origin|upstream)\//, '');
}

// FNV-1a, so that a name always gets the same color
export function getKeyColor(key: string) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; ++i) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return BRANCH_COLORS[(hash >>> 0) % BRANCH_COLORS.length];
}

export const STASH_KEY = 'stash';

export interface BranchKeyInput {
  // Children before their parents
  commits: readonly Commit[];
  parents: Map<string, string[]>;
  children: Map<string, string[]>;
  references: Iterable<Reference>;
  headName: string | null;
  stashes: { has: (sha: string) => boolean };
}

// The order in which the references claim their history: the head first, then the local branches, the remote
// branches, the tags and the others
function getClaimOrder(reference: Reference, headName: string | null) {
  if (reference.name() === headName) {
    return 0;
  } else if (reference.isBranch()) {
    return 1;
  } else if (reference.isRemote()) {
    return 2;
  } else if (reference.isTag()) {
    return 3;
  }
  return 4;
}

// Branch of each commit: a reference claims its tip and the first parents that no reference claimed before. A
// commit that no reference reaches by first parents takes the branch of its first child on the same line, or the
// branch that the merge of its line names, or else its own SHA.
export function computeBranchKeys(input: BranchKeyInput) {
  const keys = new Map<string, string>();
  const loaded = new Set(input.commits.map((commit) => commit.sha()));
  const references = [...input.references]
    .filter((reference) => loaded.has(reference.commitId))
    .sort((lhs, rhs) => getClaimOrder(lhs, input.headName) - getClaimOrder(rhs, input.headName) ||
      (lhs.name() < rhs.name() ? -1 : lhs.name() > rhs.name() ? 1 : 0));
  for (const reference of references) {
    const key = getBranchKey(reference);
    let sha: string | undefined = reference.commitId;
    while (sha !== undefined && !keys.has(sha) && !input.stashes.has(sha)) {
      keys.set(sha, key);
      sha = (input.parents.get(sha) || [])[0];
    }
  }
  const summaries = new Map(input.commits.map((commit) => [commit.sha(), commit] as [string, Commit]));
  for (const commit of input.commits) {
    const sha = commit.sha();
    if (keys.has(sha)) {
      continue;
    }
    if (input.stashes.has(sha)) {
      keys.set(sha, STASH_KEY);
      continue;
    }
    const children = input.children.get(sha) || [];
    const line = children.find((child) => (input.parents.get(child) || [])[0] === sha && keys.has(child) &&
      !input.stashes.has(child));
    if (line !== undefined) {
      keys.set(sha, keys.get(line)!);
      continue;
    }
    const merge = children.find((child) => (input.parents.get(child) || []).indexOf(sha) > 0);
    const name = merge !== undefined ? getMergedBranchName(summaries.get(merge)!.summary()) : null;
    keys.set(sha, name !== null ? removeRemote(name) : sha);
  }
  return keys;
}

export interface LaneLabel {
  // Short names of the references at the tip
  names: string[];
  lane: number;
  // Row of the tip, and last row of the lane before the history leaves it
  start: number;
  end: number;
}

// The names of the references follow their lanes down, so that they stay in sight after their tips scroll away
export function computeLaneLabels(positions: Map<string, Node>, parents: Map<string, string[]>, references: Iterable<Reference>) {
  const tips = new Map<string, string[]>();
  for (const reference of references) {
    if (positions.has(reference.commitId)) {
      tips.set(reference.commitId, [...(tips.get(reference.commitId) || []), reference.shorthand()]);
    }
  }
  // Last row of the lane of each commit, from the parents to the children so that each commit is visited once
  const ends = new Map<string, number>();
  const shas = [...positions.keys()];
  for (let k = shas.length - 1; k >= 0; --k) {
    const [row, lane] = positions.get(shas[k])!;
    const parent = (parents.get(shas[k]) || [])[0];
    const position = parent !== undefined ? positions.get(parent) : undefined;
    ends.set(shas[k], position && position[1] === lane && position[0] > row ? ends.get(parent!) ?? position[0] : row);
  }
  const labels: LaneLabel[] = [];
  for (const [sha, names] of tips) {
    const [start, lane] = positions.get(sha)!;
    labels.push({ names, lane, start, end: ends.get(sha)! });
  }
  return labels.sort((lhs, rhs) => lhs.start - rhs.start);
}

// The labels to pin at the top of the canvas: their tip is above the first visible row and their lane is still in
// sight. A lane keeps the label of the latest tip.
export function getPinnedLabels(labels: readonly LaneLabel[], firstRow: number) {
  const pinned = new Map<number, LaneLabel>();
  for (const label of labels) {
    if (label.start < firstRow && label.end >= firstRow) {
      pinned.set(label.lane, label);
    }
  }
  return [...pinned.values()];
}
