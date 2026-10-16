import * as React from 'react';
import { RepoWrapper, Reference } from '../helpers/repo-wrapper';
import { createReferenceContextMenu } from '../helpers/reference-context-menu';
import { InputDialogHandler } from './input-dialog';
import { getReferenceIcon } from './reference-badge';
import { Icon } from './icon';

export interface ReferenceItemProps {
  repo: RepoWrapper;
  reference: Reference;
  selected: boolean;
  onOpenInputDialog: InputDialogHandler;
  onClick: () => void;
}

export class ReferenceItem extends React.PureComponent<ReferenceItemProps, {}> {
  constructor(props: ReferenceItemProps) {
    super(props);
    this.handleContextMenu = this.handleContextMenu.bind(this);
    this.handleDoubleClick = this.handleDoubleClick.bind(this);
  }

  handleContextMenu(event: React.MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    const menu = createReferenceContextMenu(this.props.repo, this.props.reference, this.props.selected, this.props.onOpenInputDialog);
    menu.popup();
  }

  handleDoubleClick() {
    this.props.repo.checkoutReference(this.props.reference);
  }

  render() {
    // selected means that the reference is the head, it is shown as the current branch
    const name = this.props.reference.shorthand();
    return (
      <li>
        <button type='button'
          className={this.props.selected ? 'reference-item current' : 'reference-item'}
          title={name}
          aria-current={this.props.selected ? 'true' : undefined}
          onClick={this.props.onClick}
          onContextMenu={this.handleContextMenu}
          onDoubleClick={this.handleDoubleClick}>
          <Icon name={getReferenceIcon(this.props.reference)} />
          <span className='reference-name'>{name}</span>
          {this.props.selected ? <Icon name='check' className='reference-current' /> : null}
        </button>
      </li>
    );
  }
}
