import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';
import * as Path from 'path';
import { launchApp, LaunchedApp } from './fixtures';

function readTheme(name: string) {
  return JSON.parse(fs.readFileSync(Path.join(__dirname, `../../assets/themes/${name}.json`)).toString());
}

function getScheme(page: Page) {
  return page.evaluate(() => document.documentElement.dataset.scheme);
}

function getVariable(page: Page, variable: string) {
  return page.evaluate((variable) => getComputedStyle(document.documentElement).getPropertyValue(variable).trim(), variable);
}

let launched: LaunchedApp;

test.afterEach(async () => {
  expect(launched.pageErrors).toEqual([]);
  await launched.close();
});

test('follows the color scheme of the OS by default', async () => {
  launched = await launchApp();
  const page = launched.page;
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(() => getScheme(page)).toBe('dark');
  expect(await getVariable(page, '--surface-0')).toBe(readTheme('dark').css['surface-0']);
  await page.emulateMedia({ colorScheme: 'light' });
  await expect.poll(() => getScheme(page)).toBe('light');
  expect(await getVariable(page, '--surface-0')).toBe(readTheme('light').css['surface-0']);
});

test('keeps the theme of the settings when the color scheme of the OS changes', async () => {
  launched = await launchApp({ settings: { theme: 'dark' } });
  const page = launched.page;
  await expect.poll(() => getScheme(page)).toBe('dark');
  await page.emulateMedia({ colorScheme: 'light' });
  // Give the page the time to react to the change
  await page.waitForTimeout(300);
  expect(await getScheme(page)).toBe('dark');
  expect(await getVariable(page, '--text-primary')).toBe(readTheme('dark').css['text-primary']);
});

test('makes the native parts of the window follow the theme', async () => {
  launched = await launchApp({ settings: { theme: 'dark' } });
  await expect.poll(() => launched.app.evaluate(({ nativeTheme }) => nativeTheme.themeSource)).toBe('dark');
  expect(await launched.app.evaluate(({ nativeTheme }) => nativeTheme.shouldUseDarkColors)).toBe(true);
});
