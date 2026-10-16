import { RepoWrapper } from './repo-wrapper';
import { buildMenu, MenuItem } from './native';

export function createStashContextMenu(repo: RepoWrapper, stashIndex: number) {
  const template: MenuItem[] = [];
  template.push(
    {
      label: 'Apply stash',
      click: () => repo.applyStash(stashIndex)
    },
    {
      label: 'Pop stash',
      click: () => repo.popStash(stashIndex)
    },
    {
      label: 'Drop stash',
      click: () => repo.dropStash(stashIndex)
    },
  );
  return buildMenu(template);
}