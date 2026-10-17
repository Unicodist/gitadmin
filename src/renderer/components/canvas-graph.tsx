import * as React from 'react';
import { InputDialogHandler } from './input-dialog';
import { Icon } from './icon';
import { RepoWrapper, Commit, shortenSha } from '../helpers/repo-wrapper';
import { EdgeType, NodeType, getCommitColor } from '../helpers/commit-graph';
import {
  LANE_WIDTH, LaneLabel, ROW_HEIGHT, computeBranchKeys, computeLaneLabels, getInitials, getKeyColor, getLaneX, getPinnedLabels,
  getRowY
} from '../helpers/canvas-layout';
import {
  Bounds, Viewport, ZOOM_STEP, centerOn, clampViewport, fitBounds, getVisibleRows, getWheelZoom, isVisible, panBy, toScreen,
  toWorld, zoomAt
} from '../helpers/viewport';
import { createCommitContextMenu } from '../helpers/commit-context-menu';
import { createStashContextMenu } from '../helpers/stash-context-menu';
import { formatCommitDate } from '../helpers/viewer-format';

const RADIUS = 10;
const LINE_WIDTH = 2;
// The summaries start after the lanes
const TEXT_GAP = 16;
// Room given to the summaries in the bounds of the graph, they are not measured
const TEXT_WIDTH = 640;
const PADDING = 24;
// Pixels of the graph that stay in the canvas when it is moved away
const KEEP_IN_SIGHT = 80;
// The text and the initials are only drawn when they are big enough to read
const TEXT_MIN_ZOOM = 0.45;
const INITIALS_MIN_ZOOM = 0.6;
// Moves of the pointer below this distance are clicks
const DRAG_THRESHOLD = 4;
const KEY_PAN = 60;
const MINIMAP_WIDTH = 132;
const MINIMAP_MAX_HEIGHT = 200;
// Opacity of the commits that do not match the highlight
const DIMMED_ALPHA = 0.22;

const CSS_COLORS = ['surface-0', 'surface-1', 'surface-2', 'text-primary', 'text-muted', 'text-on-accent', 'selected', 'hover',
  'border', 'accent', 'shadow-sm'] as const;
type CssColor = typeof CSS_COLORS[number];

export interface CanvasGraphProps {
  repo: RepoWrapper;
  selectedCommit: Commit | null;
  // Commits that match the highlight, null when nothing is highlighted
  matches: Set<string> | null;
  minimap: boolean;
  onMinimapToggle: () => void;
  onCommitSelect: (commit: Commit) => void;
  onIndexSelect: () => void;
  onCreateBranch: (commit: Commit) => void;
  onOpenInputDialog: InputDialogHandler;
}

interface HoverCard {
  // Row of the commit, 0 for the index
  row: number;
  x: number;
  y: number;
}

export interface CanvasGraphState {
  hover: HoverCard | null;
  // Rounded zoom, in percent, for the controls
  zoom: number;
  dragging: boolean;
}

interface PointerGesture {
  id: number;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  moved: boolean;
}

// The graph on a canvas that can be moved and zoomed: drag or scroll to move it, pinch or Ctrl and the wheel to zoom,
// and the keyboard. Only the visible rows are drawn. A click opens a commit, a right click shows its menu.
export class CanvasGraph extends React.PureComponent<CanvasGraphProps, CanvasGraphState> {
  container: React.RefObject<HTMLDivElement | null>;
  canvas: React.RefObject<HTMLCanvasElement | null>;
  minimapCanvas: React.RefObject<HTMLCanvasElement | null>;
  viewport: Viewport;
  width: number;
  height: number;
  // Computed when the history changes
  keys: Map<string, string>;
  labels: LaneLabel[];
  initials: Map<string, string>;
  bounds: Bounds;
  textX: number;
  // Image of the whole history, drawn again when it or the theme changes
  minimapImage: HTMLCanvasElement | null;
  minimapScale: [number, number];
  // Highlight when the image was drawn
  minimapMatches: Set<string> | null;
  colors: Map<string, string>;
  fontFamily: string;
  frame: number | null;
  gesture: PointerGesture | null;
  minimapPointer: number | null;
  resizeObserver: ResizeObserver;
  themeObserver: MutationObserver;

  constructor(props: CanvasGraphProps) {
    super(props);
    this.container = React.createRef();
    this.canvas = React.createRef();
    this.minimapCanvas = React.createRef();
    this.viewport = { x: -PADDING, y: 0, zoom: 1 };
    this.width = 0;
    this.height = 0;
    this.keys = new Map();
    this.labels = [];
    this.initials = new Map();
    this.bounds = { x: 0, y: 0, width: 1, height: 1 };
    this.textX = 0;
    this.minimapImage = null;
    this.minimapScale = [1, 1];
    this.minimapMatches = null;
    this.colors = new Map();
    this.fontFamily = 'sans-serif';
    this.frame = null;
    this.gesture = null;
    this.minimapPointer = null;
    this.state = {
      hover: null,
      zoom: 100,
      dragging: false
    };
    this.draw = this.draw.bind(this);
    this.handleResize = this.handleResize.bind(this);
    this.handleThemeChange = this.handleThemeChange.bind(this);
    this.handleWheel = this.handleWheel.bind(this);
    this.handlePointerDown = this.handlePointerDown.bind(this);
    this.handlePointerMove = this.handlePointerMove.bind(this);
    this.handlePointerUp = this.handlePointerUp.bind(this);
    this.handlePointerLeave = this.handlePointerLeave.bind(this);
    this.handleContextMenu = this.handleContextMenu.bind(this);
    this.handleKeyDown = this.handleKeyDown.bind(this);
    this.handleMinimapPointerDown = this.handleMinimapPointerDown.bind(this);
    this.handleMinimapPointerMove = this.handleMinimapPointerMove.bind(this);
    this.handleMinimapPointerUp = this.handleMinimapPointerUp.bind(this);
    this.zoomIn = this.zoomIn.bind(this);
    this.zoomOut = this.zoomOut.bind(this);
    this.fitToView = this.fitToView.bind(this);
    this.jumpToHead = this.jumpToHead.bind(this);
  }

  componentDidMount() {
    this.updateModel();
    const container = this.container.current!;
    this.resizeObserver = new ResizeObserver(this.handleResize);
    this.resizeObserver.observe(container);
    // The wheel must not scroll the page, React listens to it passively
    this.canvas.current!.addEventListener('wheel', this.handleWheel, { passive: false });
    // The theme sets its colors on the root element
    this.themeObserver = new MutationObserver(this.handleThemeChange);
    this.themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'data-scheme'] });
    this.handleResize();
    if (this.props.selectedCommit) {
      this.centerOnCommit(this.props.selectedCommit.sha());
    }
  }

  componentDidUpdate(prevProps: CanvasGraphProps) {
    if (prevProps.selectedCommit !== this.props.selectedCommit) {
      this.revealSelection();
    }
    if (prevProps.minimap !== this.props.minimap || prevProps.matches !== this.props.matches) {
      this.scheduleDraw();
    }
  }

  componentWillUnmount() {
    this.resizeObserver.disconnect();
    this.themeObserver.disconnect();
    if (this.canvas.current) {
      this.canvas.current.removeEventListener('wheel', this.handleWheel);
    }
    if (this.frame !== null) {
      cancelAnimationFrame(this.frame);
    }
  }

  // The history changed: the branches, the labels and the minimap are computed again
  updateGraph() {
    this.updateModel();
    this.setViewport(this.viewport);
    if (this.state.hover && this.state.hover.row > this.props.repo.commits.length) {
      this.setState({ hover: null });
    }
  }

  updateModel() {
    const repo = this.props.repo;
    this.keys = computeBranchKeys({
      commits: repo.commits,
      parents: repo.parents,
      children: repo.children,
      references: repo.references.values(),
      headName: repo.head ? repo.head.name() : null,
      stashes: repo.stashes
    });
    this.labels = computeLaneLabels(repo.graph.positions, repo.parents,
      [...repo.references.values()].filter((reference) => repo.isBadgeShown(reference)));
    this.textX = Math.max(1, repo.graph.width) * LANE_WIDTH + TEXT_GAP;
    this.bounds = { x: 0, y: 0, width: this.textX + TEXT_WIDTH, height: (repo.commits.length + 1) * ROW_HEIGHT };
    this.minimapImage = null;
  }

  // Drawing

  scheduleDraw() {
    if (this.frame === null) {
      this.frame = requestAnimationFrame(this.draw);
    }
  }

  readColors() {
    const style = getComputedStyle(this.container.current!);
    this.colors.clear();
    for (const name of CSS_COLORS) {
      this.colors.set(name, style.getPropertyValue(`--${name}`).trim() || 'gray');
    }
    this.fontFamily = style.fontFamily || 'sans-serif';
  }

  color(name: CssColor) {
    return this.colors.get(name)!;
  }

  // The colors of the focused branches while several are focused, else the color of the branch
  getColor(sha: string) {
    const repo = this.props.repo;
    if (repo.focusLayout && repo.focusLayout.owners.has(sha)) {
      const color = getCommitColor(repo, sha);
      return color.startsWith('var(') ? this.color('text-muted') : color;
    }
    return getKeyColor(this.keys.get(sha) || sha);
  }

  getRowCommit(row: number) {
    return row >= 1 ? this.props.repo.commits[row - 1] : undefined;
  }

  isDimmed(sha: string) {
    return this.props.matches !== null && !this.props.matches.has(sha);
  }

  draw() {
    this.frame = null;
    const canvas = this.canvas.current;
    const ctx = canvas ? canvas.getContext('2d') : null;
    if (!canvas || !ctx || this.width === 0 || this.height === 0) {
      return;
    }
    this.readColors();
    const ratio = window.devicePixelRatio || 1;
    const width = Math.round(this.width * ratio);
    const height = Math.round(this.height * ratio);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.fillStyle = this.color('surface-1');
    ctx.fillRect(0, 0, this.width, this.height);
    const repo = this.props.repo;
    const viewport = this.viewport;
    const [start, end] = getVisibleRows(viewport, this.height, ROW_HEIGHT, repo.commits.length + 1);
    ctx.save();
    ctx.scale(viewport.zoom, viewport.zoom);
    ctx.translate(-viewport.x, -viewport.y);
    this.drawRowBackgrounds(ctx, start, end);
    this.drawEdges(ctx, start, end);
    this.drawNodes(ctx, start, end);
    if (viewport.zoom >= TEXT_MIN_ZOOM) {
      this.drawTexts(ctx, start, end);
    }
    ctx.restore();
    this.drawPinnedLabels(ctx, start);
    if (this.props.minimap) {
      this.drawMinimap();
    }
    const zoom = Math.round(viewport.zoom * 100);
    if (zoom !== this.state.zoom) {
      this.setState({ zoom });
    }
  }

  // The selected row and the hovered row span the canvas, like the rows of the list
  drawRowBackgrounds(ctx: CanvasRenderingContext2D, start: number, end: number) {
    const selectedRow = this.getSelectedRow();
    const left = this.viewport.x;
    const width = this.width / this.viewport.zoom;
    const hoverRow = this.state.hover && !this.state.dragging ? this.state.hover.row : -1;
    for (const [row, color] of [[hoverRow, 'hover'], [selectedRow, 'selected']] as [number, CssColor][]) {
      if (row >= start && row < end) {
        ctx.fillStyle = this.color(color);
        ctx.fillRect(left, row * ROW_HEIGHT, width, ROW_HEIGHT);
      }
    }
  }

  drawEdges(ctx: CanvasRenderingContext2D, start: number, end: number) {
    const repo = this.props.repo;
    // At least a pixel wide when the graph is zoomed out
    ctx.lineWidth = Math.max(LINE_WIDTH, 1 / this.viewport.zoom);
    ctx.lineCap = 'round';
    // The edge of the index goes down to the head commit
    const head = repo.isHeadInGraph() ? repo.graph.positions.get(repo.headCommit!.sha()) : undefined;
    if (head && start <= head[0]) {
      const [i, j] = head;
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = this.getColor(repo.headCommit!.sha());
      this.strokeEdge(ctx, 0, 0, i, j, EdgeType.Normal);
      ctx.setLineDash([]);
    }
    for (const [[i0, j0], [i1, j1], type] of repo.graph.edges.search(start, end)) {
      const child = this.getRowCommit(i0);
      const parent = this.getRowCommit(i1);
      if (!child || !parent) {
        continue;
      }
      // A merge takes the color of the branch it brings, a fork the color of the new branch
      ctx.strokeStyle = this.getColor(type === EdgeType.Merge && j0 !== j1 ? parent.sha() : child.sha());
      ctx.globalAlpha = this.isDimmed(child.sha()) && this.isDimmed(parent.sha()) ? DIMMED_ALPHA : 1;
      this.strokeEdge(ctx, i0, j0, i1, j1, type);
    }
    ctx.globalAlpha = 1;
  }

  // Straight in a lane, with a smooth curve where the line changes lanes: next to the merge, or next to the fork
  strokeEdge(ctx: CanvasRenderingContext2D, i0: number, j0: number, i1: number, j1: number, type: EdgeType) {
    const x0 = getLaneX(j0);
    const y0 = getRowY(i0);
    const x1 = getLaneX(j1);
    const y1 = getRowY(i1);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    if (j0 !== j1) {
      if (type === EdgeType.Merge) {
        const yCurve = Math.min(y1, y0 + ROW_HEIGHT);
        ctx.bezierCurveTo(x0, y0 + ROW_HEIGHT * 0.5, x1, yCurve - ROW_HEIGHT * 0.5, x1, yCurve);
      } else {
        const yCurve = Math.max(y0, y1 - ROW_HEIGHT);
        ctx.lineTo(x0, yCurve);
        ctx.bezierCurveTo(x0, yCurve + ROW_HEIGHT * 0.5, x1, y1 - ROW_HEIGHT * 0.5, x1, y1);
      }
    }
    ctx.lineTo(x1, y1);
    ctx.stroke();
  }

  drawNodes(ctx: CanvasRenderingContext2D, start: number, end: number) {
    const repo = this.props.repo;
    const zoom = this.viewport.zoom;
    const relations = repo.relations;
    const merges = repo.focusLayout ? repo.focusLayout.merges : null;
    const selectedRow = this.getSelectedRow();
    if (start === 0) {
      // The index, dashed like its edge
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = repo.headCommit && repo.isHeadInGraph() ? this.getColor(repo.headCommit.sha()) : this.color('text-muted');
      ctx.fillStyle = this.color('surface-1');
      ctx.beginPath();
      ctx.arc(getLaneX(0), getRowY(0), RADIUS - LINE_WIDTH / 2, 0, 2 * Math.PI);
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);
    }
    const showInitials = zoom >= INITIALS_MIN_ZOOM;
    // The nodes stay visible when the graph is zoomed out
    const radius = Math.max(RADIUS, 1.5 / zoom);
    if (showInitials) {
      ctx.font = `600 9px ${this.fontFamily}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
    }
    for (let row = Math.max(1, start); row < end; ++row) {
      const commit = this.getRowCommit(row);
      const position = commit ? repo.graph.positions.get(commit.sha()) : undefined;
      if (!commit || !position) {
        continue;
      }
      const sha = commit.sha();
      const [i, j, type] = position;
      const x = getLaneX(j);
      const y = getRowY(i);
      const color = this.getColor(sha);
      ctx.globalAlpha = this.isDimmed(sha) ? DIMMED_ALPHA : 1;
      if (row === selectedRow) {
        ctx.strokeStyle = this.color('accent');
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, RADIUS + 3.5, 0, 2 * Math.PI);
        ctx.stroke();
      }
      ctx.fillStyle = color;
      ctx.beginPath();
      if (type === NodeType.Stash) {
        ctx.roundRect(x - radius, y - radius, 2 * radius, 2 * radius, 4);
      } else {
        ctx.arc(x, y, radius, 0, 2 * Math.PI);
      }
      ctx.fill();
      // The merge base and the fork points of the focused branches get a ring, their merges a dot
      const isRelation = relations !== null &&
        (relations.mergeBase === sha || relations.forkPoints.some((forkPoint) => forkPoint.sha === sha));
      if (isRelation || (merges !== null && merges.has(sha))) {
        ctx.fillStyle = this.color('surface-1');
        ctx.beginPath();
        ctx.arc(x, y, isRelation ? 5.5 : 3.5, 0, 2 * Math.PI);
        ctx.fill();
      } else if (showInitials) {
        ctx.fillStyle = '#ffffff';
        ctx.fillText(type === NodeType.Stash ? 'S' : this.getInitials(commit), x, y + 0.5);
      }
    }
    ctx.globalAlpha = 1;
  }

  getInitials(commit: Commit) {
    const name = commit.author().name;
    if (!this.initials.has(name)) {
      this.initials.set(name, getInitials(name));
    }
    return this.initials.get(name)!;
  }

  // The badges of the references, then the summary and the author, after the lanes
  drawTexts(ctx: CanvasRenderingContext2D, start: number, end: number) {
    const repo = this.props.repo;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    if (start === 0) {
      ctx.font = `500 13px ${this.fontFamily}`;
      ctx.fillStyle = this.color('text-muted');
      ctx.fillText('Index', this.textX, getRowY(0));
    }
    for (let row = Math.max(1, start); row < end; ++row) {
      const commit = this.getRowCommit(row);
      if (!commit) {
        continue;
      }
      const sha = commit.sha();
      const y = getRowY(row);
      let x = this.textX;
      ctx.globalAlpha = this.isDimmed(sha) ? DIMMED_ALPHA * 1.5 : 1;
      const color = this.getColor(sha);
      for (const name of repo.shaToReferences.get(sha) || []) {
        const reference = repo.references.get(name)!;
        if (repo.isBadgeShown(reference)) {
          x += this.drawPill(ctx, reference.shorthand(), x, y, color, repo.head !== null && repo.head.name() === name) + 6;
        }
      }
      if (repo.stashes.has(sha)) {
        x += this.drawPill(ctx, `stash@{${repo.stashes.get(sha)!.index}}`, x, y, color, false) + 6;
      }
      ctx.font = `13px ${this.fontFamily}`;
      ctx.fillStyle = this.color('text-primary');
      const summary = commit.summary();
      ctx.fillText(summary, x, y);
      x += ctx.measureText(summary).width + 10;
      ctx.font = `12px ${this.fontFamily}`;
      ctx.fillStyle = this.color('text-muted');
      ctx.fillText(`${commit.author().name} · ${shortenSha(sha)}`, x, y);
    }
    ctx.globalAlpha = 1;
  }

  // Returns the width of the pill
  drawPill(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string, bold: boolean) {
    ctx.font = `${bold ? 700 : 600} 11px ${this.fontFamily}`;
    const width = ctx.measureText(text).width + 14;
    const height = 18;
    ctx.fillStyle = this.color('surface-1');
    ctx.strokeStyle = color;
    ctx.lineWidth = bold ? 1.5 : 1;
    ctx.beginPath();
    ctx.roundRect(x, y - height / 2, width, height, height / 2);
    ctx.fill();
    const alpha = ctx.globalAlpha;
    ctx.globalAlpha = alpha * 0.14;
    ctx.fillStyle = color;
    ctx.fill();
    ctx.globalAlpha = alpha;
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.fillText(text, x + 7, y + 0.5);
    return width;
  }

  // The names of the branches whose tips scrolled away stay at the top of their lanes
  drawPinnedLabels(ctx: CanvasRenderingContext2D, start: number) {
    const viewport = this.viewport;
    const firstRow = Math.max(start, Math.ceil(viewport.y / ROW_HEIGHT));
    const labels = getPinnedLabels(this.labels, firstRow);
    if (labels.length === 0) {
      return;
    }
    ctx.textBaseline = 'middle';
    for (const label of labels) {
      const [x] = toScreen(viewport, getLaneX(label.lane), 0);
      if (x < -LANE_WIDTH || x > this.width + LANE_WIDTH) {
        continue;
      }
      const text = label.names.length > 1 ? `${label.names[0]} +${label.names.length - 1}` : label.names[0];
      const commit = this.props.repo.shaToCommit.get(this.getLabelSha(label));
      const color = commit ? this.getColor(commit.sha()) : this.color('accent');
      ctx.font = `600 11px ${this.fontFamily}`;
      const width = Math.min(160, ctx.measureText(text).width + 14);
      ctx.save();
      ctx.beginPath();
      ctx.rect(x - width / 2 - 1, 0, width + 2, 32);
      ctx.clip();
      this.drawPill(ctx, text, x - width / 2, 16, color, false);
      ctx.restore();
    }
  }

  getLabelSha(label: LaneLabel) {
    const commit = this.getRowCommit(label.start);
    return commit ? commit.sha() : '';
  }

  // Minimap

  // The whole history, a dot per commit in its lane, scaled to the minimap
  renderMinimapImage() {
    const repo = this.props.repo;
    const rows = repo.commits.length + 1;
    const lanes = Math.max(1, repo.graph.width);
    const height = Math.max(40, Math.min(MINIMAP_MAX_HEIGHT, rows * 4, this.height - 96));
    const image = document.createElement('canvas');
    const ratio = window.devicePixelRatio || 1;
    image.width = Math.round(MINIMAP_WIDTH * ratio);
    image.height = Math.round(height * ratio);
    const ctx = image.getContext('2d')!;
    ctx.scale(ratio, ratio);
    const scaleX = Math.min(MINIMAP_WIDTH / (lanes * LANE_WIDTH + TEXT_GAP), 0.5);
    const scaleY = height / (rows * ROW_HEIGHT);
    const dotWidth = Math.max(1.5, LANE_WIDTH * scaleX * 0.7);
    const dotHeight = Math.max(1, ROW_HEIGHT * scaleY * 0.8);
    repo.commits.forEach((commit, index) => {
      const position = repo.graph.positions.get(commit.sha());
      if (position) {
        ctx.fillStyle = this.getColor(commit.sha());
        ctx.globalAlpha = this.isDimmed(commit.sha()) ? DIMMED_ALPHA : 1;
        ctx.fillRect(getLaneX(position[1]) * scaleX - dotWidth / 2, getRowY(index + 1) * scaleY - dotHeight / 2, dotWidth, dotHeight);
      }
    });
    this.minimapImage = image;
    this.minimapScale = [scaleX, scaleY];
    this.minimapMatches = this.props.matches;
  }

  drawMinimap() {
    const canvas = this.minimapCanvas.current;
    if (!canvas) {
      return;
    }
    if (!this.minimapImage || this.minimapMatches !== this.props.matches) {
      this.renderMinimapImage();
    }
    const image = this.minimapImage!;
    const ratio = window.devicePixelRatio || 1;
    if (canvas.width !== image.width || canvas.height !== image.height) {
      canvas.width = image.width;
      canvas.height = image.height;
      canvas.style.height = `${image.height / ratio}px`;
    }
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0);
    ctx.scale(ratio, ratio);
    const [scaleX, scaleY] = this.minimapScale;
    const viewport = this.viewport;
    const height = image.height / ratio;
    const x = Math.max(0, viewport.x * scaleX);
    const y = Math.max(0, viewport.y * scaleY);
    const right = Math.min(MINIMAP_WIDTH, (viewport.x + this.width / viewport.zoom) * scaleX);
    const bottom = Math.min(height, (viewport.y + this.height / viewport.zoom) * scaleY);
    ctx.strokeStyle = this.color('accent');
    ctx.fillStyle = this.color('selected');
    ctx.lineWidth = 1.5;
    // At least a few pixels high, so that it can be seen in a long history
    const rectHeight = Math.max(4, bottom - y);
    ctx.fillRect(x, y, Math.max(4, right - x), rectHeight);
    ctx.strokeRect(x + 0.75, y + 0.75, Math.max(4, right - x) - 1.5, rectHeight - 1.5);
  }

  moveToMinimapPoint(event: React.PointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const [scaleX, scaleY] = this.minimapScale;
    const x = (event.clientX - rect.left) / scaleX;
    const y = (event.clientY - rect.top) / scaleY;
    // The rows move under the viewport, the lanes stay where they are unless they are out of sight
    const centered = centerOn(this.viewport, x, y, this.width, this.height);
    this.setViewport({ ...centered, x: isVisible(this.viewport, x, this.viewport.y, this.width, Infinity) ? this.viewport.x : centered.x });
  }

  handleMinimapPointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    if (event.button !== 0) {
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    this.minimapPointer = event.pointerId;
    this.moveToMinimapPoint(event);
  }

  handleMinimapPointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    if (this.minimapPointer === event.pointerId) {
      this.moveToMinimapPoint(event);
    }
  }

  handleMinimapPointerUp(event: React.PointerEvent<HTMLCanvasElement>) {
    if (this.minimapPointer === event.pointerId) {
      this.minimapPointer = null;
    }
  }

  // Viewport

  setViewport(viewport: Viewport) {
    this.viewport = this.width > 0 ? clampViewport(viewport, this.bounds, this.width, this.height, KEEP_IN_SIGHT) : viewport;
    // The card would not be next to its commit anymore
    if (this.state.hover) {
      this.setState({ hover: null });
    }
    this.scheduleDraw();
  }

  handleResize() {
    const container = this.container.current;
    if (container) {
      const width = container.clientWidth;
      const height = container.clientHeight;
      if (width !== this.width || height !== this.height) {
        // The minimap gets as high as the canvas lets it
        this.minimapImage = null;
      }
      this.width = width;
      this.height = height;
      this.setViewport(this.viewport);
    }
  }

  handleThemeChange() {
    this.minimapImage = null;
    this.scheduleDraw();
  }

  zoomBy(factor: number) {
    this.setViewport(zoomAt(this.viewport, this.viewport.zoom * factor, this.width / 2, this.height / 2));
  }

  zoomIn() {
    this.zoomBy(ZOOM_STEP);
  }

  zoomOut() {
    this.zoomBy(1 / ZOOM_STEP);
  }

  fitToView() {
    this.setViewport(fitBounds(this.getLanesBounds(), this.width, this.height, PADDING));
  }

  // The lanes and the start of the summaries, the summaries are as long as they are
  getLanesBounds(): Bounds {
    return { x: 0, y: 0, width: this.textX + 240, height: this.bounds.height };
  }

  jumpToHead() {
    const repo = this.props.repo;
    if (repo.headCommit && repo.isHeadInGraph()) {
      this.centerOnCommit(repo.headCommit.sha());
    } else {
      this.centerOnRow(0, 0);
    }
  }

  centerOnRow(row: number, lane: number) {
    // The lane stays on the left part of the canvas, so that its summary can be read
    const centered = centerOn(this.viewport, getLaneX(lane), getRowY(row), this.width, this.height);
    const x = Math.min(centered.x, getLaneX(lane) - PADDING / this.viewport.zoom - LANE_WIDTH);
    this.setViewport({ ...centered, x: Math.max(x, -PADDING) });
  }

  centerOnCommit(sha: string) {
    const position = this.props.repo.graph.positions.get(sha);
    if (position) {
      this.centerOnRow(position[0], position[1]);
    }
  }

  centerOnIndex() {
    this.centerOnRow(0, 0);
  }

  getSelectedRow() {
    const commit = this.props.selectedCommit;
    if (commit === null) {
      return 0;
    }
    const position = this.props.repo.graph.positions.get(commit.sha());
    return position ? position[0] : -1;
  }

  // The selection made with the keyboard or from another view is moved into sight
  revealSelection() {
    const row = this.getSelectedRow();
    if (row < 0) {
      this.scheduleDraw();
      return;
    }
    const commit = this.getRowCommit(row);
    const position = commit ? this.props.repo.graph.positions.get(commit.sha()) : undefined;
    const lane = position ? position[1] : 0;
    if (!isVisible(this.viewport, getLaneX(lane), getRowY(row), this.width, this.height, ROW_HEIGHT * this.viewport.zoom)) {
      this.centerOnRow(row, lane);
    } else {
      this.scheduleDraw();
    }
  }

  // Pointer

  getLocalPoint(event: { clientX: number; clientY: number }): [number, number] {
    const rect = this.canvas.current!.getBoundingClientRect();
    return [event.clientX - rect.left, event.clientY - rect.top];
  }

  // Row of the commit or of the index under the point, on its node or on its text, -1 if there is none
  hitTest(x: number, y: number) {
    const [worldX, worldY] = toWorld(this.viewport, x, y);
    const row = Math.floor(worldY / ROW_HEIGHT);
    const repo = this.props.repo;
    if (row < 0 || row > repo.commits.length) {
      return -1;
    }
    const commit = this.getRowCommit(row);
    const position = commit ? repo.graph.positions.get(commit.sha()) : undefined;
    const lane = position ? position[1] : 0;
    const onNode = Math.abs(worldX - getLaneX(lane)) <= RADIUS + 4 && Math.abs(worldY - getRowY(row)) <= RADIUS + 4;
    const onText = this.viewport.zoom >= TEXT_MIN_ZOOM && worldX >= this.textX - 4 && worldX <= this.textX + TEXT_WIDTH;
    return onNode || onText ? row : -1;
  }

  handlePointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    if (event.button !== 0) {
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    this.gesture = {
      id: event.pointerId, startX: event.clientX, startY: event.clientY, lastX: event.clientX, lastY: event.clientY, moved: false
    };
  }

  handlePointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    const gesture = this.gesture;
    if (gesture && gesture.id === event.pointerId) {
      if (!gesture.moved && Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY) >= DRAG_THRESHOLD) {
        gesture.moved = true;
        this.setState({ dragging: true, hover: null });
      }
      if (gesture.moved) {
        this.setViewport(panBy(this.viewport, event.clientX - gesture.lastX, event.clientY - gesture.lastY));
      }
      gesture.lastX = event.clientX;
      gesture.lastY = event.clientY;
      return;
    }
    this.updateHover(event);
  }

  updateHover(event: { clientX: number; clientY: number }) {
    const [x, y] = this.getLocalPoint(event);
    const row = this.hitTest(x, y);
    const hover = this.state.hover;
    if (row < 0) {
      if (hover) {
        this.setState({ hover: null }, () => this.scheduleDraw());
      }
    } else if (!hover || hover.row !== row || Math.abs(hover.x - x) > 24 || Math.abs(hover.y - y) > 24) {
      this.setState({ hover: { row, x, y } }, () => this.scheduleDraw());
    }
  }

  handlePointerUp(event: React.PointerEvent<HTMLCanvasElement>) {
    const gesture = this.gesture;
    if (!gesture || gesture.id !== event.pointerId) {
      return;
    }
    this.gesture = null;
    if (gesture.moved) {
      this.setState({ dragging: false });
      return;
    }
    const [x, y] = this.getLocalPoint(event);
    this.selectRow(this.hitTest(x, y));
  }

  handlePointerLeave() {
    if (this.state.hover && !this.gesture) {
      this.setState({ hover: null }, () => this.scheduleDraw());
    }
  }

  selectRow(row: number) {
    if (row === 0) {
      this.props.onIndexSelect();
    } else if (row > 0) {
      const commit = this.getRowCommit(row);
      if (commit) {
        this.props.onCommitSelect(commit);
      }
    }
  }

  handleContextMenu(event: React.MouseEvent<HTMLCanvasElement>) {
    event.preventDefault();
    const [x, y] = this.getLocalPoint(event);
    const commit = this.getRowCommit(this.hitTest(x, y));
    if (!commit) {
      return;
    }
    const stash = this.props.repo.stashes.get(commit.sha());
    const menu = stash ?
      createStashContextMenu(this.props.repo, stash.index) :
      createCommitContextMenu(this.props.repo, commit, this.props.onCreateBranch, this.props.onOpenInputDialog);
    menu.popup();
  }

  handleWheel(event: WheelEvent) {
    event.preventDefault();
    const [x, y] = this.getLocalPoint(event);
    if (event.ctrlKey || event.metaKey) {
      this.setViewport(zoomAt(this.viewport, getWheelZoom(this.viewport.zoom, event.deltaY, event.deltaMode), x, y));
    } else {
      const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? this.height : 1;
      // Shift and the wheel of a mouse move sideways
      const dx = event.shiftKey && event.deltaX === 0 ? event.deltaY : event.deltaX;
      const dy = event.shiftKey && event.deltaX === 0 ? 0 : event.deltaY;
      this.setViewport(panBy(this.viewport, -dx * scale, -dy * scale));
    }
  }

  handleKeyDown(event: React.KeyboardEvent<HTMLCanvasElement>) {
    if (event.ctrlKey || event.metaKey || event.altKey) {
      return;
    }
    const step = event.shiftKey ? KEY_PAN * 4 : KEY_PAN;
    const actions: Record<string, () => void> = {
      ArrowUp: () => this.setViewport(panBy(this.viewport, 0, step)),
      ArrowDown: () => this.setViewport(panBy(this.viewport, 0, -step)),
      ArrowLeft: () => this.setViewport(panBy(this.viewport, step, 0)),
      ArrowRight: () => this.setViewport(panBy(this.viewport, -step, 0)),
      PageUp: () => this.setViewport(panBy(this.viewport, 0, this.height * 0.9)),
      PageDown: () => this.setViewport(panBy(this.viewport, 0, -this.height * 0.9)),
      '+': this.zoomIn,
      '=': this.zoomIn,
      '-': this.zoomOut,
      '0': this.fitToView,
      h: this.jumpToHead,
      H: this.jumpToHead,
      Home: this.jumpToHead
    };
    const action = actions[event.key];
    if (action) {
      event.preventDefault();
      action();
    }
  }

  // Rendering

  renderHoverCard() {
    const hover = this.state.hover;
    if (!hover || this.state.dragging) {
      return null;
    }
    const repo = this.props.repo;
    const commit = this.getRowCommit(hover.row);
    const style = this.getCardPosition(hover);
    if (!commit) {
      return (
        <div className='canvas-hover-card' style={style} aria-hidden='true'>
          <strong className='canvas-card-summary'>Index</strong>
          <span className='canvas-card-meta'>Uncommitted changes, click to show them</span>
        </div>
      );
    }
    const sha = commit.sha();
    const references = (repo.shaToReferences.get(sha) || [])
      .map((name) => repo.references.get(name)!)
      .filter((reference) => repo.isBadgeShown(reference));
    const stash = repo.stashes.get(sha);
    return (
      <div className='canvas-hover-card' style={style} aria-hidden='true'>
        {references.length > 0 || stash ?
          <span className='canvas-card-references' style={{ '--branch-color': this.getColor(sha) } as React.CSSProperties}>
            {references.map((reference) => <span className='canvas-card-reference' key={reference.name()}>{reference.shorthand()}</span>)}
            {stash ? <span className='canvas-card-reference'>{`stash@{${stash.index}}`}</span> : null}
          </span> : null}
        <strong className='canvas-card-summary'>{commit.summary()}</strong>
        <span className='canvas-card-meta'>
          <code>{shortenSha(sha)}</code>
          <span>{commit.author().name}</span>
          <span>{formatCommitDate(commit.author().date)}</span>
        </span>
        {commit.parentIds.length > 1 && !stash ? <span className='canvas-card-meta'>Merge of {commit.parentIds.length} parents</span> : null}
      </div>
    );
  }

  // Next to the pointer, on the side where there is room
  getCardPosition(hover: HoverCard): React.CSSProperties {
    const style: React.CSSProperties = {};
    if (hover.x > this.width - 340) {
      style.right = this.width - hover.x + 12;
    } else {
      style.left = hover.x + 16;
    }
    if (hover.y > this.height - 140) {
      style.bottom = this.height - hover.y + 12;
    } else {
      style.top = hover.y + 18;
    }
    return style;
  }

  render() {
    const classNames = ['canvas-graph'];
    if (this.state.dragging) {
      classNames.push('dragging');
    } else if (this.state.hover) {
      classNames.push('hovering');
    }
    return (
      <div className={classNames.join(' ')} ref={this.container}>
        <canvas ref={this.canvas}
          tabIndex={0}
          role='application'
          aria-label='Commit graph'
          aria-roledescription='canvas'
          aria-describedby='canvas-graph-help'
          onPointerDown={this.handlePointerDown}
          onPointerMove={this.handlePointerMove}
          onPointerUp={this.handlePointerUp}
          onPointerCancel={this.handlePointerUp}
          onPointerLeave={this.handlePointerLeave}
          onContextMenu={this.handleContextMenu}
          onKeyDown={this.handleKeyDown} />
        <p id='canvas-graph-help' className='visually-hidden'>
          Drag, scroll or use the arrow keys to move the graph. Pinch, Ctrl and the wheel, or plus and minus zoom.
          0 fits the graph in view, H goes to the head. Click a commit to open it.
        </p>
        {this.renderHoverCard()}
        {this.props.minimap ?
          <canvas className='canvas-minimap'
            ref={this.minimapCanvas}
            aria-hidden='true'
            title='Overview of the history, click or drag to move there'
            onPointerDown={this.handleMinimapPointerDown}
            onPointerMove={this.handleMinimapPointerMove}
            onPointerUp={this.handleMinimapPointerUp}
            onPointerCancel={this.handleMinimapPointerUp} /> : null}
        <div className='canvas-controls' role='toolbar' aria-label='Canvas controls'>
          <button type='button' className='ghost-button icon-button' title='Zoom out (-)' aria-label='Zoom out' onClick={this.zoomOut}>
            <Icon name='zoom-out' />
          </button>
          <output className='canvas-zoom' aria-label='Zoom'>{this.state.zoom}%</output>
          <button type='button' className='ghost-button icon-button' title='Zoom in (+)' aria-label='Zoom in' onClick={this.zoomIn}>
            <Icon name='zoom-in' />
          </button>
          <span className='canvas-controls-separator' />
          <button type='button' className='ghost-button icon-button' title='Fit to view (0)' aria-label='Fit to view'
            onClick={this.fitToView}>
            <Icon name='scan' />
          </button>
          <button type='button' className='ghost-button icon-button' title='Jump to HEAD (H)' aria-label='Jump to HEAD'
            onClick={this.jumpToHead}>
            <Icon name='locate-fixed' />
          </button>
          <button type='button' className='ghost-button icon-button' title='Show the minimap' aria-label='Minimap'
            aria-pressed={this.props.minimap} onClick={this.props.onMinimapToggle}>
            <Icon name='map' />
          </button>
        </div>
      </div>
    );
  }
}
