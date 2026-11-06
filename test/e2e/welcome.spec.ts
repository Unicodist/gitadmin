import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as Path from 'path';
import { TestRepo, lines } from '../helpers';
import { launchApp, LaunchedApp } from './fixtures';

let launched: LaunchedApp;
let repo: TestRepo;

test.beforeEach(async () => {
  repo = await TestRepo.create();
  await repo.commit('Add the engine', { 'engine.txt': lines('analytical', 'engine') });
});

test.afterEach(async () => {
  expect(launched.pageErrors).toEqual([]);
  await launched.close();
  repo.remove();
});

test('opens a recent repository with the keyboard', async () => {
  const name = Path.basename(repo.workdir);
  launched = await launchApp({ settings: { recentlyOpened: [repo.workdir] } });
  const page = launched.page;
  const entry = page.getByRole('button', { name, exact: true });
  await expect(entry).toBeVisible();

  // The actions come first, then the recent repositories
  for (const action of ['Open a repository', 'Clone a repository', 'Initialize a repository']) {
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: action })).toBeFocused();
  }
  await page.keyboard.press('Tab');
  await expect(entry).toBeFocused();
  // The name stays a heading
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();

  await page.keyboard.press('Enter');
  await expect(page.locator('.repo-title h1')).toHaveText(name);
});

test('opens a recent repository from anywhere in its entry', async () => {
  const name = Path.basename(repo.workdir);
  launched = await launchApp({ settings: { recentlyOpened: [repo.workdir] } });
  const page = launched.page;
  const entry = page.locator('.recent-repo', { hasText: name });
  const box = (await entry.boundingBox())!;
  // The end of the line of the path, away from the name
  await entry.click({ position: { x: box.width - 16, y: box.height - 12 } });
  await expect(page.locator('.repo-title h1')).toHaveText(name);
});

test('shows the shortened paths of the recent repositories', async () => {
  // The repositories do not need to exist to be listed
  const inHome = Path.join(os.homedir(), 'projects', 'difference-engine');
  launched = await launchApp({ settings: { recentlyOpened: [inHome, Path.join(repo.workdir, '.git')] } });
  const page = launched.page;
  const entries = page.locator('.recent-repo');
  await expect(entries).toHaveCount(2);
  await expect(entries.nth(0).getByRole('heading')).toHaveText('difference-engine');
  await expect(entries.nth(0).locator('p')).toHaveText(['~', 'projects', 'difference-engine'].join(Path.sep));
  // The full path describes the button of the entry
  await expect(entries.nth(0).getByRole('button')).toHaveAttribute('title', inHome);
  await expect(entries.nth(0).getByRole('button')).toHaveAccessibleDescription(inHome);
  // Older versions saved the path of the .git folder
  await expect(entries.nth(1).getByRole('heading')).toHaveText(Path.basename(repo.workdir));
  await expect(entries.nth(1).locator('p')).toHaveText(repo.workdir);
  await expect(entries.nth(1).getByRole('button')).toHaveAccessibleDescription(repo.workdir);
});

test('shows an empty state without recent repositories', async () => {
  launched = await launchApp({ settings: { recentlyOpened: [] } });
  const page = launched.page;
  await expect(page.getByRole('heading', { name: 'Recent repositories' })).toBeVisible();
  await expect(page.locator('.recent-repos-empty')).toHaveText('No recent repositories');
  await expect(page.locator('.recent-repo')).toHaveCount(0);

  // The actions show the shortcuts of the menu
  const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
  const actions = [['Open a repository', 'O'], ['Clone a repository', 'N'], ['Initialize a repository', 'I']];
  for (const [name, key] of actions) {
    const action = page.getByRole('button', { name, exact: true });
    await expect(action).toHaveAttribute('aria-keyshortcuts', `${modifier}+${key}`);
    await expect(action.locator('kbd')).toHaveText([process.platform === 'darwin' ? '⌘' : 'Ctrl', key]);
  }
});

test('offers to remove a recent repository whose folder is gone', async () => {
  const name = Path.basename(repo.workdir);
  const missing = Path.join(Path.dirname(repo.workdir), 'moved-engine');
  launched = await launchApp({ settings: { recentlyOpened: [missing, repo.workdir] } });
  const page = launched.page;
  const entry = page.locator('.recent-repo', { hasText: 'moved-engine' });
  await entry.getByRole('button', { name: 'moved-engine', exact: true }).click();

  // A message in the entry, not the error of git
  await expect(entry.locator('.recent-repo-missing')).toHaveText('Folder not found');
  await expect(page.locator('.notification')).toHaveCount(0);
  const remove = entry.getByRole('button', { name: 'Remove moved-engine from the recent repositories' });
  await expect(remove).toBeFocused();

  await remove.click();
  await expect(page.locator('.recent-repo')).toHaveCount(1);
  // The focus goes to the entry that took its place
  await expect(page.getByRole('button', { name, exact: true })).toBeFocused();
  // The list is saved
  await page.reload();
  await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
  await expect(page.locator('.recent-repo')).toHaveCount(1);
});

test('opens a recent repository whose folder came back', async () => {
  const name = Path.basename(repo.workdir);
  const moved = `${repo.workdir}-moved`;
  fs.renameSync(repo.workdir, moved);
  try {
    launched = await launchApp({ settings: { recentlyOpened: [repo.workdir] } });
    const page = launched.page;
    const entry = page.locator('.recent-repo');
    await entry.getByRole('button', { name, exact: true }).click();
    await expect(entry.locator('.recent-repo-missing')).toHaveText('Folder not found');
  } finally {
    fs.renameSync(moved, repo.workdir);
  }
  await launched.page.getByRole('button', { name, exact: true }).click();
  await expect(launched.page.locator('.repo-title h1')).toHaveText(name);
});
