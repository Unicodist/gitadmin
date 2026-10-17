import { Field, Settings } from '../../shared/settings';
import { Commit } from './git/model';

// The focus is the list of the references whose history the graph shows, by their full names
// (refs/heads/main), in the order they were chosen. An empty focus shows every reference.
// The reference explorer, the branch picker and the focus bar edit the same focus, and it is
// saved per repository.

// One color per focused reference, as many as BRANCH_COLORS (commit-graph.ts imports this file)
export const MAX_FOCUSED_REFERENCES = 16;

// Owner of the commits that all the focused references share
export const SHARED = -1;

export function isFocused(focus: readonly string[], name: string) {
  return focus.includes(name);
}

export function addToFocus(focus: readonly string[], name: string) {
  return focus.includes(name) || focus.length >= MAX_FOCUSED_REFERENCES ? [...focus] : [...focus, name];
}

export function removeFromFocus(focus: readonly string[], name: string) {
  return focus.filter((focused) => focused !== name);
}

export function toggleFocus(focus: readonly string[], name: string) {
  return focus.includes(name) ? removeFromFocus(focus, name) : addToFocus(focus, name);
}

// Removes the references that do not exist anymore, returns the same list if they all exist
export function pruneFocus(focus: string[], references: { has: (name: string) => boolean }) {
  const pruned = focus.filter((name) => references.has(name));
  return pruned.length === focus.length ? focus : pruned;
}

// Replaces a renamed reference, it keeps its place and so its color
export function renameInFocus(focus: readonly string[], oldName: string, newName: string) {
  return focus.map((name) => name === oldName ? newName : name);
}

// "Showing 2 branches"
export function describeFocus(focus: readonly string[]) {
  return `Showing ${focus.length} ${focus.length === 1 ? 'branch' : 'branches'}`;
}

// Persistence, the focus of each repository is stored under the path of its working directory

function getSavedFocuses(): Record<string, string[]> {
  const value = Settings.get(Field.BranchFocus, {});
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

export function loadFocus(workdir: string): string[] {
  const focus = getSavedFocuses()[workdir];
  return Array.isArray(focus) ?
    focus.filter((name) => typeof name === 'string').slice(0, MAX_FOCUSED_REFERENCES) :
    [];
}

export function saveFocus(workdir: string, focus: readonly string[]) {
  const focuses = getSavedFocuses();
  if (focus.length > 0) {
    focuses[workdir] = [...focus];
  } else {
    delete focuses[workdir];
  }
  Settings.set(Field.BranchFocus, focuses);
}

// Relations between the focused references, computed with git by RepoWrapper.getBranchRelations

export interface BranchComparison {
  left: string;
  right: string;
  // False if the references share no history, ahead and behind are then their whole histories
  related: boolean;
  // Commits of left that right does not have
  ahead: number;
  // Commits of right that left does not have
  behind: number;
}

export interface ForkPoint {
  reference: string;
  // Commit where the reference leaves the history of the other focused references
  sha: string;
}

export interface BranchRelations {
  references: string[];
  // Best common ancestor of all the references, null if they share no history
  mergeBase: string | null;
  // One per reference that has commits the others do not have and shares some history with them
  forkPoints: ForkPoint[];
  // One per pair of references, in the order of the focus
  comparisons: BranchComparison[];
}

// Colors and merges of the focused history, computed from the loaded commits

export interface FocusMerge {
  // Index in the focus of the reference that the merge brings in
  from: number;
  // Index in the focus of the reference that receives it, null if all the references have the merge
  into: number | null;
}

export interface FocusLayout {
  references: string[];
  // Index in the focus of the reference that colors the commit, SHARED if all the references have it
  owners: Map<string, number>;
  // Merge commits that bring a focused reference into another one
  merges: Map<string, FocusMerge[]>;
}

export interface FocusHistory {
  // Children before their parents, like RepoWrapper.commits
  commits: Commit[];
  parents: Map<string, string[]>;
  children: Map<string, string[]>;
  // Commit of each reference
  tips: Map<string, string>;
}

function bits(mask: number) {
  const indices: number[] = [];
  for (let i = 0; mask !== 0; ++i, mask >>>= 1) {
    if (mask & 1) {
      indices.push(i);
    }
  }
  return indices;
}

// Each commit belongs to the focused references that reach it. A commit that only some of them have
// is colored like the smallest of them. Null when fewer than two references are focused: the lanes
// keep their colors.
export function computeFocusLayout(focus: readonly string[], history: FocusHistory): FocusLayout | null {
  const references = focus.filter((name) => history.tips.has(name));
  if (references.length < 2) {
    return null;
  }
  const all = (2 ** references.length) - 1;
  // Bit mask of the references that reach each commit, the children come first
  const tipMasks = new Map<string, number>();
  references.forEach((name, i) => {
    const sha = history.tips.get(name)!;
    tipMasks.set(sha, (tipMasks.get(sha) || 0) | (1 << i));
  });
  const masks = new Map<string, number>();
  const sizes = references.map(() => 0);
  for (const commit of history.commits) {
    const sha = commit.sha();
    let mask = tipMasks.get(sha) || 0;
    for (const child of history.children.get(sha) || []) {
      mask |= masks.get(child) || 0;
    }
    masks.set(sha, mask);
    for (const i of bits(mask)) {
      ++sizes[i];
    }
  }
  // The smallest reference of the mask, the branch the commit was made on rather than the ones that merged or forked from it
  const getSmallest = (mask: number) => {
    const candidates = bits(mask);
    return candidates.reduce((best, i) => sizes[i] < sizes[best] ? i : best, candidates[0]);
  };
  const owners = new Map<string, number>();
  for (const [sha, mask] of masks) {
    if (mask !== 0) {
      owners.set(sha, mask === all ? SHARED : getSmallest(mask));
    }
  }
  // A merge brings the references that reach one of its other parents but not the merge itself
  const merges = new Map<string, FocusMerge[]>();
  for (const commit of history.commits) {
    const sha = commit.sha();
    const parents = history.parents.get(sha) || [];
    const mask = masks.get(sha) || 0;
    const from = new Set<number>();
    for (const parent of parents.slice(1)) {
      const brought = (masks.get(parent) || 0) & ~mask;
      if (brought !== 0) {
        from.add(getSmallest(brought));
      }
    }
    if (from.size > 0) {
      const owner = owners.get(sha);
      const into = owner === undefined || owner === SHARED ? null : owner;
      merges.set(sha, [...from].map((i) => ({ from: i, into })));
    }
  }
  return { references, owners, merges };
}

// Labels of the relations of a commit, for the commit list

export enum RelationKind {
  MergeBase = 'merge-base',
  Fork = 'fork',
  Merge = 'merge'
}

export interface RelationLabel {
  kind: RelationKind;
  // Short text of the badge
  text: string;
  // Full sentence, for the tooltip and the screen readers
  description: string;
}

export function shortenReferenceName(name: string) {
  for (const prefix of ['refs/heads/', 'refs/remotes/', 'refs/tags/']) {
    if (name.startsWith(prefix)) {
      return name.substring(prefix.length);
    }
  }
  return name;
}

// "a", "a and b", "a, b and c"
export function joinNames(names: string[]) {
  return names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

export function getRelationLabels(sha: string, relations: BranchRelations | null, layout: FocusLayout | null): RelationLabel[] {
  const labels: RelationLabel[] = [];
  if (relations) {
    const names = relations.references.map(shortenReferenceName);
    if (relations.mergeBase === sha) {
      labels.push({
        kind: RelationKind.MergeBase,
        text: 'Merge base',
        description: `Merge base of ${joinNames(names)}`
      });
    }
    // The fork points at the merge base are already told by its label
    const forked = relations.forkPoints
      .filter((forkPoint) => forkPoint.sha === sha && forkPoint.sha !== relations.mergeBase)
      .map((forkPoint) => shortenReferenceName(forkPoint.reference));
    if (forked.length > 0) {
      labels.push({
        kind: RelationKind.Fork,
        text: `${forked.join(', ')} forked`,
        description: `${joinNames(forked)} ${forked.length === 1 ? 'forks' : 'fork'} from this commit`
      });
    }
  }
  if (layout) {
    for (const merge of layout.merges.get(sha) || []) {
      const from = shortenReferenceName(layout.references[merge.from]);
      const into = merge.into === null ? null : shortenReferenceName(layout.references[merge.into]);
      labels.push({
        kind: RelationKind.Merge,
        text: into ? `${from} into ${into}` : `${from} merged`,
        description: into ? `Merges ${from} into ${into}` : `Merges ${from}`
      });
    }
  }
  return labels;
}

// "feature is 3 commits ahead and 2 behind main"
export function describeComparison(comparison: BranchComparison) {
  const left = shortenReferenceName(comparison.left);
  const right = shortenReferenceName(comparison.right);
  const commits = (n: number) => `${n} ${n === 1 ? 'commit' : 'commits'}`;
  if (!comparison.related) {
    return `${left} and ${right} share no history`;
  } else if (comparison.ahead === 0 && comparison.behind === 0) {
    return `${left} and ${right} are at the same commit`;
  } else if (comparison.behind === 0) {
    return `${left} is ${commits(comparison.ahead)} ahead of ${right}`;
  } else if (comparison.ahead === 0) {
    return `${left} is ${commits(comparison.behind)} behind ${right}`;
  }
  return `${left} is ${commits(comparison.ahead)} ahead of and ${comparison.behind} behind ${right}`;
}

// Tells why there is no merge base: some of the references may still share history
export function describeMissingMergeBase(relations: BranchRelations) {
  return relations.comparisons.some((comparison) => comparison.related) ? 'No base shared by all' : 'No common history';
}
