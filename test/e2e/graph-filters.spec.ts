import { test, expect, Page } from '@playwright/test';
import { TestRepo, lines } from '../helpers';
import { launchApp, LaunchedApp, openRecentRepo } from './fixtures';

let repo: TestRepo;
let launched: LaunchedApp;
let page: Page;

// Rows of the commit list, without the index
function commitSummaries() {
  return page.getByRole('listbox', { name: 'Commits' }).locator('li[role="option"]:not(.index-item) .commit-summary');
}

function filtersButton() {
  return page.locator('.repo-toolbar').getByRole('button', { name: 'Filters' });
}

function filtersMenu() {
  return page.getByRole('menu', { name: 'Graph filters' });
}

function filterItem(name: string) {
  return filtersMenu().getByRole('menuitemcheckbox', { name: name });
}

function explorerItem(name: string) {
  return page.locator('.reference-explorer').getByRole('button', { name: name, exact: true });
}

// main, a feature branch, a remote branch, a tag on its own commit and a stash
test.beforeEach(async () => {
  repo = await TestRepo.create();
  await repo.commit('Add the engine', { 'engine.txt': lines('analytical', 'engine') });
  await repo.git('checkout', '--quiet', '-b', 'feature');
  await repo.commit('Add the cards', { 'cards.txt': lines('operation') });
  await repo.git('checkout', '--quiet', '-b', 'remote', 'main');
  await repo.commit('Fetch the mill', { 'mill.txt': lines('store') });
  await repo.git('update-ref', 'refs/remotes/origin/mill', 'remote');
  await repo.git('checkout', '--quiet', '-b', 'tagged', 'main');
  await repo.commit('Release the engine', { 'release.txt': lines('1.0') });
  await repo.git('tag', 'v1.0');
  await repo.git('checkout', '--quiet', 'main');
  await repo.git('branch', '--quiet', '-D', 'remote', 'tagged');
  await repo.commit('Write the notes', { 'notes.txt': lines('note G') });
  repo.write('notes.txt', lines('note G', 'stashed'));
  await repo.git('stash', 'push', '--quiet', '-m', 'Bernoulli');
  launched = await launchApp({ settings: { recentlyOpened: [repo.workdir] } });
  page = launched.page;
  await openRecentRepo(page, repo);
  await expect(commitSummaries()).toHaveCount(6);
});

test.afterEach(async () => {
  expect(launched.pageErrors).toEqual([]);
  await launched.close();
  repo.remove();
});

test('hides kinds of references with the quick toggles and remembers them', async () => {
  await filtersButton().click();
  await expect(filtersMenu()).toBeVisible();
  await expect(filterItem('Hide stashes')).toHaveAttribute('aria-checked', 'false');
  await filterItem('Hide stashes').click();
  await expect(filterItem('Hide stashes')).toHaveAttribute('aria-checked', 'true');
  await expect(commitSummaries()).toHaveCount(5);
  await expect(page.locator('.commit-list')).not.toContainText('Bernoulli');

  // Local only hides the remote branches and the tags, and the menu stays open
  await filterItem('Local only').click();
  await expect(filterItem('Hide remote branches')).toHaveAttribute('aria-checked', 'true');
  await expect(filterItem('Hide tags')).toHaveAttribute('aria-checked', 'true');
  await expect(commitSummaries()).toHaveText(['Write the notes', 'Add the cards', 'Add the engine']);
  await expect(explorerItem('origin/mill')).toHaveAttribute('title', /hidden by the filters/);
  await expect(filtersButton()).toHaveAttribute('title', 'Hiding remote branches, tags and stashes in the graph');

  // Escape closes the menu and gives the focus back to its button
  await page.keyboard.press('Escape');
  await expect(filtersMenu()).toHaveCount(0);
  await expect(filtersButton()).toBeFocused();

  // The filters of the repository are back when it is opened again
  await page.locator('.repo-toolbar').getByRole('button', { name: 'Close' }).click();
  await openRecentRepo(page, repo);
  await expect(commitSummaries()).toHaveText(['Write the notes', 'Add the cards', 'Add the engine']);

  await filtersButton().click();
  await filterItem('Current branch only').click();
  await expect(commitSummaries()).toHaveText(['Write the notes', 'Add the engine']);
  await expect(filterItem('Hide tags')).toBeDisabled();
  await filtersMenu().getByRole('menuitem', { name: 'Show everything' }).click();
  await expect(commitSummaries()).toHaveCount(6);
  // A click outside closes the menu
  await page.locator('.commit-list').click({ position: { x: 5, y: 5 } });
  await expect(filtersMenu()).toHaveCount(0);
});
