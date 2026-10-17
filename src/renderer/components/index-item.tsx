import * as React from 'react';
import { RepoState } from '../helpers/repo-wrapper';

// Id of the row, the list refers to it when the index is selected
export const INDEX_ITEM_ID = 'commit-item-index';

export interface IndexItemProps {
  repoState: RepoState;
  selected: boolean;
  onIndexSelect: () => void;
}

export class IndexItem extends React.PureComponent<IndexItemProps, {}> {
  constructor(props: IndexItemProps) {
    super(props);
    this.handleClick = this.handleClick.bind(this);
  }

  handleClick() {
    this.props.onIndexSelect();
  }

  render() {
    let suffix = '';
    switch (this.props.repoState) {
      case RepoState.Cherrypick:
        suffix = 'cherrypicking';
        break;
      case RepoState.Merge:
        suffix = 'merging';
        break;
      case RepoState.Rebase:
        suffix = 'rebasing';
        break;
      case RepoState.Revert:
        suffix = 'reverting';
        break;
    }
    const classNames = ['commit-item', 'index-item'];
    if (this.props.selected) {
      classNames.push('selected-commit');
    }
    return (
      <li className={classNames.join(' ')}
        id={INDEX_ITEM_ID}
        role='option'
        aria-selected={this.props.selected}
        onClick={this.handleClick}>
        <span className='commit-summary'>Index</span>
        {suffix ? <span className='index-state'>({suffix})</span> : null}
      </li>
    );
  }
}
