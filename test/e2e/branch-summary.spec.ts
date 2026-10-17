import { test, expect, Page } from '@playwright/test';
import { TestRepo, lines } from '../helpers';
import { launchApp, LaunchedApp, openRecentRepo, pickContextMenuItem } from './fixtures';

let repo: TestRepo;
let launched: LaunchedApp;
let page: Page;

// Rows of the commit list, without the index
function commitRows() {
  return page.getByRole('listbox', { name: 'Commits' }).locator('li[role="option"]:not(.index-item)');
}

function explorerItem(name: string) {
  return page.locator('.reference-explorer').getByRole('button', { name: name, exact: true });
}

function summaryViewer() {
  return page.locator('.branch-summary-viewer');
}

function statistic(label: string) {
  return summaryViewer().getByRole('list', { name: 'Statistics' }).locator('li').filter({ hasText: label });
}

function readClipboard() {
  return launched.app.evaluate(({ clipboard }) => clipboard.readText());
}

async function openSummary(name: string) {
  await pickContextMenuItem(launched.app, 'See branch summary');
  await explorerItem(name).click({ button: 'right' });
  await expect(summaryViewer().locator('h2')).toHaveText(name);
  await expect(summaryViewer().getByRole('status').filter({ hasText: 'Loading' })).toHaveCount(0);
}

// feature and experiment fork from the first commit of main, which moves on after them
test.beforeEach(async () => {
  repo = await TestRepo.create();
  await repo.commit('Add the engine', { 'engine.txt': lines('analytical', 'engine') });
  await repo.git('checkout', '--quiet', '-b', 'feature');
  await repo.commit('Add the cards', { 'cards.txt': lines('operation') });
  await repo.commit('Punch the cards', { 'cards.txt': lines('operation', 'variable'), 'src/mill/store.txt': lines('column') });
  await repo.git('checkout', '--quiet', '-b', 'experiment', 'main');
  await repo.commit('Try a barrel', { 'barrel.txt': lines('studs') });
  await repo.git('checkout', '--quiet', 'main');
  await repo.commit('Write the notes', { 'notes.txt': lines('note G') });
  launched = await launchApp({ settings: { recentlyOpened: [repo.workdir] } });
  page = launched.page;
  await openRecentRepo(page, repo);
  await expect(commitRows()).toHaveCount(5);
});

test.afterEach(async () => {
  expect(launched.pageErrors).toEqual([]);
  await launched.close();
  repo.remove();
});

test('opens the summary of a branch from the context menu of the explorer', async () => {
  await openSummary('feature');
  const viewer = summaryViewer();
  await expect(viewer.locator('.viewer-title')).toHaveText('Branch summary');
  await expect(viewer.locator('.branch-summary-fork')).toHaveText('Forked from main');
  await expect(viewer.getByRole('list', { name: 'Fork' })).toContainText('2 commits ahead, 1 behind');
  await expect(viewer.getByRole('combobox', { name: 'Source branch' })).toHaveValue('');
  await expect(viewer.getByRole('combobox', { name: 'Source branch' }).locator('option').first()).toHaveText('Detect automatically (main)');
  // The commit viewer and the index viewer are not shown with it
  await expect(page.locator('.index-viewer')).toHaveCount(0);

  await expect(statistic('Commits')).toContainText('2');
  await expect(statistic('Files changed')).toContainText('2');
  await expect(statistic('Lines')).toContainText('+3 -0');
  await expect(viewer.getByRole('list', { name: 'Authors' })).toHaveText('Config User 2 commits');
  await expect(viewer.locator('h3', { hasText: /^Commits/ })).toHaveText('Commits (2)');
  await expect(viewer.getByRole('list', { name: 'Branch commits' }).locator('li')).toHaveText([/Punch the cards/, /Add the cards/]);
  await expect(viewer.locator('.synced-badge')).toHaveCount(0);
  await expect(viewer.locator('.merge-check')).toHaveText('Merges cleanly into main');
  await expect(viewer.getByRole('list', { name: 'Most changed files' }).locator('li')).toHaveText([/cards\.txt/, /src\/mill\/store\.txt/]);
  await expect(viewer.getByRole('list', { name: 'Most changed directories' }).locator('li')).toHaveText(['./ +2 -0', 'src/mill/ +1 -0']);
  await expect(viewer.locator('h3', { hasText: /^Files/ })).toHaveText('Files (2)');

  // A new commit of the branch is in the summary at once
  await repo.git('checkout', '--quiet', 'feature');
  await repo.commit('Sort the cards', { 'cards.txt': lines('operation', 'variable', 'number') });
  await expect(statistic('Commits')).toContainText('3');
  await expect(viewer.getByRole('list', { name: 'Fork' })).toContainText('3 commits ahead, 1 behind');

  // The fork commit selects its commit in the graph
  const forkSha = (await repo.sha('main~1')).substring(0, 6);
  await viewer.getByRole('button', { name: `Select fork commit ${forkSha}`, exact: true }).click();
  await expect(page.locator('.commit-viewer h2')).toHaveText('Add the engine');
  await expect(summaryViewer()).toHaveCount(0);
  await expect(page.getByRole('listbox', { name: 'Commits' }).getByRole('option', { selected: true })).toContainText('Add the engine');
});

test('opens the summary from a badge of the graph and selects its commits', async () => {
  await pickContextMenuItem(launched.app, 'See branch summary');
  await page.locator('.commit-list .reference-badge', { hasText: /^experiment$/ }).click({ button: 'right' });
  await expect(summaryViewer().locator('h2')).toHaveText('experiment');
  await expect(summaryViewer().locator('.branch-summary-fork')).toHaveText('Forked from main');
  await expect(statistic('Commits')).toContainText('1');

  // Another branch replaces it
  await openSummary('feature');
  await expect(statistic('Commits')).toContainText('2');

  await summaryViewer().getByRole('list', { name: 'Branch commits' }).getByRole('button').filter({ hasText: 'Add the cards' }).click();
  await expect(page.locator('.commit-viewer h2')).toHaveText('Add the cards');
  await expect(page.getByRole('listbox', { name: 'Commits' }).getByRole('option', { selected: true })).toContainText('Add the cards');

  // The commit viewer goes back to the summary, to look at the next commit
  await page.locator('.commit-viewer').getByRole('button', { name: 'Back to the branch summary' }).click();
  await expect(summaryViewer().locator('h2')).toHaveText('feature');
  await summaryViewer().getByRole('list', { name: 'Branch commits' }).getByRole('button').filter({ hasText: 'Punch the cards' }).click();
  await expect(page.locator('.commit-viewer h2')).toHaveText('Punch the cards');
  // A commit selected in the graph does not come from the summary
  await commitRows().filter({ hasText: 'Add the cards' }).click();
  await expect(page.locator('.commit-viewer h2')).toHaveText('Add the cards');
  await expect(page.locator('.commit-viewer').getByRole('button', { name: 'Back to the branch summary' })).toHaveCount(0);

  // The close button goes back to the selected commit
  await openSummary('feature');
  await summaryViewer().getByRole('button', { name: 'Close the summary' }).click();
  await expect(summaryViewer()).toHaveCount(0);
  await expect(page.locator('.commit-viewer h2')).toHaveText('Add the cards');
});

test('closes the summary when its branch is removed', async () => {
  await openSummary('experiment');
  await repo.git('branch', '-D', 'experiment');
  await expect(summaryViewer()).toHaveCount(0);
  await expect(page.locator('.index-viewer')).toBeVisible();
});

test('marks the merges that synced the branch with its source', async () => {
  await repo.git('checkout', '--quiet', 'feature');
  await repo.git('merge', '--quiet', '--no-ff', '--no-edit', 'main');
  await expect(commitRows()).toHaveCount(6);
  await openSummary('feature');
  const viewer = summaryViewer();
  await expect(viewer.getByRole('list', { name: 'Fork' })).toContainText('3 commits ahead, 0 behind');
  const syncedSha = (await repo.sha('main')).substring(0, 6);
  await expect(viewer.getByRole('list', { name: 'Fork' }).locator('li', { hasText: 'Last synced at' })).toContainText(syncedSha);
  const rows = viewer.getByRole('list', { name: 'Branch commits' }).locator('li');
  await expect(rows).toHaveCount(3);
  await expect(rows.filter({ hasText: 'Merge branch' }).locator('.synced-badge')).toHaveText('Synced with source');
  await expect(viewer.locator('.synced-badge')).toHaveCount(1);
  // The net change leaves out the files of the source
  await expect(viewer.locator('h3', { hasText: /^Files/ })).toHaveText('Files (2)');
});

test('lists the files that conflict with the source', async () => {
  await repo.commit('Write the cards', { 'cards.txt': lines('punched') });
  await expect(commitRows()).toHaveCount(6);
  await openSummary('feature');
  const viewer = summaryViewer();
  await expect(viewer.locator('.merge-check')).toHaveText('Conflicts with main in 1 file');
  await expect(viewer.getByRole('list', { name: 'Conflicting files' })).toHaveText('cards.txt');
});

test('remembers the source chosen in the dropdown', async () => {
  await openSummary('feature');
  const source = summaryViewer().getByRole('combobox', { name: 'Source branch' });
  await expect(source.locator('option')).toHaveText(['Detect automatically (main)', 'experiment', 'main']);
  await source.selectOption({ label: 'experiment' });
  await expect(summaryViewer().locator('.branch-summary-fork')).toHaveText('Forked from experiment');
  await expect(summaryViewer().getByRole('list', { name: 'Fork' })).toContainText('2 commits ahead, 1 behind');
  await expect(source).toHaveValue('refs/heads/experiment');

  await summaryViewer().getByRole('button', { name: 'Close the summary' }).click();
  await openSummary('feature');
  await expect(summaryViewer().locator('.branch-summary-fork')).toHaveText('Forked from experiment');
  await expect(summaryViewer().getByRole('combobox', { name: 'Source branch' })).toHaveValue('refs/heads/experiment');
  // The other branches keep the detected source
  await openSummary('experiment');
  await expect(summaryViewer().locator('.branch-summary-fork')).toHaveText('Forked from main');

  await openSummary('feature');
  await summaryViewer().getByRole('combobox', { name: 'Source branch' }).selectOption({ label: 'Detect automatically (main)' });
  await expect(summaryViewer().locator('.branch-summary-fork')).toHaveText('Forked from main');
});

test('copies the summary as Markdown', async () => {
  await launched.app.evaluate(({ clipboard }) => clipboard.clear());
  await openSummary('feature');
  const button = summaryViewer().getByRole('button', { name: 'Copy as Markdown' });
  await button.click();
  await expect.poll(readClipboard).toContain('## Summary of feature');
  const markdown = await readClipboard();
  expect(markdown).toContain('Forked from `main`');
  expect(markdown).toContain('2 commits ahead, 1 behind');
  expect(markdown).toContain('Punch the cards');
  await expect(button.locator('.tooltip-text')).toHaveText('Copied');
});

test('opens the files of the branch in the patch viewer', async () => {
  await openSummary('feature');
  await summaryViewer().locator('.patch-list li').filter({ hasText: 'cards.txt' }).click();
  const patchViewer = page.locator('.patch-viewer');
  await expect(patchViewer.getByRole('heading', { name: 'cards.txt' })).toBeVisible();
  await expect(patchViewer.locator('.editor.modified')).toContainText('variable');
  await expect(summaryViewer().locator('.patch-list li.selected-patch')).toContainText('cards.txt');

  // The most changed files open too
  await summaryViewer().getByRole('list', { name: 'Most changed files' }).getByRole('button').filter({ hasText: 'store.txt' }).click();
  await expect(patchViewer.getByRole('heading', { name: 'store.txt' })).toBeVisible();
  await expect(summaryViewer().locator('.patch-list li.selected-patch')).toContainText('store.txt');
});
