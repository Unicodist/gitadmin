import * as fs from 'fs';
import * as Path from 'path';
import * as React from 'react';
import { RepoWrapper, Patch } from '../helpers/repo-wrapper';
import { openInEditor } from '../helpers/open-in-editor';
import { arePatchesSimilar } from '../helpers/patch-comparison';
import { ConflictHunk, findConflictHunks } from '../helpers/conflict-parser';
import { getEditorFontFamily, loadMonaco } from '../helpers/monaco-loader';
import { createWidgetButton, createWidgetHeader, getEditorOptions, WIDGET_HEADER_HEIGHT } from '../helpers/viewer-widgets';
import { createIconElement } from '../helpers/icons';
import { Icon } from './icon';

// Load Monaco

let monaco: any;

// ConflictViewer

enum Version {
  Current = 1,
  Incoming = 2,
  Both = 3
}

// Small square in the colors of the lines of a version, it tells which lines a button keeps
function createSwatch(version: Version) {
  const swatch = document.createElement('span');
  swatch.classList.add('conflict-swatch', version === Version.Both ? 'both' : version === Version.Current ? 'current' : 'incoming');
  swatch.setAttribute('aria-hidden', 'true');
  return swatch;
}

export interface ConflictViewerOptions {
  fontSize: number;
}

export interface ConflictViewerProps {
  repo: RepoWrapper;
  patch: Patch;
  content: string;
  editorTheme: string;
  options: ConflictViewerOptions;
}

export class ConflictViewer extends React.PureComponent<ConflictViewerProps, {}> {
  divEditor: React.RefObject<HTMLDivElement | null>;
  editor: any;
  viewZoneIds: number[];
  overlayWidgets: any[];
  decorations: string[];
  conflicts: ConflictHunk[];

  constructor(props: ConflictViewerProps) {
    super(props);
    this.divEditor = React.createRef();
    this.editor = null;
    this.viewZoneIds = [];
    this.overlayWidgets = [];
    this.decorations = [];
    this.setUpEditor = this.setUpEditor.bind(this);
    this.handleOpenInEditor = this.handleOpenInEditor.bind(this);
    this.handleResolve = this.handleResolve.bind(this);
  }

  componentDidMount() {
    this.conflicts = findConflictHunks(this.props.content.toString());
    this.setUpEditor();
  }

  componentDidUpdate(prevProps: ConflictViewerProps) {
    // The editor is created once Monaco is loaded
    if (!this.editor) {
      return;
    }
    // Only load if the patch has changed
    if (this.props.patch !== prevProps.patch || this.props.content !== prevProps.content) {
      const scrollTop = arePatchesSimilar(prevProps.patch, this.props.patch) ? this.editor.getScrollTop() : 0;
      this.conflicts = findConflictHunks(this.props.content.toString());
      this.updateEditor(scrollTop);
    }
    if (this.props.editorTheme !== prevProps.editorTheme) {
      monaco.editor.setTheme(this.props.editorTheme);
      // A theme can change the monospace font
      this.editor.updateOptions({ fontFamily: getEditorFontFamily() });
    }
    if (this.props.options !== prevProps.options) {
      this.editor.updateOptions(this.props.options);
    }
  }

  componentWillUnmount() {
    if (this.editor) {
      this.editor.dispose();
    }
  }

  handleOpenInEditor() {
    openInEditor(this.props.patch.newFile.path);
  }

  handleResolve() {
    this.props.repo.stagePatch(this.props.patch);
  }

  hide() {
    if (this.divEditor.current) {
      this.divEditor.current.classList.add('hidden');
    }
  }

  show() {
    if (this.divEditor.current) {
      this.divEditor.current.classList.remove('hidden');
    }
  }

  async setUpEditor() {
    monaco = await loadMonaco();
    if (this.divEditor.current) {
      const options = {
        theme: this.props.editorTheme,
        automaticLayout: true,
        readOnly: true,
        ...getEditorOptions(),
        ...this.props.options
      };
      this.editor = monaco.editor.create(this.divEditor.current, options);
      this.updateEditor(0);
    }
  }

  updateEditor(scrollTop: number) {
    // Hide
    this.hide();
    // Reset editor
    this.resetEditor();
    // Update models
    this.editor.setValue(this.props.content);
    this.createConflictWidgets();
    // Scroll
    this.editor.setScrollTop(scrollTop);
    // Show
    this.show();
  }

  resetEditor() {
    // Reset view zones
    this.editor.changeViewZones((changeAccessor: any) => {
      for (const viewZoneId of this.viewZoneIds) {
        changeAccessor.removeZone(viewZoneId);
      }
    });
    this.viewZoneIds = [];
    // Reset overlay widgets
    for (const overlayWidget of this.overlayWidgets) {
      this.editor.removeOverlayWidget(overlayWidget);
    }
    this.overlayWidgets = [];
  }

  createConflictWidgets() {
    // Add decorations
    const decorations: any[] = [];
    for (let i = 0; i < this.conflicts.length; ++i) {
      const conflict = this.conflicts[i];
      decorations.push({
        range: new monaco.Range(conflict.start, 1, conflict.start, 1),
        options: {
          isWholeLine: true,
          className: 'conflict-start',
          marginClassName: 'conflict-start'
        }
      });
      const currentEnd = (conflict.ancestors.length > 0 ? conflict.ancestors[0] : conflict.separator) - 1;
      if (conflict.start + 1 <= currentEnd) {
        decorations.push({
          range: new monaco.Range(conflict.start + 1, 1, currentEnd, 1),
          options: {
            isWholeLine: true,
            className: 'conflict-current',
            marginClassName: 'conflict-current'
          }
        });
      }
      if (conflict.separator + 1 <= conflict.end - 1) {
        decorations.push({
          range: new monaco.Range(conflict.separator + 1, 1, conflict.end - 1, 1),
          options: {
            isWholeLine: true,
            className: 'conflict-incoming',
            marginClassName: 'conflict-incoming'
          }
        });
      }
      decorations.push({
        range: new monaco.Range(conflict.end, 1, conflict.end, 1),
        options: {
          isWholeLine: true,
          className: 'conflict-end',
          marginClassName: 'conflict-end'
        }
      });
    }
    this.decorations= this.editor.deltaDecorations(this.decorations, decorations);
    // Create widgets
    const overlayWidgets: any[] = [];
    for (let i = 0; i < this.conflicts.length; ++i) {
      const id = `conflict.${this.overlayWidgets.length}`;
      const overlayNode = document.createElement('div');
      overlayNode.classList.add('conflict-widget');
      overlayNode.appendChild(this.createConflictHeader(i));
      overlayWidgets.push({
        getId: () => id,
        getDomNode: () => overlayNode,
        getPosition: () => null
      });
      this.overlayWidgets.push(overlayWidgets[overlayWidgets.length - 1]);
    }
    // Add the widgets (we batch the calls)
    this.editor.changeViewZones((changeAccessor: any) => {
      for (let i = 0; i < this.conflicts.length; ++i) {
        const overlayWidget = overlayWidgets[i];
        this.editor.addOverlayWidget(overlayWidget);

        // Used only to compute the position.
        this.viewZoneIds.push(changeAccessor.addZone({
          afterLineNumber: this.conflicts[i].start - 1,
          heightInPx: WIDGET_HEADER_HEIGHT,
          domNode: document.createElement('div'),
          onDomNodeTop: (top: number) => {
            overlayWidget.getDomNode().style.top = top + 'px';
          },
          onComputedHeight: (height: number) => {
            overlayWidget.getDomNode().style.height = height + 'px';
          }
        }));
      }
    });
  }

  createConflictHeader(i: number) {
    const conflict = this.conflicts[i];
    const header = createWidgetHeader('conflict-header', conflict.start === 1);
    const titleNode = document.createElement('span');
    titleNode.className = 'conflict-title';
    titleNode.appendChild(createIconElement('git-merge-conflict', 14));
    const textNode = document.createElement('span');
    textNode.className = 'conflict-title-text';
    textNode.textContent = this.conflicts.length > 1 ? `Conflict ${i + 1} of ${this.conflicts.length}` : 'Conflict';
    titleNode.appendChild(textNode);
    header.appendChild(titleNode);

    const actionsNode = document.createElement('div');
    actionsNode.className = 'widget-actions';
    actionsNode.append(
      createWidgetButton({
        label: 'Accept current',
        labelEnd: ' change',
        title: 'Keep the lines of the current change',
        icon: createSwatch(Version.Current),
        onClick: () => this.acceptChange(conflict, Version.Current)
      }),
      createWidgetButton({
        label: 'Accept incoming',
        labelEnd: ' change',
        title: 'Keep the lines of the incoming change',
        icon: createSwatch(Version.Incoming),
        onClick: () => this.acceptChange(conflict, Version.Incoming)
      }),
      createWidgetButton({
        label: 'Accept both',
        labelEnd: ' changes',
        title: 'Keep the lines of both changes, the current ones first',
        icon: createSwatch(Version.Both),
        onClick: () => this.acceptChange(conflict, Version.Both)
      })
    );
    header.appendChild(actionsNode);
    return header;
  }

  removeLines(linesToRemove: Set<number>) {
    const lines = this.props.content.split('\n');
    const value = lines.filter((_line, i) => !linesToRemove.has(i + 1)).join('\n');
    const path = Path.join(this.props.repo.workdir, this.props.patch.newFile.path);
    return new Promise<void>((resolve, reject) => {
      fs.writeFile(path, value, (error) => {
        if (!error) {
          resolve();
        } else {
          reject(error);
        }
      });
    });
  }

  addConflictChange(linesToRemove: Set<number>, conflict: ConflictHunk, version: Version) {
    function addRange(start: number, end: number) {
      for (let i = start; i < end; ++i) {
        linesToRemove.add(i);
      }
    }

    // Start line
    linesToRemove.add(conflict.start);
    // Incoming changes
    const currentEnd = conflict.ancestors.length > 0 ? conflict.ancestors[0] : conflict.separator;
    if ((version & Version.Current) === 0) {
      addRange(conflict.start + 1, currentEnd);
    }
    // Ancestors and separator
    addRange(currentEnd, conflict.separator + 1);
    // Current changes
    if ((version & Version.Incoming) === 0) {
      addRange(conflict.separator + 1, conflict.end);
    }
    // End line
    linesToRemove.add(conflict.end);
  }

  acceptChange(conflict: ConflictHunk, version: Version) {
    const linesToRemove = new Set<number>();
    this.addConflictChange(linesToRemove, conflict, version);
    this.removeLines(linesToRemove);
  }

  render() {
    return (
      <>
        <div className='patch-toolbar'>
          <div className='patch-toolbar-start'>
            <button type='button'
              className='ghost-button small-button'
              title='Open the file in your editor'
              onClick={this.handleOpenInEditor}>
              <Icon name='external-link' />
              <span className='button-label'>Open in editor</span>
            </button>
          </div>
          <div className='patch-toolbar-end conflict-actions'>
            <button type='button'
              className='small-button'
              title='Keep the current version of the file'
              onClick={() => console.log('current')}>
              <span className='conflict-swatch current' aria-hidden='true' />
              <span className='button-label'>Keep current<span className='label-end'> version</span></span>
            </button>
            <button type='button'
              className='small-button'
              title='Take the incoming version of the file'
              onClick={() => console.log('incoming')}>
              <span className='conflict-swatch incoming' aria-hidden='true' />
              <span className='button-label'>Take incoming<span className='label-end'> version</span></span>
            </button>
            <button type='button'
              className='primary-button small-button'
              title='Stage the file to mark its conflicts as resolved'
              onClick={this.handleResolve}>
              <Icon name='check' />
              <span className='button-label'>Mark as resolved</span>
            </button>
          </div>
        </div>
        <div className='patch-editor' ref={this.divEditor} />
      </>
    );
  }
}
