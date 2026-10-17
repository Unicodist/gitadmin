import * as Path from 'path';
import * as fs from 'fs';
import ignore, { Ignore } from 'ignore';
import { CommitGraph } from './commit-graph';
import { Field, Settings } from '../../shared/settings';
import { NotificationType } from '../components/notification-item';
import { git, gitBuffer } from './git/runner';
import { CancelledError, getSshCommand, getSshHostKeys, runNetworkCommand } from './git/network';
import { Commit, DiffFile, DiffLine, Hunk, Patch, PatchStatus, Reference, Stash } from './git/model';
import {
  COMMIT_FORMAT, DiffEntry, REFERENCE_FORMAT, parseCommits, parseDiffSummary, parseHunks, parseLineCounts, parseReferences
} from './git/parsers';
import { ApplyDirection, buildPartialPatch } from './git/partial-patch';
import { BranchComparison, BranchRelations, FocusLayout, ForkPoint, computeFocusLayout, pruneFocus, renameInFocus } from './branch-focus';
import { BranchSummary, FileChange, MergeCheck, countAuthors, getSourceCandidates, getTimeSpan } from './branch-summary';
import { DEFAULT_FILTERS, GraphFilters, areFiltersEqual, hasActiveFilters, isBadgeShown, isReferenceShown, showsStashes } from './graph-filters';

export { Commit, DiffFile, DiffLine, Hunk, Patch, PatchStatus, Reference, Stash } from './git/model';

// Accepts a working directory or a .git directory (the format used by older versions of the app)
export function getRepoName(path: string) {
  const parsed = Path.parse(path.replace(/[\\/]+$/, ''));
  return parsed.base === '.git' ? Path.basename(parsed.dir) : parsed.base;
}

export function shortenSha(sha: string) {
  return sha.substring(0, 6);
}

export function removeReferencePrefix(name: string) {
  return name.substring(name.indexOf('/', name.indexOf('/') + 1) + 1);
}

// Default message of a merge commit, as git writes it
export function getMergeMessage(referenceName: string) {
  const reference = new Reference(referenceName, '', '');
  if (reference.isBranch()) {
    return `Merge branch '${reference.shorthand()}'`;
  } else if (reference.isRemote()) {
    return `Merge remote-tracking branch '${reference.shorthand()}'`;
  } else if (reference.isTag()) {
    return `Merge tag '${reference.shorthand()}'`;
  }
  return `Merge commit '${referenceName}'`;
}

export enum PatchType {
  Unstaged,
  Staged,
  Committed
}

export enum RepoState {
  Cherrypick,
  Commit,
  Merge,
  Rebase,
  Revert
}

export enum ResetType {
  Soft = 'soft',
  Mixed = 'mixed',
  Hard = 'hard'
}

// Version of a conflicted file, git calls the current one "ours" and the incoming one "theirs"
export enum ConflictVersion {
  Current = 'ours',
  Incoming = 'theirs'
}

export interface RepoLocation {
  workdir: string;
  gitDir: string;
}

export interface Identity {
  name: string;
  email: string;
}

export interface RepoWrapperOptions {
  // Identity used for new commits, null to use the git configuration
  getIdentity?: () => Identity | null;
}

function getIdentityFromSettings(): Identity | null {
  const name = Settings.get(Field.Name);
  const email = Settings.get(Field.Email);
  return name && email ? { name, email } : null;
}

function errorMessage(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}

// Calls the function on each item with at most a few calls running at once, the results keep the order of the items
async function mapConcurrently<T, R>(items: T[], fn: (item: T, index: number) => Promise<R>, limit = 4) {
  const results: R[] = new Array(items.length);
  let next = 0;
  const run = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

const DIFF_OPTIONS = ['--no-color', '--no-ext-diff', '--no-textconv'];
const SUMMARY_OPTIONS = ['--raw', '--numstat', '-z', '--no-abbrev', '-M', '-C'];

export class RepoWrapper {
  path: string; // Path of the .git directory
  workdir: string;
  name: string;
  commits: Commit[];
  shaToCommit: Map<string, Commit>;
  shaToIndex: Map<string, number>;
  references: Map<string, Reference>;
  shaToReferences: Map<string, string[]>;
  stashes: Map<string, Stash>;
  parents: Map<string, string[]>;
  children: Map<string, string[]>;
  head: Reference | null;
  headCommit: Commit | null;
  graph: CommitGraph;
  unstagedPatches: Patch[];
  stagedPatches: Patch[];
  // Full names of the references whose history is loaded, every reference and stash when it is empty
  focus: string[];
  // Quick filters of the history while nothing is focused
  filters: GraphFilters;
  // Relations between the focused references, null when fewer than two are focused
  relations: BranchRelations | null;
  // Colors and merges of the focused history, null when fewer than two references are focused
  focusLayout: FocusLayout | null;
  onNotification: (message: string, type: NotificationType) => void;
  // Internals
  updateCommitsPromise: Promise<void>; // Used to queue commit updates
  ig: Ignore;
  headName: string | null;
  headSha: string | null;
  loadedHeadName: string | null; // Head when the history was last loaded again, the current branch filter follows it
  relationsKey: string; // Focused references and their commits when the relations were computed
  getIdentity: () => Identity | null;

  constructor(location: RepoLocation, onNotification: (message: string, type: NotificationType) => void, options: RepoWrapperOptions = {}) {
    this.path = location.gitDir;
    this.workdir = location.workdir;
    this.name = getRepoName(this.workdir);
    this.commits = [];
    this.shaToCommit = new Map<string, Commit>();
    this.shaToIndex = new Map<string, number>();
    this.references = new Map<string, Reference>();
    this.shaToReferences = new Map<string, string[]>();
    this.stashes = new Map<string, Stash>();
    this.parents = new Map<string, string[]>();
    this.children = new Map<string, string[]>();
    this.head = null;
    this.headCommit = null;
    this.graph = new CommitGraph();
    this.unstagedPatches = [];
    this.stagedPatches = [];
    this.focus = [];
    this.filters = DEFAULT_FILTERS;
    this.relations = null;
    this.focusLayout = null;
    this.onNotification = onNotification;
    this.updateCommitsPromise = Promise.resolve();
    this.ig = ignore();
    this.headName = null;
    this.headSha = null;
    this.loadedHeadName = null;
    this.relationsKey = '';
    this.getIdentity = options.getIdentity || getIdentityFromSettings;
  }

  git(args: string[], options: Parameters<typeof git>[2] = {}) {
    return git(args, this.workdir, options);
  }

  async init() {
    await this.updateCommits();
    await this.updateHead();
    await this.updateGraph();
    await this.updateIndex();
    this.updateIgnore();
  }

  async requestUpdateCommits() {
    // Start an update only if the previous ones have finished
    this.updateCommitsPromise = this.updateCommitsPromise.then(() => this.updateCommits());
    await this.updateCommitsPromise;
  }

  // Loads the new commits, or all of them again when the focus or the filters change
  async updateCommits(focus?: string[], filters?: GraphFilters) {
    let referencesToUpdate = await this.updateReferences();
    let stashesToUpdate = await this.updateStashes();
    await this.readHead();
    // A focused reference may have been removed
    const newFocus = pruneFocus(focus || this.focus, this.references);
    const newFilters = filters || this.filters;
    const focused = newFocus.length > 0;
    // The current branch changes with the head
    const headMoved = !focused && newFilters.currentBranchOnly && this.loadedHeadName !== this.headName;
    const reload = newFocus !== this.focus || !areFiltersEqual(newFilters, this.filters) || headMoved;
    if (reload) {
      referencesToUpdate = [...this.references.values()];
      stashesToUpdate = [...this.stashes.values()];
    }
    const tips = focused ?
      referencesToUpdate.filter((reference) => newFocus.includes(reference.name())) :
      referencesToUpdate.filter((reference) => isReferenceShown(reference, newFilters, this.headName));
    const stashes = focused || !showsStashes(newFilters) ? [] : stashesToUpdate;
    // The commits are only replaced once they are all read, the lists keep showing the previous ones in the meantime
    const newCommits = await this.readNewCommits(tips, stashes, !focused, reload);
    if (reload) {
      this.focus = newFocus;
      this.filters = newFilters;
      this.loadedHeadName = this.headName;
      this.clearCommits();
    }
    this.addCommits(newCommits);
    this.updateShaToReferences();
    this.getParents(newCommits);
    this.removeUnreachableCommits();
    this.sortCommits();
    if (reload) {
      // Every commit has a position again before the lists are drawn
      this.updateGraph();
    }
    // Computing the relations runs git for each pair of references, only when they moved
    const relationsKey = this.focus.map((name) => `${name} ${this.references.get(name)!.commitId}`).join('\n');
    if (relationsKey !== this.relationsKey) {
      this.relations = await this.getBranchRelations(this.focus);
      this.relationsKey = relationsKey;
    }
  }

  isFocused() {
    return this.focus.length > 0;
  }

  // True if the filters leave some history out, they only apply while nothing is focused
  isFiltered() {
    return !this.isFocused() && hasActiveFilters(this.filters);
  }

  // True if the reference gets a badge in the graph
  isBadgeShown(reference: Reference) {
    return this.isFocused() || isBadgeShown(reference, this.filters);
  }

  // Shows only part of the history while nothing is focused
  async setFilters(filters: GraphFilters) {
    this.updateCommitsPromise = this.updateCommitsPromise.then(() => this.updateCommits(undefined, { ...filters }));
    await this.updateCommitsPromise;
    await this.updateHead();
    this.updateGraph();
  }

  // Shows only the history of these references, or of everything if the list is empty
  async setFocus(focus: string[]) {
    // Queued like the other updates, a new list is always different from the current one
    this.updateCommitsPromise = this.updateCommitsPromise.then(() => this.updateCommits([...new Set(focus)]));
    await this.updateCommitsPromise;
    await this.updateHead();
    this.updateGraph();
  }

  clearCommits() {
    this.commits = [];
    this.shaToCommit.clear();
    this.shaToIndex.clear();
    this.parents.clear();
    this.children.clear();
  }

  // True if the history of the reference is not loaded because of the focus
  isHidden(reference: Reference) {
    return !this.shaToCommit.has(reference.commitId);
  }

  async updateReferences() {
    const references = await this.getReferences();
    const referencesToUpdate: Reference[] = [];
    const newReferences = new Map<string, Reference>();
    for (const reference of references) {
      const name = reference.name();
      const previous = this.references.get(name);
      if (!previous || previous.commitId !== reference.commitId) {
        referencesToUpdate.push(reference);
      }
      newReferences.set(name, reference);
    }
    this.references = newReferences;
    return referencesToUpdate;
  }

  async updateStashes() {
    const stashes = await this.getStashes();
    const stashesToUpdate: Stash[] = [];
    for (const [sha, stash] of stashes) {
      if (!this.stashes.has(sha)) {
        stashesToUpdate.push(stash);
      }
    }
    this.stashes = stashes;
    return stashesToUpdate;
  }

  updateShaToReferences() {
    this.shaToReferences.clear();
    for (const [name, reference] of this.references) {
      const commitSha = reference.commitId;
      if (!this.shaToReferences.has(commitSha)) {
        this.shaToReferences.set(commitSha, []);
      }
      this.shaToReferences.get(commitSha)!.push(name);
    }
  }

  // Reads the commits that are not loaded yet, or all of them for a reload
  async readNewCommits(references: Reference[], stashes: Stash[], withHead: boolean, reload: boolean) {
    const isLoaded = (sha: string) => !reload && this.shaToCommit.has(sha);
    // Start from the updated references, the parents of the new stashes, and a detached head
    const tips = new Set<string>(references.map((reference) => reference.commitId));
    for (const stash of stashes) {
      tips.add(stash.commit.parentIds[0]);
    }
    if (withHead && this.headSha && !isLoaded(this.headSha)) {
      tips.add(this.headSha);
    }
    const newCommits: Commit[] = [];
    if (tips.size > 0) {
      // Prevent from retrieving commits already loaded: hiding the commits
      // without loaded children hides all their ancestors
      const hidden = reload ? [] : this.commits
        .filter((commit) => this.children.get(commit.sha())!.length === 0)
        .map((commit) => `^${commit.sha()}`);
      const output = await this.git(['log', '-z', `--format=${COMMIT_FORMAT}`, '--ignore-missing', '--stdin'], {
        stdin: [...tips, ...hidden].join('\n') + '\n'
      });
      newCommits.push(...parseCommits(output).filter((commit) => !isLoaded(commit.sha())));
    }
    // Stash commits are only linked to the commit they were created on
    for (const stash of stashes) {
      if (!isLoaded(stash.commit.sha())) {
        newCommits.push(stash.commit);
      }
    }
    return newCommits;
  }

  addCommits(commits: Commit[]) {
    for (const commit of commits) {
      this.commits.push(commit);
      this.shaToCommit.set(commit.sha(), commit);
    }
  }

  getParents(commits: Commit[]) {
    for (const commit of commits) {
      this.children.set(commit.sha(), []);
    }
    for (const commit of commits) {
      const commitSha = commit.sha();
      const parentShas = this.stashes.has(commitSha) ?
        commit.parentIds.slice(0, 1) :
        commit.parentIds.filter((parentSha) => this.shaToCommit.has(parentSha)); // Shallow clones
      this.parents.set(commitSha, parentShas);
      // Update children
      for (const parentSha of parentShas) {
        this.children.get(parentSha)!.push(commitSha);
      }
    }
  }

  removeUnreachableCommits() {
    // Find unreachable commits by doing a DFS
    const alreadyAdded = new Set<string>();
    const frontier: string[] = this.isFocused() ?
      this.focus.map((name) => this.references.get(name)!.commitId) : [
        ...Array.from(this.references.values())
          .filter((reference) => isReferenceShown(reference, this.filters, this.headName))
          .map((reference) => reference.commitId),
        ...(showsStashes(this.filters) ? this.stashes.keys() : [])
      ];
    if (this.headSha && !this.isFocused()) {
      frontier.push(this.headSha);
    }
    for (const sha of frontier) {
      alreadyAdded.add(sha);
    }
    while (frontier.length > 0) {
      const commitSha = frontier.pop()!;
      for (const parentSha of this.parents.get(commitSha) || []) {
        if (!alreadyAdded.has(parentSha)) {
          alreadyAdded.add(parentSha);
          frontier.push(parentSha);
        }
      }
    }
    const commitsToRemove = this.commits.filter((commit) => !alreadyAdded.has(commit.sha()));
    for (const commit of commitsToRemove) {
      this.removeCommit(commit);
    }
  }

  removeCommit(commit: Commit) {
    const commitSha = commit.sha();
    this.commits.splice(this.commits.indexOf(this.shaToCommit.get(commitSha)!), 1); // TODO: batch removal or update shaToIndex before removal
    this.shaToCommit.delete(commitSha);
    for (const parentSha of this.parents.get(commitSha)!) {
      const parentChildren = this.children.get(parentSha)!;
      parentChildren.splice(parentChildren.indexOf(commitSha), 1);
    }
    this.parents.delete(commitSha);
    for (const childSha of this.children.get(commitSha)!) {
      const childParents = this.parents.get(childSha)!;
      childParents.splice(childParents.indexOf(commitSha), 1);
    }
    this.children.delete(commitSha);
  }

  sortCommits() {
    const sortedCommits: Commit[] = [];
    const alreadySeen = new Set<string>();
    // Iterative DFS, recursion overflows the stack on long histories
    const dfs = (root: Commit) => {
      const stack: [Commit, number][] = [[root, 0]];
      alreadySeen.add(root.sha());
      while (stack.length > 0) {
        const top = stack[stack.length - 1];
        const children = this.children.get(top[0].sha())!;
        if (top[1] < children.length) {
          const child = this.shaToCommit.get(children[top[1]])!;
          top[1] += 1;
          if (!alreadySeen.has(child.sha())) {
            alreadySeen.add(child.sha());
            stack.push([child, 0]);
          }
        } else {
          sortedCommits.push(top[0]);
          stack.pop();
        }
      }
    };

    // Sort the commits by date (from newer to older)
    this.commits.sort((lhs, rhs) => rhs.date().valueOf() - lhs.date().valueOf());
    // Topological sort (from parent to children)
    for (const commit of this.commits) {
      if (!alreadySeen.has(commit.sha())) {
        dfs(commit);
      }
    }
    this.commits = sortedCommits;
    // Update shaToIndex
    this.shaToIndex = new Map(this.commits.map((commit, i) => [commit.sha(), i] as [string, number]));
  }

  async readHead() {
    const name = (await this.git(['symbolic-ref', '-q', 'HEAD'], { okExitCodes: [1] })).trim();
    const sha = (await this.git(['rev-parse', '-q', '--verify', 'HEAD^{commit}'], { okExitCodes: [1] })).trim();
    this.headName = name || null;
    this.headSha = sha || null;
  }

  async updateHead() {
    await this.readHead();
    this.head = this.headName ? this.references.get(this.headName) || null : null;
    // The focus can leave the head out of the graph, the index still needs its commit
    this.headCommit = this.headSha ? this.shaToCommit.get(this.headSha) || await this.readCommit(this.headSha) : null;
  }

  async readCommit(sha: string) {
    const output = await this.git(['log', '-1', '-z', `--format=${COMMIT_FORMAT}`, sha, '--'], { okExitCodes: [128] });
    return parseCommits(output)[0] || null;
  }

  // True if the head commit is in the graph, the index is then linked to it
  isHeadInGraph() {
    return this.headCommit !== null && this.shaToIndex.has(this.headCommit.sha());
  }

  updateGraph() {
    this.graph.computePositions(this);
    this.focusLayout = computeFocusLayout(this.focus, {
      commits: this.commits,
      parents: this.parents,
      children: this.children,
      tips: new Map(this.focus.filter((name) => this.references.has(name)).map((name) => [name, this.references.get(name)!.commitId]))
    });
  }

  async updateIndex() {
    this.stagedPatches = await this.getStagedPatches();
    this.unstagedPatches = await this.getUnstagedPatches();
  }

  // Repo creation

  static async open(path: string): Promise<RepoLocation> {
    path = Path.resolve(path);
    let gitDir = (await git(['rev-parse', '--absolute-git-dir'], path)).trim();
    const insideGitDir = (await git(['rev-parse', '--is-inside-git-dir'], path)).trim() === 'true';
    const cwd = insideGitDir ? Path.dirname(gitDir) : path;
    const workdir = (await git(['rev-parse', '--show-toplevel'], cwd)).trim();
    if (!workdir) {
      throw new Error('Bare repositories are not supported');
    }
    gitDir = (await git(['rev-parse', '--absolute-git-dir'], workdir)).trim();
    return { workdir: Path.normalize(workdir), gitDir: Path.normalize(gitDir) };
  }

  static async clone(url: string, path: string) {
    path = Path.resolve(path);
    const parent = Path.dirname(path);
    fs.mkdirSync(parent, { recursive: true });
    await runNetworkCommand(url, (env) => git(['clone', '--', url, path], parent, { env }));
    return await RepoWrapper.open(path);
  }

  static async init(path: string) {
    path = Path.resolve(path);
    fs.mkdirSync(path, { recursive: true });
    await git(['init', '--quiet', '--', path], path);
    return await RepoWrapper.open(path);
  }

  // State

  getState() {
    const exists = (name: string) => fs.existsSync(Path.join(this.path, name));
    if (exists('rebase-merge') || exists('rebase-apply')) {
      return RepoState.Rebase;
    } else if (exists('MERGE_HEAD')) {
      return RepoState.Merge;
    } else if (exists('REVERT_HEAD')) {
      return RepoState.Revert;
    } else if (exists('CHERRY_PICK_HEAD')) {
      return RepoState.Cherrypick;
    } else {
      return RepoState.Commit;
    }
  }

  // Runs an operation and notifies the user if it fails
  async tryRun<T>(failureMessage: string, operation: () => Promise<T>, successMessage?: string) {
    try {
      const result = await operation();
      if (successMessage) {
        this.onNotification(successMessage, NotificationType.Information);
      }
      return result;
    } catch (e) {
      // The user cancelled a prompt for credentials
      if (!(e instanceof CancelledError)) {
        this.onNotification(`${failureMessage}: ${errorMessage(e)}`, NotificationType.Error);
      }
      return null;
    }
  }

  // Head operations

  async checkoutReference(reference: Reference) {
    const target = reference.isBranch() ? [reference.shorthand()] : ['--detach', reference.name()];
    await this.tryRun(`Unable to checkout to ${reference.shorthand()}`,
      () => this.git(['checkout', '--quiet', ...target, '--']),
      `Checked out ${reference.shorthand()}`);
  }

  async reset(target: Commit, resetType: ResetType) {
    await this.tryRun(`Unable to reset to ${target.sha()}`,
      () => this.git(['reset', '--quiet', `--${resetType}`, target.sha(), '--']));
  }

  // Index operations

  createPatch(entry: DiffEntry, newId: string | null, loadDiff: (entry: DiffEntry) => Promise<string>) {
    const oldExists = entry.status !== PatchStatus.Added && entry.status !== PatchStatus.Untracked;
    const newExists = entry.status !== PatchStatus.Deleted;
    return new Patch(
      entry.status,
      { path: entry.oldPath, id: entry.oldId, mode: entry.oldMode, exists: oldExists },
      { path: entry.newPath, id: newId, mode: entry.newMode, exists: newExists },
      entry.binary,
      async () => parseHunks(await loadDiff(entry))
    );
  }

  async getUnstagedPatches() {
    const summary = await this.git(['diff', ...SUMMARY_OPTIONS]);
    const entries = parseDiffSummary(summary);
    // Untracked files
    const untracked = (await this.git(['ls-files', '--others', '--exclude-standard', '-z']))
      .split('\0')
      .filter((path) => path.length > 0);
    for (const path of untracked) {
      entries.push({
        status: PatchStatus.Untracked,
        oldPath: path,
        newPath: path,
        oldMode: '000000',
        newMode: '100644',
        oldId: null,
        newId: null,
        binary: false
      });
    }
    // The working directory side has no id, hash the files so that the patches can be compared
    const toHash = entries.filter((entry) => entry.status !== PatchStatus.Deleted &&
      entry.status !== PatchStatus.Conflicted && !entry.newPath.includes('\n'));
    const ids = new Map<string, string>();
    if (toHash.length > 0) {
      try {
        const output = await this.git(['hash-object', '--stdin-paths'], {
          stdin: toHash.map((entry) => entry.newPath).join('\n') + '\n'
        });
        output.trim().split('\n').forEach((id, i) => ids.set(toHash[i].newPath, id));
      } catch (e) {
        // A file may have been removed in the meantime, the patches will be reloaded
      }
    }
    return entries.map((entry) => this.createPatch(entry, ids.get(entry.newPath) || null, (entry) => {
      if (entry.status === PatchStatus.Untracked) {
        return this.git(['diff', ...DIFF_OPTIONS, '--no-index', '--', '/dev/null', entry.newPath], { okExitCodes: [1] });
      }
      return this.git(['diff', ...DIFF_OPTIONS, '-U3', '--', entry.newPath]);
    }));
  }

  async getStagedPatches() {
    const summary = await this.git(['diff', '--cached', ...SUMMARY_OPTIONS]);
    // Conflicts are not staged, they are listed with the unstaged patches
    const entries = parseDiffSummary(summary).filter((entry) => entry.status !== PatchStatus.Conflicted);
    return entries.map((entry) => this.createPatch(entry, entry.newId, (entry) =>
      this.git(['diff', '--cached', ...DIFF_OPTIONS, '-M', '-C', '-U3', '--', ...new Set([entry.oldPath, entry.newPath])])));
  }

  async applyPatch(patch: Patch, lines: DiffLine[], direction: ApplyDirection, applyArgs: string[]) {
    const hunks = await patch.hunks();
    let newFileMode: string | undefined;
    if (direction === ApplyDirection.Forward && patch.isUntracked()) {
      const stats = fs.statSync(Path.join(this.workdir, patch.newFile.path));
      newFileMode = stats.mode & 0o111 ? '100755' : '100644';
    }
    const partialPatch = buildPartialPatch(hunks, new Set(lines), direction, {
      oldPath: patch.isUntracked() ? patch.newFile.path : patch.oldFile.path,
      newPath: patch.newFile.path,
      newFileMode: newFileMode
    });
    if (partialPatch) {
      await this.git(['apply', '--recount', '--whitespace=nowarn', ...applyArgs, '-'], { stdin: partialPatch });
    }
  }

  async stageLines(patch: Patch, lines: DiffLine[]) {
    await this.tryRun('Unable to stage lines',
      () => this.applyPatch(patch, lines, ApplyDirection.Forward, ['--cached']));
  }

  async stageHunk(patch: Patch, hunk: Hunk) {
    await this.stageLines(patch, hunk.lines);
  }

  async stagePatch(patch: Patch) {
    await this.stageAll([patch]);
  }

  async stageAll(patches: Patch[]) {
    const paths = new Set<string>();
    for (const patch of patches) {
      paths.add(patch.newFile.path);
      if (patch.isRenamed()) {
        paths.add(patch.oldFile.path);
      }
    }
    if (paths.size > 0) {
      await this.tryRun('Unable to stage', () => this.git(['add', '--all', '--', ...paths]));
    }
  }

  async unstageLines(patch: Patch, lines: DiffLine[]) {
    await this.tryRun('Unable to unstage lines',
      () => this.applyPatch(patch, lines, ApplyDirection.Reverse, ['--cached', '--reverse']));
  }

  async unstageHunk(patch: Patch, hunk: Hunk) {
    await this.unstageLines(patch, hunk.lines);
  }

  async unstagePatch(patch: Patch) {
    await this.unstageAll([patch]);
  }

  async unstageAll(patches: Patch[]) {
    const paths = new Set<string>();
    for (const patch of patches) {
      paths.add(patch.newFile.path);
      if (patch.isRenamed()) {
        paths.add(patch.oldFile.path);
      }
    }
    if (paths.size > 0) {
      await this.tryRun('Unable to unstage', async () => {
        await this.readHead();
        if (this.headSha) {
          await this.git(['reset', '--quiet', 'HEAD', '--', ...paths]);
        } else {
          // Nothing is committed yet
          await this.git(['rm', '--cached', '--quiet', '-r', '--', ...paths]);
        }
      });
    }
  }

  async discardLines(patch: Patch, lines: DiffLine[]) {
    await this.tryRun('Unable to discard lines',
      () => this.applyPatch(patch, lines, ApplyDirection.Reverse, ['--reverse']));
  }

  async discardHunk(patch: Patch, hunk: Hunk) {
    await this.discardLines(patch, hunk.lines);
  }

  // Discards the unstaged changes of a file
  async discardPatch(patch: Patch) {
    await this.tryRun('Unable to discard changes', async () => {
      if (patch.isUntracked()) {
        await fs.promises.unlink(Path.join(this.workdir, patch.newFile.path));
      } else {
        await this.git(['checkout', '--quiet', '--', patch.newFile.path]);
      }
    });
  }

  // Replaces a conflicted file of the working directory with one of its versions, the file stays conflicted until it is staged
  async checkoutConflictVersion(patch: Patch, version: ConflictVersion) {
    const failureMessage = version === ConflictVersion.Current ? 'Unable to keep the current version' : 'Unable to take the incoming version';
    await this.tryRun(failureMessage, () => this.git(['checkout', '--quiet', `--${version}`, '--', patch.newFile.path]));
  }

  getIdentityEnvironment(committerOnly = false) {
    const identity = this.getIdentity();
    if (!identity) {
      return {};
    }
    const committer = {
      GIT_COMMITTER_NAME: identity.name,
      GIT_COMMITTER_EMAIL: identity.email
    };
    return committerOnly ? committer : {
      ...committer,
      GIT_AUTHOR_NAME: identity.name,
      GIT_AUTHOR_EMAIL: identity.email
    };
  }

  async commit(message: string) {
    // During a merge, git uses MERGE_HEAD to create the merge commit
    await this.tryRun('Unable to commit', () => this.git(['commit', '--quiet', '--cleanup=whitespace', '-F', '-'], {
      stdin: message,
      env: this.getIdentityEnvironment()
    }));
  }

  async amend(message: string) {
    await this.tryRun('Unable to amend', () => this.git(['commit', '--quiet', '--amend', '--cleanup=whitespace', '-F', '-'], {
      stdin: message,
      env: this.getIdentityEnvironment(true)
    }));
  }

  mainlineArgs(commit: Commit) {
    return commit.parentIds.length > 1 ? ['-m', '1'] : [];
  }

  async cherrypick(commit: Commit) {
    await this.tryRun('Unable to cherrypick', () => this.git(['cherry-pick', ...this.mainlineArgs(commit), commit.sha()], {
      env: this.getIdentityEnvironment(true)
    }));
  }

  async revert(commit: Commit) {
    await this.tryRun('Unable to revert', () => this.git(['revert', '--no-edit', ...this.mainlineArgs(commit), commit.sha()], {
      env: this.getIdentityEnvironment()
    }));
  }

  // Reference operations

  async getReferences() {
    const output = await this.git(['for-each-ref', `--format=${REFERENCE_FORMAT}`]);
    // Filter stash
    return parseReferences(output).filter((reference) => reference.name() !== 'refs/stash');
  }

  getReferenceCommits() {
    return Array.from(this.references.values(), (reference) => this.getReferenceCommit(reference));
  }

  // Undefined if the history of the reference is hidden by the focus
  getReferenceCommit(reference: Reference) {
    return this.shaToCommit.get(reference.commitId);
  }

  // Relations

  // Best common ancestor of the commits, null if they share no history
  async getMergeBase(shas: string[], octopus = false) {
    const output = await this.git(['merge-base', ...(octopus ? ['--octopus'] : []), ...shas], { okExitCodes: [1] });
    return output.trim() || null;
  }

  // Number of commits of left that right does not have, and of right that left does not have
  async compareCommits(left: string, right: string): Promise<[number, number]> {
    const output = await this.git(['rev-list', '--left-right', '--count', `${left}...${right}`, '--']);
    const [ahead, behind] = output.trim().split(/\s+/).map((count) => parseInt(count, 10));
    return [ahead, behind];
  }

  async getBranchRelations(names: string[]): Promise<BranchRelations | null> {
    const references = names.filter((name) => this.references.has(name));
    if (references.length < 2) {
      return null;
    }
    const tips = references.map((name) => this.references.get(name)!.commitId);
    const pairs: [number, number][] = [];
    for (let i = 0; i < references.length; ++i) {
      for (let j = i + 1; j < references.length; ++j) {
        pairs.push([i, j]);
      }
    }
    // The git commands are independent, a few of them run at the same time
    const [mergeBase, forkPoints, comparisons] = await Promise.all([
      this.getMergeBase(tips, true),
      // Where each reference leaves the history of the others: git merges the others before looking for the base
      mapConcurrently(references, async (reference, i) => {
        const base = await this.getMergeBase([tips[i], ...tips.filter((_tip, j) => j !== i)]);
        // A reference that the others contain does not fork
        return base !== null && base !== tips[i] ? { reference, sha: base } : null;
      }),
      mapConcurrently(pairs, async ([i, j]): Promise<BranchComparison> => {
        const [related, [ahead, behind]] = await Promise.all([
          this.getMergeBase([tips[i], tips[j]]).then((base) => base !== null),
          this.compareCommits(tips[i], tips[j])
        ]);
        return { left: references[i], right: references[j], related, ahead, behind };
      })
    ]);
    return {
      references,
      mergeBase,
      forkPoints: forkPoints.filter((forkPoint): forkPoint is ForkPoint => forkPoint !== null),
      comparisons
    };
  }

  // Branch summary

  // Commit where the branch was taken out of the source, null if they share no history. git merge-base --fork-point
  // uses the reflog of the source, so that a branch taken out of commits the source dropped since then still forks
  // from them. When the branch merged the source in since then, its first parents lead back to where it was taken out.
  async getForkPoint(source: string, branch: string) {
    const forkPoint = (await this.git(['merge-base', '--fork-point', source, branch], { okExitCodes: [1] })).trim();
    const base = forkPoint || await this.getMergeBase([source, branch]);
    if (base === null) {
      return { forkPoint: null, base: null };
    }
    const output = await this.git(['rev-list', '--first-parent', '--reverse', branch, `^${base}`, `^${source}`, '--']);
    const first = output.split('\n').find((sha) => sha.length > 0);
    const firstCommit = first ? await this.readCommit(first) : null;
    // A branch that the source contains, or whose first parents never reach the source, forks from the base
    return { forkPoint: firstCommit && firstCommit.parentIds.length > 0 ? firstCommit.parentIds[0] : base, base };
  }

  // Main branch that the branch was most likely taken out of: the one it has the fewest commits since, null if
  // it shares no history with any of them
  async detectSource(branch: string) {
    const candidates = getSourceCandidates(this.references.keys(), branch);
    const counts = await mapConcurrently(candidates, async (candidate) => {
      const { base } = await this.getForkPoint(candidate, branch);
      return base === null ? null : await this.countCommits(branch, [base, candidate]);
    });
    let best: string | null = null;
    let bestCount = Infinity;
    // The candidates are in the order of preference, the first one wins ties
    candidates.forEach((candidate, i) => {
      const count = counts[i];
      if (count !== null && count < bestCount) {
        best = candidate;
        bestCount = count;
      }
    });
    return best;
  }

  async countCommits(tip: string, excluded: string[]) {
    const output = await this.git(['rev-list', '--count', tip, ...excluded.map((sha) => `^${sha}`), '--']);
    return parseInt(output.trim(), 10);
  }

  // Files that conflict when the branch is merged into the source, computed without touching the working directory
  async checkMerge(source: string, branch: string): Promise<MergeCheck> {
    const output = await this.git(['merge-tree', '--write-tree', '-z', '--name-only', '--no-messages', source, branch], { okExitCodes: [1] });
    // The tree comes first, then the conflicted files
    const conflicts = [...new Set(output.split('\0').slice(1).filter((path) => path.length > 0))];
    return { clean: conflicts.length === 0, conflicts };
  }

  // Net change from one commit to another
  async getDiffPatches(from: string, to: string) {
    const summary = await this.git(['diff-tree', '-r', ...SUMMARY_OPTIONS, from, to]);
    const patches = parseDiffSummary(summary).map((entry) => this.createPatch(entry, entry.newId, (entry) =>
      this.git(['diff-tree', '-p', ...DIFF_OPTIONS, '-M', '-C', '-U3', from, to, '--', ...new Set([entry.oldPath, entry.newPath])])));
    // Line counts, in the same order as the patches
    const counts = parseLineCounts(summary);
    const changes = patches.map((patch): FileChange => {
      const count = counts.get(patch.newFile.path);
      return {
        path: patch.newFile.path,
        added: count ? count.added : 0,
        removed: count ? count.removed : 0,
        binary: patch.isBinary || (count !== undefined && count.binary)
      };
    });
    return { patches, changes };
  }

  // What happened on the branch since it was taken out of the source, both are full reference names
  async getBranchSummary(branch: string, source: string | null): Promise<BranchSummary> {
    const empty: BranchSummary = {
      branch, source, forkPoint: null, base: null, ahead: 0, behind: 0, commits: [], authors: [],
      firstDate: null, lastDate: null, patches: [], changes: [], added: 0, removed: 0, mergeCheck: null
    };
    if (source === null) {
      return empty;
    }
    const { forkPoint, base } = await this.getForkPoint(source, branch);
    const [ahead, behind] = await this.compareCommits(branch, source);
    if (forkPoint === null || base === null) {
      return { ...empty, ahead, behind };
    }
    const [forkCommit, log, diff, mergeCheck] = await Promise.all([
      this.readCommit(forkPoint),
      this.git(['log', '-z', `--format=${COMMIT_FORMAT}`, branch, `^${source}`, `^${base}`, '--']),
      this.getDiffPatches(base, branch),
      this.checkMerge(source, branch)
    ]);
    const commits = parseCommits(log);
    const listed = new Set(commits.map((commit) => commit.sha()));
    const [firstDate, lastDate] = getTimeSpan(commits);
    return {
      branch,
      source,
      forkPoint: forkCommit,
      base,
      ahead,
      behind,
      // A merge brings the source when one of its other parents is not a commit of the branch
      commits: commits.map((commit) => ({
        commit,
        syncedWithSource: commit.parentIds.slice(1).some((parent) => !listed.has(parent))
      })),
      authors: countAuthors(commits),
      firstDate,
      lastDate,
      patches: diff.patches,
      changes: diff.changes,
      added: diff.changes.reduce((total, change) => total + change.added, 0),
      removed: diff.changes.reduce((total, change) => total + change.removed, 0),
      mergeCheck
    };
  }

  async createBranch(name: string, commit: Commit) {
    return await this.tryRun(`Unable to create branch ${name}`, async () => {
      await this.git(['branch', '--', name, commit.sha()]);
      return new Reference(`refs/heads/${name}`, commit.sha(), commit.sha());
    });
  }

  async createTag(name: string, commit: Commit) {
    await this.tryRun(`Unable to create tag ${name}`, () => this.git(['tag', '--', name, commit.sha()]));
  }

  async removeReference(reference: Reference) {
    await this.tryRun(`Unable to remove reference ${reference.shorthand()}`, () => {
      if (reference.isBranch()) {
        return this.git(['branch', '-D', '--', reference.shorthand()]);
      } else if (reference.isTag()) {
        return this.git(['tag', '-d', '--', reference.shorthand()]);
      } else {
        return this.git(['update-ref', '-d', reference.name()]);
      }
    });
  }

  async renameReference(reference: Reference, newShorthand: string) {
    const oldName = reference.name();
    const newName = oldName.substring(0, oldName.lastIndexOf(reference.shorthand())) + newShorthand;
    await this.tryRun(`Unable to rename reference ${oldName} to ${newName}`, async () => {
      if (reference.isBranch()) {
        await this.git(['branch', '-m', '--', reference.shorthand(), newShorthand]);
      } else {
        await this.git(['check-ref-format', newName]);
        await this.git(['update-ref', '--create-reflog', newName, reference.targetId, '']);
        await this.git(['update-ref', '-d', oldName, reference.targetId]);
      }
      // The renamed reference stays in the focus
      this.focus = renameInFocus(this.focus, oldName, newName);
    });
  }

  // Merges the reference "from" into the current branch "to"
  async merge(to: string, from: string) {
    await this.tryRun(`Unable to merge ${from} into ${to}`, async () => {
      await this.readHead();
      if (this.headName !== to) {
        throw new Error(`${to} is not the current branch`);
      }
      // The full reference name avoids ambiguities, but git would use it in the message
      await this.git(['merge', '--no-edit', '-m', getMergeMessage(from), from], { env: this.getIdentityEnvironment() });
    }, 'Merged successfully');
  }

  async getMergeHeads() {
    try {
      const content = await fs.promises.readFile(Path.join(this.path, 'MERGE_HEAD'));
      return content.toString().split('\n').filter((line) => line.length > 0);
    } catch (e) {
      return [];
    }
  }

  async getMergeMessage() {
    const data = await fs.promises.readFile(Path.join(this.path, 'MERGE_MSG'));
    return data.toString().split('\n')[0];
  }

  async finishMerge(message: string) {
    if ((await this.getMergeHeads()).length === 0) {
      this.onNotification('Unable to merge: No merge head found', NotificationType.Error);
      return;
    }
    await this.commit(message);
  }

  async abortMerge() {
    if (this.getState() === RepoState.Merge) {
      await this.tryRun('Unable to abort the merge', () => this.git(['merge', '--abort']));
    }
  }

  // Names and fetch URLs of the remotes
  async getRemotes() {
    const output = await this.git(['remote', '-v']);
    const remotes: { name: string, url: string }[] = [];
    for (const line of output.split('\n')) {
      const match = /^(\S+)\t(.*) \(fetch\)$/.exec(line);
      if (match) {
        remotes.push({ name: match[1], url: match[2] });
      }
    }
    return remotes;
  }

  async fetchAll() {
    await this.tryRun('Unable to fetch all', async () => {
      const remotes = await this.getRemotes();
      const hostKeys = getSshHostKeys();
      if (new Set(remotes.map((remote) => getSshCommand(remote.url, hostKeys))).size <= 1) {
        await runNetworkCommand(remotes.length > 0 ? remotes[0].url : null,
          (env) => this.git(['fetch', '--all', '--quiet'], { env }));
      } else {
        // The remotes are on hosts that use different keys
        for (const remote of remotes) {
          await runNetworkCommand(remote.url, (env) => this.git(['fetch', '--quiet', remote.name], { env }));
        }
      }
    });
  }

  async pull(name: string) {
    await this.merge(`refs/heads/${name}`, `refs/remotes/origin/${name}`);
  }

  async push() {
    await this.tryRun('Unable to push', async () => {
      await this.readHead();
      if (!this.headName) {
        throw new Error('HEAD is not on a branch');
      }
      const url = (await this.git(['remote', 'get-url', '--push', 'origin'])).trim();
      await runNetworkCommand(url, (env) => this.git(['push', '--quiet', 'origin', this.headName!], { env }));
    }, 'Pushed successfully');
  }

  // Stash

  async getStashes() {
    const output = await this.git(['stash', 'list', '-z', `--format=${COMMIT_FORMAT}`]);
    return new Map<string, Stash>(parseCommits(output).map((commit, index) =>
      [commit.sha(), new Stash(index, commit)] as [string, Stash]));
  }

  async stash() {
    await this.tryRun('Unable to stash', () => this.git(['stash', 'push', '--quiet'], {
      env: this.getIdentityEnvironment()
    }));
  }

  async applyStash(index: number) {
    await this.tryRun('Unable to apply stash', () => this.git(['stash', 'apply', '--quiet', `stash@{${index}}`]));
  }

  async popStash(index = 0) {
    await this.tryRun('Unable to pop stash', () => this.git(['stash', 'pop', '--quiet', `stash@{${index}}`]));
  }

  async dropStash(index: number) {
    await this.tryRun('Unable to drop stash', () => this.git(['stash', 'drop', '--quiet', `stash@{${index}}`]));
  }

  // Ignore

  updateIgnore() {
    const path = Path.join(this.workdir, '.gitignore');
    if (fs.existsSync(path)) {
      this.ig = ignore().add(fs.readFileSync(path).toString());
    }
  }

  isIgnored(path: string) {
    // .gitignore is never ignored
    return path.length > 0 && path !== '.gitignore' && this.ig.ignores(path);
  }

  // Commit

  async getPatches(commit: Commit) {
    const parent = commit.parentIds.length > 0 ? [commit.parentIds[0]] : ['--root'];
    const summary = await this.git(['diff-tree', '-r', '--no-commit-id', ...SUMMARY_OPTIONS, ...parent, commit.sha()]);
    return parseDiffSummary(summary).map((entry) => this.createPatch(entry, entry.newId, (entry) =>
      this.git(['diff-tree', '-p', '--no-commit-id', ...DIFF_OPTIONS, '-M', '-C', '-U3', ...parent, commit.sha(),
        '--', ...new Set([entry.oldPath, entry.newPath])])));
  }

  // Content of a side of a patch, read from the object database or the working directory
  async readFile(file: DiffFile) {
    if (file.id) {
      try {
        return await gitBuffer(['cat-file', 'blob', file.id], this.workdir);
      } catch (e) {
        // The blob is not in the object database (working directory file)
      }
    }
    return await fs.promises.readFile(Path.join(this.workdir, file.path));
  }
}
