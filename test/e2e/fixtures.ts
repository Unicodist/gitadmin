import { _electron as electron, ElectronApplication, Page } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as Path from 'path';
import { TestRepo } from '../helpers';

const APP_PATH = Path.join(__dirname, '../..');

export interface LaunchOptions {
  // Values of the settings file, they replace the default ones
  settings?: Record<string, any>;
  // Command line switches of Chromium, for instance --force-device-scale-factor=1
  switches?: string[];
  env?: Record<string, string>;
}

export interface LaunchedApp {
  app: ElectronApplication;
  page: Page;
  // Uncaught errors and console errors of the page
  pageErrors: string[];
  close: () => Promise<void>;
}

// Starts the app with its own user data directory, which is removed when the app is closed
export async function launchApp(options: LaunchOptions = {}): Promise<LaunchedApp> {
  const userData = fs.mkdtempSync(Path.join(os.tmpdir(), 'gitadmin-e2e-'));
  fs.writeFileSync(Path.join(userData, 'Settings'), JSON.stringify({
    gitadmin: { name: 'Ada Lovelace', email: 'ada@example.com', fontSize: 14, ...options.settings }
  }));
  const app = await electron.launch({
    args: [APP_PATH, '--no-sandbox', `--user-data-dir=${userData}`, ...(options.switches || [])],
    env: { ...process.env, GITADMIN_NO_DEVTOOLS: '1', ...options.env } as Record<string, string>
  });
  const page = await app.firstWindow();
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') {
      pageErrors.push(message.text());
    }
  });
  return {
    app,
    page,
    pageErrors,
    close: async () => {
      await app.close();
      fs.rmSync(userData, { recursive: true, force: true });
    }
  };
}

// Sends a command of the application menu: clone-repo, init-repo, open-repo or preferences
export async function sendMenuCommand(app: ElectronApplication, command: string) {
  // The renderer ignores the commands that arrive before the app is rendered
  await (await app.firstWindow()).locator('div#app').waitFor();
  await app.evaluate(({ BrowserWindow }, command) => BrowserWindow.getAllWindows()[0].webContents.send(command), command);
}

// Opens a repository from the recently opened repositories of the welcome screen
export async function openRecentRepo(page: Page, repo: TestRepo) {
  await page.getByRole('heading', { name: Path.basename(repo.workdir) }).click();
  await page.locator('.repo-toolbar').waitFor();
}

// Adds a bare clone of the repository as its origin, returns the path of the clone to remove it
export async function addOrigin(repo: TestRepo) {
  const path = fs.realpathSync.native(fs.mkdtempSync(Path.join(os.tmpdir(), 'gitadmin-origin-')));
  await repo.git('clone', '--quiet', '--bare', repo.workdir, path);
  await repo.git('remote', 'add', 'origin', path);
  await repo.git('fetch', '--quiet', 'origin');
  return path;
}
