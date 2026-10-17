import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as Path from 'path';
import { TestRepo, lines } from '../helpers';
import { addOrigin, launchApp, LaunchedApp, openRecentRepo, sendMenuCommand } from './fixtures';

// Screenshots of the main views in both themes, compared with the baselines of
// screenshots.spec.ts-snapshots. After a visual change, review the new images written by
// `npm run test:e2e:update-snapshots` and commit them.
//
// The baselines are rendered on Linux, with fonts from npm instead of the fonts of the system,
// the same font rendering everywhere (fonts.conf), no GPU and a fixed window size, locale and
// time zone, so that they do not depend on the machine.

test.skip(process.platform !== 'linux', 'The baselines are rendered on Linux');

const WINDOW_SIZE = { width: 1280, height: 800 };
// The rendering is the same from one run to the next, the tolerance only absorbs a few pixels
// of antialiasing that could differ between processors
const SCREENSHOT_OPTIONS = { animations: 'disabled' as const, maxDiffPixels: 100 };
const FONTS_PATH = Path.join(__dirname, '../../node_modules/@fontsource');
const FONTS = [
  { family: 'Screenshot Sans', file: 'inter/files/inter-latin-{weight}-normal.woff2', weights: [400, 500, 600, 700] },
  { family: 'Screenshot Mono', file: 'jetbrains-mono/files/jetbrains-mono-latin-{weight}-normal.woff2', weights: [400, 700] }
];

function getFontStyles() {
  const fontFaces = FONTS.flatMap((font) => font.weights.map((weight) => {
    const data = fs.readFileSync(Path.join(FONTS_PATH, font.file.replace('{weight}', `${weight}`))).toString('base64');
    return `@font-face { font-family: "${font.family}"; font-weight: ${weight}; src: url(data:font/woff2;base64,${data}); }`;
  }));
  const variables = ':root { --font-family: "Screenshot Sans", sans-serif; --font-mono: "Screenshot Mono", monospace; }';
  return [...fontFaces, variables].join('\n');
}

async function launchForScreenshots(theme: string, recentlyOpened: string[]) {
  const launched = await launchApp({
    settings: { theme, recentlyOpened },
    switches: ['--force-device-scale-factor=1', '--disable-gpu', '--disable-lcd-text', '--lang=en-US'],
    env: { TZ: 'UTC', LANG: 'en_US.UTF-8', FONTCONFIG_FILE: Path.join(__dirname, 'fonts.conf') }
  });
  const { app, page } = launched;
  await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(size.width, size.height),
    WINDOW_SIZE);
  await page.waitForFunction((size) => window.innerWidth === size.width && window.innerHeight === size.height, WINDOW_SIZE);
  // The fonts are loaded before anything uses them, the editors read the font when they are created
  await page.addStyleTag({ content: getFontStyles() });
  await page.evaluate((fonts) => Promise.all(fonts.flatMap((font) =>
    font.weights.map((weight) => document.fonts.load(`${weight} 13px "${font.family}"`)))), FONTS);
  return launched;
}

const TEXT_NODE = 3;

interface DomNode {
  nodeId: number;
  nodeType: number;
  nodeValue: string;
  children?: DomNode[];
}

// Fonts of the system that the page uses, for characters that the fonts of the screenshots do
// not have. The text drawn with them would look different on another machine.
async function getSystemFonts(page: Page) {
  const client = await page.context().newCDPSession(page);
  try {
    await client.send('DOM.enable');
    await client.send('CSS.enable');
    const { root } = await client.send('DOM.getDocument', { depth: -1 });
    const elements: number[] = [];
    const visit = (node: DomNode) => {
      const children = node.children || [];
      if (children.some((child) => child.nodeType === TEXT_NODE && child.nodeValue.trim())) {
        elements.push(node.nodeId);
      }
      children.forEach(visit);
    };
    visit(root);
    const systemFonts = new Set<string>();
    for (const nodeId of elements) {
      // Null when the element was removed after the document was read
      const result = await client.send('CSS.getPlatformFontsForNode', { nodeId }).catch(() => null);
      for (const font of result?.fonts || []) {
        if (!font.isCustomFont) {
          systemFonts.add(font.familyName);
        }
      }
    }
    return [...systemFonts];
  } finally {
    await client.detach();
  }
}

async function expectScreenshot(page: Page, name: string) {
  // Out of the window, the pointer hovers nothing
  await page.mouse.move(-1, -1);
  // Monaco shows the scrollbars of an editor for a moment after it scrolls
  await expect(page.locator('.monaco-scrollable-element > .scrollbar.visible')).toHaveCount(0);
  await expect.soft(page).toHaveScreenshot(name, SCREENSHOT_OPTIONS);
  expect.soft(await getSystemFonts(page), `Fonts of the system in ${name}`).toEqual([]);
}

// A repository with local, remote and nested branches, a tag, a merge, a stash, and modified,
// untracked, staged, deleted and renamed files
async function createRepo(path: string) {
  const repo = await TestRepo.create(path);
  await repo.commit('Add the engine', { 'engine.txt': lines('analytical', 'engine'), 'cards.txt': lines('operation') });
  await repo.git('checkout', '--quiet', '-b', 'notes');
  await repo.commit('Write the notes', { 'notes.txt': lines('note G') });
  await repo.git('tag', 'v1.0');
  await repo.git('checkout', '--quiet', 'main');
  await repo.commit('Describe the mill', { 'mill.txt': lines('store', 'mill') });
  await repo.git('merge', '--no-ff', '--quiet', '-m', 'Merge the notes', 'notes');
  await repo.commit('Add the punched cards', { 'cards.txt': lines('operation', 'variable') });
  await repo.git('checkout', '--quiet', '-b', 'feature/bernoulli-numbers');
  await repo.commit('Compute the Bernoulli numbers', { 'bernoulli.txt': lines('B1', 'B2') });
  await repo.git('checkout', '--quiet', 'main');
  const origin = await addOrigin(repo);
  await repo.git('branch', '--quiet', '--set-upstream-to=origin/main', 'main');
  repo.write('mill.txt', lines('store', 'mill', 'barrel'));
  await repo.git('stash', 'push', '--quiet', '-m', 'Try a barrel');
  repo.write('engine.txt', lines('analytical', 'difference', 'engine'));
  repo.write('src/punch.ts', 'export const holes = 12;\n');
  repo.write('mill.txt', lines('store', 'mill', 'gears'));
  await repo.git('add', 'mill.txt');
  await repo.git('rm', '--quiet', 'cards.txt');
  fs.mkdirSync(repo.path('docs'));
  await repo.git('mv', 'notes.txt', 'docs/notes.md');
  return { repo, origin };
}

for (const theme of ['light', 'dark']) {
  test.describe(`${theme} theme`, () => {
    let launched: LaunchedApp | null;
    let cleanup: string[];

    test.beforeEach(() => {
      launched = null;
      cleanup = [];
    });

    test.afterEach(async () => {
      if (launched) {
        expect(launched.pageErrors).toEqual([]);
        await launched.close();
      }
      for (const path of cleanup) {
        fs.rmSync(path, { recursive: true, force: true });
      }
    });

    test('welcome screen', async () => {
      launched = await launchForScreenshots(theme,
        ['/home/ada/projects/analytical-engine', '/home/ada/projects/difference-engine', '/home/ada/notes']);
      const page = launched.page;
      await page.getByRole('heading', { name: 'analytical-engine' }).waitFor();
      await expectScreenshot(page, `welcome-${theme}.png`);
    });

    test('repository', async () => {
      // The name of the repository is in the screenshots, not the path
      const parent = fs.realpathSync.native(fs.mkdtempSync(Path.join(os.tmpdir(), 'gitadmin-screenshots-')));
      const { repo, origin } = await createRepo(Path.join(parent, 'analytical-engine'));
      cleanup.push(parent, origin);
      launched = await launchForScreenshots(theme, [repo.workdir]);
      const { app, page } = launched;
      await openRecentRepo(page, repo);
      const indexViewer = page.locator('.index-viewer');
      await expect(indexViewer.getByText('Unstaged files (2)', { exact: true })).toBeVisible();
      await expectScreenshot(page, `index-${theme}.png`);

      await test.step('diff', async () => {
        await indexViewer.locator('li', { hasText: 'engine.txt' }).click();
        await expect(page.locator('.monaco-diff-editor .view-lines').last()).toContainText('difference');
        await expectScreenshot(page, `diff-${theme}.png`);
        await page.keyboard.press('Escape');
        await expect(page.locator('.monaco-diff-editor')).toHaveCount(0);
      });

      await test.step('commit', async () => {
        await page.locator('.commit-list').getByText('Merge the notes').click();
        await expect(page.locator('.commit-viewer h2')).toHaveText('Merge the notes');
        await expectScreenshot(page, `commit-${theme}.png`);
      });

      await test.step('canvas', async () => {
        const header = page.getByRole('group', { name: 'Graph options' });
        await header.locator('label[for="graph-mode-canvas"]').click();
        const canvas = page.getByRole('application', { name: 'Commit graph' });
        await expect(canvas).toBeVisible();
        await expect(page.locator('canvas.canvas-minimap')).toBeVisible();
        // The canvas is drawn on the next frame
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        await expectScreenshot(page, `canvas-${theme}.png`);
        await header.locator('label[for="graph-mode-list"]').click();
        await expect(page.locator('.commit-list').getByText('Merge the notes')).toBeVisible();
      });

      await test.step('modal', async () => {
        await page.locator('.repo-toolbar').getByRole('button', { name: 'Branch' }).click();
        await expect(page.getByRole('dialog')).toBeVisible();
        await expectScreenshot(page, `modal-${theme}.png`);
        await page.keyboard.press('Escape');
        await expect(page.getByRole('dialog')).toHaveCount(0);
      });

      await test.step('focus', async () => {
        // The three kinds of relations: notes is merged into main, and feature forks from main
        const explorer = page.locator('.reference-explorer');
        for (const name of ['main', 'notes', 'feature/bernoulli-numbers']) {
          await explorer.getByRole('checkbox', { name: `Focus on ${name}`, exact: true }).check();
        }
        await expect(page.getByText('Showing 3 branches')).toBeVisible();
        await expect(page.locator('.commit-list').getByText('Add the engine')).toBeVisible();
        await expectScreenshot(page, `focus-${theme}.png`);

        await page.locator('.repo-toolbar').getByRole('button', { name: 'Focus' }).click();
        await expect(page.getByRole('dialog')).toBeVisible();
        await expectScreenshot(page, `focus-dialog-${theme}.png`);
        await page.keyboard.press('Escape');
        await expect(page.getByRole('dialog')).toHaveCount(0);
      });

      await test.step('preferences', async () => {
        await sendMenuCommand(app, 'preferences');
        await expect(page.getByRole('dialog')).toBeVisible();
        await expectScreenshot(page, `preferences-${theme}.png`);
      });
    });
  });
}
