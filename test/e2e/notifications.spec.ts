import { test, expect, Locator, Page } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as Path from 'path';
import { TestRepo, lines } from '../helpers';
import { addOrigin, launchApp, LaunchedApp, openRecentRepo } from './fixtures';

// Much longer than the time for which an information stays on screen
const LONG_DELAY = 60000;

let launched: LaunchedApp;
let page: Page;
let cleanup: string[];

// The toast plays its exit transition, then goes away
async function expectDismissed(toast: Locator) {
  await page.clock.runFor(1000);
  await expect(toast).toHaveCount(0);
}

test.beforeEach(() => {
  cleanup = [];
});

test.afterEach(async () => {
  expect(launched.pageErrors).toEqual([]);
  await launched.close();
  for (const path of cleanup) {
    fs.rmSync(path, { recursive: true, force: true });
  }
});

test('keeps an error until it is dismissed', async () => {
  // A recent repository that was removed since
  const parent = fs.mkdtempSync(Path.join(os.tmpdir(), 'gitadmin-removed-'));
  cleanup.push(parent);
  launched = await launchApp({ settings: { recentlyOpened: [Path.join(parent, 'difference-engine')] } });
  page = launched.page;
  // The timers of the page only run when the test makes the time pass
  await page.clock.install();
  await page.clock.pauseAt(Date.now() + 1000);

  await page.getByRole('heading', { name: 'difference-engine' }).click();
  const queue = page.locator('.notification-queue');
  const toast = queue.locator('li');
  await expect(toast).toHaveCount(1);
  await expect(toast).toHaveClass(/\berror\b/);
  await expect(toast.getByRole('alert')).toContainText('Unable to open repo');
  await expect(toast.locator('.notification-title')).toHaveText('Unable to open repo');
  await expect(queue).toHaveAttribute('aria-live', 'polite');
  // Above the toolbar and the dialogs
  await expect(queue).toHaveCSS('z-index', '30');

  await page.clock.runFor(LONG_DELAY);
  await expect(toast).toHaveCount(1);
  await expect(toast).not.toHaveClass(/\bleaving\b/);

  // The dismiss button plays the exit transition, then removes the toast
  const dismiss = toast.getByRole('button', { name: 'Dismiss notification' });
  await expect(dismiss).toHaveAttribute('title', 'Dismiss');
  await dismiss.click();
  await expect(toast).toHaveClass(/\bleaving\b/);
  await expectDismissed(toast);
});

test('dismisses an information by itself, unless it is hovered or focused', async () => {
  const repo = await TestRepo.create();
  await repo.commit('Add the engine', { 'engine.txt': lines('analytical', 'engine') });
  cleanup.push(repo.workdir, await addOrigin(repo));
  launched = await launchApp({ settings: { recentlyOpened: [repo.workdir] } });
  page = launched.page;
  await openRecentRepo(page, repo);
  await page.clock.install();
  await page.clock.pauseAt(Date.now() + 1000);

  const pull = page.locator('.repo-toolbar').getByRole('button', { name: 'Pull' });
  const toast = page.locator('.notification-queue li', { hasText: 'Merge successfully' });
  await pull.click();
  await expect(toast).toHaveCount(1);
  await expect(toast).toHaveClass(/\binformation\b/);
  // An information is read politely, it does not interrupt
  await expect(toast.getByRole('alert')).toHaveCount(0);

  // The time stops while the pointer is on the toast
  await toast.hover();
  await page.clock.runFor(LONG_DELAY);
  await expect(toast).toHaveCount(1);
  await expect(toast).not.toHaveClass(/\bleaving\b/);
  await page.mouse.move(0, 400);
  await page.clock.runFor(LONG_DELAY);
  await expectDismissed(toast);

  // And while it has the focus
  await pull.click();
  await expect(toast).toHaveCount(1);
  await page.mouse.move(0, 400);
  await toast.getByRole('button', { name: 'Dismiss notification' }).focus();
  await page.clock.runFor(LONG_DELAY);
  await expect(toast).toHaveCount(1);
  await expect(toast).not.toHaveClass(/\bleaving\b/);
  await pull.focus();
  await page.clock.runFor(LONG_DELAY);
  await expectDismissed(toast);
});
