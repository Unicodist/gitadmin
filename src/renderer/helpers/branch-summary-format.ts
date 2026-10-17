import { shortenReferenceName } from './branch-focus';
import { MergeCheck } from './branch-summary';

// Texts of the branch summary viewer

function plural(n: number, word: string) {
  return `${n} ${n === 1 ? word : `${word}s`}`;
}

// The first option of the source dropdown, it names the detected branch when there is one
export function describeAutomaticSource(detected: string | null) {
  return detected !== null ? `Detect automatically (${shortenReferenceName(detected)})` : 'Detect automatically';
}

// "+12 -3"
export function describeLineChanges(added: number, removed: number) {
  return `+${added} -${removed}`;
}

// "1 commit", "3 commits"
export function describeCommitCount(count: number) {
  return plural(count, 'commit');
}

// "Merges cleanly into main", "Conflicts with main in 2 files"
export function describeMergeCheck(check: MergeCheck, source: string) {
  const name = shortenReferenceName(source);
  return check.clean ? `Merges cleanly into ${name}` : `Conflicts with ${name} in ${plural(check.conflicts.length, 'file')}`;
}

// Why the summary has no fork point
export function describeMissingFork(source: string | null) {
  return source === null ?
    'No source branch found, choose one above' :
    `${shortenReferenceName(source)} shares no history with this branch`;
}

// The saved source is only used while it exists, the summary goes back to the detected one otherwise
export function resolveSavedSource(saved: string | null, references: { has(name: string): boolean }) {
  return saved !== null && references.has(saved) ? saved : null;
}

// Commits of the branch and of its source, the summary is loaded again when one of them changes
export function getSummaryKey(references: { get(name: string): { commitId: string } | undefined }, branch: string,
  source: string | null) {
  const commitId = (name: string | null) => {
    const reference = name !== null ? references.get(name) : undefined;
    return reference ? reference.commitId : '';
  };
  return `${commitId(branch)} ${commitId(source)}`;
}
