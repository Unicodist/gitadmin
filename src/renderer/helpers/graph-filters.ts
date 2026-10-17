import { Field, Settings } from '../../shared/settings';
import { Reference } from './git/model';
import { joinNames } from './branch-focus';

// The filters are quick toggles that leave kinds of references out of the graph while it is not
// focused: their history is not loaded and their badges are not shown. A focus chooses the
// references by itself, the filters wait until it is cleared. They are saved per repository.

export interface GraphFilters {
  // Only the history of the head, the other toggles do not apply
  currentBranchOnly: boolean;
  hideRemotes: boolean;
  hideTags: boolean;
  hideStashes: boolean;
}

export const NO_FILTERS: GraphFilters = {
  currentBranchOnly: false,
  hideRemotes: false,
  hideTags: false,
  hideStashes: false
};

const FILTER_KEYS = Object.keys(NO_FILTERS) as (keyof GraphFilters)[];

export function isFiltering(filters: GraphFilters) {
  return FILTER_KEYS.some((key) => filters[key]);
}

// Local only hides the remote branches and the tags, the local branches and the stashes stay
export function isLocalOnly(filters: GraphFilters) {
  return filters.hideRemotes && filters.hideTags;
}

export function setLocalOnly(filters: GraphFilters, localOnly: boolean): GraphFilters {
  return { ...filters, hideRemotes: localOnly, hideTags: localOnly };
}

export function toggleFilter(filters: GraphFilters, key: keyof GraphFilters): GraphFilters {
  return { ...filters, [key]: !filters[key] };
}

// True if the filters keep the history and the badge of the reference, headName is the full name of
// the current branch, null for a detached head
export function showsReference(filters: GraphFilters, reference: Reference, headName: string | null) {
  if (filters.currentBranchOnly) {
    return reference.name() === headName;
  }
  return !(filters.hideRemotes && reference.isRemote()) && !(filters.hideTags && reference.isTag());
}

export function showsStashes(filters: GraphFilters) {
  return !filters.currentBranchOnly && !filters.hideStashes;
}

// "Hiding remote branches, tags and stashes"
export function describeFilters(filters: GraphFilters) {
  if (filters.currentBranchOnly) {
    return 'Showing the current branch only';
  }
  const hidden: string[] = [];
  if (filters.hideRemotes) {
    hidden.push('remote branches');
  }
  if (filters.hideTags) {
    hidden.push('tags');
  }
  if (filters.hideStashes) {
    hidden.push('stashes');
  }
  if (hidden.length === 0) {
    return 'Showing everything';
  }
  return `Hiding ${joinNames(hidden)}`;
}

// Persistence, the filters of each repository are stored under the path of its working directory

function getSavedFilters(): Record<string, Partial<GraphFilters>> {
  const value = Settings.get(Field.GraphFilters, {});
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

export function loadFilters(workdir: string): GraphFilters {
  const saved = getSavedFilters()[workdir];
  const filters = { ...NO_FILTERS };
  if (saved !== null && typeof saved === 'object') {
    for (const key of FILTER_KEYS) {
      filters[key] = saved[key] === true;
    }
  }
  return filters;
}

export function saveFilters(workdir: string, filters: GraphFilters) {
  const saved = getSavedFilters();
  if (isFiltering(filters)) {
    saved[workdir] = { ...filters };
  } else {
    delete saved[workdir];
  }
  Settings.set(Field.GraphFilters, saved);
}
