import { clipboard } from 'electron';
import * as React from 'react';
import { PatchList } from './patch-list';
import { Icon } from './icon';
import { PatchType, RepoWrapper, shortenSha, Commit, Patch } from '../helpers/repo-wrapper';
import { CancellablePromise, makeCancellable } from '../helpers/make-cancellable';
import { formatCommitDate, formatFullDate } from '../helpers/viewer-format';

function renderDate(date: Date) {
  return <time dateTime={date.toISOString()} title={formatFullDate(date)}>{formatCommitDate(date)}</time>;
}

// The button may have been clicked on its icon or its label, the tooltip is found from the button itself
function setTooltipText(button: HTMLElement, text: string) {
  const tooltip = button.querySelector('.tooltip-text');
  if (tooltip) {
    tooltip.textContent = text;
  }
}

export interface CommitViewerProps {
  repo: RepoWrapper;
  commit: Commit;
  selectedPatch: Patch | null;
  onCommitSelect: (commit: Commit) => void;
  onPatchSelect: (patch: Patch, type: PatchType) => void;
}

export interface CommitViewerState {
  patches: Patch[];
  // False until the files of the first commit are loaded, so that their number does not show 0 first
  patchesLoaded: boolean;
}

export class CommitViewer extends React.PureComponent<CommitViewerProps, CommitViewerState> {
  div: React.RefObject<HTMLDivElement | null>;
  patchesPromise: CancellablePromise<Patch[]>;

  constructor(props: CommitViewerProps) {
    super(props);
    this.div = React.createRef<HTMLDivElement>();
    this.state = {
      patches: [],
      patchesLoaded: false
    };
    this.handlePatchSelect = this.handlePatchSelect.bind(this);
  }

  componentDidMount() {
    this.updatePatches();
  }

  componentWillUnmount() {
    if (this.patchesPromise) {
      this.patchesPromise.cancel();
    }
  }

  componentDidUpdate(prevProps: CommitViewerProps) {
    if (this.props.commit !== prevProps.commit) {
      if (this.patchesPromise) {
        this.patchesPromise.cancel();
      }
      this.updatePatches();
    }
  }

  handlePatchSelect(patch: Patch) {
    this.props.onPatchSelect(patch, PatchType.Committed);
  }

  resize(offset: number) {
    if (this.div.current) {
      this.div.current.style.width = `${this.div.current.clientWidth - offset}px`;
    }
  }

  async updatePatches() {
    this.patchesPromise = makeCancellable(this.props.repo.getPatches(this.props.commit));
    try {
      this.setState({
        patches: await this.patchesPromise.promise,
        patchesLoaded: true
      });
    } catch (e) {
    }
  }

  static createShaButton(sha: string) {
    function handleHover(event: React.SyntheticEvent<HTMLButtonElement>) {
      setTooltipText(event.currentTarget, 'Copy');
    }
    function handleClick(event: React.MouseEvent<HTMLButtonElement>) {
      clipboard.writeText(sha);
      setTooltipText(event.currentTarget, 'Copied');
    }
    const shortSha = shortenSha(sha);
    return (
      <button type='button'
        className='ghost-button small-button sha-button tooltip-bottom'
        aria-label={`Copy SHA ${shortSha}`}
        onMouseEnter={handleHover}
        onFocus={handleHover}
        onClick={handleClick}>
        <Icon name='copy' size={14} />
        <span className='mono'>{shortSha}</span>
        <span className='tooltip-text' aria-hidden='true'>Copy</span>
      </button>
    );
  }

  createNavigationButton(commit: Commit) {
    const shortSha = shortenSha(commit.sha());
    return (
      <button type='button'
        className='sha-chip tooltip-bottom'
        aria-label={`Navigate to ${shortSha}`}
        key={commit.sha()}
        onClick={() => this.props.onCommitSelect(commit)}>
        <span className='mono'>{shortSha}</span>
        <span className='tooltip-text' aria-hidden='true'>Navigate</span>
      </button>
    );
  }

  createNavigationButtons(shas: string[]) {
    return shas.map((sha) => this.createNavigationButton(this.props.repo.shaToCommit.get(sha)!));
  }

  renderParents() {
    const parents = this.props.repo.parents.get(this.props.commit.sha()) || [];
    return (
      <li>
        <Icon name={parents.length > 1 ? 'git-merge' : 'git-commit-horizontal'} size={14} />
        <span className='commit-detail-label'>{parents.length > 1 ? 'Parents' : 'Parent'}</span>
        {parents.length > 0 ?
          <span className='commit-parents'>{this.createNavigationButtons(parents)}</span> :
          <span className='commit-detail-label'>None</span>}
      </li>
    );
  }

  render() {
    const commit = this.props.commit;
    const author = commit.author();
    const body = commit.body();
    return (
      <div className='commit-viewer' ref={this.div}>
        <div className='viewer-header'>
          <span className='viewer-title'>Commit</span>
          {CommitViewer.createShaButton(commit.sha())}
        </div>
        <div className='viewer-body'>
          <div className='commit-message'>
            <h2>{commit.summary()}</h2>
            {body ? <pre>{body}</pre> : null}
          </div>
          <ul className='commit-details'>
            <li>
              <Icon name='user' size={14} />
              <span className='commit-author'>
                <span className='commit-author-name'>{author.name}</span>
                <a href={`mailto:${author.email}`} title={author.email}>{author.email}</a>
              </span>
            </li>
            <li>
              <Icon name='calendar' size={14} />
              <span className='commit-detail-label'>Authored</span>
              {renderDate(author.date)}
            </li>
            <li>
              <Icon name='clock' size={14} />
              <span className='commit-detail-label'>Last modified</span>
              {renderDate(commit.date())}
            </li>
            {this.renderParents()}
          </ul>
          <h3 className='section-label'>
            {this.state.patchesLoaded ? `Files (${this.state.patches.length})` : 'Files'}
          </h3>
          <PatchList patches={this.state.patches}
            type={PatchType.Committed}
            selectedPatch={this.props.selectedPatch}
            onPatchSelect={this.handlePatchSelect} />
        </div>
      </div>
    );
  }
}
