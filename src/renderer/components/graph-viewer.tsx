import * as React from 'react';
import { GraphCanvas, OFFSET_X } from './graph-canvas';
import { CanvasGraph } from './canvas-graph';
import { CommitList } from './commit-list';
import { Splitter } from './splitter';
import { ReferenceExplorer } from './reference-explorer';
import { FocusBar } from './focus-bar';
import { GraphHeader } from './graph-header';
import { InputDialogHandler } from './input-dialog';
import { RepoWrapper, RepoState, Commit } from '../helpers/repo-wrapper';
import { GraphFilters, GraphMode, GraphView, findMatches, parseCommitQuery } from '../helpers/graph-filters';

export interface GraphViewerProps {
  repo: RepoWrapper;
  repoState: RepoState;
  selectedCommit: Commit | null;
  focus: string[];
  graphView: GraphView;
  // Text of the highlight of commits
  highlight: string;
  onCommitSelect: (commit: Commit) => void;
  onIndexSelect: () => void;
  onCreateBranch: (commit: Commit) => void;
  onOpenInputDialog: InputDialogHandler;
  onFocusChange: (focus: string[]) => Promise<void>;
  onGraphViewChange: (view: GraphView) => void;
  onHighlightChange: (highlight: string) => void;
  // Opens the summary of a branch, from the context menu of the explorer and of the badges
  onShowBranchSummary: (branch: string) => void;
  onOpenFocusDialog: () => void;
}

export class GraphViewer extends React.PureComponent<GraphViewerProps, {}> {
  referenceExplorer: React.RefObject<ReferenceExplorer | null>;
  div: React.RefObject<HTMLDivElement | null>;
  canvas: React.RefObject<GraphCanvas | null>;
  canvasGraph: React.RefObject<CanvasGraph | null>;
  commitList: React.RefObject<CommitList | null>;
  focusBar: React.RefObject<FocusBar | null>;
  // Highlighted commits, computed again when the text or the commits change
  matches: Set<string> | null;
  matchesKey: [string, Commit[]] | null;

  constructor(props: GraphViewerProps) {
    super(props);
    this.referenceExplorer = React.createRef();
    this.div = React.createRef();
    this.canvas = React.createRef();
    this.canvasGraph = React.createRef();
    this.commitList = React.createRef();
    this.focusBar = React.createRef();
    this.matches = null;
    this.matchesKey = null;
    this.handleCommitSelect = this.handleCommitSelect.bind(this);
    this.handleIndexSelect = this.handleIndexSelect.bind(this);
    this.handleListScroll = this.handleListScroll.bind(this);
    this.handleListResize = this.handleListResize.bind(this);
    this.handleListStateUpdate = this.handleListStateUpdate.bind(this);
    this.handleCanvasResize = this.handleCanvasResize.bind(this);
    this.handleLeftPanelResize = this.handleLeftPanelResize.bind(this);
    this.handleModeChange = this.handleModeChange.bind(this);
    this.handleFiltersChange = this.handleFiltersChange.bind(this);
    this.handleMinimapToggle = this.handleMinimapToggle.bind(this);
    this.handleFindMatch = this.handleFindMatch.bind(this);
  }

  // Selects a commit from outside the list, the list is scrolled to it
  async handleCommitSelect(commit: Commit) {
    await this.props.onCommitSelect(commit);
    // A stash is not in the list while the graph is focused
    const i = this.props.repo.shaToIndex.get(commit.sha());
    if (this.commitList.current && i !== undefined) {
      this.commitList.current.centerOnItem(i);
    }
    if (this.canvasGraph.current) {
      this.canvasGraph.current.centerOnCommit(commit.sha());
    }
  }

  async handleIndexSelect() {
    await this.props.onIndexSelect();
    if (this.commitList.current) {
      this.commitList.current.centerOnItem(-1);
    }
    if (this.canvasGraph.current) {
      this.canvasGraph.current.centerOnIndex();
    }
  }

  handleListScroll(offset: number, start: number, end: number) {
    if (this.canvas.current) {
      this.canvas.current.handleScroll(offset, start, end);
    }
  }

  handleListResize(height: number, start: number, end: number) {
    if (this.canvas.current) {
      this.canvas.current.handleResize(height, start, end);
    }
  }

  handleListStateUpdate(start: number, end: number) {
    if (this.canvas.current) {
      this.canvas.current.handleRangeUpdate(start, end);
    }
  }

  handleCanvasResize(offset: number) {
    if (this.div.current) {
      const parentWidth = this.div.current.parentElement!.clientWidth;
      // 32px is the min width of the graph canvas
      // 100px is the min width of the commit list
      const newWidth = Math.max(32, Math.min(this.div.current.clientWidth + offset, parentWidth - 100));
      this.setCanvasWidth(newWidth);
    }
  }

  handleLeftPanelResize(offset: number) {
    if (this.referenceExplorer.current) {
      this.referenceExplorer.current.resize(offset);
    }
  }

  handleModeChange(mode: GraphMode) {
    this.props.onGraphViewChange({ ...this.props.graphView, mode });
  }

  handleFiltersChange(filters: GraphFilters) {
    this.props.onGraphViewChange({ ...this.props.graphView, filters });
  }

  handleMinimapToggle() {
    this.props.onGraphViewChange({ ...this.props.graphView, minimap: !this.props.graphView.minimap });
  }

  // The commits that match, from the top of the graph
  getMatches() {
    const commits = this.props.repo.commits;
    if (!this.matchesKey || this.matchesKey[0] !== this.props.highlight || this.matchesKey[1] !== commits) {
      this.matches = findMatches(commits, parseCommitQuery(this.props.highlight));
      this.matchesKey = [this.props.highlight, commits];
    }
    return this.matches;
  }

  // Selects the next match after the selected commit, or the previous one, and goes around
  handleFindMatch(forward: boolean) {
    const matches = this.getMatches();
    const commits = this.props.repo.commits;
    if (!matches || matches.size === 0) {
      return;
    }
    const selected = this.props.selectedCommit ? this.props.repo.shaToIndex.get(this.props.selectedCommit.sha()) : undefined;
    const from = selected !== undefined ? selected : (forward ? -1 : commits.length);
    for (let step = 1; step <= commits.length; ++step) {
      const i = ((from + (forward ? step : -step)) % commits.length + commits.length) % commits.length;
      if (matches.has(commits[i].sha())) {
        this.handleCommitSelect(commits[i]);
        return;
      }
    }
  }

  updateGraph() {
    // The highlight and the header follow the new commits
    this.forceUpdate();
    if (this.commitList.current) {
      this.commitList.current.updateState();
      this.commitList.current.forceUpdate();
    }
    if (this.canvasGraph.current) {
      this.canvasGraph.current.updateGraph();
    }
    if (this.referenceExplorer.current) {
      this.referenceExplorer.current.forceUpdate();
    }
    // The relations of the focused branches change with them
    if (this.focusBar.current) {
      this.focusBar.current.forceUpdate();
    }
  }

  // Returns false while the list is not shown, it can then be shrunk later
  shrinkCanvas() {
    if (this.canvas.current) {
      const canvasWidth = this.props.repo.graph.width * OFFSET_X;
      // 32px is the min width of the graph canvas
      // 20px is the padding around the canvas
      // 98px is the width to display 4 branches
      this.setCanvasWidth(Math.max(32, Math.min(canvasWidth + 20, 98)));
      return true;
    }
    return false;
  }

  setCanvasWidth(width: number) {
    document.body.style.setProperty('--canvas-width', `${width}px`);
  }

  renderList(matches: Set<string> | null) {
    return (
      <div className='commit-graph' ref={this.div}>
        <GraphCanvas repo={this.props.repo} matches={matches} ref={this.canvas} />
        <Splitter label='Resize the commit graph' onDrag={this.handleCanvasResize} />
        <CommitList repo={this.props.repo}
          repoState={this.props.repoState}
          selectedCommit={this.props.selectedCommit}
          focus={this.props.focus}
          matches={matches}
          onCommitSelect={this.props.onCommitSelect}
          onIndexSelect={this.props.onIndexSelect}
          onCreateBranch={this.props.onCreateBranch}
          onOpenInputDialog={this.props.onOpenInputDialog}
          onFocusChange={this.props.onFocusChange}
          onShowBranchSummary={this.props.onShowBranchSummary}
          onScroll={this.handleListScroll}
          onResize={this.handleListResize}
          onStateUpdate={this.handleListStateUpdate}
          ref={this.commitList} />
      </div>
    );
  }

  render() {
    const matches = this.getMatches();
    const view = this.props.graphView;
    return (
      <div className='graph-viewer'>
        <ReferenceExplorer repo={this.props.repo}
          focus={this.props.focus}
          onCommitSelect={this.handleCommitSelect}
          onIndexSelect={this.handleIndexSelect}
          onOpenInputDialog={this.props.onOpenInputDialog}
          onFocusChange={this.props.onFocusChange}
          onShowBranchSummary={this.props.onShowBranchSummary}
          ref={this.referenceExplorer} />
        <Splitter label='Resize the references panel' onDrag={this.handleLeftPanelResize} />
        <div className='graph-container'>
          {this.props.focus.length > 0 ?
            <FocusBar repo={this.props.repo}
              focus={this.props.focus}
              onFocusChange={this.props.onFocusChange}
              onEditFocus={this.props.onOpenFocusDialog}
              onCommitSelect={this.handleCommitSelect}
              ref={this.focusBar} /> : null}
          <GraphHeader mode={view.mode}
            filters={view.filters}
            focused={this.props.focus.length > 0}
            highlight={this.props.highlight}
            matchCount={matches ? matches.size : null}
            onModeChange={this.handleModeChange}
            onFiltersChange={this.handleFiltersChange}
            onHighlightChange={this.props.onHighlightChange}
            onFindMatch={this.handleFindMatch} />
          {/* The list and the canvas fill the room under the bars */}
          <div className='graph-area'>
            {view.mode === GraphMode.Canvas ?
              <CanvasGraph repo={this.props.repo}
                selectedCommit={this.props.selectedCommit}
                matches={matches}
                minimap={view.minimap}
                onMinimapToggle={this.handleMinimapToggle}
                onCommitSelect={this.props.onCommitSelect}
                onIndexSelect={this.props.onIndexSelect}
                onCreateBranch={this.props.onCreateBranch}
                onOpenInputDialog={this.props.onOpenInputDialog}
                ref={this.canvasGraph} /> :
              this.renderList(matches)}
          </div>
        </div>
      </div>
    );
  }
}
