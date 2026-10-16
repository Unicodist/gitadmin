export interface Signature {
  name: string;
  email: string;
  date: Date;
}

export class Commit {
  readonly id: string;
  readonly parentIds: string[];
  readonly authorSignature: Signature;
  readonly committerSignature: Signature;
  readonly rawMessage: string;

  constructor(id: string, parentIds: string[], author: Signature, committer: Signature, message: string) {
    this.id = id;
    this.parentIds = parentIds;
    this.authorSignature = author;
    this.committerSignature = committer;
    this.rawMessage = message;
  }

  sha() {
    return this.id;
  }

  message() {
    return this.rawMessage;
  }

  // First paragraph of the message, with whitespace squashed
  summary() {
    const paragraph = this.rawMessage.trim().split(/\n\s*\n/)[0];
    return paragraph.split('\n').map((line) => line.trim()).join(' ');
  }

  // Message without the summary paragraph
  body() {
    const trimmed = this.rawMessage.trim();
    const match = /\n\s*\n/.exec(trimmed);
    return match ? trimmed.substring(match.index + match[0].length).trim() : '';
  }

  author() {
    return this.authorSignature;
  }

  committer() {
    return this.committerSignature;
  }

  date() {
    return this.committerSignature.date;
  }
}

export class Reference {
  readonly refName: string;
  // Object the reference points to (an annotated tag object for annotated tags)
  readonly targetId: string;
  // Commit the reference resolves to
  readonly commitId: string;

  constructor(refName: string, targetId: string, commitId: string) {
    this.refName = refName;
    this.targetId = targetId;
    this.commitId = commitId;
  }

  name() {
    return this.refName;
  }

  shorthand() {
    for (const prefix of ['refs/heads/', 'refs/remotes/', 'refs/tags/']) {
      if (this.refName.startsWith(prefix)) {
        return this.refName.substring(prefix.length);
      }
    }
    return this.refName;
  }

  isBranch() {
    return this.refName.startsWith('refs/heads/');
  }

  isRemote() {
    return this.refName.startsWith('refs/remotes/');
  }

  isTag() {
    return this.refName.startsWith('refs/tags/');
  }
}

export class Stash {
  index: number;
  commit: Commit;

  constructor(index: number, commit: Commit) {
    this.index = index;
    this.commit = commit;
  }
}

export enum PatchStatus {
  Added = 'A',
  Copied = 'C',
  Deleted = 'D',
  Modified = 'M',
  Renamed = 'R',
  TypeChanged = 'T',
  Conflicted = 'U',
  Untracked = '?'
}

export interface DiffFile {
  path: string;
  // Blob id, or null when the content only exists in the working directory
  // or the file does not exist on this side
  id: string | null;
  mode: string;
  exists: boolean;
}

export interface DiffLine {
  // '+' for an added line, '-' for a removed line, ' ' for context
  origin: '+' | '-' | ' ';
  // Content without the line terminator
  content: string;
  // Line number in the old file, or -1 for added lines
  oldLineno: number;
  // Line number in the new file, or -1 for removed lines
  newLineno: number;
  // True if the line is followed by "\ No newline at end of file"
  noNewline: boolean;
}

export interface Hunk {
  header: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

export class Patch {
  readonly status: PatchStatus;
  readonly oldFile: DiffFile;
  readonly newFile: DiffFile;
  readonly isBinary: boolean;
  private hunksLoader: () => Promise<Hunk[]>;
  private hunksPromise: Promise<Hunk[]> | null;

  constructor(status: PatchStatus, oldFile: DiffFile, newFile: DiffFile, isBinary: boolean, hunksLoader: () => Promise<Hunk[]>) {
    this.status = status;
    this.oldFile = oldFile;
    this.newFile = newFile;
    this.isBinary = isBinary;
    this.hunksLoader = hunksLoader;
    this.hunksPromise = null;
  }

  // Hunks are loaded lazily and cached, so the line objects stay the same
  // between calls and can be used to select lines
  hunks() {
    if (!this.hunksPromise) {
      this.hunksPromise = this.hunksLoader();
      this.hunksPromise.catch(() => {
        this.hunksPromise = null;
      });
    }
    return this.hunksPromise;
  }

  isAdded() {
    return this.status === PatchStatus.Added;
  }

  isCopied() {
    return this.status === PatchStatus.Copied;
  }

  isDeleted() {
    return this.status === PatchStatus.Deleted;
  }

  isModified() {
    return this.status === PatchStatus.Modified || this.status === PatchStatus.TypeChanged;
  }

  isRenamed() {
    return this.status === PatchStatus.Renamed;
  }

  isConflicted() {
    return this.status === PatchStatus.Conflicted;
  }

  isUntracked() {
    return this.status === PatchStatus.Untracked;
  }
}
