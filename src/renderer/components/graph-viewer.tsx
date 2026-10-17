import * as React from 'react';
import { GraphCanvas, OFFSET_X } from './graph-canvas';
import { CommitList } from './commit-list';
import { Splitter } from './splitter';
import { ReferenceExplorer } from './reference-explorer';
import { FocusBar } from './focus-bar';
import { InputDialogHandler } from './input-dialog';
import { RepoWrapper, RepoState, Commit } from '../helpers/repo-wrapper';

export interface GraphViewerProps {
  repo: RepoWrapper;
  repoState: RepoState;
  selectedCommit: Commit | null;
  focus: string[];
  onCommitSelect: (commit: Commit) => void;
  onIndexSelect: () => void;
  onCreateBranch: (commit: Commit) => void;
  onOpenInputDialog: InputDialogHandler;
  onFocusChange: (focus: string[]) => Promise<void>;
  // Opens the summary of a branch, from the context menu of the explorer and of the badges
  onShowBranchSummary: (branch: string) => void;
  onOpenFocusDialog: () => void;
}

export class GraphViewer extends React.PureComponent<GraphViewerProps, {}> {
  referenceExplorer: React.RefObject<ReferenceExplorer | null>;
  div: React.RefObject<HTMLDivElement | null>;
  canvas: React.RefObject<GraphCanvas | null>;
  commitList: React.RefObject<CommitList | null>;
  focusBar: React.RefObject<FocusBar | null>;

  constructor(props: GraphViewerProps) {
    super(props);
    this.referenceExplorer = React.createRef();
    this.div = React.createRef();
    this.canvas = React.createRef();
    this.commitList = React.createRef();
    this.focusBar = React.createRef();
    this.handleCommitSelect = this.handleCommitSelect.bind(this);
    this.handleIndexSelect = this.handleIndexSelect.bind(this);
    this.handleListScroll = this.handleListScroll.bind(this);
    this.handleListResize = this.handleListResize.bind(this);
    this.handleListStateUpdate = this.handleListStateUpdate.bind(this);
    this.handleCanvasResize = this.handleCanvasResize.bind(this);
    this.handleLeftPanelResize = this.handleLeftPanelResize.bind(this);
  }

  // Selects a commit from outside the list, the list is scrolled to it
  async handleCommitSelect(commit: Commit) {
    await this.props.onCommitSelect(commit);
    // A stash is not in the list while the graph is focused
    const i = this.props.repo.shaToIndex.get(commit.sha());
    if (this.commitList.current && i !== undefined) {
      this.commitList.current.centerOnItem(i);
    }
  }

  async handleIndexSelect() {
    await this.props.onIndexSelect();
    if (this.commitList.current) {
      this.commitList.current.centerOnItem(-1);
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

  updateGraph() {
    if (this.commitList.current) {
      this.commitList.current.updateState();
      this.commitList.current.forceUpdate();
    }
    if (this.referenceExplorer.current) {
      this.referenceExplorer.current.forceUpdate();
    }
    // The relations of the focused branches change with them
    if (this.focusBar.current) {
      this.focusBar.current.forceUpdate();
    }
  }

  shrinkCanvas() {
    if (this.canvas.current) {
      const canvasWidth = this.props.repo.graph.width * OFFSET_X;
      // 32px is the min width of the graph canvas
      // 20px is the padding around the canvas
      // 98px is the width to display 4 branches
      this.setCanvasWidth(Math.max(32, Math.min(canvasWidth + 20, 98)));
    }
  }

  setCanvasWidth(width: number) {
    document.body.style.setProperty('--canvas-width', `${width}px`);
  }

  render() {
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
          {/* The list and the canvas fill the room under the focus bar */}
          <div className='graph-area'>
            <div className='commit-graph' ref={this.div}>
              <GraphCanvas repo={this.props.repo} ref={this.canvas} />
              <Splitter label='Resize the commit graph' onDrag={this.handleCanvasResize} />
              <CommitList {...this.props}
                onScroll={this.handleListScroll}
                onResize={this.handleListResize}
                onStateUpdate={this.handleListStateUpdate}
                ref={this.commitList} />
            </div>
          </div>
        </div>
      </div>
    );
  }
}