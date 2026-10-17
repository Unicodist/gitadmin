import { test, expect, Page } from '@playwright/test';
import * as zlib from 'zlib';
import { TestRepo, lines } from '../helpers';
import { launchApp, LaunchedApp, openRecentRepo } from './fixtures';

let repo: TestRepo;
let launched: LaunchedApp;
let page: Page;

async function launch() {
  launched = await launchApp({ settings: { recentlyOpened: [repo.workdir] } });
  page = launched.page;
  await openRecentRepo(page, repo);
}

// The window opens at 800x600, Monaco shows the inline view instead of the split view below 900px
async function setWindowSize(width: number, height: number) {
  await launched.app.evaluate(({ BrowserWindow }, size) => {
    BrowserWindow.getAllWindows()[0].setContentSize(size.width, size.height);
  }, { width, height });
  await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(width);
}

// Font family that a variable of the theme computes to, to compare it with the fonts of the elements
function themeFont(variable: string) {
  return page.evaluate((variable) => {
    const element = document.createElement('span');
    element.style.fontFamily = `var(--${variable})`;
    document.body.append(element);
    const font = getComputedStyle(element).fontFamily;
    element.remove();
    return font;
  }, variable);
}

// A PNG of a single color
function createPng(width: number, height: number) {
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(Buffer.concat([Buffer.from(type), data])));
    return Buffer.concat([length, Buffer.from(type), data, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 0x40)]);
  const pixels = zlib.deflateSync(Buffer.concat(Array.from({ length: height }, () => row)));
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([signature, chunk('IHDR', header), chunk('IDAT', pixels), chunk('IEND', Buffer.alloc(0))]);
}

test.afterEach(async () => {
  await launched.close();
  repo.remove();
});

test.describe('text viewers', () => {
  test.beforeEach(async () => {
    repo = await TestRepo.create();
    await repo.commit('Add the engine', { 'engine.txt': lines('analytical', 'engine') });
    await repo.commit('Describe the mill', { 'mill.txt': lines('store', 'mill') });
    repo.write('engine.txt', lines('analytical', 'difference', 'engine'));
    repo.write('mill.txt', lines('store', 'mill', 'gears'));
    await repo.git('add', 'mill.txt');
    await launch();
  });

  test('switches the view mode of the diff to Split and back', async () => {
    await setWindowSize(1280, 800);
    await page.locator('.index-viewer li', { hasText: 'engine.txt' }).click();
    const viewMode = page.getByRole('radiogroup', { name: 'View mode' });
    const original = page.locator('.monaco-diff-editor .editor.original');
    await expect(viewMode.getByRole('radio', { name: 'Hunk' })).toBeChecked();
    await expect(page.locator('.hunk-header .hunk-range')).toHaveText('@@ -1,2 +1,3 @@');

    // The original editor is only a column of line numbers out of the split view
    await viewMode.getByText('Split', { exact: true }).click();
    await expect(viewMode.getByRole('radio', { name: 'Split' })).toBeChecked();
    await expect(page.locator('.hunk-widget')).toHaveCount(0);
    await expect(original.getByText('analytical')).toBeVisible();
    expect((await original.boundingBox())!.width).toBeGreaterThan(300);

    // The arrow keys move along the view modes
    await viewMode.getByRole('radio', { name: 'Split' }).focus();
    await page.keyboard.press('ArrowLeft');
    await expect(viewMode.getByRole('radio', { name: 'Inline' })).toBeChecked();
    await page.keyboard.press('ArrowLeft');
    await expect(viewMode.getByRole('radio', { name: 'Hunk' })).toBeChecked();
    await expect(page.locator('.hunk-header .hunk-range')).toHaveText('@@ -1,2 +1,3 @@');
    expect((await original.boundingBox())!.width).toBeLessThan(100);
    expect(launched.pageErrors).toEqual([]);
  });

  test('draws the diff with the monospace font of the theme and the headers with the fonts of the app', async () => {
    await page.locator('.index-viewer li', { hasText: 'engine.txt' }).click();
    const editor = page.locator('.monaco-diff-editor .editor.modified');
    await expect(editor.getByText('difference')).toBeVisible();
    // Monaco adds its own fonts after the fonts of the theme
    const mono = await themeFont('font-mono');
    for (const element of [editor.locator('.view-lines'), editor.locator('.line-numbers').first()]) {
      const font = await element.evaluate((element) => getComputedStyle(element).fontFamily);
      expect(font.startsWith(mono), font).toBe(true);
    }
    await expect(page.locator('.hunk-header .hunk-range')).toHaveCSS('font-family', mono);
    await expect(page.locator('.hunk-header button').first()).toHaveCSS('font-family', await themeFont('font-family'));

    // No minimap, and the scrollbars of the app
    expect(await editor.evaluate((element) => [...element.querySelectorAll('.minimap')].every((minimap) => minimap.clientWidth === 0))).toBe(true);
    await expect(editor.locator('.monaco-scrollable-element > .scrollbar.vertical').first()).toHaveCSS('width', '10px');
    expect(launched.pageErrors).toEqual([]);
  });

  test('closes the diff with its button and with Escape once the editor has closed its find widget', async () => {
    const file = page.locator('.index-viewer li', { hasText: 'engine.txt' });
    const patchViewer = page.locator('.patch-viewer');
    await file.click();
    await expect(patchViewer.getByRole('heading', { name: 'engine.txt' })).toBeVisible();
    const close = patchViewer.getByRole('button', { name: 'Close diff' });
    await expect(close).toHaveAttribute('title', 'Close diff');
    await close.click();
    await expect(patchViewer).toHaveCount(0);

    await file.click();
    await patchViewer.locator('.editor.modified .view-lines').click();
    await page.keyboard.press('ControlOrMeta+F');
    const findWidget = patchViewer.locator('.find-widget');
    await expect(findWidget).toHaveClass(/visible/);
    await page.keyboard.press('Escape');
    await expect(findWidget).not.toHaveClass(/visible/);
    await expect(patchViewer).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(patchViewer).toHaveCount(0);
    expect(launched.pageErrors).toEqual([]);
  });

  test('keeps the labels that matter in the toolbar of a narrow diff', async () => {
    await page.locator('.index-viewer li', { hasText: 'engine.txt' }).click();
    const toolbar = page.locator('.patch-toolbar');
    const width = async (name: string) => (await toolbar.getByRole('button', { name, exact: true }).locator('.button-label').boundingBox())!.width;
    await expect(toolbar.getByRole('button', { name: 'Stage file', exact: true })).toBeVisible();
    // The window is 800px wide: only the main action keeps its label, the others are still named
    expect(await width('Open in editor')).toBeLessThanOrEqual(1);
    expect(await width('Discard file')).toBeLessThanOrEqual(1);
    expect(await width('Stage file')).toBeGreaterThan(40);
    expect(await toolbar.evaluate((element) => element.scrollWidth - element.clientWidth)).toBe(0);

    await setWindowSize(1280, 800);
    await expect.poll(() => width('Discard file')).toBeGreaterThan(40);
    expect(await width('Open in editor')).toBeGreaterThan(40);
    expect(launched.pageErrors).toEqual([]);
  });

  test('stages a line with the button of its margin and unstages a hunk', async () => {
    const indexViewer = page.locator('.index-viewer');
    await indexViewer.locator('li', { hasText: 'engine.txt' }).click();
    const header = page.locator('.hunk-header');
    await expect(header.getByRole('button')).toHaveText(['Discard', 'Stage']);
    await expect(page.getByRole('button', { name: /stage file/i })).toHaveCount(1);

    // The button covers the row of its line, it shows on hover
    const button = page.locator('.stage-line-button');
    await expect(button).toHaveCount(1);
    const line = (await page.locator('.editor.modified .view-line', { hasText: 'difference' }).boundingBox())!;
    const box = (await button.boundingBox())!;
    expect(Math.abs(box.y - line.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.height - line.height)).toBeLessThanOrEqual(1);
    await expect(button.locator('.margin-button-face')).toHaveCSS('opacity', '0');
    await button.hover();
    await expect(button.locator('.margin-button-face')).toHaveCSS('opacity', '1');
    await expect(button.locator('.tooltip-text')).toHaveText('Stage this line');
    await button.click();
    await expect(indexViewer.getByText('Staged files (2)', { exact: true })).toBeVisible();
    expect(await repo.staged('engine.txt')).toBe(lines('analytical', 'difference', 'engine'));

    // A staged file has a single action in the toolbar and in the headers
    await indexViewer.locator('li', { hasText: 'mill.txt' }).click();
    await expect(page.locator('.hunk-header').getByRole('button')).toHaveText(['Unstage']);
    await expect(page.getByRole('button', { name: /stage file/i })).toHaveText(['Unstage file']);
    await page.locator('.hunk-header').getByRole('button', { name: 'Unstage' }).click();
    await expect(indexViewer.getByText('Staged files (1)', { exact: true })).toBeVisible();
    expect(await repo.staged('mill.txt')).toBe(lines('store', 'mill'));
    expect(launched.pageErrors).toEqual([]);
  });

  test('copies the SHA of a commit with a named button and goes to its parent', async () => {
    const sha = await repo.sha('HEAD');
    const parent = await repo.sha('HEAD~1');
    await page.locator('.commit-list').getByText('Describe the mill').click();
    const commitViewer = page.locator('.commit-viewer');
    await expect(commitViewer.locator('h2')).toHaveText('Describe the mill');

    const copy = commitViewer.getByRole('button', { name: `Copy SHA ${sha.slice(0, 6)}`, exact: true });
    await expect(copy).toBeVisible();
    await copy.click();
    await expect(copy.locator('.tooltip-text')).toHaveText('Copied');
    expect(await launched.app.evaluate(({ clipboard }) => clipboard.readText())).toBe(sha);

    // The details, with the dates in a machine readable form
    const details = commitViewer.locator('.commit-details li');
    await expect(details).toHaveText([/^Config User\s*config@example\.com$/, /^Authored/, /^Last modified/, /^Parent/]);
    await expect(commitViewer.getByRole('link', { name: 'config@example.com' })).toHaveAttribute('href', 'mailto:config@example.com');
    const date = new Date((await repo.git('log', '-1', '--format=%aI')).trim()).toISOString();
    await expect(details.nth(1).locator('time')).toHaveAttribute('datetime', date);
    await expect(commitViewer.getByText('Files (1)', { exact: true })).toBeVisible();

    // The first commit has no parent
    await commitViewer.getByRole('button', { name: `Navigate to ${parent.slice(0, 6)}`, exact: true }).click();
    await expect(commitViewer.locator('h2')).toHaveText('Add the engine');
    await expect(details.last()).toHaveText('ParentNone');
    expect(launched.pageErrors).toEqual([]);
  });

  test('groups the files and the commit message of the index viewer under section headers', async () => {
    const indexViewer = page.locator('.index-viewer');
    await expect(indexViewer.getByRole('heading', { level: 2 })).toHaveText('Index');
    const unstaged = indexViewer.getByRole('group', { name: 'Unstaged files (1)' });
    const staged = indexViewer.getByRole('group', { name: 'Staged files (1)' });
    await expect(unstaged.getByRole('button', { name: 'Stage all changes' })).toBeEnabled();
    await expect(unstaged.getByText('engine.txt')).toBeVisible();
    await expect(staged.getByRole('button', { name: 'Unstage all changes' })).toBeEnabled();
    await expect(staged.getByText('mill.txt')).toBeVisible();

    // The submit button spans the form and waits for a summary
    const form = indexViewer.getByRole('group', { name: 'Commit message' });
    const commit = form.getByRole('button', { name: 'Commit', exact: true });
    await expect(commit).toBeDisabled();
    await expect(commit).toHaveClass(/primary-button/);
    expect((await commit.boundingBox())!.width).toBeCloseTo((await form.boundingBox())!.width, 0);
    await form.getByPlaceholder('Summary').fill('Add the gears');
    await expect(commit).toBeEnabled();
    await form.getByLabel('Amend').check();
    await expect(form.getByRole('button', { name: 'Amend', exact: true })).toBeEnabled();
    await expect(indexViewer.getByRole('button', { name: /commit/i })).toHaveCount(0);
    expect(launched.pageErrors).toEqual([]);
  });
});

test.describe('image and binary viewers', () => {
  test.beforeEach(async () => {
    repo = await TestRepo.create();
    repo.write('logo.png', createPng(12, 8));
    repo.write('banner.png', createPng(30, 10));
    repo.write('engine.bin', Buffer.from([0, 1, 2, 3, 0, 255]));
    await repo.commit('Add the images');
    repo.write('logo.png', createPng(16, 8));
    repo.write('icon.png', createPng(4, 4));
    repo.write('engine.bin', Buffer.from([0, 1, 2, 3, 0, 254, 7]));
    await repo.git('rm', '--quiet', 'banner.png');
    await launch();
  });

  test('shows the two versions of an image and an empty state for the missing one', async () => {
    const indexViewer = page.locator('.index-viewer');
    const viewer = page.locator('.image-viewer');
    await indexViewer.locator('li', { hasText: 'logo.png' }).click();
    await expect(viewer.locator('figcaption')).toHaveText(['Old', 'New']);
    await expect(viewer.getByRole('img', { name: 'Old version' })).toBeVisible();
    await expect(viewer.getByRole('img', { name: 'New version' })).toBeVisible();
    await expect(viewer.locator('.image-details')).toHaveText([/^12 × 8 px · \d+ bytes$/, /^16 × 8 px · \d+ bytes$/]);

    await indexViewer.locator('li', { hasText: 'icon.png' }).click();
    await expect(viewer.locator('.image-missing')).toHaveText('No old versionThe file is new');
    await expect(viewer.getByRole('img', { name: 'New version' })).toBeVisible();

    await indexViewer.locator('li', { hasText: 'banner.png' }).click();
    await expect(viewer.getByRole('img', { name: 'Old version' })).toBeVisible();
    await expect(viewer.locator('.image-missing')).toHaveText('No new versionThe file was deleted');
    expect(launched.pageErrors).toEqual([]);
  });

  test('shows an empty state for a binary file', async () => {
    await page.locator('.index-viewer li', { hasText: 'engine.bin' }).click();
    const viewer = page.locator('.binary-viewer');
    await expect(viewer.locator('.empty-state-title')).toHaveText('Binary file');
    await expect(viewer.locator('.empty-state-hint')).toHaveText('No preview available');
    await expect(viewer.locator('svg.icon')).toBeVisible();
    expect(launched.pageErrors).toEqual([]);
  });
});

test.describe('conflict viewer', () => {
  test.beforeEach(async () => {
    repo = await TestRepo.create();
    await repo.commit('Add the engine', { 'engine.txt': lines('analytical', 'engine') });
    await repo.git('checkout', '--quiet', '-b', 'difference');
    await repo.commit('Use the difference engine', { 'engine.txt': lines('difference', 'engine') });
    await repo.git('checkout', '--quiet', 'main');
    await repo.commit('Use the analytical engine', { 'engine.txt': lines('babbage', 'engine', 'mill') });
    await repo.git('merge', '--quiet', 'difference').catch(() => {});
    await launch();
  });

  test('resolves a conflict with the buttons of its header', async () => {
    const indexViewer = page.locator('.index-viewer');
    await expect(indexViewer.locator('.merge-state')).toHaveText('Merging');
    const submitRow = indexViewer.locator('.submit-row');
    await expect(submitRow.getByRole('button', { name: 'Commit and merge' })).toBeDisabled();
    await expect(submitRow.getByRole('button', { name: 'Abort merge' })).toHaveClass(/danger-button/);

    await indexViewer.locator('li', { hasText: 'engine.txt' }).click();
    const header = page.locator('.conflict-header');
    await expect(header.locator('.conflict-title')).toHaveText('Conflict');
    // The labels are shortened in the narrow window, the names stay complete
    await expect(header.getByRole('button')).toHaveText(['Accept current change', 'Accept incoming change', 'Accept both changes']);
    await expect(header.getByRole('button', { name: 'Accept current change', exact: true })).toBeVisible();
    const toolbar = page.locator('.patch-toolbar');
    for (const name of ['Keep current version', 'Take incoming version', 'Mark as resolved']) {
      await expect(toolbar.getByRole('button', { name, exact: true })).toBeVisible();
    }
    expect(await toolbar.evaluate((element) => element.scrollWidth - element.clientWidth)).toBe(0);

    await header.getByRole('button', { name: 'Accept incoming change' }).click();
    await expect.poll(() => repo.read('engine.txt')).toBe(lines('difference', 'engine', 'mill'));
    await expect(page.locator('.conflict-header')).toHaveCount(0);
    await toolbar.getByRole('button', { name: 'Mark as resolved' }).click();
    await expect(submitRow.getByRole('button', { name: 'Commit and merge' })).toBeEnabled();
    expect(launched.pageErrors).toEqual([]);
  });

  test('replaces the file with its current or its incoming version', async () => {
    const indexViewer = page.locator('.index-viewer');
    await indexViewer.locator('li', { hasText: 'engine.txt' }).click();
    await expect(page.locator('.conflict-header')).toHaveCount(1);
    const toolbar = page.locator('.patch-toolbar');
    const content = page.locator('.patch-editor .view-lines');

    await toolbar.getByRole('button', { name: 'Take incoming version' }).click();
    await expect.poll(() => repo.read('engine.txt')).toBe(lines('difference', 'engine'));
    await expect(page.locator('.conflict-header')).toHaveCount(0);
    await expect(content).toHaveText(/^difference\s*engine\s*$/);
    await toolbar.getByRole('button', { name: 'Keep current version' }).click();
    await expect.poll(() => repo.read('engine.txt')).toBe(lines('babbage', 'engine', 'mill'));
    await expect(content).toHaveText(/^babbage\s*engine\s*mill\s*$/);

    // The file stays conflicted until it is marked as resolved
    const commitAndMerge = indexViewer.locator('.submit-row').getByRole('button', { name: 'Commit and merge' });
    await expect(commitAndMerge).toBeDisabled();
    await toolbar.getByRole('button', { name: 'Mark as resolved' }).click();
    await expect(commitAndMerge).toBeEnabled();
    expect(launched.pageErrors).toEqual([]);
  });
});
