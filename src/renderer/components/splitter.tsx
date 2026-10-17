import * as React from 'react';

// Distance that the arrow keys move the splitter, in pixels
export const SPLITTER_KEYBOARD_STEP = 16;

export interface SplitterProps {
  onDrag: (offset: number) => void;
  // Accessible name, what the splitter resizes
  label: string;
}

export interface SplitterState {
  dragging: boolean;
  // Position in percent of the width of the window, read by assistive technologies
  position: number | null;
}

export class Splitter extends React.PureComponent<SplitterProps, SplitterState> {
  dragging: boolean;
  div: React.RefObject<HTMLDivElement | null>;
  // Distance between the mouse and the line when the dragging started, the hit area is wider than the line
  grabOffset: number;

  constructor(props: SplitterProps) {
    super(props);
    this.dragging = false;
    this.div = React.createRef();
    this.grabOffset = 0;
    this.state = {
      dragging: false,
      position: null
    };
    this.startDragging = this.startDragging.bind(this);
    this.handleMouseMove = this.handleMouseMove.bind(this);
    this.endDragging = this.endDragging.bind(this);
    this.handleKeyDown = this.handleKeyDown.bind(this);
    this.updatePosition = this.updatePosition.bind(this);
  }

  componentDidMount() {
    window.addEventListener('mousemove', this.handleMouseMove);
    window.addEventListener('mouseup', this.endDragging);
    this.updatePosition();
  }

  componentWillUnmount() {
    window.removeEventListener('mousemove', this.handleMouseMove);
    window.removeEventListener('mouseup', this.endDragging);
    if (this.dragging) {
      this.resetDocumentStyle();
    }
  }

  startDragging(event: React.MouseEvent<HTMLDivElement>) {
    if (event.button !== 0 || !this.div.current) {
      return;
    }
    this.dragging = true;
    this.grabOffset = event.clientX - this.div.current.getBoundingClientRect().left;
    this.setState({ dragging: true });
    document.documentElement.style.cursor = 'col-resize';
    document.documentElement.style.userSelect = 'none';
  }

  handleMouseMove(event: MouseEvent) {
    if (this.dragging && this.div.current) {
      const mouseX = event.clientX;
      const rect = this.div.current.getBoundingClientRect();
      this.props.onDrag(mouseX - rect.left - this.grabOffset);
    }
  }

  endDragging() {
    if (!this.dragging) {
      return;
    }
    this.dragging = false;
    this.setState({ dragging: false });
    this.resetDocumentStyle();
    this.updatePosition();
  }

  resetDocumentStyle() {
    document.documentElement.style.removeProperty('cursor');
    document.documentElement.style.removeProperty('user-select');
  }

  handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    // The arrow keys with a modifier are left to the shortcuts
    if (event.altKey || event.ctrlKey || event.metaKey) {
      return;
    }
    let offset: number;
    if (event.key === 'ArrowLeft') {
      offset = -SPLITTER_KEYBOARD_STEP;
    } else if (event.key === 'ArrowRight') {
      offset = SPLITTER_KEYBOARD_STEP;
    } else {
      return;
    }
    event.preventDefault();
    this.props.onDrag(offset);
    this.updatePosition();
  }

  // Updated when a move ends rather than at each move of the mouse, so that dragging does not render the splitter again
  updatePosition() {
    if (this.div.current && window.innerWidth > 0) {
      const left = this.div.current.getBoundingClientRect().left;
      this.setState({ position: Math.round(left / window.innerWidth * 100) });
    }
  }

  render() {
    const classNames = ['splitter'];
    if (this.state.dragging) {
      classNames.push('dragging');
    }
    return (
      <div className={classNames.join(' ')}
        role='separator'
        aria-orientation='vertical'
        aria-label={this.props.label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={this.state.position !== null ? this.state.position : undefined}
        tabIndex={0}
        onMouseDown={this.startDragging}
        onKeyDown={this.handleKeyDown}
        onFocus={this.updatePosition}
        ref={this.div} />
    );
  }
}
