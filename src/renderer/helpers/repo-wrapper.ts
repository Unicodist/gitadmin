import * as Path from 'path';
import * as fs from 'fs';
import ignore, { Ignore } from 'ignore';
import { CommitGraph } from './commit-graph';
import { Field, Settings } from '../../shared/settings';
import { NotificationType } from '../components/notification-item';
import { git, gitBuffer } from './git/runner';
import { Commit, DiffFile, DiffLine, Hunk, Patch, PatchStatus, Reference, Stash } from './git/model';
import { COMMIT_FORMAT, DiffEntry, REFERENCE_FORMAT, parseCommits, parseDiffSummary, parseHunks, parseReferences } from './git/parsers';
import { ApplyDirection, buildPartialPatch } from './git/partial-patch';

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
  onNotification: (message: string, type: NotificationType) => void;
  // Internals
  updateCommitsPromise: Promise<void>; // Used to queue commit updates
  ig: Ignore;
  headName: string | null;
  headSha: string | null;
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
    this.onNotification = onNotification;
    this.updateCommitsPromise = Promise.resolve();
    this.ig = ignore();
    this.headName = null;
    this.headSha = null;
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

  async updateCommits() {
    const referencesToUpdate = await this.updateReferences();
    const stashesToUpdate = await this.updateStashes();
    await this.readHead();
    const newCommits = await this.getNewCommits(referencesToUpdate, stashesToUpdate);
    this.updateShaToReferences();
    this.getParents(newCommits);
    this.removeUnreachableCommits();
    this.sortCommits();
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

  async getNewCommits(references: Reference[], stashes: Stash[]) {
    // Start from the updated references, the parents of the new stashes, and a detached head
    const tips = new Set<string>(references.map((reference) => reference.commitId));
    for (const stash of stashes) {
      tips.add(stash.commit.parentIds[0]);
    }
    if (this.headSha && !this.shaToCommit.has(this.headSha)) {
      tips.add(this.headSha);
    }
    const newCommits: Commit[] = [];
    if (tips.size > 0) {
      // Prevent from retrieving commits already loaded: hiding the commits
      // without loaded children hides all their ancestors
      const hidden = this.commits
        .filter((commit) => this.children.get(commit.sha())!.length === 0)
        .map((commit) => `^${commit.sha()}`);
      const output = await this.git(['log', '-z', `--format=${COMMIT_FORMAT}`, '--ignore-missing', '--stdin'], {
        stdin: [...tips, ...hidden].join('\n') + '\n'
      });
      newCommits.push(...parseCommits(output).filter((commit) => !this.shaToCommit.has(commit.sha())));
    }
    // Stash commits are only linked to the commit they were created on
    for (const stash of stashes) {
      if (!this.shaToCommit.has(stash.commit.sha())) {
        newCommits.push(stash.commit);
      }
    }
    for (const commit of newCommits) {
      this.commits.push(commit);
      this.shaToCommit.set(commit.sha(), commit);
    }
    return newCommits;
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
    const frontier: string[] = [
      ...Array.from(this.references.values(), (reference) => reference.commitId),
      ...this.stashes.keys()
    ];
    if (this.headSha) {
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
    this.headCommit = this.headSha ? this.shaToCommit.get(this.headSha) || null : null;
  }

  updateGraph() {
    this.graph.computePositions(this);
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
    await git(['clone', '--', url, path], parent);
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
      this.onNotification(`${failureMessage}: ${errorMessage(e)}`, NotificationType.Error);
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

  getReferenceCommit(reference: Reference) {
    return this.shaToCommit.get(reference.commitId)!;
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

  async fetchAll() {
    await this.tryRun('Unable to fetch all', () => this.git(['fetch', '--all', '--quiet']));
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
      await this.git(['push', '--quiet', 'origin', this.headName]);
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
