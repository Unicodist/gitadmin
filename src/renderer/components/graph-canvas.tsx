import * as React from 'react';
import { RepoWrapper } from '../helpers/repo-wrapper';
import { getBranchColor, getCommitColor, EdgeType, NodeType } from '../helpers/commit-graph';

const RADIUS = 11;
export const OFFSET_X = 2 * RADIUS;
const OFFSET_Y = 28;
const LINE_WIDTH = 2;
const INNER_RADIUS = RADIUS - LINE_WIDTH / 2;
const DASH_LENGTH = 2 * Math.PI * INNER_RADIUS / 32;
// Holes in the nodes: a ring for the merge base and the fork points, a dot for the merges between focused references
const RING_RADIUS = 5.5;
const DOT_RADIUS = 3.5;

export interface GraphCanvasProps {
  repo: RepoWrapper;
}

export class GraphCanvas extends React.PureComponent<GraphCanvasProps, {}> {
  canvas: React.RefObject<HTMLCanvasElement | null>;
  offset: number;
  start: number;
  end: number;
  // Values of the CSS variables used by the colors, read once per drawing
  cssColors: Map<string, string>;

  constructor(props: GraphCanvasProps) {
    super(props);
    this.canvas = React.createRef<HTMLCanvasElement>();
    this.offset = 0;
    this.cssColors = new Map<string, string>();
  }

  handleScroll(offset: number, start: number, end: number) {
    this.offset = offset;
    this.handleRangeUpdate(start, end);
  }

  handleResize(height: number, start: number, end: number) {
    if (this.canvas.current) {
      const canvas = this.canvas.current;
      if (canvas.height != height) {
        canvas.height = height;
        this.handleRangeUpdate(start, end);
      }
    }
  }

  handleRangeUpdate(start: number , end: number) {
    this.start = start;
    this.end = end;
    this.drawGraph();
  }

  drawGraph() {
    if (this.canvas.current) {
      this.canvas.current.width = this.props.repo.graph.width * OFFSET_X;
      const ctx = this.canvas.current.getContext('2d');
      this.cssColors.clear();
      if (ctx) {
        this.drawIndexEdge(ctx);
        this.drawEdges(ctx);
        if (this.start === -1) {
          this.drawIndexNode(ctx);
        }
        this.drawNodes(ctx);
      }
    }
  }

  // Index

  drawIndexNode(ctx: CanvasRenderingContext2D) {
    // Set the style
    ctx.lineWidth = LINE_WIDTH;
    ctx.setLineDash([DASH_LENGTH]);
    ctx.strokeStyle = getBranchColor(0);

    // Draw the node
    const [x, y] = this.computeNodeCenterCoordinates(0, 0);
    ctx.beginPath();
    ctx.arc(x, y, INNER_RADIUS, 0, 2 * Math.PI, true);
    ctx.stroke();
  }

  drawIndexEdge(ctx: CanvasRenderingContext2D) {
    const repo = this.props.repo;
    const positions = repo.graph.positions;
    // Draw the edge between the index and the head commit, the focus can leave the head out of the graph
    if (repo.headCommit && repo.isHeadInGraph()) {
      const [x0, yIndex] = this.computeNodeCenterCoordinates(0, 0);
      const y0 = yIndex + RADIUS;
      const node = positions.get(repo.headCommit.sha())!;
      if (!node) {
        console.error('Unable to draw index edge: position of head is undefined.\n' +
          `Head's commit: ${repo.headCommit.sha()}.\n` +
          `Heads's branch: ${repo.head ? repo.head.name() : ''}`);
        return;
      }
      const [x1, y1] = this.computeNodeCenterCoordinates(node[0], node[1]);

      // Set the style
      ctx.lineWidth = LINE_WIDTH;
      ctx.setLineDash([DASH_LENGTH]);
      ctx.strokeStyle = getBranchColor(0);

      // Draw the edge
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    }
  }

  // Commits

  // Color of the commit of a row: the color of its lane, or of its focused reference
  getRowColor(i: number, j: number) {
    const repo = this.props.repo;
    // The commits can be reloaded before the graph, the row may not exist for a moment
    const commit = repo.commits[i - 1];
    if (!repo.focusLayout || !commit) {
      return getBranchColor(j);
    }
    return this.resolveColor(getCommitColor(repo, commit.sha()));
  }

  // The canvas does not understand var(--name), the colors of the theme are read from the page
  resolveColor(color: string) {
    const match = /^var\((--[\w-]+)\)$/.exec(color);
    if (!match || !this.canvas.current) {
      return color;
    }
    if (!this.cssColors.has(match[1])) {
      this.cssColors.set(match[1], getComputedStyle(this.canvas.current).getPropertyValue(match[1]).trim() || 'gray');
    }
    return this.cssColors.get(match[1])!;
  }

  drawNodes(ctx: CanvasRenderingContext2D) {
    const repo = this.props.repo;
    const relations = repo.relations;
    const merges = repo.focusLayout ? repo.focusLayout.merges : new Map<string, unknown>();
    // Draw only visible nodes
    for (const commit of repo.commits.slice(Math.max(this.start, 0), this.end)) {
      const sha = commit.sha();
      const [i, j, type] = repo.graph.positions.get(sha)!;
      const [x, y] = this.computeNodeCenterCoordinates(i, j);
      ctx.fillStyle = this.getRowColor(i, j);
      ctx.beginPath();
      if (type === NodeType.Commit) {
        ctx.arc(x, y, RADIUS, 0, 2 * Math.PI, true);
      } else {
        ctx.fillRect(x - RADIUS, y - RADIUS, 2 * RADIUS, 2 * RADIUS);
      }
      ctx.fill();
      // Relations between the focused references, they are also told by the badges of the rows
      let hole = 0;
      if (relations && (relations.mergeBase === sha || relations.forkPoints.some((forkPoint) => forkPoint.sha === sha))) {
        hole = RING_RADIUS;
      } else if (merges.has(sha)) {
        hole = DOT_RADIUS;
      }
      if (hole > 0) {
        ctx.fillStyle = this.resolveColor('var(--surface-1)');
        ctx.beginPath();
        ctx.arc(x, y, hole, 0, 2 * Math.PI, true);
        ctx.fill();
      }
    }
  }

  drawEdges(ctx: CanvasRenderingContext2D) {
    const repo = this.props.repo;
    const edges = repo.graph.edges;
    ctx.lineWidth = LINE_WIDTH;
    ctx.setLineDash([]);
    for (const [[i0, j0], [i1, j1], type] of edges.search(this.start, this.end)) {
      const [x0, y0] = this.computeNodeCenterCoordinates(i0, j0);
      const [x1, y1] = this.computeNodeCenterCoordinates(i1, j1);
      ctx.beginPath();
      if (j0 !== j1 && type === EdgeType.Merge) {
        ctx.strokeStyle = this.getRowColor(i1, j1);
      } else {
        ctx.strokeStyle = this.getRowColor(i0, j0);
      }
      ctx.moveTo(x0, y0);
      if (j0 !== j1) {
        if (type === EdgeType.Merge) {
          if (x0 < x1) {
            ctx.lineTo(x1 - RADIUS, y0);
            ctx.quadraticCurveTo(x1, y0, x1, y0 + RADIUS);
          } else {
            ctx.lineTo(x1 + RADIUS, y0);
            ctx.quadraticCurveTo(x1, y0, x1, y0 + RADIUS);
          }
        } else {
          if (x0 < x1) {
            ctx.lineTo(x0, y1 - RADIUS);
            ctx.quadraticCurveTo(x0, y1, x0 + RADIUS, y1);
          } else {
            ctx.lineTo(x0, y1 - RADIUS);
            ctx.quadraticCurveTo(x0, y1, x0 - RADIUS, y1);
          }
        }
      }
      ctx.lineTo(x1, y1);
      ctx.stroke();
    }
  }

  computeNodeCenterCoordinates(i: number, j: number) {
    return [j * OFFSET_X + RADIUS, 3 + i * OFFSET_Y + RADIUS - this.offset];
  }

  render() {
    return (
      <canvas ref={this.canvas} />
    );
  }
}