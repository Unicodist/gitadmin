import { Field, Settings } from '../../shared/settings';
import { Commit, Reference } from './git/model';

// Quick filters of the graph while it shows every reference. A focus chooses the references by itself, the
// filters then do not apply. The lanes are computed again for the commits that are left, so the graph compacts.

export interface GraphFilters {
  // Only the history of the head
  currentBranchOnly: boolean;
  // Only the local branches and the head, no remote branches, tags or other references
  localOnly: boolean;
  hideRemotes: boolean;
  hideTags: boolean;
  hideStashes: boolean;
}

export const DEFAULT_FILTERS: GraphFilters = {
  currentBranchOnly: false,
  localOnly: false,
  hideRemotes: false,
  hideTags: false,
  hideStashes: false
};

export const FILTER_NAMES = Object.keys(DEFAULT_FILTERS) as (keyof GraphFilters)[];

export function hasActiveFilters(filters: GraphFilters) {
  return FILTER_NAMES.some((name) => filters[name]);
}

export function areFiltersEqual(lhs: GraphFilters, rhs: GraphFilters) {
  return FILTER_NAMES.every((name) => lhs[name] === rhs[name]);
}

// The broader filters include the narrower ones: the current branch is local, and local hides the remotes and the tags
export function isFilterImplied(filters: GraphFilters, name: keyof GraphFilters) {
  switch (name) {
    case 'localOnly':
      return filters.currentBranchOnly;
    case 'hideRemotes':
    case 'hideTags':
      return filters.currentBranchOnly || filters.localOnly;
    default:
      return false;
  }
}

export function isFilterOn(filters: GraphFilters, name: keyof GraphFilters) {
  return filters[name] || isFilterImplied(filters, name);
}

// True if the history of the reference is loaded, the head is always loaded
export function isReferenceShown(reference: Reference, filters: GraphFilters, headName: string | null) {
  if (filters.currentBranchOnly) {
    return reference.name() === headName;
  }
  if (filters.localOnly) {
    return reference.isBranch();
  }
  return !(filters.hideRemotes && reference.isRemote()) && !(filters.hideTags && reference.isTag());
}

// True if the reference gets a badge on its commit: the current branch only filters the history, the badges of
// the other local branches of that history stay
export function isBadgeShown(reference: Reference, filters: GraphFilters) {
  return isReferenceShown(reference, { ...filters, currentBranchOnly: false, localOnly: isFilterOn(filters, 'localOnly') }, null);
}

export function showsStashes(filters: GraphFilters) {
  return !filters.hideStashes && !filters.currentBranchOnly;
}

// Unknown or missing values of an older or broken settings file are left out
export function sanitizeFilters(value: unknown): GraphFilters {
  const filters = { ...DEFAULT_FILTERS };
  if (value !== null && typeof value === 'object') {
    for (const name of FILTER_NAMES) {
      if (typeof (value as Record<string, unknown>)[name] === 'boolean') {
        filters[name] = (value as Record<string, boolean>)[name];
      }
    }
  }
  return filters;
}

// Highlight: the commits that match a text are highlighted, the others are dimmed

export interface CommitQuery {
  // Each word must be in the summary, the message, the author or the SHA, ignoring the case
  terms: string[];
  // Inclusive bounds of the date of the commit, null when unbounded
  after: Date | null;
  before: Date | null;
}

function parseDate(text: string, endOfDay: boolean) {
  const match = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(text);
  if (!match) {
    return null;
  }
  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10) - 1;
  if (match[3] === undefined) {
    // A month: from its first day to its last day
    return endOfDay ? new Date(year, month + 1, 0, 23, 59, 59, 999) : new Date(year, month, 1);
  }
  const day = parseInt(match[3], 10);
  return endOfDay ? new Date(year, month, day, 23, 59, 59, 999) : new Date(year, month, day);
}

// "ada after:2024-01 before:2024-03-15", the dates of the authors are compared in local time, a word that is not
// a valid date filter is searched as text. Null when there is nothing to search.
export function parseCommitQuery(text: string): CommitQuery | null {
  const query: CommitQuery = { terms: [], after: null, before: null };
  for (const word of text.trim().split(/\s+/).filter((word) => word.length > 0)) {
    const match = /^(after|since|before|until):(.+)$/i.exec(word);
    const date = match ? parseDate(match[2], /^(before|until)$/i.test(match[1])) : null;
    if (match && date) {
      if (/^(after|since)$/i.test(match[1])) {
        query.after = date;
      } else {
        query.before = date;
      }
    } else {
      query.terms.push(word.toLowerCase());
    }
  }
  return query.terms.length > 0 || query.after || query.before ? query : null;
}

export function matchesCommitQuery(commit: Commit, query: CommitQuery) {
  const date = commit.author().date;
  if ((query.after && date < query.after) || (query.before && date > query.before)) {
    return false;
  }
  if (query.terms.length === 0) {
    return true;
  }
  const author = commit.author();
  const text = `${commit.message()}\n${author.name}\n${author.email}`.toLowerCase();
  return query.terms.every((term) => text.includes(term) || commit.sha().startsWith(term));
}

// SHAs of the commits that match, null when nothing is searched
export function findMatches(commits: readonly Commit[], query: CommitQuery | null) {
  if (!query) {
    return null;
  }
  return new Set(commits.filter((commit) => matchesCommitQuery(commit, query)).map((commit) => commit.sha()));
}

// Persistence: the filters, the view and the minimap of each repository are stored under the path of its working
// directory

export enum GraphMode {
  List = 'list',
  Canvas = 'canvas'
}

export interface GraphView {
  mode: GraphMode;
  filters: GraphFilters;
  minimap: boolean;
}

export const DEFAULT_GRAPH_VIEW: GraphView = {
  mode: GraphMode.List,
  filters: DEFAULT_FILTERS,
  minimap: true
};

function getSavedViews(): Record<string, unknown> {
  const value = Settings.get(Field.GraphView, {});
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

export function loadGraphView(workdir: string): GraphView {
  const saved = getSavedViews()[workdir] as Record<string, unknown> | undefined;
  if (!saved || typeof saved !== 'object') {
    return { ...DEFAULT_GRAPH_VIEW };
  }
  return {
    mode: saved.mode === GraphMode.Canvas ? GraphMode.Canvas : GraphMode.List,
    filters: sanitizeFilters(saved.filters),
    minimap: typeof saved.minimap === 'boolean' ? saved.minimap : DEFAULT_GRAPH_VIEW.minimap
  };
}

export function saveGraphView(workdir: string, view: GraphView) {
  const views = getSavedViews();
  if (view.mode === DEFAULT_GRAPH_VIEW.mode && view.minimap === DEFAULT_GRAPH_VIEW.minimap && !hasActiveFilters(view.filters)) {
    delete views[workdir];
  } else {
    views[workdir] = { mode: view.mode, filters: { ...view.filters }, minimap: view.minimap };
  }
  Settings.set(Field.GraphView, views);
}
