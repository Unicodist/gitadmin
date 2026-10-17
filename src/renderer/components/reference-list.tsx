import * as React from 'react';
import { ReferenceItem } from './reference-item';
import { ReferenceSection } from './reference-section';
import { InputDialogHandler } from './input-dialog';
import { RepoWrapper, Commit, Reference } from '../helpers/repo-wrapper';
import { MAX_FOCUSED_REFERENCES, addToFocus } from '../helpers/branch-focus';

export interface ReferenceListProps {
  title: string;
  repo: RepoWrapper;
  head: Reference | null;
  references: Reference[];
  focus: string[];
  onOpenInputDialog: InputDialogHandler;
  onFocusChange: (focus: string[]) => Promise<void>;
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

  // The commit of a reference hidden by the focus is only in the graph once the reference is added to the focus
  async handleItemClick(reference: Reference) {
    const repo = this.props.repo;
    if (repo.isHidden(reference)) {
      if (this.props.focus.length >= MAX_FOCUSED_REFERENCES) {
        return;
      }
      await this.props.onFocusChange(addToFocus(this.props.focus, reference.name()));
    }
    const commit = repo.getReferenceCommit(reference);
    if (commit) {
      this.props.onClick(commit);
    }
  }

  render() {
    const referenceItems = this.props.references
      .sort((lhs, rhs) => lhs.name() <= rhs.name() ? -1 : 1)
      .map((reference) => {
        const name = reference.name();
        return <ReferenceItem repo={this.props.repo}
          reference={reference}
          selected={this.props.head !== null && this.props.head.name() === reference.name()}
          focus={this.props.focus}
          hidden={(this.props.repo.isFocused() || this.props.repo.isFiltering()) && this.props.repo.isHidden(reference)}
          onOpenInputDialog={this.props.onOpenInputDialog}
          onFocusChange={this.props.onFocusChange}
          onClick={() => this.handleItemClick(reference)}
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
