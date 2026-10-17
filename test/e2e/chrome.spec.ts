import { test, expect, Locator, Page } from '@playwright/test';
import { TestRepo, lines } from '../helpers';
import { launchApp, LaunchedApp, openRecentRepo } from './fixtures';

let launched: LaunchedApp;
let page: Page;
let repo: TestRepo;

async function getWidth(locator: Locator) {
  return (await locator.boundingBox())!.width;
}

test.beforeEach(async () => {
  repo = await TestRepo.create();
  await repo.commit('Add the engine', { 'engine.txt': lines('analytical', 'engine') });
  launched = await launchApp({ settings: { recentlyOpened: [repo.workdir] } });
  page = launched.page;
  await openRecentRepo(page, repo);
});

test.afterEach(async () => {
  expect(launched.pageErrors).toEqual([]);
  await launched.close();
  repo.remove();
});

test('groups the buttons of the toolbar', async () => {
  const toolbar = page.locator('.repo-toolbar');
  const groups = toolbar.getByRole('group');
  await expect(groups).toHaveCount(3);
  await expect(groups.nth(0).getByRole('button')).toHaveText(['Fetch', 'Pull', 'Push']);
  await expect(groups.nth(1).getByRole('button')).toHaveText(['Branch', 'Focus']);
  await expect(groups.nth(2).getByRole('button')).toHaveText(['Stash', 'Pop']);
  await expect(toolbar.getByRole('button', { name: 'Close', exact: true })).toBeVisible();
  // Each button has an icon
  await expect(toolbar.locator('button:not(:has(svg.icon))')).toHaveCount(0);
});

test('shows a spinner while an action of the toolbar runs', async () => {
  // The transport of this remote waits before failing, so that fetching takes a while
  await repo.git('config', 'protocol.ext.allow', 'always');
  await repo.git('remote', 'add', 'slow', 'ext::sleep 2');
  const fetch = page.locator('.repo-toolbar').getByRole('button', { name: 'Fetch', exact: true });
  const width = await getWidth(fetch);
  await fetch.focus();
  await page.keyboard.press('Enter');

  await expect(fetch).toHaveAttribute('aria-busy', 'true');
  await expect(fetch).toBeDisabled();
  await expect(fetch.locator('svg.spinner-icon')).toBeVisible();
  // The label stays, so that the width does not change, and the button keeps the focus
  await expect(fetch).toHaveText('Fetch');
  expect(await getWidth(fetch)).toBe(width);
  await expect(fetch).toBeFocused();

  await expect(fetch).toHaveAttribute('aria-busy', 'false', { timeout: 15000 });
  await expect(fetch).toBeEnabled();
  await expect(fetch.locator('svg.spinner-icon')).toHaveCount(0);
  await expect(fetch).toBeFocused();
});

test('resizes the right panel with the arrow keys', async () => {
  const splitter = page.getByRole('separator', { name: 'Resize the right panel' });
  const panel = page.locator('.index-viewer');
  await expect(splitter).toHaveAttribute('aria-orientation', 'vertical');
  await expect(splitter).toHaveAttribute('tabindex', '0');
  const width = await getWidth(panel);
  const position = Number(await splitter.getAttribute('aria-valuenow'));

  await splitter.focus();
  await page.keyboard.press('ArrowLeft');
  await expect.poll(() => getWidth(panel)).toBe(width + 16);
  await page.keyboard.press('ArrowLeft');
  await expect.poll(() => getWidth(panel)).toBe(width + 32);
  await expect.poll(async () => Number(await splitter.getAttribute('aria-valuenow'))).toBeLessThan(position);
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => getWidth(panel)).toBe(width + 16);

  // The other keys do nothing
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Control+ArrowLeft');
  await expect.poll(() => getWidth(panel)).toBe(width + 16);
  await expect(splitter).toBeFocused();
});

test('keeps the line under the mouse while dragging the splitter', async () => {
  const splitter = page.getByRole('separator', { name: 'Resize the right panel' });
  const panel = page.locator('.index-viewer');
  const box = (await splitter.boundingBox())!;
  const width = await getWidth(panel);
  const y = box.y + box.height / 2;
  // The hit area is wider than the line, grab it a few pixels to the right of the line
  await page.mouse.move(box.x + 3, y);
  await page.mouse.down();
  await expect(splitter).toHaveClass(/dragging/);
  await page.mouse.move(box.x + 3 - 40, y, { steps: 4 });
  await page.mouse.up();
  await expect(splitter).not.toHaveClass(/dragging/);
  expect((await splitter.boundingBox())!.x).toBe(box.x - 40);
  expect(await getWidth(panel)).toBe(width + 40);
});

test('names each splitter after what it resizes', async () => {
  const panels: [string, string][] = [
    ['Resize the references panel', '.reference-explorer'],
    ['Resize the commit graph', '.commit-graph']
  ];
  for (const [name, selector] of panels) {
    const splitter = page.getByRole('separator', { name, exact: true });
    const panel = page.locator(selector);
    const width = await getWidth(panel);
    await splitter.focus();
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => getWidth(panel)).toBe(width + 16);
    await expect(splitter).toBeFocused();
  }
});
