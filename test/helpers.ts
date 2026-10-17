import * as fs from 'fs';
import * as os from 'os';
import * as Path from 'path';
import { git } from '../src/renderer/helpers/git/runner';
import { RepoWrapper } from '../src/renderer/helpers/repo-wrapper';
import { NotificationType } from '../src/renderer/components/notification-item';

// Isolate the tests from the git configuration of the machine
const configDir = fs.mkdtempSync(Path.join(os.tmpdir(), 'gitadmin-config-'));
fs.writeFileSync(Path.join(configDir, 'gitconfig'), '');
process.env.GIT_CONFIG_GLOBAL = Path.join(configDir, 'gitconfig');
process.env.GIT_CONFIG_NOSYSTEM = '1';

export const IDENTITY = { name: 'Ada Lovelace', email: 'ada@example.com' };

export interface Notification {
  message: string;
  type: NotificationType;
}

export class TestRepo {
  readonly workdir: string;
  private time: number;

  private constructor(workdir: string) {
    this.workdir = workdir;
    // Commits get increasing dates so that their order is deterministic
    this.time = 1700000000;
  }

  // Creates the repository in a new temporary directory, or in the given directory
  static async create(path?: string) {
    if (path) {
      fs.mkdirSync(path, { recursive: true });
    }
    const workdir = fs.realpathSync.native(path || fs.mkdtempSync(Path.join(os.tmpdir(), 'gitadmin-repo-')));
    const repo = new TestRepo(workdir);
    await repo.git('init', '--quiet', '--initial-branch=main');
    await repo.git('config', 'user.name', 'Config User');
    await repo.git('config', 'user.email', 'config@example.com');
    await repo.git('config', 'commit.gpgsign', 'false');
    await repo.git('config', 'core.autocrlf', 'false');
    return repo;
  }

  git(...args: string[]) {
    return git(args, this.workdir, { env: this.dateEnvironment() });
  }

  dateEnvironment() {
    const date = `${this.time} +0000`;
    return { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date };
  }

  path(path: string) {
    return Path.join(this.workdir, path);
  }

  write(path: string, content: string | Buffer) {
    fs.mkdirSync(Path.dirname(this.path(path)), { recursive: true });
    fs.writeFileSync(this.path(path), content);
  }

  read(path: string) {
    return fs.readFileSync(this.path(path)).toString();
  }

  exists(path: string) {
    return fs.existsSync(this.path(path));
  }

  // Writes the files, stages everything and commits, returns the sha of the commit
  async commit(message: string, files: Record<string, string> = {}) {
    for (const [path, content] of Object.entries(files)) {
      this.write(path, content);
    }
    await this.git('add', '--all');
    this.time += 60;
    await this.git('commit', '--quiet', '--allow-empty', '-m', message);
    return await this.sha('HEAD');
  }

  async sha(revision: string) {
    return (await this.git('rev-parse', revision)).trim();
  }

  // Content of a file in the index
  async staged(path: string) {
    return await this.git('show', `:${path}`);
  }

  async status() {
    return (await this.git('status', '--porcelain')).trim();
  }

  wrapper() {
    const notifications: Notification[] = [];
    const wrapper = new RepoWrapper({ workdir: this.workdir, gitDir: Path.join(this.workdir, '.git') },
      (message, type) => notifications.push({ message, type }),
      { getIdentity: () => IDENTITY });
    return { wrapper, notifications, errors: () => notifications.filter((n) => n.type === NotificationType.Error) };
  }

  remove() {
    fs.rmSync(this.workdir, { recursive: true, force: true });
  }
}

export function lines(...values: string[]) {
  return values.map((value) => `${value}\n`).join('');
}

// Paths of the files of a folder and of its subfolders that have one of the extensions
export function listFiles(dir: string, extensions: string[]): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = Path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return listFiles(path, extensions);
    }
    return extensions.some((extension) => entry.name.endsWith(extension)) ? [path] : [];
  });
}

// Writes a script that stands for ssh. It asks for the passphrase of a key through SSH_ASKPASS three
// times at most, as ssh does, then runs the command of git on this machine. With FAKE_SSH_MODE=host-key,
// it first asks to confirm an unknown host key, with FAKE_SSH_MODE=changed-host-key, it fails as ssh
// does when the key of a host changed.
export function writeFakeSsh(path: string) {
  fs.writeFileSync(path, `#!/bin/sh
for last; do :; done
if [ "$FAKE_SSH_MODE" = "changed-host-key" ]; then
  echo "@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@" >&2
  echo "@    WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!     @" >&2
  echo "@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@" >&2
  echo "Host key for fakehost has changed and you have requested strict checking." >&2
  echo "Host key verification failed." >&2
  exit 255
fi
if [ "$FAKE_SSH_MODE" = "host-key" ]; then
  answer=$("$SSH_ASKPASS" "The authenticity of host 'fakehost (192.0.2.1)' can't be established.
ED25519 key fingerprint is SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU.
This key is not known by any other names.
Are you sure you want to continue connecting (yes/no/[fingerprint])? ")
  if [ "$answer" != "yes" ]; then
    echo "Host key verification failed." >&2
    exit 255
  fi
fi
for attempt in 1 2 3; do
  answer=$("$SSH_ASKPASS" "Enter passphrase for key '/keys/id_test': ") || break
  if [ "$answer" = "secret" ]; then
    exec sh -c "$last"
  fi
done
echo "git@fakehost: Permission denied (publickey)." >&2
exit 255
`, { mode: 0o755 });
}
