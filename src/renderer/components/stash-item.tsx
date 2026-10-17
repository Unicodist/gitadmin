import * as React from 'react';
import { RepoWrapper } from '../helpers/repo-wrapper';
import { createStashContextMenu } from '../helpers/stash-context-menu';
import { Icon } from './icon';

export interface StashItemProps {
  repo: RepoWrapper;
  name: string;
  index: number;
  onClick: () => void;
}

export class StashItem extends React.PureComponent<StashItemProps, {}> {
  constructor(props: StashItemProps) {
    super(props);
    this.handleContextMenu = this.handleContextMenu.bind(this);
  }

  handleContextMenu(event: React.MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    const menu = createStashContextMenu(this.props.repo, this.props.index);
    menu.popup();
  }

  render() {
    return (
      <li>
        <button type='button'
          className='reference-item'
          title={this.props.name}
          onClick={this.props.onClick}
          onContextMenu={this.handleContextMenu}>
          <Icon name='archive' />
          <span className='reference-name'>{this.props.name}</span>
        </button>
      </li>
    );
  }
}
