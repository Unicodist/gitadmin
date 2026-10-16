import { test, expect, Page } from '@playwright/test';
import { TestRepo, lines } from '../helpers';
import { launchApp, LaunchedApp, openRecentRepo, pickContextMenuItem } from './fixtures';

let repo: TestRepo;
let launched: LaunchedApp;
let page: Page;

function readClipboard() {
  return launched.app.evaluate(({ clipboard }) => clipboard.readText());
}

test.beforeEach(async () => {
  repo = await TestRepo.create();
  await repo.commit('Add the engine', { 'engine.txt': lines('analytical', 'engine') });
  await repo.git('branch', 'notes');
  await repo.git('tag', 'v1.0');
  repo.write('src/mill.txt', lines('store', 'mill'));
  launched = await launchApp({ settings: { recentlyOpened: [repo.workdir] } });
  page = launched.page;
  await openRecentRepo(page, repo);
  await launched.app.evaluate(({ clipboard }) => clipboard.clear());
});

test.afterEach(async () => {
  expect(launched.pageErrors).toEqual([]);
  await launched.close();
  repo.remove();
});

test('copies the names of the references, the SHA of a commit and the path of a file', async () => {
  const explorer = page.locator('.reference-explorer');
  await pickContextMenuItem(launched.app, 'Copy branch name to clipboard');
  await explorer.getByRole('button', { name: 'notes', exact: true }).click({ button: 'right' });
  await expect.poll(readClipboard).toBe('notes');

  await pickContextMenuItem(launched.app, 'Copy tag name to clipboard');
  await explorer.getByRole('button', { name: 'v1.0', exact: true }).click({ button: 'right' });
  await expect.poll(readClipboard).toBe('v1.0');

  const sha = (await repo.git('rev-parse', 'HEAD')).trim();
  await pickContextMenuItem(launched.app, 'Copy commit sha to clipboard');
  await page.getByRole('listbox', { name: 'Commits' }).getByRole('option').filter({ hasText: 'Add the engine' }).click({ button: 'right' });
  await expect.poll(readClipboard).toBe(sha);

  await pickContextMenuItem(launched.app, 'Copy file path to clipboard');
  await page.locator('.index-viewer li').filter({ hasText: 'mill.txt' }).click({ button: 'right' });
  await expect.poll(readClipboard).toBe('src/mill.txt');
});
