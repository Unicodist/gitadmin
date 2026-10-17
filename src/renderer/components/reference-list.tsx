import * as React from 'react';
import { ReferenceItem } from './reference-item';
import { ReferenceSection } from './reference-section';
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
      <ReferenceSection title={this.props.title}
        count={referenceItems.length}
        collapsed={this.state.hide}
        onToggle={this.handleClick}>
        {referenceItems}
      </ReferenceSection>
    );
  }
}
