import { test, expect, Locator, Page } from '@playwright/test';
import * as fs from 'fs';
import { TestRepo, lines } from '../helpers';
import { addOrigin, launchApp, LaunchedApp, openRecentRepo } from './fixtures';

let repo: TestRepo;
let origin: string;
let launched: LaunchedApp;
let page: Page;

// Color that a variable of the theme computes to, to compare it with the colors of the elements
function themeColor(variable: string) {
  return page.evaluate((variable) => {
    const element = document.createElement('span');
    element.style.color = `var(--${variable})`;
    document.body.append(element);
    const color = getComputedStyle(element).color;
    element.remove();
    return color;
  }, variable);
}

test.beforeEach(async () => {
  repo = await TestRepo.create();
  await repo.commit('Add the engine', { 'engine.txt': lines('analytical', 'engine'), 'cards.txt': lines('operation'), 'notes.txt': 'note G\n' });
  await repo.git('checkout', '--quiet', '-b', 'notes');
  await repo.commit('Write the notes', { 'notes.txt': lines('note G', 'note H') });
  await repo.git('tag', 'v1.0');
  await repo.git('checkout', '--quiet', 'main');
  origin = await addOrigin(repo);
  repo.write('engine.txt', lines('analytical', 'engine', 'barrel'));
  await repo.git('stash', 'push', '--quiet', '-m', 'Try a barrel');
  // A change of each status: modified and untracked files, then added, deleted and renamed files in the index
  repo.write('engine.txt', lines('analytical', 'difference', 'engine'));
  repo.write('src/new-file.ts', 'export const a = 1;\n');
  repo.write('mill.txt', lines('store', 'mill'));
  await repo.git('add', 'mill.txt');
  await repo.git('rm', '--quiet', 'cards.txt');
  fs.mkdirSync(repo.path('docs'));
  await repo.git('mv', 'notes.txt', 'docs/notes.md');

  launched = await launchApp({ settings: { recentlyOpened: [repo.workdir] } });
  page = launched.page;
  await openRecentRepo(page, repo);
});

test.afterEach(async () => {
  await launched.close();
  repo.remove();
  fs.rmSync(origin, { recursive: true, force: true });
});

test('shows the status of the files with badges', async () => {
  const indexViewer = page.locator('.index-viewer');
  const files: [string, string, string, string][] = [
    ['engine.txt', 'M', 'Modified', 'warning'],
    ['new-file.ts', 'U', 'Untracked', 'success'],
    ['mill.txt', 'A', 'Added', 'success'],
    ['cards.txt', 'D', 'Deleted', 'danger'],
    ['notes.md', 'R', 'Renamed', 'accent-text']
  ];
  for (const [name, letter, word, color] of files) {
    const badge = indexViewer.locator('li', { hasText: name }).locator('.patch-status');
    await expect(badge).toHaveAttribute('title', word);
    await expect(badge.locator('[aria-hidden="true"]')).toHaveText(letter);
    await expect(badge.locator('.visually-hidden')).toHaveText(word);
    await expect(badge).toHaveCSS('color', await themeColor(color));
  }

  // The folder and the name of the file are apart, the tooltip has the whole path
  const renamed = indexViewer.locator('li', { hasText: 'notes.md' }).locator('.patch-path');
  await expect(renamed.locator('.left')).toHaveText('docs/');
  await expect(renamed.locator('.right')).toHaveText('notes.md');
  await expect(renamed).toHaveAttribute('title', 'docs/notes.md, renamed from notes.txt');
  expect(launched.pageErrors).toEqual([]);
});

test('names the stage buttons after their file and keeps the focus in the list', async () => {
  const indexViewer = page.locator('.index-viewer');
  const stage = page.getByRole('button', { name: 'Stage engine.txt', exact: true });
  await expect(stage).toHaveAttribute('title', 'Stage');
  await expect(page.getByRole('button', { name: 'Stage src/new-file.ts', exact: true })).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Unstage mill.txt', exact: true })).toHaveAttribute('title', 'Unstage');
  // The patch viewer has the only Stage file button
  await expect(page.getByRole('button', { name: 'Stage file' })).toHaveCount(0);

  // The buttons show on hover and with the keyboard focus
  await expect(stage).toHaveCSS('opacity', '0');
  await indexViewer.locator('li', { hasText: 'engine.txt' }).hover();
  await expect(stage).toHaveCSS('opacity', '1');
  await page.mouse.move(0, 0);
  await expect(stage).toHaveCSS('opacity', '0');
  const unstagedList = indexViewer.locator('ul.patch-list').first();
  await unstagedList.focus();
  await page.keyboard.press('Tab');
  await expect(stage).toBeFocused();
  await expect(stage).toHaveCSS('opacity', '1');

  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Unstage engine.txt', exact: true })).toHaveCount(1);
  await expect(unstagedList).toBeFocused();
  expect((await repo.git('diff', '--cached', '--name-only')).split('\n')).toContain('engine.txt');
  expect(launched.pageErrors).toEqual([]);
});

test('selects the files of a list with the arrow keys', async () => {
  const indexViewer = page.locator('.index-viewer');
  const stagedList = indexViewer.locator('ul.patch-list').nth(1);
  const rows = stagedList.locator('li');
  await expect(rows).toHaveCount(3);
  await stagedList.focus();
  await page.keyboard.press('ArrowDown');
  await expect(rows.nth(0)).toHaveClass('selected-patch');
  await page.keyboard.press('ArrowDown');
  await expect(rows.nth(1)).toHaveClass('selected-patch');
  await expect(stagedList.locator('li.selected-patch')).toHaveCount(1);
  await page.keyboard.press('Shift+ArrowDown');
  await expect(stagedList.locator('li.selected-patch')).toHaveCount(2);
  await page.keyboard.press('ArrowUp');
  await expect(stagedList.locator('li.selected-patch')).toHaveCount(1);
  await expect(stagedList).toBeFocused();
  expect(launched.pageErrors).toEqual([]);
});

test('selects the references with the keyboard', async () => {
  const explorer = page.locator('.reference-explorer');
  const item = (name: string) => explorer.getByRole('button', { name: name, exact: true });
  await expect(item('main')).toHaveAttribute('aria-current', 'true');
  await expect(item('notes')).not.toHaveAttribute('aria-current');
  await expect(item('main').locator('svg.icon-git-branch')).toHaveCount(1);
  await expect(item('origin/main').locator('svg.icon-cloud')).toHaveCount(1);
  await expect(item('v1.0').locator('svg.icon-tag')).toHaveCount(1);
  await expect(item('On main: Try a barrel').locator('svg.icon-archive')).toHaveCount(1);
  await expect(item('origin/main')).toHaveAttribute('title', 'origin/main');

  // The arrow keys go from the Index to the header of the local branches, then to main and notes
  await explorer.getByRole('button', { name: 'Index' }).focus();
  await page.keyboard.press('ArrowDown');
  await expect(explorer.getByRole('button', { name: /^Local branches/ })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect(item('notes')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('.commit-viewer h2')).toHaveText('Write the notes');
  await expect(page.locator('.commit-list').getByRole('option', { selected: true })).toContainText('Write the notes');

  await explorer.getByRole('button', { name: 'Index' }).press('Enter');
  await expect(page.locator('.index-viewer')).toBeVisible();
  await item('v1.0').press('Space');
  await expect(page.locator('.commit-viewer h2')).toHaveText('Write the notes');
  expect(launched.pageErrors).toEqual([]);
});

test('collapses and expands the sections', async () => {
  const explorer = page.locator('.reference-explorer');
  const toggle = explorer.getByRole('button', { name: /^Tags/ });
  const tag = explorer.getByRole('button', { name: 'v1.0', exact: true });
  await expect(toggle.locator('.reference-count')).toHaveText('1');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(toggle.locator('svg.icon-chevron-down')).toHaveCount(1);
  await expect(tag).toBeVisible();

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(toggle.locator('svg.icon-chevron-right')).toHaveCount(1);
  await expect(tag).toBeHidden();
  // The arrow keys skip the items of the collapsed section
  await page.keyboard.press('ArrowDown');
  await expect(explorer.getByRole('button', { name: /^Stashes/ })).toBeFocused();

  await toggle.press('Enter');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(tag).toBeVisible();
  expect(launched.pageErrors).toEqual([]);
});

test('keeps the commit list at 28px rows with badges and the keyboard navigation', async () => {
  const commitList = page.locator('.commit-list');
  const listbox = commitList.getByRole('listbox', { name: 'Commits' });
  const rows = commitList.locator('li');
  for (const row of await rows.all()) {
    expect((await row.boundingBox())!.height).toBe(28);
  }

  const badge = (name: string): Locator => commitList.locator('.reference-badge', { hasText: new RegExp(`^${name}$`) });
  await expect(badge('main')).toHaveClass(/\bhead\b/);
  await expect(badge('main')).toHaveAttribute('title', 'main');
  await expect(badge('origin/main')).toHaveClass(/\bremote\b/);
  await expect(badge('origin/main').locator('svg.icon-cloud')).toHaveCount(1);
  await expect(badge('v1.0')).toHaveClass(/\btag\b/);
  await expect(commitList.locator('li', { hasText: 'Try a barrel' }).locator('.stash-badge svg.icon-archive')).toHaveCount(1);

  // The index is selected first, the arrows move the selection, and Tab leaves the list
  await expect(rows.first()).toHaveAttribute('aria-selected', 'true');
  await listbox.focus();
  await page.keyboard.press('ArrowDown');
  await expect(rows.nth(1)).toHaveAttribute('aria-selected', 'true');
  await expect(listbox).toHaveAttribute('aria-activedescendant', (await rows.nth(1).getAttribute('id'))!);
  await expect(page.locator('.commit-viewer h2')).toHaveText((await rows.nth(1).locator('.commit-summary').textContent())!);
  await page.keyboard.press('ArrowUp');
  await expect(rows.first()).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Tab');
  await expect(listbox).not.toBeFocused();
  expect(launched.pageErrors).toEqual([]);
});
