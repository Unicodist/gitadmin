import { PatchStatus } from './git/model';
import { IconName } from './icons';

// Date and time of a commit, short enough for the right panel ("Nov 14, 2023, 10:16 PM" in English)
export function formatCommitDate(date: Date, locale?: string, timeZone?: string) {
  return date.toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone });
}

// Date and time with the seconds and the time zone, for the tooltip of the short date
export function formatFullDate(date: Date, locale?: string, timeZone?: string) {
  return date.toLocaleString(locale, { dateStyle: 'full', timeStyle: 'long', timeZone });
}

// Splits the header of a hunk into its range and the context that git writes after it,
// for instance "@@ -12,7 +12,8 @@ function update() {" into "@@ -12,7 +12,8 @@" and "function update() {".
// The context of a file with CRLF line endings ends with a carriage return
export function splitHunkHeader(header: string): [string, string] {
  const match = /^(@@ [^@]+ @@)(.*)$/s.exec(header);
  return match ? [match[1], match[2].trim()] : [header.trim(), ''];
}

const SIZE_UNITS = ['KB', 'MB', 'GB'];

// Size of a file for people: bytes below a kilobyte, then one decimal below 10 of a unit
export function formatFileSize(size: number) {
  if (size < 1024) {
    return size === 1 ? '1 byte' : `${size} bytes`;
  }
  let value = size / 1024;
  let i = 0;
  // A size that would be rounded to 1024 of a unit is given in the next unit
  while (Math.round(value) >= 1024 && i < SIZE_UNITS.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value < 9.95 ? value.toFixed(1) : Math.round(value)} ${SIZE_UNITS[i]}`;
}

// Icon of the file in the header of the patch viewer. It follows the badges of the patch lists:
// copies and type changes look like modifications
export function getPatchIcon(status: PatchStatus): IconName {
  switch (status) {
    case PatchStatus.Added:
    case PatchStatus.Untracked:
      return 'file-plus';
    case PatchStatus.Deleted:
      return 'file-minus';
    case PatchStatus.Renamed:
      return 'file-symlink';
    case PatchStatus.Conflicted:
      return 'file-exclamation-point';
    default:
      return 'file-pen';
  }
}
