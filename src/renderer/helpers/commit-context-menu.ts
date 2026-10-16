import { clipboard } from 'electron';
import { RepoWrapper, ResetType, removeReferencePrefix, Commit } from './repo-wrapper';
import { InputDialogHandler } from '../components/input-dialog';
import { buildMenu, MenuItem } from './native';

export function createCommitContextMenu(repo: RepoWrapper,
  commit: Commit,
  onCreateBranch: (commit: Commit) => void,
  onOpenInputDialog: InputDialogHandler) {
  function openCreateTagDialog() {
    onOpenInputDialog('Create tag', 'Name', 'Create tag', (value) => repo.createTag(value, commit));
  }

  const template: MenuItem[] = [
    {
      label: 'Create branch here',
      click: () => onCreateBranch(commit)
    },
    {
      label: 'Cherrypick commit',
      click: () => repo.cherrypick(commit)
    },
  ];
  if (repo.head) {
    template.push(
      {
        label: `Reset ${removeReferencePrefix(repo.head.name())} to this commit`,
        submenu: [
          {
            label: 'Soft',
            click: () => repo.reset(commit, ResetType.Soft)
          },
          {
            label: 'Mixed',
            click: () => repo.reset(commit, ResetType.Mixed)
          },
          {
            label: 'Hard',
            click: () => repo.reset(commit, ResetType.Hard)
          }
        ]
      }
    );
  }
  template.push(
    {
      label: 'Revert commit',
      click: () => repo.revert(commit)
    },
    {
      type: 'separator'
    },
    {
      label: 'Copy commit sha to clipboard',
      click: () => clipboard.writeText(commit.sha())
    },
    {
      type: 'separator'
    },
    {
      label: 'Create tag here',
      click: openCreateTagDialog
    }
  );
  return buildMenu(template);
}