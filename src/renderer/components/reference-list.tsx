import * as React from 'react';
import { ReferenceItem } from './reference-item';
import { InputDialogHandler } from './input-dialog';
import { RepoWrapper, Commit, Reference } from '../helpers/repo-wrapper';

export interface ReferenceListProps {
  title: string;
  repo: RepoWrapper;
  head: Reference | null;
  references: Reference[];
  onOpenInputDialog: InputDialogHandler;
  onClick: (commit: Commit) => void;
}

export interface ReferenceListState {
  hide: boolean;
}

export class ReferenceList extends React.PureComponent<ReferenceListProps, ReferenceListState> {
  constructor(props: ReferenceListProps) {
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
    const referenceItems = this.props.references
      .sort((lhs, rhs) => lhs.name() <= rhs.name() ? -1 : 1)
      .map((reference) => {
        const name = reference.name();
        return <ReferenceItem repo={this.props.repo}
          reference={reference}
          selected={this.props.head !== null && this.props.head.name() === reference.name()}
          onOpenInputDialog={this.props.onOpenInputDialog}
          onClick={() => this.props.onClick(this.props.repo.getReferenceCommit(reference))}
          key={name} />;
      });
    return (
      <>
        <h3 onClick={this.handleClick}>
          {this.props.title}
          <span>{this.state.hide ? '+' : '\u2212'}</span>
        </h3>
        <ul className={this.state.hide ? 'hidden' : ''}>
          {referenceItems}
        </ul>
      </>
    );
  }
}