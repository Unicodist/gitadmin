import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';
import { TestRepo, lines } from '../helpers';
import { addOrigin, launchApp, LaunchedApp, openRecentRepo, pickContextMenuItem } from './fixtures';

let repo: TestRepo;
let origin: string;
let launched: LaunchedApp;
let page: Page;

function commitRows() {
  return page.getByRole('listbox', { name: 'Commits' }).locator('li[role="option"]:not(.index-item)');
}

function commitSummaries() {
  return commitRows().locator('.commit-summary');
}

function graphHeader() {
  return page.getByRole('group', { name: 'Graph options' });
}

function canvas() {
  return page.getByRole('application', { name: 'Commit graph' });
}

function controls() {
  return page.getByRole('toolbar', { name: 'Canvas controls' });
}

function filtersButton() {
  return graphHeader().getByRole('button', { name: /^Filters/ });
}

function filter(name: string) {
  return graphHeader().getByRole('group', { name: 'Filters' }).getByRole('checkbox', { name: name, exact: true });
}

// The radio buttons are drawn by their labels
async function chooseView(name: 'List' | 'Canvas') {
  await graphHeader().locator(`label[for="graph-mode-${name.toLowerCase()}"]`).click();
  await expect(graphHeader().getByRole('radio', { name: name })).toBeChecked();
}

async function closeAndReopen() {
  await page.locator('.repo-toolbar').getByRole('button', { name: 'Close', exact: true }).click();
  await openRecentRepo(page, repo);
}

// main: engine - notes merged - cards, notes: engine - notes (tagged), origin/main one commit ahead of main, a stash
test.beforeEach(async () => {
  repo = await TestRepo.create();
  await repo.commit('Add the engine', { 'engine.txt': lines('analytical', 'engine') });
  await repo.git('checkout', '--quiet', '-b', 'notes');
  await repo.commit('Write the notes', { 'notes.txt': lines('note G') });
  await repo.git('tag', 'v1.0');
  await repo.git('checkout', '--quiet', 'main');
  await repo.git('merge', '--no-ff', '--quiet', '-m', "Merge branch 'notes'", 'notes');
  await repo.commit('Punch the cards', { 'cards.txt': lines('operation') });
  origin = await addOrigin(repo);
  await repo.commit('Only on the remote', { 'remote.txt': lines('remote') });
  await repo.git('push', '--quiet', 'origin', 'main');
  await repo.git('fetch', '--quiet', 'origin');
  await repo.git('reset', '--quiet', '--hard', 'main~1');
  repo.write('engine.txt', lines('analytical', 'engine', 'barrel'));
  await repo.git('stash', 'push', '--quiet', '-m', 'Try a barrel');
  launched = await launchApp({ settings: { recentlyOpened: [repo.workdir] } });
  page = launched.page;
  await openRecentRepo(page, repo);
  await expect(commitRows()).toHaveCount(6);
});

test.afterEach(async () => {
  expect(launched.pageErrors).toEqual([]);
  await launched.close();
  repo.remove();
  fs.rmSync(origin, { recursive: true, force: true });
});

test('switches to the canvas, zooms it, and remembers the view of the repository', async () => {
  await expect(graphHeader().getByRole('radio', { name: 'List' })).toBeChecked();
  await chooseView('Canvas');
  await expect(canvas()).toBeVisible();
  await expect(page.locator('.commit-list')).toHaveCount(0);
  const zoom = controls().getByRole('status', { name: 'Zoom' });
  await expect(zoom).toHaveText('100%');

  await controls().getByRole('button', { name: 'Zoom in' }).click();
  await expect(zoom).toHaveText('125%');
  await controls().getByRole('button', { name: 'Zoom out' }).click();
  await expect(zoom).toHaveText('100%');
  // The keyboard and the wheel with Ctrl, like a pinch of the trackpad, zoom too
  await canvas().focus();
  await page.keyboard.press('-');
  await expect(zoom).toHaveText('80%');
  await page.keyboard.press('+');
  await expect(zoom).toHaveText('100%');
  const box = (await canvas().boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -100);
  await page.keyboard.up('Control');
  await expect(zoom).not.toHaveText('100%');
  // The small history fits without zooming in
  await controls().getByRole('button', { name: 'Zoom in' }).click();
  await controls().getByRole('button', { name: 'Fit to view' }).click();
  await expect(zoom).toHaveText(/^\d+%$/);
  expect(parseInt(await zoom.innerText(), 10)).toBeLessThanOrEqual(100);

  // The minimap can be hidden
  const minimap = page.locator('canvas.canvas-minimap');
  await expect(minimap).toBeVisible();
  await controls().getByRole('button', { name: 'Minimap' }).click();
  await expect(minimap).toHaveCount(0);
  await expect(controls().getByRole('button', { name: 'Minimap' })).toHaveAttribute('aria-pressed', 'false');

  await closeAndReopen();
  await expect(canvas()).toBeVisible();
  await expect(page.locator('canvas.canvas-minimap')).toHaveCount(0);
  await chooseView('List');
  await expect(commitRows()).toHaveCount(6);
});

test('opens a commit with a click, shows a card on hover and the menu of the commit', async () => {
  await chooseView('Canvas');
  await controls().getByRole('button', { name: 'Jump to HEAD' }).click();
  // The head is in the middle of the canvas, its summary is right of the lanes
  const box = (await canvas().boundingBox())!;
  const x = box.x + 260;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  const card = page.locator('.canvas-hover-card');
  await expect(card).toBeVisible();
  await expect(card.locator('.canvas-card-summary')).toHaveText('Punch the cards');
  await expect(card.locator('.canvas-card-references')).toHaveText('main');
  await page.mouse.click(x, y);
  await expect(page.locator('.commit-viewer h2')).toHaveText('Punch the cards');

  // A drag moves the graph instead of opening the commit under the pointer
  await page.mouse.move(x, y + 36);
  await page.mouse.down();
  await page.mouse.move(x + 40, y + 120, { steps: 5 });
  await page.mouse.up();
  await expect(card).toHaveCount(0);
  await expect(page.locator('.commit-viewer h2')).toHaveText('Punch the cards');

  // The head is under the remote branch and the stash, then comes the index
  await controls().getByRole('button', { name: 'Jump to HEAD' }).click();
  await page.mouse.click(x, y - 3 * 36);
  await expect(page.locator('.index-viewer')).toBeVisible();

  await pickContextMenuItem(launched.app, 'Create branch here');
  await page.mouse.click(x, y, { button: 'right' });
  await expect(page.getByRole('dialog', { name: 'Create a branch' })).toBeVisible();
});

test('filters the history and remembers the filters of the repository', async () => {
  const badges = page.locator('.commit-list .reference-badge');
  await expect(badges.filter({ hasText: 'v1.0' })).toHaveCount(1);
  await filtersButton().click();
  await expect(filtersButton()).toHaveAttribute('aria-expanded', 'true');

  await filter('Hide tags').check();
  await expect(badges.filter({ hasText: 'v1.0' })).toHaveCount(0);
  // The tagged commit is still on notes
  await expect(commitSummaries()).toHaveText(['Only on the remote', 'On main: Try a barrel', 'Punch the cards',
    'Merge branch \'notes\'', 'Write the notes', 'Add the engine']);

  await filter('Hide stashes').check();
  await expect(commitRows()).toHaveCount(5);
  await filter('Hide remote branches').check();
  await expect(commitSummaries()).toHaveText(['Punch the cards', 'Merge branch \'notes\'', 'Write the notes', 'Add the engine']);
  await expect(filtersButton()).toContainText('3');

  await filter('Current branch only').check();
  await expect(filter('Local branches only')).toBeChecked();
  await expect(filter('Local branches only')).toBeDisabled();
  await expect(filter('Hide tags')).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(filtersButton()).toHaveAttribute('aria-expanded', 'false');

  // Another branch is checked out: the graph follows it
  await repo.git('checkout', '--quiet', 'notes');
  await expect(commitSummaries()).toHaveText(['Write the notes', 'Add the engine']);

  await closeAndReopen();
  await expect(commitSummaries()).toHaveText(['Write the notes', 'Add the engine']);
  await filtersButton().click();
  await expect(filter('Current branch only')).toBeChecked();
  await graphHeader().getByRole('button', { name: 'Show everything' }).click();
  await expect(commitRows()).toHaveCount(6);
  await expect(filter('Hide tags')).not.toBeChecked();
});

test('leaves the filters to the focus while branches are focused', async () => {
  await filtersButton().click();
  await filter('Hide tags').check();
  await expect(page.locator('.commit-list .reference-badge', { hasText: 'v1.0' })).toHaveCount(0);
  await page.locator('.reference-explorer').getByRole('checkbox', { name: 'Focus on v1.0', exact: true }).check();
  await expect(commitSummaries()).toHaveText(['Write the notes', 'Add the engine']);
  await expect(page.locator('.commit-list .reference-badge', { hasText: 'v1.0' })).toHaveCount(1);
  await filtersButton().click();
  await expect(filter('Hide tags')).toBeDisabled();
  await expect(graphHeader().getByRole('group', { name: 'Filters' })).toContainText('The focus chooses the branches');
});

test('highlights the commits that match and goes from one to the next', async () => {
  const search = graphHeader().getByRole('searchbox', { name: 'Highlight commits' });
  await search.fill('notes');
  await expect(graphHeader()).toContainText('2 matches');
  await expect(commitRows().filter({ hasText: 'Write the notes' })).not.toHaveClass(/\bdimmed-commit\b/);
  await expect(commitRows().filter({ hasText: 'Punch the cards' })).toHaveClass(/\bdimmed-commit\b/);
  await expect(page.locator('.commit-list li.dimmed-commit')).toHaveCount(4);

  await search.press('Enter');
  await expect(page.locator('.commit-viewer h2')).toHaveText('Merge branch \'notes\'');
  await search.press('Enter');
  await expect(page.locator('.commit-viewer h2')).toHaveText('Write the notes');
  await search.press('Enter');
  await expect(page.locator('.commit-viewer h2')).toHaveText('Merge branch \'notes\'');
  await search.press('Shift+Enter');
  await expect(page.locator('.commit-viewer h2')).toHaveText('Write the notes');

  await search.fill('cards before:2000-01');
  await expect(graphHeader()).toContainText('No match');
  await expect(page.locator('.commit-list li.dimmed-commit')).toHaveCount(6);
  await search.fill('');
  await expect(page.locator('.commit-list li.dimmed-commit')).toHaveCount(0);
  await expect(graphHeader()).not.toContainText('match');
});
