import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { PatchStatus } from '../src/renderer/helpers/git/model';
import { ICON_NAMES } from '../src/renderer/helpers/icons';
import { formatCommitDate, formatFileSize, formatFullDate, getPatchIcon, splitHunkHeader } from '../src/renderer/helpers/viewer-format';

// Recent versions of ICU put a narrow no-break space before AM and PM
function normalizeSpaces(text: string) {
  return text.replace(/\s/g, ' ');
}

describe('formatCommitDate', () => {
  const date = new Date('2023-11-14T22:16:00Z');

  it('gives the date and the time without the seconds', () => {
    assert.equal(normalizeSpaces(formatCommitDate(date, 'en-US', 'UTC')), 'Nov 14, 2023, 10:16 PM');
  });

  it('follows the time zone and the locale', () => {
    assert.equal(normalizeSpaces(formatCommitDate(date, 'en-US', 'Asia/Tokyo')), 'Nov 15, 2023, 7:16 AM');
    assert.equal(normalizeSpaces(formatCommitDate(date, 'fr-FR', 'UTC')), '14 nov. 2023, 22:16');
  });
});

describe('formatFullDate', () => {
  it('gives the day, the seconds and the time zone', () => {
    const date = new Date('2023-11-14T22:16:05Z');
    assert.equal(normalizeSpaces(formatFullDate(date, 'en-US', 'UTC')), 'Tuesday, November 14, 2023 at 10:16:05 PM UTC');
  });
});

describe('splitHunkHeader', () => {
  it('separates the range from the context that git adds', () => {
    assert.deepEqual(splitHunkHeader('@@ -12,7 +12,8 @@ function update() {'), ['@@ -12,7 +12,8 @@', 'function update() {']);
    assert.deepEqual(splitHunkHeader('@@ -1 +1,2 @@  class Engine'), ['@@ -1 +1,2 @@', 'class Engine']);
    assert.deepEqual(splitHunkHeader('@@ -3,4 +3,4 @@ Sub Main()\r'), ['@@ -3,4 +3,4 @@', 'Sub Main()']);
  });

  it('gives an empty context when there is none', () => {
    assert.deepEqual(splitHunkHeader('@@ -1,2 +1,3 @@'), ['@@ -1,2 +1,3 @@', '']);
    assert.deepEqual(splitHunkHeader('@@ -1,2 +1,3 @@\n'), ['@@ -1,2 +1,3 @@', '']);
  });

  it('keeps a header that it does not understand as the range', () => {
    assert.deepEqual(splitHunkHeader(' Binary files differ '), ['Binary files differ', '']);
  });
});

describe('formatFileSize', () => {
  it('counts the bytes below a kilobyte', () => {
    assert.equal(formatFileSize(0), '0 bytes');
    assert.equal(formatFileSize(1), '1 byte');
    assert.equal(formatFileSize(1023), '1023 bytes');
  });

  it('keeps one decimal below 10 of a unit', () => {
    assert.equal(formatFileSize(1024), '1.0 KB');
    assert.equal(formatFileSize(1536), '1.5 KB');
    assert.equal(formatFileSize(10188), '9.9 KB');
    assert.equal(formatFileSize(10199), '10 KB');
    assert.equal(formatFileSize(523 * 1024), '523 KB');
    assert.equal(formatFileSize(5.5 * 1024 ** 3), '5.5 GB');
  });

  it('moves to the next unit instead of showing 1024', () => {
    assert.equal(formatFileSize(1024 * 1024 - 1), '1.0 MB');
    assert.equal(formatFileSize(1024 * 1024), '1.0 MB');
    assert.equal(formatFileSize(3 * 1024 ** 4), '3072 GB');
  });
});

describe('getPatchIcon', () => {
  it('gives an icon of file to each status, like the badges of the patch lists', () => {
    const icons = Object.values(PatchStatus).map((status) => [status, getPatchIcon(status)]);
    assert.deepEqual(icons, [
      ['A', 'file-plus'],
      ['C', 'file-pen'],
      ['D', 'file-minus'],
      ['M', 'file-pen'],
      ['R', 'file-symlink'],
      ['T', 'file-pen'],
      ['U', 'file-exclamation-point'],
      ['?', 'file-plus']
    ]);
  });

  it('only gives icons of the icon set', () => {
    for (const status of Object.values(PatchStatus)) {
      assert.ok(ICON_NAMES.includes(getPatchIcon(status)), getPatchIcon(status));
    }
  });
});
