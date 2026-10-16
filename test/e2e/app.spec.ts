import { test, expect, _electron as electron, ElectronApplication, Page } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as Path from 'path';
import { TestRepo, lines } from '../helpers';

const APP_PATH = Path.join(__dirname, '../..');

let repo: TestRepo;
let userData: string;
let app: ElectronApplication;
let page: Page;
let pageErrors: string[];

test.beforeEach(async () => {
  repo = await TestRepo.create();
  await repo.commit('Add the engine', { 'engine.txt': lines('analytical', 'engine') });
  await repo.git('checkout', '--quiet', '-b', 'notes');
  await repo.commit('Write the notes', { 'notes.txt': 'note G\n' });
  await repo.git('checkout', '--quiet', 'main');
  repo.write('engine.txt', lines('analytical', 'difference', 'engine'));

  userData = fs.mkdtempSync(Path.join(os.tmpdir(), 'gitadmin-e2e-'));
  fs.writeFileSync(Path.join(userData, 'Settings'), JSON.stringify({
    gitadmin: { recentlyOpened: [repo.workdir], name: 'Ada Lovelace', email: 'ada@example.com', fontSize: 14 }
  }));
  app = await electron.launch({
    args: [APP_PATH, '--no-sandbox', `--user-data-dir=${userData}`],
    env: { ...process.env, GITADMIN_NO_DEVTOOLS: '1' } as Record<string, string>
  });
  page = await app.firstWindow();
  pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') {
      pageErrors.push(message.text());
    }
  });
});

test.afterEach(async () => {
  await app.close();
  repo.remove();
  fs.rmSync(userData, { recursive: true, force: true });
});

test('opens a repository, stages a file and commits it', async () => {
  const repoName = Path.basename(repo.workdir);
  await page.getByRole('heading', { name: repoName }).click();

  // History and references
  await expect(page.locator('.repo-title h1')).toHaveText(repoName);
  await expect(page.getByText('Add the engine')).toBeVisible();
  await expect(page.getByText('Write the notes')).toBeVisible();
  await expect(page.locator('.reference-explorer').getByText('notes', { exact: true })).toBeVisible();

  // Diff of the unstaged file
  const indexViewer = page.locator('.index-viewer');
  await expect(indexViewer.getByText('Unstaged files (1)', { exact: true })).toBeVisible();
  await indexViewer.locator('li', { hasText: 'engine.txt' }).click();
  await expect(page.locator('.monaco-diff-editor')).toBeVisible();
  await expect(page.locator('.monaco-diff-editor').getByText('difference')).toBeVisible();

  // Stage it
  await page.getByRole('button', { name: 'Stage file' }).click();
  await expect(indexViewer.getByText('Staged files (1)', { exact: true })).toBeVisible();
  await expect(indexViewer.getByText('Unstaged files (0)', { exact: true })).toBeVisible();

  // Commit
  await indexViewer.getByPlaceholder('Summary').fill('Add the difference engine');
  await indexViewer.getByRole('button', { name: 'Commit' }).click();
  await expect(page.locator('.commit-list').getByText('Add the difference engine')).toBeVisible();
  await expect(indexViewer.getByText('Staged files (0)', { exact: true })).toBeVisible();
  expect((await repo.git('log', '-1', '--format=%s|%an')).trim()).toBe('Add the difference engine|Ada Lovelace');

  // Details of the commit
  await page.locator('.commit-list').getByText('Add the difference engine').click();
  await expect(page.locator('.commit-viewer h2')).toHaveText('Add the difference engine');
  await expect(page.locator('.commit-viewer').getByText('engine.txt')).toBeVisible();

  expect(pageErrors).toEqual([]);
});
