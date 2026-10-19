import type { RepoWrapper } from './repo-wrapper';
import { SHARED } from './branch-focus';
import IntervalTree from 'node-interval-tree';

// The colors have the same luminance so that no branch stands out, and a contrast of at least
// 3:1 with the backgrounds of the commit list in both themes, selected rows included.
// Consecutive colors are far apart in hue so that neighbor branches are easy to tell apart.
export const BRANCH_COLORS = [
  '#347ef6',
  '#e0540b',
  '#0d9186',
  '#aa58f7',
  '#f33455',
  '#149544',
  '#c36b05',
  '#7073f2',
  '#088dad',
  '#e0478b',
  '#59900c',
  '#9266f7',
  '#ef3f3f',
  '#0288ce',
  '#cc44dd',
  '#059468'
];

export function getBranchColor(j: number) {
  return BRANCH_COLORS[j % BRANCH_COLORS.length];
}

// Color of the commits that all the focused references share, they are dimmed
export const SHARED_COLOR = 'var(--text-muted)';

// Color of a commit in the graph and in the commit list: the color of its focused reference when
// several references are focused, otherwise the color of its lane
export function getCommitColor(repo: RepoWrapper, sha: string) {
  const owner = repo.focusLayout ? repo.focusLayout.owners.get(sha) : undefined;
  if (owner !== undefined) {
    return owner === SHARED ? SHARED_COLOR : getBranchColor(owner);
  }
  const position = repo.graph.positions.get(sha);
  return getBranchColor(position ? position[1] : 0);
}

// True if all the focused references have the commit
export function isSharedCommit(repo: RepoWrapper, sha: string) {
  return repo.focusLayout !== null && repo.focusLayout.owners.get(sha) === SHARED;
}

export enum NodeType {
  Commit,
  Stash
}

export type Node = [number, number, NodeType];

export enum EdgeType {
  Normal,
  Merge
}

export type Edge = [[number, number], [number, number], EdgeType];

export class CommitGraph {
  positions: Map<string, Node>;
  width: number;
  edges: IntervalTree<Edge>;

  constructor() {
    this.positions = new Map<string, Node>();
    this.width = 0;
    this.edges = new IntervalTree<Edge>();
  }

  computePositions(repo: RepoWrapper) {
    function insertCommit(commitSha: string, j: number, isForbidden: (j: number) => boolean) {
      // Try to insert as close as possible to i
      // replace i by j
      let dj = 1;
      while (j - dj >= 0 || j + dj < branches.length) {
        if (j + dj < branches.length && branches[j + dj] === null && !isForbidden(j + dj)) {
          branches[j + dj] = commitSha;
          return j + dj;
        } else if (j - dj >= 0 && branches[j - dj] === null && !isForbidden(j - dj)) {
          branches[j - dj] = commitSha;
          return j - dj;
        }
        ++dj;
      }
      // If it is not possible to find an available position, append
      branches.push(commitSha);
      return branches.length - 1;
    }

    this.positions.clear();
    // The focus can leave the head out of the graph, the first lane is then free for the commits
    const headSha = repo.isHeadInGraph() ? repo.headCommit!.sha() : null;
    let i = 1;
    const branches: (string | null)[] = [headSha ? 'index' : null];
    // Last row that used each lane, for a commit or for the end of a branch. A merge edge runs down the lane of the
    // parent from the row of the merge, so the parent avoids the lanes used since its highest merge.
    const lastRow: number[] = [];
    const useLane = (j: number) => {
      lastRow[j] = i;
    };
    const noneForbidden = () => false;
    for (const commit of repo.commits) {
      let j: number;
      const commitSha = commit.sha();
      const children = repo.children.get(commitSha)!;
      const branchChildren: string[] = [];
      // Row of the highest merge child
      let iMin = Infinity;
      for (const childSha of children) {
        if (repo.parents.get(childSha)![0] === commitSha) {
          branchChildren.push(childSha);
        } else {
          iMin = Math.min(iMin, this.positions.get(childSha)![0]);
        }
      }
      const isForbidden = iMin === Infinity ? noneForbidden : (j: number) => lastRow[j] > iMin;
      // Find a commit to replace
      let commitToReplace: string | null = null;
      let jCommitToReplace = Infinity;
      if (commitSha === headSha) {
        commitToReplace = 'index';
        jCommitToReplace = 0;
      } else {
        // The commit can only replace a child whose first parent is this commit
        for (const childSha of branchChildren) {
          const jChild = this.positions.get(childSha)![1]!;
          if (!isForbidden(jChild) && jChild < jCommitToReplace) {
            commitToReplace = childSha;
            jCommitToReplace = jChild;
          }
        }
      }
      // Insert the commit in the active branches
      if (commitToReplace) {
        j = jCommitToReplace;
        branches[j] = commitSha;
      } else {
        if (children.length > 0) {
          const childSha = children[0];
          const jChild = this.positions.get(childSha)![1];
          // Try to insert near a child
          // We could try to insert near any child instead of arbitrarily chosing the first one
          j = insertCommit(commitSha, jChild, isForbidden);
        } else {
          // TODO: Find a better value for j
          // Starting before the first lane takes it when the index does not
          j = insertCommit(commitSha, headSha ? 0 : -1, noneForbidden);
        }
      }
      // The lanes of the commit and of the children it ends are used by this row
      useLane(j);
      for (const childSha of branchChildren) {
        useLane(this.positions.get(childSha)![1]);
      }
      // Remove children from active branches
      for (const childSha of branchChildren) {
        if (childSha != commitToReplace) {
          branches[this.positions.get(childSha)![1]] = null;
        }
      }
      // If the commit has no parent, remove it from active branches
      if (repo.parents.get(commitSha)!.length === 0) {
        branches[j] = null;
      }
      // Finally set the position
      this.positions.set(commitSha, [i, j, repo.stashes.has(commitSha) ? NodeType.Stash : NodeType.Commit]);
      ++i;
    }
    this.width = branches.length;
    this.updateIntervalTree(repo);
  }

  updateIntervalTree(repo: RepoWrapper) {
    this.edges = new IntervalTree<Edge>();
    for (const [commitSha, [i0, j0]] of this.positions) {
      const parents = repo.parents.get(commitSha)!;
      for (const [i, parentSha] of parents.entries()) {
        const [i1, j1] = this.positions.get(parentSha)!;
        this.edges.insert(i0, i1, [[i0, j0], [i1, j1], i > 0 ? EdgeType.Merge : EdgeType.Normal]);
      }
    }
  }
}