import { RepoWrapper, removeReferencePrefix, Reference } from './repo-wrapper';
import { InputDialogHandler } from '../components/input-dialog';
import { buildMenu, copyToClipboard, MenuItem } from './native';
import { MAX_FOCUSED_REFERENCES, addToFocus, isFocused, removeFromFocus } from './branch-focus';

export type FocusChangeHandler = (focus: string[]) => void;
// Opens the summary of a branch in the right panel, with the full name of the reference
export type BranchSummaryHandler = (branch: string) => void;

// Items that change the references whose history the graph shows
function createFocusItems(reference: Reference, focus: readonly string[], onFocusChange: FocusChangeHandler): MenuItem[] {
  const name = reference.name();
  const shortName = reference.shorthand();
  return [
    {
      label: `Focus on ${shortName}`,
      click: () => onFocusChange([name]),
      enabled: focus.length !== 1 || focus[0] !== name
    },
    isFocused(focus, name) ?
      {
        label: `Remove ${shortName} from the focus`,
        click: () => onFocusChange(removeFromFocus(focus, name))
      } :
      {
        label: `Add ${shortName} to the focus`,
        click: () => onFocusChange(addToFocus(focus, name)),
        enabled: focus.length < MAX_FOCUSED_REFERENCES
      },
    {
      label: 'Show all branches',
      click: () => onFocusChange([]),
      enabled: focus.length > 0
    }
  ];
}

function createBranchContextMenu(repo: RepoWrapper,
  reference: Reference,
  currentBranch: boolean,
  onOpenInputDialog: InputDialogHandler,
  focus: readonly string[],
  onFocusChange: FocusChangeHandler,
  onShowBranchSummary: BranchSummaryHandler) {
  function openRenameBranchDialog() {
    onOpenInputDialog('Rename branch', 'Name', 'Rename', (value) => repo.renameReference(reference, value), shortName);
  }

  const shortName = reference.shorthand();
  const template: MenuItem[] = [
    {
      label: `Checkout to ${shortName}`,
      click: () => repo.checkoutReference(reference),
      enabled: reference.isBranch() && !currentBranch
    },
    {
      label: `Rename ${shortName}`,
      click: openRenameBranchDialog,
      enabled: reference.isBranch() && !currentBranch
    },
    {
      label: `Remove ${shortName}`,
      click: () => repo.removeReference(reference),
      enabled: reference.isBranch() && !currentBranch
    },
    {
      type: 'separator'
    },
    {
      // The head is null when it is detached
      label: repo.head ? `Merge ${shortName} into ${removeReferencePrefix(repo.head.name())}` : `Merge ${shortName}`,
      click: () => repo.merge(repo.head!.name(), reference.name()),
      enabled: reference.isBranch() && !currentBranch && repo.head !== null
    },
    {
      type: 'separator'
    },
    {
      label: 'See branch summary',
      click: () => onShowBranchSummary(reference.name())
    },
    {
      type: 'separator'
    },
    ...createFocusItems(reference, focus, onFocusChange),
    {
      type: 'separator'
    },
    {
      label: 'Copy branch name to clipboard',
      click: () => copyToClipboard(shortName)
    }
  ];
  return buildMenu(template);
}

function createTagContextMenu(repo: RepoWrapper,
  reference: Reference,
  onOpenInputDialog: InputDialogHandler,
  focus: readonly string[],
  onFocusChange: FocusChangeHandler) {
  function openRenameTagDialog() {
    onOpenInputDialog('Rename tag', 'Name', 'Rename', (value) => repo.renameReference(reference, value), shortName);
  }

  const shortName = reference.shorthand();
  const template: MenuItem[] = [
    {
      label: `Rename ${shortName}`,
      click: openRenameTagDialog,
    },
    {
      label: `Remove ${shortName}`,
      click: () => repo.removeReference(reference),
    },
    {
      type: 'separator'
    },
    ...createFocusItems(reference, focus, onFocusChange),
    {
      type: 'separator'
    },
    {
      label: 'Copy tag name to clipboard',
      click: () => copyToClipboard(shortName)
    }
  ];
  return buildMenu(template);
}

export function createReferenceContextMenu(repo: RepoWrapper,
  reference: Reference,
  currentBranch: boolean,
  onOpenInputDialog: InputDialogHandler,
  focus: readonly string[],
  onFocusChange: FocusChangeHandler,
  onShowBranchSummary: BranchSummaryHandler) {
  if (reference.isTag()) {
    return createTagContextMenu(repo, reference, onOpenInputDialog, focus, onFocusChange);
  } else {
    return createBranchContextMenu(repo, reference, currentBranch, onOpenInputDialog, focus, onFocusChange, onShowBranchSummary);
  }
}