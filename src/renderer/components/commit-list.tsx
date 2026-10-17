import * as React from 'react';
import { CommitItem, getCommitItemId } from './commit-item';
import { IndexItem, INDEX_ITEM_ID } from './index-item';
import { InputDialogHandler } from './input-dialog';
import { RepoWrapper, RepoState, Commit } from '../helpers/repo-wrapper';
import { getCommitColor, isSharedCommit } from '../helpers/commit-graph';
import { getRelationLabels, RelationLabel } from '../helpers/branch-focus';

const ITEM_HEIGHT = 28;

// Shared by the commits without relations, so that their rows are not rendered again for nothing
const NO_RELATIONS: RelationLabel[] = [];

export interface CommitListProps {
  repo: RepoWrapper;
  repoState: RepoState;
  selectedCommit: Commit | null;
  focus: string[];
  onCommitSelect: (commit: Commit) => void;
  onIndexSelect: () => void;
  onCreateBranch: (commit: Commit) => void;
  onOpenInputDialog: InputDialogHandler;
  onFocusChange: (focus: string[]) => void;
  onScroll: (height: number, start: number, end: number) => void;
  onResize: (offset: number, start: number, end: number) => void;
  onStateUpdate: (start: number, end: number) => void;
}

export interface CommitListState {
  start: number;
  end: number;
}

export class CommitList extends React.PureComponent<CommitListProps, CommitListState> {
  div: React.RefObject<HTMLDivElement | null>;
  resizeObserver: ResizeObserver;

  constructor(props: CommitListProps) {
    super(props);
    this.div = React.createRef();
    this.state = {
      start: 0,
      end: 0
    };
    this.handleScroll = this.handleScroll.bind(this);
    this.handleResize = this.handleResize.bind(this);
    this.handleKeyUp = this.handleKeyUp.bind(this);
    this.handleKeyDown = this.handleKeyDown.bind(this);
  }

  componentDidMount() {
    if (this.div.current) {
      this.resizeObserver = new ResizeObserver(this.handleResize);
      this.resizeObserver.observe(this.div.current);
    }
  }

  componentDidUpdate(prevProps: CommitListProps) {
    if (this.props.selectedCommit !== prevProps.selectedCommit) {
      this.scrollToItem();
    }
  }

  componentWillUnmount() {
    this.resizeObserver.disconnect();
  }

  handleScroll() {
    if (this.div.current) {
      const newState = this.computeState()!;
      this.props.onScroll(this.div.current.scrollTop, newState.start, newState.end);
      this.setState(newState);
    }
  }

  handleResize() {
    if (this.div.current) {
      const newState = this.computeState()!;
      this.props.onResize(this.div.current.clientHeight, newState.start, newState.end);
      this.setState(newState);
    }
  }

  handleKeyUp(event: React.KeyboardEvent<HTMLUListElement>) {
    event.preventDefault();
    if (event.keyCode === 38) {
      let i = this.getIndexOfSelectedCommit();
      i = Math.max(i - 1, -1);
      if (i >= 0) {
        this.props.onCommitSelect(this.props.repo.commits[i]);
      } else {
        this.props.onIndexSelect();
      }
    } else if (event.keyCode === 40) {
      let i = this.getIndexOfSelectedCommit();
      i = Math.min(i + 1, this.props.repo.commits.length - 1);
      if (i >= 0) {
        this.props.onCommitSelect(this.props.repo.commits[i]);
      }
    }
  }

  handleKeyDown(event: React.KeyboardEvent<HTMLUListElement>) {
    // The arrows select the commits on key up, they must not scroll the list too. The other keys, like Tab, keep working.
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  scrollToItem() {
    // Scroll so that the commit is visible, unless it is not in the list
    const i = this.getIndexOfSelectedCommit();
    if (i === -1 && this.props.selectedCommit !== null) {
      return;
    }
    if (i <= this.state.start && this.div.current) {
      this.div.current.scrollTo(0, (i + 1) * ITEM_HEIGHT);
    }
    if (i >= this.state.end - 1 && this.div.current) {
      this.div.current.scrollTo(0, (i + 2) * ITEM_HEIGHT - this.div.current.clientHeight);
    }
  }

  centerOnItem(i: number) {
    if (this.div.current) {
      this.div.current.scrollTo(0, (i + 1.5) * ITEM_HEIGHT - this.div.current.clientHeight / 2);
    }
  }

  updateState() {
    if (this.div.current) {
      const newState = this.computeState()!;
      this.props.onStateUpdate(newState.start, newState.end);
      this.setState(newState);
    }
  }

  computeState() {
    const div = this.div.current!;
    // Take account of the index
    const top = div.scrollTop - ITEM_HEIGHT;
    const start = Math.floor(top / ITEM_HEIGHT);
    const end = Math.min(Math.ceil((top + div.clientHeight) / ITEM_HEIGHT),
      this.props.repo.commits.length);
    return {
      start: start,
      end: end
    };
  }

  // A stash selected while the graph is focused is not in the list, the arrows then start from the index
  getIndexOfSelectedCommit() {
    const i = this.props.selectedCommit ? this.props.repo.shaToIndex.get(this.props.selectedCommit.sha()) : undefined;
    return i !== undefined ? i : -1;
  }

  // Row of the selection, for assistive technologies, if it is rendered
  getActiveDescendant() {
    const i = this.getIndexOfSelectedCommit();
    if (this.props.selectedCommit === null) {
      return this.state.start === -1 ? INDEX_ITEM_ID : undefined;
    }
    return i !== -1 && i >= this.state.start && i < this.state.end ? getCommitItemId(this.props.selectedCommit!.sha()) : undefined;
  }

  render() {
    // Select visible commits and add index if necessary
    const items: React.JSX.Element[] = [];
    if (this.state.start === -1) {
      items.push(<IndexItem repoState={this.props.repoState} selected={this.props.selectedCommit === null}
        onIndexSelect={this.props.onIndexSelect}
        key='index' />);
    }
    const commits = this.props.repo.commits.slice(Math.max(this.state.start, 0), this.state.end);
    items.push(...commits.map((commit: Commit) => {
      const commitSha = commit.sha();
      const repo = this.props.repo;
      const relations = getRelationLabels(commitSha, repo.relations, repo.focusLayout);
      return (
        <CommitItem
          repo={this.props.repo}
          commit={commit}
          head={this.props.repo.head}
          references={this.props.repo.shaToReferences.get(commitSha) || []}
          selected={this.props.selectedCommit !== null && this.props.selectedCommit.sha() === commit.sha()}
          onCommitSelect={this.props.onCommitSelect}
          onCreateBranch={this.props.onCreateBranch}
          onOpenInputDialog={this.props.onOpenInputDialog}
          onFocusChange={this.props.onFocusChange}
          color={getCommitColor(repo, commitSha)}
          shared={isSharedCommit(repo, commitSha)}
          relations={relations.length > 0 ? relations : NO_RELATIONS}
          focus={this.props.focus}
          stash={repo.stashes.get(commitSha)}
          key={commit.sha()} />
      );
    }));

    // Compute height of the divs
    const paddingTop = (this.state.start + 1) * ITEM_HEIGHT;
    const paddingBottom = (this.props.repo.commits.length - this.state.end) * ITEM_HEIGHT;
    const style = {
      paddingTop: paddingTop,
      paddingBottom: paddingBottom
    };

    return (
      <div className='commit-list' onScroll={this.handleScroll} ref={this.div}>
        <ul style={style}
          role='listbox'
          aria-label='Commits'
          aria-activedescendant={this.getActiveDescendant()}
          tabIndex={0}
          onKeyUp={this.handleKeyUp}
          onKeyDown={this.handleKeyDown}>
          {items}
        </ul>
      </div>
    );
  }
}

