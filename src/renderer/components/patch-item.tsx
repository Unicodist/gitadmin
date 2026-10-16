import { clipboard } from 'electron';
import * as React from 'react';
import { RepoWrapper, PatchType, Patch } from '../helpers/repo-wrapper';
import { openInEditor } from '../helpers/open-in-editor';
import { buildMenu, MenuItem } from '../helpers/native';
import { describePatchPath, getPatchStatusDisplay, splitPath } from '../helpers/patch-status';
import { Icon } from './icon';

export interface PatchItemProps {
  repo?: RepoWrapper;
  patch: Patch;
  type: PatchType;
  selected: boolean;
  onPatchSelect: (patch: Patch, ctrlKey: boolean, shiftKey: boolean) => void;
}

export class PatchItem extends React.PureComponent<PatchItemProps, {}> {
  li: React.RefObject<HTMLLIElement | null>;

  constructor(props: PatchItemProps) {
    super(props);
    this.li = React.createRef();
    this.handleClick = this.handleClick.bind(this);
    this.handleStageClick = this.handleStageClick.bind(this);
    this.handleUnstageClick = this.handleUnstageClick.bind(this);
    this.handleContextMenu = this.handleContextMenu.bind(this);
  }

  componentDidUpdate(prevProps: PatchItemProps) {
    if (this.props.selected && !prevProps.selected) {
      this.scrollIntoList();
    }
  }

  handleClick(event: React.MouseEvent<HTMLLIElement>) {
    this.props.onPatchSelect(this.props.patch, event.ctrlKey, event.shiftKey);
  }

  handleStageClick(event: React.MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    this.keepFocusInList(event.currentTarget);
    this.props.repo!.stagePatch(this.props.patch);
  }

  handleUnstageClick(event: React.MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    this.keepFocusInList(event.currentTarget);
    this.props.repo!.unstagePatch(this.props.patch);
  }

  handleContextMenu(event: React.MouseEvent<HTMLLIElement>) {
    event.preventDefault();
    const path = this.props.patch.newFile.path;
    const template: MenuItem[] = [];
    if (this.props.type === PatchType.Unstaged) {
      template.push(
        {
          label: 'Stage',
          click: () => this.props.repo!.stagePatch(this.props.patch)
        },
        {
          label: 'Discard changes',
          click: () => this.props.repo!.discardPatch(this.props.patch)
        },
      );
    } else if (this.props.type === PatchType.Staged) {
      template.push({
        label: 'Unstage',
        click: () => this.props.repo!.unstagePatch(this.props.patch)
      });
    }
    template.push(
      {
        type: 'separator'
      },
      {
        label: 'Copy file path to clipboard',
        click: () => clipboard.writeText(path)
      },
      {
        type: 'separator'
      },
      {
        label: 'Open in editor',
        click: () => openInEditor(path)
      }
    );
    const menu = buildMenu(template);
    menu.popup();
  }

  // The row goes away once its file is staged or unstaged, the list keeps the keyboard focus instead of the page
  keepFocusInList(button: HTMLButtonElement) {
    const list = this.li.current ? this.li.current.parentElement : null;
    if (list && document.activeElement === button) {
      list.focus();
    }
  }

  // Only the list scrolls: scrollIntoView would also scroll the viewers, which hide their overflow
  scrollIntoList() {
    const li = this.li.current;
    const list = li ? li.parentElement : null;
    if (li && list) {
      const top = list.getBoundingClientRect().top + list.clientTop;
      const rect = li.getBoundingClientRect();
      if (rect.top < top) {
        list.scrollTop -= top - rect.top;
      } else if (rect.bottom > top + list.clientHeight) {
        list.scrollTop += rect.bottom - top - list.clientHeight;
      }
    }
  }

  renderAction() {
    const path = this.props.patch.newFile.path;
    if (this.props.type === PatchType.Unstaged) {
      return (
        <button className='ghost-button small-button icon-button patch-action'
          type='button'
          aria-label={`Stage ${path}`}
          title='Stage'
          onClick={this.handleStageClick}>
          <Icon name='plus' />
        </button>
      );
    } else if (this.props.type === PatchType.Staged) {
      return (
        <button className='ghost-button small-button icon-button patch-action'
          type='button'
          aria-label={`Unstage ${path}`}
          title='Unstage'
          onClick={this.handleUnstageClick}>
          <Icon name='minus' />
        </button>
      );
    }
    return null;
  }

  render() {
    const patch = this.props.patch;
    const status = getPatchStatusDisplay(patch.status);
    const [folder, fileName] = splitPath(patch.newFile.path);
    // The name of the file is written only once in the row, the full path is in the tooltip
    return (
      <li className={this.props.selected ? 'selected-patch' : ''}
        onClick={this.handleClick}
        onContextMenu={this.handleContextMenu}
        ref={this.li}>
        <span className={`patch-status ${status.className}`} title={status.label}>
          <span aria-hidden='true'>{status.letter}</span>
          <span className='visually-hidden'>{status.label}</span>
        </span>
        <span className='patch-path ellipsis-middle' title={describePatchPath(patch.status, patch.oldFile.path, patch.newFile.path)}>
          <span className='left'>{folder}</span>
          <span className='right'>{fileName}</span>
        </span>
        {this.renderAction()}
      </li>
    );
  }
}
