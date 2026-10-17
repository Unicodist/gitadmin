import { RepoWrapper, removeReferencePrefix, Reference } from './repo-wrapper';
import { InputDialogHandler } from '../components/input-dialog';
import { buildMenu, copyToClipboard, MenuItem } from './native';

function createBranchContextMenu(repo: RepoWrapper,
  reference: Reference,
  currentBranch: boolean,
  onOpenInputDialog: InputDialogHandler) {
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
      label: `Merge ${shortName} into ${removeReferencePrefix(repo.head!.name())}`,
      click: () => repo.merge(repo.head!.name(), reference.name()),
      enabled: reference.isBranch() && !currentBranch && repo.head !== null
    },
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
  onOpenInputDialog: InputDialogHandler) {
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
  onOpenInputDialog: InputDialogHandler) {
  if (reference.isTag()) {
    return createTagContextMenu(repo, reference, onOpenInputDialog);
  } else {
    return createBranchContextMenu(repo, reference, currentBranch, onOpenInputDialog);
  }
}