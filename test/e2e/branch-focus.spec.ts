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

function commitSummaries() {
  return commitRows().locator('.commit-summary');
}

function explorerItem(name: string) {
  return page.locator('.reference-explorer').getByRole('button', { name: name, exact: true });
}

function focusCheckbox(name: string) {
  return page.locator('.reference-explorer').getByRole('checkbox', { name: `Focus on ${name}`, exact: true });
}

function focusBar() {
  return page.getByRole('region', { name: 'Branch focus' });
}

// main and feature fork from the first commit, experiment too but it is never focused
test.beforeEach(async () => {
  repo = await TestRepo.create();
  await repo.commit('Add the engine', { 'engine.txt': lines('analytical', 'engine') });
  await repo.git('checkout', '--quiet', '-b', 'feature');
  await repo.commit('Add the cards', { 'cards.txt': lines('operation') });
  await repo.commit('Punch the cards', { 'cards.txt': lines('operation', 'variable') });
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

test('shows only the history of the checked branches and how they relate', async () => {
  await expect(focusBar()).toHaveCount(0);
  await focusCheckbox('feature').check();
  await expect(focusBar()).toContainText('Showing 1 branch');
  await expect(commitSummaries()).toHaveText(['Punch the cards', 'Add the cards', 'Add the engine']);

  await focusCheckbox('main').check();
  await expect(focusBar()).toContainText('Showing 2 branches');
  await expect(focusCheckbox('feature')).toBeChecked();
  await expect(commitSummaries()).toHaveText(['Write the notes', 'Punch the cards', 'Add the cards', 'Add the engine']);
  await expect(page.locator('.commit-list')).not.toContainText('Try a barrel');
  // The branch that is not focused is dimmed in the explorer
  await expect(explorerItem('experiment')).toHaveClass(/\bhidden-by-focus\b/);
  await expect(explorerItem('experiment')).toHaveAttribute('title', /hidden by the focus/);
  await expect(explorerItem('main')).not.toHaveClass(/\bhidden-by-focus\b/);

  // The merge base is marked in the list and in the bar, the comparison is in the panel of the relations
  const mergeBase = commitRows().filter({ hasText: 'Add the engine' }).locator('.relation-badge');
  await expect(mergeBase).toHaveCount(1);
  await expect(mergeBase).toHaveAttribute('title', 'Merge base of feature and main');
  await expect(mergeBase.locator('.relation-badge-text')).toHaveText('Merge base');
  await expect(commitRows().locator('.relation-badge')).toHaveCount(1);
  const relations = focusBar().getByRole('button', { name: 'Relations' });
  await expect(relations).toHaveAttribute('aria-expanded', 'true');
  await expect(focusBar().getByRole('list', { name: 'Comparisons' })).toHaveText('feature is 2 commits ahead of and 1 behind main');
  await relations.click();
  await expect(relations).toHaveAttribute('aria-expanded', 'false');
  await expect(focusBar().getByRole('list', { name: 'Comparisons' })).toBeHidden();

  // The merge base of the bar selects its commit
  const sha = (await repo.sha('main~1')).substring(0, 6);
  await focusBar().getByRole('button', { name: `Merge base ${sha} Add the engine`, exact: true }).click();
  await expect(page.locator('.commit-viewer h2')).toHaveText('Add the engine');
  await expect(page.getByRole('listbox', { name: 'Commits' }).getByRole('option', { selected: true })).toContainText('Add the engine');

  // A click on a commit still opens it
  await commitRows().filter({ hasText: 'Punch the cards' }).click();
  await expect(page.locator('.commit-viewer h2')).toHaveText('Punch the cards');

  await focusBar().getByRole('button', { name: 'Show all', exact: true }).click();
  await expect(focusBar()).toHaveCount(0);
  await expect(commitRows()).toHaveCount(5);
  await expect(page.locator('.commit-list')).toContainText('Try a barrel');
  await expect(focusCheckbox('main')).not.toBeChecked();
  await expect(page.locator('.commit-viewer h2')).toHaveText('Punch the cards');
});

test('remembers the focus of the repository', async () => {
  await focusCheckbox('feature').check();
  await focusCheckbox('main').check();
  await expect(focusBar()).toContainText('Showing 2 branches');
  await page.locator('.repo-toolbar').getByRole('button', { name: 'Close', exact: true }).click();

  await openRecentRepo(page, repo);
  await expect(focusBar()).toContainText('Showing 2 branches');
  await expect(commitRows()).toHaveCount(4);
  await expect(focusCheckbox('feature')).toBeChecked();
  await expect(focusCheckbox('main')).toBeChecked();
});

test('changes the focus from the context menu and with Ctrl+click', async () => {
  // The badges of the commit list and the rows of the explorer have the same menu
  await pickContextMenuItem(launched.app, 'Focus on main');
  await page.locator('.commit-list .reference-badge', { hasText: /^main$/ }).click({ button: 'right' });
  await expect(focusBar()).toContainText('Showing 1 branch');
  await expect(commitSummaries()).toHaveText(['Write the notes', 'Add the engine']);

  await pickContextMenuItem(launched.app, 'Add experiment to the focus');
  await explorerItem('experiment').click({ button: 'right' });
  await expect(focusBar()).toContainText('Showing 2 branches');
  await expect(commitSummaries()).toHaveText(['Write the notes', 'Try a barrel', 'Add the engine']);

  await explorerItem('experiment').click({ modifiers: ['ControlOrMeta'] });
  await expect(focusBar()).toContainText('Showing 1 branch');
  await expect(commitSummaries()).toHaveText(['Write the notes', 'Add the engine']);

  // A click on a hidden branch adds it to the focus and selects its commit
  await explorerItem('feature').click();
  await expect(focusBar()).toContainText('Showing 2 branches');
  await expect(page.locator('.commit-viewer h2')).toHaveText('Punch the cards');

  await pickContextMenuItem(launched.app, 'Show all branches');
  await explorerItem('main').click({ button: 'right' });
  await expect(focusBar()).toHaveCount(0);
  await expect(commitRows()).toHaveCount(5);
});

test('chooses the branches in the focus dialog', async () => {
  await page.locator('.repo-toolbar').getByRole('button', { name: 'Focus', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Focus on branches' });
  const filter = dialog.getByRole('searchbox', { name: 'Filter branches' });
  await expect(filter).toBeFocused();
  await expect(dialog).toContainText('0 of 16');

  await filter.fill('FEAT');
  await expect(dialog.getByRole('checkbox')).toHaveCount(1);
  await dialog.getByRole('checkbox', { name: 'feature', exact: true }).check();
  await filter.fill('');
  await dialog.getByRole('checkbox', { name: 'main', exact: true }).check();
  await expect(dialog).toContainText('2 of 16');
  // Cancel leaves the graph as it was
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(focusBar()).toHaveCount(0);

  await page.locator('.repo-toolbar').getByRole('button', { name: 'Focus', exact: true }).click();
  await dialog.getByRole('checkbox', { name: 'feature', exact: true }).check();
  await dialog.getByRole('checkbox', { name: 'main', exact: true }).check();
  await dialog.getByRole('button', { name: 'Show', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(focusBar()).toContainText('Showing 2 branches');
  await expect(commitRows()).toHaveCount(4);

  // The dialog opens from the bar with the current focus, Clear then Show shows everything
  await focusBar().getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(dialog.getByRole('checkbox', { name: 'feature', exact: true })).toBeChecked();
  await dialog.getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(dialog).toContainText('0 of 16');
  await dialog.getByRole('button', { name: 'Show', exact: true }).click();
  await expect(focusBar()).toHaveCount(0);
  await expect(commitRows()).toHaveCount(5);
});
