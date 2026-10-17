import * as React from 'react';
import { RepoWrapper, Reference } from '../helpers/repo-wrapper';
import { BranchSummaryHandler, createReferenceContextMenu, FocusChangeHandler } from '../helpers/reference-context-menu';
import { IconName } from '../helpers/icons';
import { InputDialogHandler } from './input-dialog';
import { Icon } from './icon';

export class ReferenceBadgeProps {
  reference: Reference;
  color: string;
  selected: boolean;
  repo: RepoWrapper;
  focus: string[];
  onOpenInputDialog: InputDialogHandler;
  onFocusChange: FocusChangeHandler;
  onShowBranchSummary: BranchSummaryHandler;
}

export function getReferenceIcon(reference: Reference): IconName {
  if (reference.isTag()) {
    return 'tag';
  } else if (reference.isRemote()) {
    return 'cloud';
  }
  return 'git-branch';
}

export class ReferenceBadge extends React.PureComponent<ReferenceBadgeProps, {}> {
  constructor(props: ReferenceBadgeProps) {
    super(props);
    this.handleContextMenu = this.handleContextMenu.bind(this);
    this.handleDoubleClick = this.handleDoubleClick.bind(this);
  }

  handleContextMenu(event: React.MouseEvent<HTMLSpanElement>) {
    event.preventDefault();
    event.stopPropagation();
    const menu = createReferenceContextMenu(this.props.repo, this.props.reference, this.props.selected, this.props.onOpenInputDialog,
      this.props.focus, this.props.onFocusChange, this.props.onShowBranchSummary);
    menu.popup();
  }

  handleDoubleClick() {
    this.props.repo.checkoutReference(this.props.reference);
  }

  render() {
    const reference = this.props.reference;
    const name = reference.shorthand();
    const style: Record<string, string> = {};
    style['--branch-color'] = this.props.color;
    const classNames = ['reference-badge'];
    if (reference.isTag()) {
      classNames.push('tag');
    } else if (reference.isRemote()) {
      classNames.push('remote');
    }
    if (this.props.selected) {
      classNames.push('head');
    }
    return (
      <span className={classNames.join(' ')} style={style} title={name}
        onContextMenu={this.handleContextMenu}
        onDoubleClick={this.handleDoubleClick}>
        <Icon name={getReferenceIcon(reference)} size={12} />
        <span className='reference-badge-name'>{name}</span>
      </span>
    );
  }
}
