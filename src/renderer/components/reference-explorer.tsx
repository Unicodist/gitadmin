import * as React from 'react';
import { RepoWrapper, Commit } from '../helpers/repo-wrapper';
import { ReferenceList } from './reference-list';
import { StashList } from './stash-list';
import { InputDialogHandler } from './input-dialog';
import { Icon } from './icon';

export interface ReferenceExplorerProps {
  repo: RepoWrapper;
  onCommitSelect: (commit: Commit) => void;
  onIndexSelect: () => void;
  onOpenInputDialog: InputDialogHandler;
}

export interface ReferenceExplorerState {
}

export class ReferenceExplorer extends React.PureComponent<ReferenceExplorerProps, ReferenceExplorerState> {
  div: React.RefObject<HTMLDivElement | null>;

  constructor(props: ReferenceExplorerProps) {
    super(props);
    this.div = React.createRef();
    this.handleKeyDown = this.handleKeyDown.bind(this);
  }

  resize(offset: number) {
    if (this.div.current) {
      this.div.current.style.width = `${this.div.current.clientWidth + offset}px`;
    }
  }

  // The arrow keys move the focus to the previous or next row, the rows of collapsed sections are skipped
  handleKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    if ((event.key !== 'ArrowDown' && event.key !== 'ArrowUp') || !this.div.current) {
      return;
    }
    const rows = Array.from(this.div.current.querySelectorAll('button')).filter((row) => row.offsetParent !== null);
    const i = rows.indexOf(document.activeElement as HTMLButtonElement);
    if (i !== -1) {
      event.preventDefault();
      rows[event.key === 'ArrowDown' ? Math.min(i + 1, rows.length - 1) : Math.max(i - 1, 0)].focus();
    }
  }

  render() {
    const references = [...this.props.repo.references.values()];
    return (
      <div className='reference-explorer' ref={this.div}>
        <nav aria-label='References' onKeyDown={this.handleKeyDown}>
          <button type='button' className='reference-item' onClick={this.props.onIndexSelect}>
            <Icon name='pencil-line' />
            <span className='reference-name'>Index</span>
          </button>
          <ReferenceList title="Local branches"
            repo={this.props.repo}
            references={references.filter((reference) => reference.isBranch())}
            head={this.props.repo.head}
            onOpenInputDialog={this.props.onOpenInputDialog}
            onClick={this.props.onCommitSelect} />
          <ReferenceList title="Remote branches"
            repo={this.props.repo}
            references={references.filter((reference) => reference.isRemote())}
            head={this.props.repo.head}
            onOpenInputDialog={this.props.onOpenInputDialog}
            onClick={this.props.onCommitSelect} />
          <ReferenceList title="Tags"
            repo={this.props.repo}
            references={references.filter((reference) => reference.isTag())}
            head={this.props.repo.head}
            onOpenInputDialog={this.props.onOpenInputDialog}
            onClick={this.props.onCommitSelect} />
          <StashList repo={this.props.repo}
            stashes={[...this.props.repo.stashes.values()]}
            onClick={this.props.onCommitSelect} />
        </nav>
      </div>
    );
  }
}
