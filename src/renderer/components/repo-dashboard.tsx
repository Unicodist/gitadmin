import * as Path from 'path';
import * as fs from 'fs';
import * as chokidar from 'chokidar';
import * as React from 'react';
import { GraphViewer } from './graph-viewer';
import { CommitViewer } from './commit-viewer';
import { IndexViewer } from './index-viewer';
import { BranchSummaryViewer } from './branch-summary-viewer';
import { PatchViewer } from './patch-viewer';
import { TextPatchViewerOptions } from './text-patch-viewer';
import { Splitter } from './splitter';
import { Toolbar } from './toolbar';
import { LoadingScreen, LoadingState } from './loading-screen';
import { InputDialogHandler } from './input-dialog';
import { FocusDialogHandler } from './focus-dialog';
import { RepoWrapper, PatchType, RepoState, Commit, Patch } from '../helpers/repo-wrapper';
import { CancellablePromise, makeCancellable } from '../helpers/make-cancellable';
import { loadFocus, saveFocus } from '../helpers/branch-focus';
import { GraphView, areFiltersEqual, loadGraphView, saveGraphView } from '../helpers/graph-filters';
import { Changes, UpdateScheduler } from '../helpers/update-scheduler';

export interface RepoDashboardProps {
  repo: RepoWrapper;
  editorTheme: string;
  patchViewerOptions: TextPatchViewerOptions;
  onRepoClose: () => void;
  onCreateBranch: (commit: Commit) => void;
  onOpenInputDialog: InputDialogHandler;
  onOpenFocusDialog: FocusDialogHandler;
}

export interface RepoDashboardState {
  repoState: RepoState;
  loadingState: LoadingState;
  selectedCommit: Commit | null;
  selectedPatch: Patch | null;
  patchType: PatchType;
  // Full names of the references whose history the graph shows, everything when it is empty
  focus: string[];
  // List or canvas, filters and minimap of the graph
  graphView: GraphView;
  // Text of the highlight of commits, it is not saved
  highlight: string;
  // Full name of the branch whose summary is in the right panel, it takes the place of the commit or the index
  summaryBranch: string | null;
  // Branch whose summary the selected commit was opened from, the commit viewer can go back to it
  previousSummary: string | null;
}

export class RepoDashboard extends React.PureComponent<RepoDashboardProps, RepoDashboardState> {
  // Loading
  loadingPromise: CancellablePromise<void>;
  graphShrunk: boolean;
  // References
  graphViewer: React.RefObject<GraphViewer | null>;
  rightViewer: React.RefObject<CommitViewer | IndexViewer | BranchSummaryViewer | null>;
  // Watches
  repositoryWatcher: fs.FSWatcher;
  workingDirectoryWatcher: chokidar.FSWatcher;
  referencesWatcher: chokidar.FSWatcher;
  // Handles together the changes that the watchers see
  updates: UpdateScheduler;
  // Focus changes whose history is still loading, the last one wins
  focusChanges: number;
  // Same for the filters
  filterChanges: number;

  constructor(props: RepoDashboardProps) {
    super(props);
    this.graphShrunk = false;
    this.graphViewer = React.createRef();
    this.rightViewer = React.createRef();
    this.updates = new UpdateScheduler((changes) => this.handleUpdate(changes), () => this.props.repo.isBusy());
    this.focusChanges = 0;
    this.filterChanges = 0;
    this.handleCommitSelect = this.handleCommitSelect.bind(this);
    this.handleIndexSelect = this.handleIndexSelect.bind(this);
    this.handlePatchSelect = this.handlePatchSelect.bind(this);
    this.handlePatchUnselect = this.handlePatchUnselect.bind(this);
    this.handleRightPanelResize = this.handleRightPanelResize.bind(this);
    this.handleFocusChange = this.handleFocusChange.bind(this);
    this.handleGraphViewChange = this.handleGraphViewChange.bind(this);
    this.handleHighlightChange = this.handleHighlightChange.bind(this);
    this.openFocusDialog = this.openFocusDialog.bind(this);
    this.handleBranchSummaryShow = this.handleBranchSummaryShow.bind(this);
    this.handleBranchSummaryClose = this.handleBranchSummaryClose.bind(this);
    this.handleSummaryCommitSelect = this.handleSummaryCommitSelect.bind(this);
    this.handleBackToSummary = this.handleBackToSummary.bind(this);
    this.state = {
      repoState: this.props.repo.getState(),
      loadingState: LoadingState.NotLoading,
      selectedCommit: null,
      selectedPatch: null,
      patchType: PatchType.Committed,
      // The repository opens with the focus it had when it was closed
      focus: loadFocus(this.props.repo.workdir),
      graphView: loadGraphView(this.props.repo.workdir),
      highlight: '',
      summaryBranch: null,
      previousSummary: null
    };
  }

  async componentDidMount() {
    this.props.repo.focus = this.state.focus;
    this.props.repo.filters = this.state.graphView.filters;
    this.loadingPromise = makeCancellable(this.props.repo.init());
    try {
      await this.loadingPromise.promise;
      this.syncFocus();
      this.updateIndexViewer();
      this.setState({
        loadingState: LoadingState.Loaded
      });
      this.setWatchers();
    } catch (e) {
    }
  }

  componentDidUpdate() {
    // The list may not be shown yet, the canvas view does not use it
    if (!this.graphShrunk && this.graphViewer.current) {
      this.graphShrunk = this.graphViewer.current.shrinkCanvas();
    }
  }

  componentWillUnmount() {
    if (this.loadingPromise) {
      this.loadingPromise.cancel();
    }
    this.removeWatchers();
  }

  handleCommitSelect(commit: Commit) {
    return new Promise<void>((resolve) => {
      this.setState({
        selectedCommit: commit,
        summaryBranch: null,
        previousSummary: null
      }, () => resolve());
    });
  }

  handleIndexSelect() {
    return new Promise<void>((resolve) => {
      this.setState({
        selectedCommit: null,
        summaryBranch: null,
        previousSummary: null
      }, () => resolve());
    });
  }

  // Shows the summary of a branch in the right panel, the selection of the graph stays as it is
  handleBranchSummaryShow(branch: string) {
    this.setState({
      summaryBranch: branch,
      selectedPatch: null
    });
  }

  // Goes back to the selected commit, or to the index
  handleBranchSummaryClose() {
    this.setState({
      summaryBranch: null
    });
  }

  // A commit of the summary is selected in the graph, so that the list scrolls to it, the commit viewer can go back
  // to the summary
  async handleSummaryCommitSelect(commit: Commit) {
    const branch = this.state.summaryBranch;
    if (this.graphViewer.current) {
      await this.graphViewer.current.handleCommitSelect(commit);
    } else {
      await this.handleCommitSelect(commit);
    }
    this.setState({
      previousSummary: branch
    });
  }

  handleBackToSummary() {
    this.setState({
      summaryBranch: this.state.previousSummary,
      previousSummary: null,
      selectedPatch: null
    });
  }

  handlePatchSelect(patch: Patch | null, type: PatchType) {
    this.setState({
      selectedPatch: patch,
      patchType: type
    });
  }

  handlePatchUnselect() {
    this.setState({
      selectedPatch: null
    });
  }

  // Shows only the history of these references, or of everything if the list is empty
  async handleFocusChange(focus: string[]) {
    const repo = this.props.repo;
    // The checkboxes follow at once, so that the next change starts from this one, the graph follows once
    // the history is loaded
    const change = ++this.focusChanges;
    this.setState({
      focus: focus
    });
    // Saved at once so that closing the repository before the history is loaded keeps the choice,
    // the references that do not exist anymore are left out when it is opened again
    saveFocus(repo.workdir, focus);
    try {
      await repo.setFocus(focus);
    } finally {
      if (change === this.focusChanges) {
        this.focusChanges = 0;
      }
    }
    // A newer change is still loading
    if (this.focusChanges !== 0) {
      return;
    }
    // The references that do not exist anymore are left out
    saveFocus(repo.workdir, repo.focus);
    this.setState({
      focus: repo.focus
    });
    if (this.graphViewer.current) {
      this.graphViewer.current.updateGraph();
    }
    this.unselectRemovedCommit();
  }

  // Saves the view at once, the history is loaded again when the filters change
  async handleGraphViewChange(view: GraphView) {
    const repo = this.props.repo;
    const filtersChanged = !areFiltersEqual(view.filters, this.state.graphView.filters);
    this.setState({
      graphView: view
    });
    saveGraphView(repo.workdir, view);
    if (!filtersChanged) {
      return;
    }
    const change = ++this.filterChanges;
    try {
      await repo.setFilters(view.filters);
    } finally {
      if (change === this.filterChanges) {
        this.filterChanges = 0;
      }
    }
    // A newer change is still loading
    if (this.filterChanges !== 0) {
      return;
    }
    if (this.graphViewer.current) {
      this.graphViewer.current.updateGraph();
    }
    this.unselectRemovedCommit();
  }

  handleHighlightChange(highlight: string) {
    this.setState({
      highlight: highlight
    });
  }

  openFocusDialog() {
    this.props.onOpenFocusDialog([...this.props.repo.references.values()], this.state.focus, this.handleFocusChange);
  }

  // The repository changes the focus when a focused reference is removed or renamed
  syncFocus() {
    const repo = this.props.repo;
    // A focus that is still loading is not the one of the repository yet
    if (this.focusChanges === 0 && repo.focus !== this.state.focus) {
      saveFocus(repo.workdir, repo.focus);
      this.setState({
        focus: repo.focus
      });
    }
  }

  // If the selected commit is not in the graph anymore, switch to index. A stash stays selected,
  // the focus leaves the stashes out of the graph but they can still be shown.
  unselectRemovedCommit() {
    const repo = this.props.repo;
    const commit = this.state.selectedCommit;
    if (commit && !repo.shaToCommit.has(commit.sha()) && !repo.stashes.has(commit.sha())) {
      if (this.state.summaryBranch !== null) {
        // The summary stays in the right panel
        this.setState({
          selectedCommit: null
        });
      } else {
        this.handleIndexSelect();
      }
    }
  }

  handleRightPanelResize(offset: number) {
    if (this.rightViewer.current) {
      this.rightViewer.current.resize(offset);
    }
  }

  setWatchers() {
    const path = this.props.repo.path;
    // Watch index and head, the other files of the repository tell its state
    // fs.watch seems sufficient for that, I should try with chokidar
    this.repositoryWatcher = fs.watch(path, (_event, filename) => {
      if (filename === 'index') {
        this.updates.schedule(false, true);
      } else if (filename === 'packed-refs' || filename === 'HEAD') {
        this.updates.schedule(true, true);
      } else {
        this.updates.schedule(false, false);
      }
    });

    // Watch working directory
    const wdPath = this.props.repo.workdir;
    this.workingDirectoryWatcher = chokidar.watch(wdPath, {
      ignoreInitial: true,
      ignored: [/(.*\.git(\/.*|$))/, (path: string) => this.props.repo.isIgnored(Path.relative(wdPath, path))],
      followSymlinks: false,
    });
    this.workingDirectoryWatcher.on('all', (_event: string, path: string) => {
      if (path.endsWith('.gitignore')) {
        this.props.repo.updateIgnore();
      }
      this.updates.schedule(false, true);
    });

    // Watch references
    this.referencesWatcher = chokidar.watch(Path.join(path, 'refs'), {
      ignoreInitial: true,
      ignored: /.*\.lock$/,
      followSymlinks: false
    });
    this.referencesWatcher.on('all', () => {
      this.updates.schedule(true, true);
    });

    // The commands that change many references hold the updates until they finish
    this.props.repo.onIdle = () => this.updates.resume();
  }

  removeWatchers() {
    if (this.repositoryWatcher) {
      this.repositoryWatcher.close();
    }
    if (this.workingDirectoryWatcher) {
      this.workingDirectoryWatcher.close();
    }
    if (this.referencesWatcher) {
      this.referencesWatcher.close();
    }
    this.updates.stop();
    this.props.repo.onIdle = () => undefined;
  }

  async handleUpdate(changes: Changes) {
    this.handleStateUpdate();
    if (changes.references) {
      await this.handleReferencesUpdate();
    }
    if (changes.index) {
      await this.handleIndexUpdate();
    }
  }

  handleStateUpdate() {
    this.setState({
      repoState: this.props.repo.getState()
    });
  }

  async handleIndexUpdate() {
    await this.props.repo.updateIndex();
    this.updateIndexViewer();
  }

  // The head is read with the references, the lists are only drawn again when something moved
  async handleReferencesUpdate() {
    const changed = await this.props.repo.requestUpdateCommits();
    this.syncFocus();
    if (!changed) {
      return;
    }
    if (this.graphViewer.current) {
      this.graphViewer.current.updateGraph();
    }
    this.unselectRemovedCommit();
    this.updateBranchSummary();
  }

  // The summary closes when its branch is removed, it is loaded again when the branch or its source moved
  updateBranchSummary() {
    if (this.state.previousSummary !== null && !this.props.repo.references.has(this.state.previousSummary)) {
      this.setState({
        previousSummary: null
      });
    }
    const branch = this.state.summaryBranch;
    if (branch === null) {
      return;
    }
    if (!this.props.repo.references.has(branch)) {
      this.handleBranchSummaryClose();
    } else if (this.rightViewer.current instanceof BranchSummaryViewer) {
      this.rightViewer.current.refresh();
    }
  }

  updateIndexViewer() {
    // The summary of a branch may be in the right panel instead
    if (!this.state.selectedCommit && this.state.summaryBranch === null && this.rightViewer.current instanceof IndexViewer) {
      const indexViewer = this.rightViewer.current;
      indexViewer.forceUpdate();
      if (this.state.selectedPatch && this.state.patchType !== PatchType.Committed) {
        indexViewer.refreshSelectedPatch(this.state.patchType === PatchType.Unstaged);
      }
    }
  }

  render() {
    let leftViewer;
    if (this.state.selectedPatch) {
      leftViewer = <PatchViewer repo={this.props.repo}
        patch={this.state.selectedPatch!}
        patchType={this.state.patchType}
        editorTheme={this.props.editorTheme}
        options={this.props.patchViewerOptions}
        onClose={this.handlePatchUnselect} />;
    } else {
      if (this.state.loadingState !== LoadingState.Loaded) {
        leftViewer = <LoadingScreen state={this.state.loadingState} />;
      } else {
        leftViewer = <GraphViewer repo={this.props.repo}
          repoState={this.state.repoState}
          selectedCommit={this.state.selectedCommit}
          focus={this.state.focus}
          graphView={this.state.graphView}
          highlight={this.state.highlight}
          onGraphViewChange={this.handleGraphViewChange}
          onHighlightChange={this.handleHighlightChange}
          onCommitSelect={this.handleCommitSelect}
          onIndexSelect={this.handleIndexSelect}
          onCreateBranch={this.props.onCreateBranch}
          onOpenInputDialog={this.props.onOpenInputDialog}
          onFocusChange={this.handleFocusChange}
          onOpenFocusDialog={this.openFocusDialog}
          onShowBranchSummary={this.handleBranchSummaryShow}
          ref={this.graphViewer} />;
      }
    }
    let rightViewer;
    if (this.state.summaryBranch !== null) {
      // A new branch gets a new viewer, which loads its summary
      rightViewer = <BranchSummaryViewer repo={this.props.repo}
        branch={this.state.summaryBranch}
        selectedPatch={this.state.selectedPatch}
        onCommitSelect={this.handleSummaryCommitSelect}
        onPatchSelect={this.handlePatchSelect}
        onClose={this.handleBranchSummaryClose}
        key={this.state.summaryBranch}
        ref={this.rightViewer as React.RefObject<BranchSummaryViewer | null>} />;
    } else if (this.state.selectedCommit) {
      rightViewer = <CommitViewer repo={this.props.repo}
        commit={this.state.selectedCommit}
        selectedPatch={this.state.selectedPatch}
        onCommitSelect={this.handleCommitSelect}
        onPatchSelect={this.handlePatchSelect}
        onBackToSummary={this.state.previousSummary !== null ? this.handleBackToSummary : undefined}
        ref={this.rightViewer as React.RefObject<CommitViewer | null>} />;
    } else {
      rightViewer = <IndexViewer repo={this.props.repo}
        repoState={this.state.repoState}
        selectedPatch={this.state.selectedPatch}
        onPatchSelect={this.handlePatchSelect}
        ref={this.rightViewer as React.RefObject<IndexViewer | null>} />;
    }
    return (
      <div className='repo-dashboard'>
        <Toolbar repo={this.props.repo}
          selectedCommit={this.state.selectedCommit}
          onRepoClose={this.props.onRepoClose}
          onCreateBranch={this.props.onCreateBranch}
          onOpenFocusDialog={this.openFocusDialog} />
        <div className='repo-content'>
          {leftViewer}
          <Splitter label='Resize the right panel' onDrag={this.handleRightPanelResize} />
          {rightViewer}
        </div>
      </div>
    );
  }
}