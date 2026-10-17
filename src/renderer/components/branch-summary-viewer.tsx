import * as React from 'react';
import { PatchList } from './patch-list';
import { Icon } from './icon';
import { renderDate, setTooltipText } from './commit-viewer';
import { PatchType, RepoWrapper, shortenSha, Commit, Patch } from '../helpers/repo-wrapper';
import { CancellablePromise, makeCancellable } from '../helpers/make-cancellable';
import { copyToClipboard } from '../helpers/native';
import { shortenReferenceName } from '../helpers/branch-focus';
import {
  BranchSummary, FileChange, describeAheadBehind, describeTimeSpan, formatSummaryMarkdown, getMostChangedDirectories,
  getMostChangedFiles, getSourceChoices, loadSource, saveSource
} from '../helpers/branch-summary';
import {
  describeAutomaticSource, describeCommitCount, describeLineChanges, describeMergeCheck, describeMissingFork, getSummaryKey,
  resolveSavedSource
} from '../helpers/branch-summary-format';

export interface BranchSummaryViewerProps {
  repo: RepoWrapper;
  // Full name of the branch, refs/heads/feature
  branch: string;
  selectedPatch: Patch | null;
  // Selects the commit in the graph
  onCommitSelect: (commit: Commit) => void;
  onPatchSelect: (patch: Patch, type: PatchType) => void;
  onClose: () => void;
}

export interface BranchSummaryViewerState {
  summary: BranchSummary | null;
  // Source found by the detection, it names the automatic choice of the dropdown
  detected: string | null;
  // Source chosen in the dropdown, null when it is detected
  chosenSource: string | null;
  loading: boolean;
  error: string | null;
}

interface LoadedSummary {
  summary: BranchSummary;
  detected: string | null;
  // Commits of the branch and of the source when the summary was computed
  key: string;
}

function renderLineChanges(added: number, removed: number, binary = false) {
  if (binary) {
    return <span className='line-changes binary'>Binary</span>;
  }
  // The text is read as a whole, like "+12 -3"
  return (
    <span className='line-changes' title={describeLineChanges(added, removed)}>
      <span className='lines-added'>+{added}</span>{' '}
      <span className='lines-removed'>-{removed}</span>
    </span>
  );
}

// What happened on a branch since it was taken out of its source, in the right panel
export class BranchSummaryViewer extends React.PureComponent<BranchSummaryViewerProps, BranchSummaryViewerState> {
  div: React.RefObject<HTMLDivElement | null>;
  summaryPromise: CancellablePromise<LoadedSummary> | null;
  // Key of the loaded summary, null while it loads or after an error
  loadedKey: string | null;
  loading: boolean;
  // The references changed while the summary was loading
  refreshRequested: boolean;

  constructor(props: BranchSummaryViewerProps) {
    super(props);
    this.div = React.createRef<HTMLDivElement>();
    this.summaryPromise = null;
    this.loadedKey = null;
    this.loading = false;
    this.refreshRequested = false;
    this.state = {
      summary: null,
      detected: null,
      chosenSource: null,
      loading: true,
      error: null
    };
    this.handleSourceChange = this.handleSourceChange.bind(this);
    this.handleCopyHover = this.handleCopyHover.bind(this);
    this.handleCopyClick = this.handleCopyClick.bind(this);
    this.handlePatchSelect = this.handlePatchSelect.bind(this);
  }

  componentDidMount() {
    this.load();
  }

  componentWillUnmount() {
    if (this.summaryPromise) {
      this.summaryPromise.cancel();
    }
  }

  resize(offset: number) {
    if (this.div.current) {
      this.div.current.style.width = `${this.div.current.clientWidth - offset}px`;
    }
  }

  // Called when the references changed, the summary is loaded again if the branch or its source moved
  refresh() {
    if (this.loading) {
      this.refreshRequested = true;
      return;
    }
    const summary = this.state.summary;
    if (this.loadedKey === null || summary === null ||
      getSummaryKey(this.props.repo.references, this.props.branch, summary.source) !== this.loadedKey) {
      this.load();
    } else {
      // The choices of the dropdown follow the references
      this.forceUpdate();
    }
  }

  async computeSummary(chosen: string | null): Promise<LoadedSummary> {
    const repo = this.props.repo;
    const branch = this.props.branch;
    if (chosen === null) {
      const detected = await repo.detectSource(branch);
      const key = getSummaryKey(repo.references, branch, detected);
      return { summary: await repo.getBranchSummary(branch, detected), detected, key };
    }
    // The detected source still names the automatic choice
    const key = getSummaryKey(repo.references, branch, chosen);
    const [summary, detected] = await Promise.all([
      repo.getBranchSummary(branch, chosen),
      repo.detectSource(branch).catch(() => null)
    ]);
    return { summary, detected, key };
  }

  // A refresh keeps the current summary on screen until the new one is loaded, a new source clears it
  async load(clear = false) {
    if (this.summaryPromise) {
      this.summaryPromise.cancel();
    }
    const repo = this.props.repo;
    const chosen = resolveSavedSource(loadSource(repo.workdir, this.props.branch), repo.references);
    this.loading = true;
    this.refreshRequested = false;
    this.loadedKey = null;
    this.setState((state) => ({
      summary: clear ? null : state.summary,
      chosenSource: chosen,
      loading: true,
      error: null
    }));
    const promise = makeCancellable(this.computeSummary(chosen));
    this.summaryPromise = promise;
    try {
      const loaded = await promise.promise;
      this.loadedKey = loaded.key;
      this.setState({
        summary: loaded.summary,
        detected: loaded.detected,
        loading: false
      });
    } catch (e: any) {
      if (e && e.isCanceled) {
        return;
      }
      this.setState({
        summary: null,
        loading: false,
        error: e instanceof Error ? e.message : String(e)
      });
    }
    this.loading = false;
    this.summaryPromise = null;
    if (this.refreshRequested) {
      this.refresh();
    }
  }

  handleSourceChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const value = event.currentTarget.value;
    saveSource(this.props.repo.workdir, this.props.branch, value !== '' ? value : null);
    this.load(true);
  }

  handleCopyHover(event: React.SyntheticEvent<HTMLButtonElement>) {
    setTooltipText(event.currentTarget, 'Copy for a pull request');
  }

  handleCopyClick(event: React.MouseEvent<HTMLButtonElement>) {
    const button = event.currentTarget;
    if (this.state.summary) {
      copyToClipboard(formatSummaryMarkdown(this.state.summary)).then(() => setTooltipText(button, 'Copied'));
    }
  }

  handlePatchSelect(patch: Patch) {
    this.props.onPatchSelect(patch, PatchType.Committed);
  }

  // The commits of the summary are read again from git, the graph has its own objects
  selectCommit(commit: Commit) {
    this.props.onCommitSelect(this.props.repo.shaToCommit.get(commit.sha()) || commit);
  }

  createCommitButton(commit: Commit, label: string) {
    const shortSha = shortenSha(commit.sha());
    return (
      <button type='button'
        className='sha-chip tooltip-bottom'
        aria-label={`${label} ${shortSha}`}
        onClick={() => this.selectCommit(commit)}>
        <span className='mono'>{shortSha}</span>
        <span className='tooltip-text' aria-hidden='true'>Select</span>
      </button>
    );
  }

  renderSourceSelect() {
    const repo = this.props.repo;
    const choices = getSourceChoices(repo.references.keys(), this.props.branch);
    return (
      <label className='branch-summary-source'>
        <span className='commit-detail-label'>Source</span>
        <span className='select'>
          <select aria-label='Source branch' value={this.state.chosenSource || ''} onChange={this.handleSourceChange}>
            <option value=''>{describeAutomaticSource(this.state.detected)}</option>
            {choices.map((name) => <option value={name} key={name}>{shortenReferenceName(name)}</option>)}
          </select>
          <Icon name='chevron-down' size={14} />
        </span>
      </label>
    );
  }

  renderForkDescription(summary: BranchSummary) {
    if (summary.source !== null && summary.forkPoint !== null) {
      return <p className='branch-summary-fork'>Forked from <strong>{shortenReferenceName(summary.source)}</strong></p>;
    }
    return <p className='branch-summary-fork missing-fork'>{describeMissingFork(summary.source)}</p>;
  }

  renderForkDetails(summary: BranchSummary) {
    const forkPoint = summary.forkPoint;
    const syncCommit = forkPoint !== null && summary.base !== null && summary.base !== forkPoint.sha() ?
      this.props.repo.shaToCommit.get(summary.base) : undefined;
    return (
      <ul className='commit-details' aria-label='Fork'>
        {forkPoint !== null ?
          <li>
            <Icon name='git-fork' size={14} />
            <span className='commit-detail-label'>Fork commit</span>
            <span className='commit-parents'>{this.createCommitButton(forkPoint, 'Select fork commit')}</span>
          </li> : null}
        {forkPoint !== null ?
          <li>
            <Icon name='calendar' size={14} />
            <span className='commit-detail-label'>Forked</span>
            {renderDate(forkPoint.date())}
          </li> : null}
        {summary.base !== null && forkPoint !== null && summary.base !== forkPoint.sha() ?
          <li>
            <Icon name='git-merge' size={14} />
            <span className='commit-detail-label'>Last synced at</span>
            {syncCommit ?
              <span className='commit-parents'>{this.createCommitButton(syncCommit, 'Select last synced commit')}</span> :
              <span className='mono'>{shortenSha(summary.base)}</span>}
          </li> : null}
        {summary.source !== null ?
          <li>
            <Icon name='git-branch' size={14} />
            <span className='commit-detail-label'>Compared</span>
            <span className='ahead-behind'>{describeAheadBehind(summary.ahead, summary.behind)}</span>
          </li> : null}
      </ul>
    );
  }

  renderStats(summary: BranchSummary) {
    return (
      <React.Fragment>
        <h3 className='section-label'>Overview</h3>
        <ul className='commit-details' aria-label='Statistics'>
          <li>
            <Icon name='git-commit-horizontal' size={14} />
            <span className='commit-detail-label'>Commits</span>
            <span className='stat-value' data-stat='commits'>{summary.commits.length}</span>
          </li>
          <li>
            <Icon name='clock' size={14} />
            <span className='commit-detail-label'>Time span</span>
            <span className='stat-value'>{describeTimeSpan(summary.firstDate, summary.lastDate)}</span>
          </li>
          <li>
            <Icon name='file-pen' size={14} />
            <span className='commit-detail-label'>Files changed</span>
            <span className='stat-value' data-stat='files'>{summary.changes.length}</span>
          </li>
          <li>
            <Icon name='code' size={14} />
            <span className='commit-detail-label'>Lines</span>
            {renderLineChanges(summary.added, summary.removed)}
          </li>
          <li>
            <Icon name='user' size={14} />
            <span className='commit-detail-label'>Authors</span>
            <span className='stat-value'>{summary.authors.length}</span>
          </li>
        </ul>
        {summary.authors.length > 0 ?
          <ul className='branch-summary-authors' aria-label='Authors'>
            {summary.authors.map((author) => (
              <li key={`${author.name} ${author.email}`} title={author.email}>
                <span className='author-name'>{author.name}</span>{' '}
                <span className='author-commits'>{describeCommitCount(author.commits)}</span>
              </li>
            ))}
          </ul> : null}
      </React.Fragment>
    );
  }

  renderMergeCheck(summary: BranchSummary) {
    const check = summary.mergeCheck;
    if (check === null || summary.source === null) {
      return null;
    }
    return (
      <React.Fragment>
        <h3 className='section-label'>Merge check</h3>
        <div className={check.clean ? 'merge-check clean' : 'merge-check conflicts'} role='status'>
          <Icon name={check.clean ? 'circle-check' : 'git-merge-conflict'} size={14} />
          <span>{describeMergeCheck(check, summary.source)}</span>
        </div>
        {!check.clean ?
          <ul className='conflicting-files' aria-label='Conflicting files'>
            {check.conflicts.map((path) => <li className='mono' key={path}>{path}</li>)}
          </ul> : null}
      </React.Fragment>
    );
  }

  renderCommits(summary: BranchSummary) {
    return (
      <React.Fragment>
        <h3 className='section-label'>{`Commits (${summary.commits.length})`}</h3>
        {summary.commits.length > 0 ?
          <ul className='branch-summary-commits' aria-label='Branch commits'>
            {summary.commits.map(({ commit, syncedWithSource }) => (
              <li key={commit.sha()}>
                <button type='button'
                  className='ghost-button branch-summary-commit'
                  title={`${commit.summary()}\n${commit.author().name}`}
                  onClick={() => this.selectCommit(commit)}>
                  <span className='mono commit-sha'>{shortenSha(commit.sha())}</span>{' '}
                  <span className='commit-summary'>{commit.summary()}</span>
                  {syncedWithSource ? <React.Fragment> <span className='synced-badge'>Synced with source</span></React.Fragment> : null}
                </button>
              </li>
            ))}
          </ul> :
          <p className='branch-summary-empty'>No commits since the fork</p>}
      </React.Fragment>
    );
  }

  renderMostChanged(summary: BranchSummary) {
    if (summary.changes.length === 0) {
      return null;
    }
    const patches = new Map<string, Patch>();
    summary.changes.forEach((change, i) => patches.set(change.path, summary.patches[i]));
    const renderChange = (change: FileChange, patch?: Patch) => {
      const content = (
        <React.Fragment>
          <span className='mono changed-path'>{change.path}</span>{' '}
          {renderLineChanges(change.added, change.removed, change.binary)}
        </React.Fragment>
      );
      return (
        <li key={change.path}>
          {patch ?
            <button type='button' className='ghost-button most-changed-item' onClick={() => this.handlePatchSelect(patch)}>{content}</button> :
            <span className='most-changed-item'>{content}</span>}
        </li>
      );
    };
    return (
      <React.Fragment>
        <h3 className='section-label'>Most changed files</h3>
        <ul className='most-changed' aria-label='Most changed files'>
          {getMostChangedFiles(summary.changes).map((change) => renderChange(change, patches.get(change.path)))}
        </ul>
        <h3 className='section-label'>Most changed directories</h3>
        <ul className='most-changed' aria-label='Most changed directories'>
          {getMostChangedDirectories(summary.changes).map((change) => renderChange(change))}
        </ul>
      </React.Fragment>
    );
  }

  renderSummary(summary: BranchSummary) {
    // Without a fork point, there is nothing to tell
    if (summary.forkPoint === null) {
      return null;
    }
    return (
      <React.Fragment>
        {this.renderStats(summary)}
        {this.renderMergeCheck(summary)}
        {this.renderCommits(summary)}
        {this.renderMostChanged(summary)}
        <h3 className='section-label'>{`Files (${summary.patches.length})`}</h3>
        <PatchList patches={summary.patches}
          type={PatchType.Committed}
          selectedPatch={this.props.selectedPatch}
          onPatchSelect={this.handlePatchSelect} />
      </React.Fragment>
    );
  }

  renderContent() {
    if (this.state.summary !== null) {
      return this.renderSummary(this.state.summary);
    } else if (this.state.loading) {
      return (
        <div className='branch-summary-status' role='status'>
          <div className='spinner' />
          <span>Loading the summary</span>
        </div>
      );
    } else if (this.state.error !== null) {
      return (
        <div className='branch-summary-status error' role='alert'>
          <Icon name='circle-alert' size={16} />
          <span>Unable to load the summary: {this.state.error}</span>
        </div>
      );
    }
    return null;
  }

  render() {
    const summary = this.state.summary;
    return (
      <div className='commit-viewer branch-summary-viewer' ref={this.div}>
        <div className='viewer-header'>
          <span className='viewer-title'>Branch summary</span>
          <span className='viewer-actions'>
            <button type='button'
              className='ghost-button small-button copy-markdown-button tooltip-bottom'
              aria-label='Copy as Markdown'
              disabled={summary === null}
              onMouseEnter={this.handleCopyHover}
              onFocus={this.handleCopyHover}
              onClick={this.handleCopyClick}>
              <Icon name='copy' size={14} />
              <span aria-hidden='true'>Markdown</span>
              <span className='tooltip-text' aria-hidden='true'>Copy for a pull request</span>
            </button>
            <button type='button'
              className='ghost-button small-button icon-button'
              aria-label='Close the summary'
              title='Close the summary'
              onClick={this.props.onClose}>
              <Icon name='x' size={14} />
            </button>
          </span>
        </div>
        <div className='viewer-body'>
          <div className='commit-message branch-summary-header'>
            <h2>{shortenReferenceName(this.props.branch)}</h2>
            {summary ? this.renderForkDescription(summary) : null}
            {this.renderSourceSelect()}
          </div>
          {summary ? this.renderForkDetails(summary) : null}
          {this.renderContent()}
        </div>
      </div>
    );
  }
}
