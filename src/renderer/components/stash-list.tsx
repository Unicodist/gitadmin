import * as React from 'react';
import { StashItem } from './stash-item';
import { ReferenceSection } from './reference-section';
import { RepoWrapper, Stash, Commit } from '../helpers/repo-wrapper';

export interface StashListProps {
  repo: RepoWrapper;
  stashes: Stash[];
  onClick: (commit: Commit) => void;
}

export interface StashListState {
  hide: boolean;
}

export class StashList extends React.PureComponent<StashListProps, StashListState> {
  constructor(props: StashListProps) {
    super(props);
    this.state = {
      hide: false
    };
    this.handleClick = this.handleClick.bind(this);
  }

  handleClick() {
    this.setState((prevState) => ({
      hide: !prevState.hide
    }));
  }

  render() {
    const stashItems = this.props.stashes.sort((a, b) => b.index - a.index).map((stash) => (
      <StashItem repo={this.props.repo}
        name={stash.commit.summary()}
        index={stash.index}
        onClick={() => this.props.onClick(stash.commit)}
        key={stash.commit.sha()} />
    ));
    return (
      <ReferenceSection title='Stashes'
        count={stashItems.length}
        collapsed={this.state.hide}
        onToggle={this.handleClick}>
        {stashItems}
      </ReferenceSection>
    );
  }
}
