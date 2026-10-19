import { test, expect, ElectronApplication, Page } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as Path from 'path';
import { TestRepo, lines } from '../helpers';
import { addOrigin, launchApp, LaunchedApp, openRecentRepo, pickContextMenuItem, sendMenuCommand } from './fixtures';

let repo: TestRepo;
let launched: LaunchedApp;
let app: ElectronApplication;
let page: Page;
let cleanup: string[];

function createTempDir() {
  const path = fs.realpathSync.native(fs.mkdtempSync(Path.join(os.tmpdir(), 'gitadmin-dialogs-')));
  cleanup.push(path);
  return path;
}

test.beforeEach(async () => {
  repo = await TestRepo.create();
  await repo.commit('Add the engine', { 'engine.txt': lines('analytical', 'engine') });
  await repo.git('checkout', '--quiet', '-b', 'notes');
  await repo.commit('Write the notes', { 'notes.txt': 'note G\n' });
  await repo.git('checkout', '--quiet', 'main');
  repo.write('engine.txt', lines('analytical', 'difference', 'engine'));
  cleanup = [];
  launched = await launchApp({ settings: { recentlyOpened: [repo.workdir] } });
  app = launched.app;
  page = launched.page;
});

test.afterEach(async () => {
  expect(launched.pageErrors).toEqual([]);
  await launched.close();
  repo.remove();
  for (const path of cleanup) {
    fs.rmSync(path, { recursive: true, force: true });
  }
});

test('keeps the focus in a dialog and gives it back when the dialog closes', async () => {
  await openRecentRepo(page, repo);
  // A diff, which Escape closes when there is no dialog
  await page.locator('.index-viewer li', { hasText: 'engine.txt' }).click();
  await expect(page.locator('.monaco-diff-editor')).toBeVisible();

  const branch = page.locator('.repo-toolbar').getByRole('button', { name: 'Branch' });
  await branch.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Create a branch' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute('aria-modal', 'true');
  const name = dialog.getByLabel('Name', { exact: true });
  await expect(name).toBeFocused();

  // Tab goes around the dialog and skips the disabled button, Shift+Tab goes back
  const close = dialog.getByRole('button', { name: 'Close dialog' });
  const cancel = dialog.getByRole('button', { name: 'Cancel' });
  for (const element of [dialog.getByLabel('Check out the new branch'), cancel, close, name]) {
    await page.keyboard.press('Tab');
    await expect(element).toBeFocused();
  }
  await page.keyboard.press('Shift+Tab');
  await expect(close).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(cancel).toBeFocused();

  // The dialog is over the toolbar
  const box = (await branch.boundingBox())!;
  const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)!.closest('.modal-backdrop') !== null, point)).toBe(true);

  // Escape closes the dialog only
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(branch).toBeFocused();
  await expect(page.locator('.monaco-diff-editor')).toBeVisible();

  // The close button too gives the focus back
  await page.keyboard.press('Enter');
  await expect(name).toBeFocused();
  await close.click();
  await expect(dialog).toHaveCount(0);
  await expect(branch).toBeFocused();
});

test('brings the focus back to the dialog when it leaves it, unless it goes to a notification', async () => {
  await openRecentRepo(page, repo);
  const branch = page.locator('.repo-toolbar').getByRole('button', { name: 'Branch' });
  const dialog = page.getByRole('dialog', { name: 'Create a branch' });
  const name = dialog.getByLabel('Name', { exact: true });
  const checkout = dialog.getByLabel('Check out the new branch');
  // The branch exists already, the error stays on screen
  await branch.click();
  await name.fill('notes');
  await page.keyboard.press('Enter');
  const toast = page.locator('.notification-queue li', { hasText: 'Unable to create branch notes' });
  await expect(toast).toHaveCount(1);

  await branch.click();
  await expect(name).toBeFocused();
  await checkout.focus();
  // The notifications are above the dialog, they can have the focus
  const dismiss = toast.getByRole('button', { name: 'Dismiss notification' });
  await dismiss.focus();
  await expect(dismiss).toBeFocused();
  // Tab after the notification goes back to the dialog, and so does the focus that an element under the dialog takes
  await page.keyboard.press('Tab');
  await expect(checkout).toBeFocused();
  await page.locator('.repo-toolbar').getByRole('button', { name: 'Pull' }).focus();
  await expect(checkout).toBeFocused();

  // Once the dialog is closed, the focus goes anywhere
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(branch).toBeFocused();
  await dismiss.focus();
  await expect(dismiss).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(toast).toHaveCount(0);
});

test('creates a branch at the selected commit and checks it out', async () => {
  await openRecentRepo(page, repo);
  await page.locator('.commit-list').getByText('Write the notes').click();
  await page.locator('.repo-toolbar').getByRole('button', { name: 'Branch' }).click();
  const dialog = page.getByRole('dialog', { name: 'Create a branch' });
  const sha = (await repo.git('rev-parse', 'notes')).trim();
  await expect(dialog.locator('.branch-start')).toHaveText(`Starts at ${sha.substring(0, 7)} Write the notes`);
  await expect(dialog.getByLabel('Check out the new branch')).toBeChecked();

  const create = dialog.getByRole('button', { name: 'Create branch' });
  await expect(create).toBeDisabled();
  await dialog.getByLabel('Name', { exact: true }).fill('feature/bernoulli');
  await expect(create).toBeEnabled();
  await page.keyboard.press('Enter');
  await expect(dialog).toHaveCount(0);
  await expect.poll(async () => (await repo.git('branch', '--show-current')).trim()).toBe('feature/bernoulli');
  expect((await repo.git('rev-parse', 'feature/bernoulli')).trim()).toBe(sha);
});

test('clones a repository in the folder that the dialog shows', async () => {
  const origin = await addOrigin(repo);
  cleanup.push(origin);
  const location = createTempDir();
  const name = Path.basename(origin);
  await sendMenuCommand(app, 'clone-repo');
  const dialog = page.getByRole('dialog', { name: 'Clone a repo' });
  const url = dialog.getByLabel('Repository URL');
  const path = dialog.locator('.repo-path');
  const clone = dialog.getByRole('button', { name: 'Clone', exact: true });
  await expect(url).toBeFocused();
  await expect(path).toHaveText('Choose where to put the repository');
  await expect(clone).toBeDisabled();

  await url.fill(origin);
  // The name of the folder comes from the URL unless it is given
  const folder = dialog.getByLabel('Folder name');
  await expect(folder).toHaveAttribute('placeholder', name);
  await dialog.getByLabel('Location').fill(location);
  await expect(path.locator('.ellipsis-middle')).toHaveText(Path.join(location, name));
  await expect(path).toHaveAttribute('title', Path.join(location, name));
  // Screen readers read the full path rather than its two parts
  await expect(folder).toHaveAccessibleDescription(Path.join(location, name));
  await folder.fill('copy');
  await expect(path.locator('.ellipsis-middle')).toHaveText(Path.join(location, 'copy'));
  await expect(folder).toHaveAccessibleDescription(Path.join(location, 'copy'));

  await clone.click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.repo-title h1')).toHaveText('copy');
  expect(fs.existsSync(Path.join(location, 'copy', 'engine.txt'))).toBe(true);
});

test('initializes a repository in the folder that the dialog shows', async () => {
  const location = createTempDir();
  await sendMenuCommand(app, 'init-repo');
  const dialog = page.getByRole('dialog', { name: 'Initialize a repo' });
  const name = dialog.getByLabel('Name', { exact: true });
  const path = dialog.locator('.repo-path');
  await expect(name).toBeFocused();
  await expect(path).toHaveText('Choose where to put the repository');

  await dialog.getByLabel('Location').fill(location);
  await expect(path).toHaveText('Enter the name of the repository');
  await name.fill('difference-engine');
  await expect(path.locator('.ellipsis-middle')).toHaveText(Path.join(location, 'difference-engine'));
  await expect(dialog.getByLabel('Location')).toHaveAccessibleDescription(Path.join(location, 'difference-engine'));
  await dialog.getByRole('button', { name: 'Create repository' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.repo-title h1')).toHaveText('difference-engine');
  expect(fs.existsSync(Path.join(location, 'difference-engine', '.git'))).toBe(true);
});

test('starts the directory dialog where the last directory was picked', async () => {
  // Answers the directory dialogs with the repository and records where they start
  await app.evaluate(({ ipcMain }, workdir) => {
    (globalThis as any).dialogStarts = [];
    ipcMain.removeHandler('show-open-dialog');
    ipcMain.handle('show-open-dialog', (_event, options) => {
      (globalThis as any).dialogStarts.push(options.defaultPath ?? null);
      return { canceled: false, filePaths: [workdir] };
    });
  }, repo.workdir);
  const getDialogStarts = () => app.evaluate(() => (globalThis as any).dialogStarts);

  await sendMenuCommand(app, 'open-repo');
  await expect(page.locator('.repo-title h1')).toHaveText(Path.basename(repo.workdir));
  // The system chooses the first time
  expect(await getDialogStarts()).toEqual([null]);

  await sendMenuCommand(app, 'init-repo');
  const dialog = page.getByRole('dialog', { name: 'Initialize a repo' });
  await dialog.getByRole('button', { name: 'Browse' }).click();
  await expect(dialog.getByLabel('Location')).toHaveValue(repo.workdir);
  // Then the dialog shows the folder of the repository picked last time
  expect(await getDialogStarts()).toEqual([null, Path.dirname(repo.workdir)]);
  const userData = await app.evaluate(({ app }) => app.getPath('userData'));
  expect(JSON.parse(fs.readFileSync(Path.join(userData, 'Settings')).toString()).gitadmin.recentDirectory)
    .toBe(Path.dirname(repo.workdir));
});

test('renames a branch with the input dialog', async () => {
  await openRecentRepo(page, repo);
  await pickContextMenuItem(app, 'Rename notes');
  await page.locator('.reference-explorer').getByRole('button', { name: 'notes', exact: true }).click({ button: 'right' });
  const dialog = page.getByRole('dialog', { name: 'Rename branch' });
  await expect(dialog.locator('label')).toHaveText('Name');
  // The name is selected, typing replaces it
  const input = dialog.getByLabel('Name', { exact: true });
  await expect(input).toBeFocused();
  await expect(input).toHaveValue('notes');
  expect(await input.evaluate((input: HTMLInputElement) => [input.selectionStart, input.selectionEnd])).toEqual([0, 5]);
  await page.keyboard.type('notes-g');
  await dialog.getByRole('button', { name: 'Rename' }).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(async () => (await repo.git('branch', '--list', 'notes*')).trim()).toBe('notes-g');
});

test('goes through the sections of the preferences with the keyboard and applies the theme', async () => {
  await sendMenuCommand(app, 'preferences');
  const dialog = page.getByRole('dialog', { name: 'Preferences' });
  const tabs = dialog.getByRole('tab');
  await expect(tabs).toHaveText(['Profile', 'Authentication', 'Appearance', 'Editor']);
  await expect(dialog.getByRole('tab', { selected: true })).toHaveText('Profile');
  await expect(dialog.getByLabel('Name', { exact: true })).toBeFocused();

  // Only the selected tab is in the tab sequence, the arrow keys select the others
  await page.keyboard.press('Shift+Tab');
  await expect(tabs.nth(0)).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect(tabs.nth(2)).toBeFocused();
  await expect(tabs.nth(2)).toHaveAttribute('aria-selected', 'true');
  await expect(dialog.getByRole('tabpanel')).toHaveCount(1);
  await expect(dialog.getByRole('tabpanel', { name: 'Appearance' })).toBeVisible();
  await page.keyboard.press('End');
  await expect(tabs.nth(3)).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(tabs.nth(0)).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(dialog.getByRole('tabpanel', { name: 'Editor' })).toBeVisible();
  await expect(dialog.getByLabel('Font size')).toHaveValue('14');

  // The options of the theme have values, the system one is the default
  await tabs.nth(2).click();
  const theme = dialog.getByLabel('Theme');
  await expect(theme).toHaveValue('system');
  await expect(theme.locator('option')).toHaveText(['System', 'Light', 'Dark']);
  expect(await theme.locator('option').evaluateAll((options: HTMLOptionElement[]) => options.map((option) => option.value)))
    .toEqual(['system', 'light', 'dark']);
  await expect(theme).toHaveAccessibleDescription('Switches between light and dark with your system');
  await theme.selectOption('dark');
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.scheme)).toBe('dark');
  // The hint is about the system setting only
  await expect(theme).toHaveAccessibleDescription('');
  await expect(dialog.locator('#preferences-theme-hint')).toHaveCount(0);

  // The settings are saved when the dialog closes
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  const userData = await app.evaluate(({ app }) => app.getPath('userData'));
  expect(JSON.parse(fs.readFileSync(Path.join(userData, 'Settings')).toString()).gitadmin.theme).toBe('dark');
});
