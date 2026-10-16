import { exec } from 'dugite';

export class GitError extends Error {
  readonly args: string[];
  readonly exitCode: number;
  readonly stderr: string;

  constructor(args: string[], exitCode: number, stderr: string, stdout = '') {
    super(stderr.trim() || stdout.trim() || `git ${args[0]} exited with code ${exitCode}`);
    this.name = 'GitError';
    this.args = args;
    this.exitCode = exitCode;
    this.stderr = stderr;
  }
}

export interface GitOptions {
  stdin?: string | Buffer;
  env?: Record<string, string | undefined>;
  // Exit codes that are not errors (0 is always accepted)
  okExitCodes?: number[];
}

// Never block on a credential prompt and treat pathspecs literally,
// so file names containing glob characters are not expanded
const BASE_ENV = {
  GIT_TERMINAL_PROMPT: '0',
  GIT_LITERAL_PATHSPECS: '1'
};

async function run(args: string[], cwd: string, options: GitOptions, encoding: 'utf8' | 'buffer') {
  const result = await exec(args, cwd, {
    env: { ...BASE_ENV, ...options.env },
    stdin: options.stdin,
    encoding: encoding as any
  });
  if (result.exitCode !== 0 && !(options.okExitCodes || []).includes(result.exitCode)) {
    throw new GitError(args, result.exitCode, result.stderr.toString(), encoding === 'utf8' ? result.stdout.toString() : '');
  }
  return result;
}

export async function git(args: string[], cwd: string, options: GitOptions = {}) {
  const result = await run(args, cwd, options, 'utf8');
  return result.stdout as string;
}

export async function gitBuffer(args: string[], cwd: string, options: GitOptions = {}) {
  const result = await run(args, cwd, options, 'buffer');
  return result.stdout as unknown as Buffer;
}
