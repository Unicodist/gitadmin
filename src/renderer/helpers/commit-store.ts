import * as crypto from 'crypto';
import * as fs from 'fs';
import * as Path from 'path';
import { Commit } from './git/model';

// Commits never change once created, so the ones read from git are kept, in memory and in a cache file per
// repository. Loading the history then only asks git for the commits that are not stored yet.
//
// The store is closed: the parents of a stored commit are stored too, except the ones a shallow clone does not
// have. The commits that git returns for `tips ^storeTips` keep it closed, since everything reachable from the tips
// of the store is in the store. Stashes are not stored, their index commits are never loaded.
//
// The cache is two files: the commits, one JSON array per line, only ever appended to, and a small header that
// says how many bytes of them are valid. The commits are written before the header, so a cache cut short by a crash
// still reads as the previous one, and a cache that does not read back as a closed store is dropped.

const VERSION = 1;
// Folder of the caches in the user data of the app
export const COMMIT_CACHE_FOLDER = 'CommitCache';
// Small histories load fast from git, no file is written for them
export const MIN_CACHED_COMMITS = 2000;
// Caches of the repositories opened least recently are removed beyond this number
export const MAX_CACHED_REPOSITORIES = 20;

interface Header {
  version: number;
  id: string;
  // Content of the shallow file of the repository when the commits were read
  shallow: string;
  // Bytes of the commits file that hold whole lines written by this header
  length: number;
  tips: string[];
}

type Row = [string, string, string, string, number, string, string, number, string];

function toRow(commit: Commit): Row {
  const author = commit.author();
  const committer = commit.committer();
  return [commit.sha(), commit.parentIds.join(' '), author.name, author.email, author.date.valueOf() / 1000,
    committer.name, committer.email, committer.date.valueOf() / 1000, commit.message()];
}

function fromRow(row: Row) {
  const [sha, parents, authorName, authorEmail, authorTime, committerName, committerEmail, committerTime, message] = row;
  return new Commit(sha, parents ? parents.split(' ') : [],
    { name: authorName, email: authorEmail, date: new Date(authorTime * 1000) },
    { name: committerName, email: committerEmail, date: new Date(committerTime * 1000) },
    message);
}

// Content of the file that lists the boundary commits of a shallow clone, empty for a complete clone
export function readShallow(gitDir: string) {
  try {
    return fs.readFileSync(Path.join(gitDir, 'shallow')).toString();
  } catch (e) {
    return '';
  }
}

// Name of the cache files of a repository
export function getCacheName(gitDir: string) {
  return crypto.createHash('sha1').update(Path.resolve(gitDir)).digest('hex');
}

export class CommitStore {
  readonly commits: Map<string, Commit>;
  // Stored commits that no stored commit has as parent, their history is the whole store
  readonly tips: Set<string>;
  shallow: string;
  private readonly directory: string | null;
  private readonly name: string;
  private readonly minCommits: number;
  private id: string;
  // Commits of the cache file, in the order they were written, and its valid length
  private written: number;
  private length: number;
  private rewrite: boolean;
  // Changes when the store is emptied, a save that started before must write everything again
  private generation: number;
  private saving: Promise<void>;

  // Without a directory, the commits are only kept in memory
  constructor(gitDir: string, directory: string | null, minCommits = MIN_CACHED_COMMITS) {
    this.commits = new Map<string, Commit>();
    this.tips = new Set<string>();
    this.shallow = '';
    this.directory = directory;
    this.name = getCacheName(gitDir);
    this.minCommits = minCommits;
    this.id = '';
    this.written = 0;
    this.length = 0;
    this.rewrite = true;
    this.generation = 0;
    this.saving = Promise.resolve();
  }

  get size() {
    return this.commits.size;
  }

  has(sha: string) {
    return this.commits.has(sha);
  }

  get(sha: string) {
    return this.commits.get(sha);
  }

  private get headerPath() {
    return Path.join(this.directory!, `${this.name}.json`);
  }

  private get commitsPath() {
    return Path.join(this.directory!, `${this.name}.commits`);
  }

  clear(shallow = '') {
    this.commits.clear();
    this.tips.clear();
    this.shallow = shallow;
    this.written = 0;
    this.rewrite = true;
    ++this.generation;
  }

  // Adds commits read from git: with the store, they must hold the parents of each of them
  add(commits: Commit[]) {
    let added = false;
    for (const commit of commits) {
      if (!this.commits.has(commit.sha())) {
        this.commits.set(commit.sha(), commit);
        this.tips.add(commit.sha());
        added = true;
      }
    }
    if (added) {
      for (const commit of commits) {
        for (const parentSha of commit.parentIds) {
          this.tips.delete(parentSha);
        }
      }
    }
  }

  // Keeps only these commits, which must be closed, when the store holds many that are not loaded anymore
  compact(commits: Commit[]) {
    this.clear(this.shallow);
    this.add(commits);
  }

  // Commits reachable from the tips, without going past the commits for which stop is true
  collect(tips: Iterable<string>, stop: (sha: string) => boolean) {
    const found: Commit[] = [];
    const seen = new Set<string>();
    const stack: string[] = [];
    for (const sha of tips) {
      if (!seen.has(sha)) {
        seen.add(sha);
        stack.push(sha);
      }
    }
    while (stack.length > 0) {
      const sha = stack.pop()!;
      const commit = this.commits.get(sha);
      // Missing commits are the boundary of a shallow clone
      if (commit === undefined || stop(sha)) {
        continue;
      }
      found.push(commit);
      for (const parentSha of commit.parentIds) {
        if (!seen.has(parentSha)) {
          seen.add(parentSha);
          stack.push(parentSha);
        }
      }
    }
    return found;
  }

  // Reads the cache of the repository, false if there is none or it does not match the repository anymore
  async load(shallow: string) {
    this.clear(shallow);
    if (this.directory === null) {
      return false;
    }
    try {
      const header: Header = JSON.parse((await fs.promises.readFile(this.headerPath)).toString());
      if (header.version !== VERSION || header.shallow !== shallow) {
        return false;
      }
      const content = await fs.promises.readFile(this.commitsPath);
      if (content.length < header.length) {
        return false;
      }
      const lines = content.subarray(0, header.length).toString().split('\n');
      // The first line ties the commits to their header, the last one is empty
      if (lines[0] !== JSON.stringify(header.id) || lines[lines.length - 1] !== '') {
        return false;
      }
      const rows: Row[] = JSON.parse(`[${lines.slice(1, -1).join(',')}]`);
      const commits = rows.map(fromRow);
      for (const commit of commits) {
        this.commits.set(commit.sha(), commit);
      }
      const boundary = new Set(shallow.split('\n'));
      const closed = commits.every((commit) =>
        commit.parentIds.every((parentSha) => this.commits.has(parentSha) || boundary.has(commit.sha())));
      if (!closed || header.tips.some((sha) => !this.commits.has(sha))) {
        this.clear(shallow);
        return false;
      }
      for (const sha of header.tips) {
        this.tips.add(sha);
      }
      this.id = header.id;
      this.written = commits.length;
      this.length = header.length;
      this.rewrite = false;
      // The caches beyond the limit are the ones opened least recently
      const now = new Date();
      await fs.promises.utimes(this.headerPath, now, now).catch(() => undefined);
      return true;
    } catch (e) {
      // No cache yet, or a cache that cannot be read: the history is read from git
      this.clear(shallow);
      return false;
    }
  }

  // Writes the commits that are not in the cache yet. The saves run one after the other.
  save() {
    this.saving = this.saving.then(() => this.write()).catch(() => {
      // The cache is only an optimization, it is written again from scratch next time
      this.rewrite = true;
    });
    return this.saving;
  }

  private async write() {
    if (this.directory === null || this.commits.size < this.minCommits) {
      return;
    }
    // The commits are in the order they were added, the ones after the written ones are new. The store can change
    // while the files are written, the header lists the tips of the commits written.
    const commits = [...this.commits.values()];
    const tips = [...this.tips];
    const shallow = this.shallow;
    const generation = this.generation;
    if (!this.rewrite && this.written === commits.length) {
      return;
    }
    await fs.promises.mkdir(this.directory, { recursive: true });
    if (!this.rewrite) {
      // Another window may have written the cache of the same repository in the meantime
      const stats = await fs.promises.stat(this.commitsPath).catch(() => null);
      this.rewrite = stats === null || stats.size !== this.length;
    }
    if (this.rewrite) {
      this.id = crypto.randomBytes(8).toString('hex');
      this.written = 0;
      this.length = 0;
    }
    const lines = commits.slice(this.written).map((commit) => JSON.stringify(toRow(commit)) + '\n');
    const data = Buffer.from((this.rewrite ? JSON.stringify(this.id) + '\n' : '') + lines.join(''));
    if (this.rewrite) {
      const temporary = `${this.commitsPath}.${this.id}.tmp`;
      await fs.promises.writeFile(temporary, data);
      await fs.promises.rename(temporary, this.commitsPath);
    } else {
      await fs.promises.appendFile(this.commitsPath, data);
    }
    const header: Header = { version: VERSION, id: this.id, shallow, length: this.length + data.length, tips };
    const temporary = `${this.headerPath}.${this.id}.tmp`;
    await fs.promises.writeFile(temporary, JSON.stringify(header));
    await fs.promises.rename(temporary, this.headerPath);
    this.length = header.length;
    if (generation === this.generation) {
      this.written = commits.length;
      this.rewrite = false;
    }
    await this.removeOldCaches();
  }

  // Keeps the caches of the repositories opened most recently
  private async removeOldCaches() {
    const names = (await fs.promises.readdir(this.directory!)).filter((name) => name.endsWith('.json'));
    if (names.length <= MAX_CACHED_REPOSITORIES) {
      return;
    }
    const caches = await Promise.all(names.map(async (name) => ({
      name: name.substring(0, name.length - '.json'.length),
      time: (await fs.promises.stat(Path.join(this.directory!, name))).mtimeMs
    })));
    caches.sort((lhs, rhs) => rhs.time - lhs.time);
    for (const cache of caches.slice(MAX_CACHED_REPOSITORIES)) {
      if (cache.name !== this.name) {
        await fs.promises.rm(Path.join(this.directory!, `${cache.name}.json`), { force: true });
        await fs.promises.rm(Path.join(this.directory!, `${cache.name}.commits`), { force: true });
      }
    }
  }
}
