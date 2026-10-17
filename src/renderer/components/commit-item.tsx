import * as React from 'react';
import { ReferenceBadge } from './reference-badge';
import { InputDialogHandler } from './input-dialog';
import { Icon } from './icon';
import { RepoWrapper, Stash, Commit, Reference } from '../helpers/repo-wrapper';
import { createStashContextMenu } from '../helpers/stash-context-menu';
import { createCommitContextMenu } from '../helpers/commit-context-menu';
import { ContextMenu } from '../helpers/native';

// Id of the row of a commit, the list refers to the selected row with it
export function getCommitItemId(sha: string) {
  return `commit-item-${sha}`;
}

export interface CommitItemProps {
  repo: RepoWrapper;
  commit: Commit;
  head: Reference | null;
  references: string[];
  selected: boolean;
  color: string;
  stash?: Stash;
  onCommitSelect: (commit: Commit) => void;
  onCreateBranch: (commit: Commit) => void;
  onOpenInputDialog: InputDialogHandler;
}

export class CommitItem extends React.PureComponent<CommitItemProps, {}> {
  constructor(props: CommitItemProps) {
    super(props);
    this.handleClick = this.handleClick.bind(this);
    this.handleContextMenu = this.handleContextMenu.bind(this);
  }

  handleClick(_event: React.MouseEvent<HTMLLIElement>) {
    this.props.onCommitSelect(this.props.commit);
  }

  handleContextMenu(event: React.MouseEvent<HTMLLIElement>) {
    event.preventDefault();
    let menu: ContextMenu;
    if (!this.props.stash) {
      menu = createCommitContextMenu(this.props.repo,
        this.props.commit,
        this.props.onCreateBranch,
        this.props.onOpenInputDialog);
    } else {
      menu = createStashContextMenu(this.props.repo, this.props.stash.index);
    }
    menu.popup();
  }

  getBranchColorStyle() {
    const style: Record<string, string> = {};
    style['--branch-color'] = this.props.color;
    return style;
  }

  // A narrow row keeps the badge of the head, or else the first one, and folds the others into a +N pill.
  // They stay in the accessible name of the row, so the pill is only visual.
  renderFoldedBadges() {
    const references = this.props.references;
    const head = this.props.head !== null ? this.props.head.name() : null;
    const shown = head !== null && references.includes(head) ? head : references[0];
    const folded = references.filter((name) => name !== shown).map((name) => this.props.repo.references.get(name)!.shorthand());
    if (folded.length === 0) {
      return null;
    }
    return (
      <span className='folded-badges' aria-hidden='true' style={this.getBranchColorStyle()} title={folded.join(', ')}>
        +{folded.length}
      </span>
    );
  }

  renderStashBadge() {
    return (
      <span className='stash-badge' style={this.getBranchColorStyle()} title={`stash@{${this.props.stash!.index}}`}>
        <Icon name='archive' size={12} />
        <span>Stash</span>
      </span>
    );
  }

  render() {
    const badges = this.props.references.map((name) => (
      <ReferenceBadge reference={this.props.repo.references.get(name)!}
        color={this.props.color}
        selected={this.props.head !== null && name === this.props.head.name()}
        repo={this.props.repo}
        onOpenInputDialog={this.props.onOpenInputDialog}
        key={name} />
    ));
    const classNames = ['commit-item'];
    if (this.props.selected) {
      classNames.push('selected-commit');
    }
    return (
      <li className={classNames.join(' ')}
        id={getCommitItemId(this.props.commit.sha())}
        role='option'
        aria-selected={this.props.selected}
        onClick={this.handleClick}
        onContextMenu={this.handleContextMenu}>
        {badges.length > 0 || this.props.stash ?
          <span className='commit-badges'>
            {badges}
            {this.renderFoldedBadges()}
            {this.props.stash ? this.renderStashBadge() : null}
          </span> : null}
        <span className='commit-summary'>{this.props.commit.summary()}</span>
      </li>
    );
  }
}
