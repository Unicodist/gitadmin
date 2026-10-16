import * as React from 'react';
import { RepoWrapper, PatchType, DiffLine, Hunk, Patch } from '../helpers/repo-wrapper';
import { openInEditor } from '../helpers/open-in-editor';
import { makeCancellable, CancellablePromise } from '../helpers/make-cancellable';
import { arePatchesSimilar } from '../helpers/patch-comparison';
import { getEditorFontFamily, loadMonaco } from '../helpers/monaco-loader';
import { createIconElement } from '../helpers/icons';
import { splitHunkHeader } from '../helpers/viewer-format';
import { createWidgetButton, createWidgetHeader, getEditorOptions, WIDGET_HEADER_HEIGHT } from '../helpers/viewer-widgets';
import { Icon } from './icon';

// Load Monaco

let monaco: any;

// TextPatchViewer

enum ViewMode {
  Hunk,
  Inline,
  Split
}

enum Editor {
  Original,
  Modified,
  Count
}

export interface TextPatchViewerOptions {
  fontSize: number;
}

export interface TextPatchViewerProps {
  repo: RepoWrapper;
  patch: Patch;
  oldString: string;
  newString: string;
  type: PatchType;
  editorTheme: string;
  options: TextPatchViewerOptions;
}

export class TextPatchViewer extends React.PureComponent<TextPatchViewerProps, {}> {
  divEditor: React.RefObject<HTMLDivElement | null>;
  editor: any;
  viewMode: ViewMode;
  viewZoneIds: number[][];
  overlayWidgets: any[][];
  actionDisposables: any[];
  hunks: Hunk[];
  lines: DiffLine[];
  loadingPromise: CancellablePromise<[Hunk[], DiffLine[]]>;
  marginButtonsDirty: boolean;

  constructor(props: TextPatchViewerProps) {
    super(props);
    this.divEditor = React.createRef();
    this.editor = null;
    this.viewMode = ViewMode.Hunk;
    this.viewZoneIds = [[], []];
    this.overlayWidgets = [[], []];
    this.actionDisposables = [];
    this.marginButtonsDirty = false;
    this.setUpEditor = this.setUpEditor.bind(this);
    this.handleSelectedLinesDiscard = this.handleSelectedLinesDiscard.bind(this);
    this.handleSelectedLinesStage = this.handleSelectedLinesStage.bind(this);
    this.handleSelectedLinesUnstage = this.handleSelectedLinesUnstage.bind(this);
    this.handleFileDiscard = this.handleFileDiscard.bind(this);
    this.handleFileStage = this.handleFileStage.bind(this);
    this.handleFileUnstage = this.handleFileUnstage.bind(this);
    this.handleOpenInEditor = this.handleOpenInEditor.bind(this);
  }

  componentDidMount() {
    this.setUpEditor();
  }

  componentDidUpdate(prevProps: TextPatchViewerProps) {
    // The editor is created once Monaco is loaded
    if (!this.editor) {
      return;
    }
    // Only load if the patch has changed
    if (this.props.patch !== prevProps.patch) {
      const scrollTop = arePatchesSimilar(prevProps.patch, this.props.patch) ?
        this.editor.getModifiedEditor().getScrollTop() :
        0;
      this.loadAndUpdate(scrollTop);
    } else if (this.props.type !== prevProps.type) {
      this.updateEditor(this.editor.getModifiedEditor().getScrollTop());
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
    if (this.loadingPromise) {
      this.loadingPromise.cancel();
    }
    if (this.editor) {
      this.disposeModels();
      this.editor.dispose();
    }
  }

  handleViewModeChange(viewMode: ViewMode) {
    if (viewMode !== this.viewMode) {
      this.viewMode = viewMode;
      if (this.editor) {
        this.updateEditor(0);
      }
    }
  }

  async handleSelectedLinesDiscard(editor: any) {
    this.props.repo.discardLines(this.props.patch, await this.getSelectedLines(editor));
  }

  async handleSelectedLinesStage(editor: any) {
    this.props.repo.stageLines(this.props.patch, await this.getSelectedLines(editor));
  }

  async handleSelectedLinesUnstage(editor: any) {
    this.props.repo.unstageLines(this.props.patch, await this.getSelectedLines(editor));
  }

  handleFileDiscard() {
    this.props.repo.discardPatch(this.props.patch);
  }

  handleFileStage() {
    this.props.repo.stagePatch(this.props.patch);
  }

  handleFileUnstage() {
    this.props.repo.unstagePatch(this.props.patch);
  }

  handleOpenInEditor() {
    openInEditor(this.props.patch.newFile.path);
  }

  handleMarginButtonClick(i: number, editor: Editor) {
    let line: DiffLine | undefined;
    if (editor === Editor.Original) {
      line = this.lines.find((line) => line.oldLineno === i);
    } else if (editor === Editor.Modified) {
      line = this.lines.find((line) => line.newLineno === i);
    }
    if (line) {
      if (this.props.type === PatchType.Unstaged) {
        this.props.repo.stageLines(this.props.patch, [line]);
      } else if (this.props.type === PatchType.Staged) {
        this.props.repo.unstageLines(this.props.patch, [line]);
      }
    }
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
        renderSideBySide: false,
        readOnly: true,
        ...getEditorOptions(),
        ...this.props.options
      };
      this.editor = monaco.editor.createDiffEditor(this.divEditor.current, options);
      this.editor.onDidUpdateDiff(() => this.updateMarginButtons());
      this.loadAndUpdate(0);
    }
  }

  async loadAndUpdate(scrollTop: number) {
    this.hide();
    await this.loadData();
    try {
      const [hunks, lines] = await this.loadingPromise.promise;
      this.hunks = hunks;
      this.lines = lines;
      if (this.editor) {
        await this.updateEditor(scrollTop);
      }
    } catch (e) {
    }
  }

  loadData() {
    if (this.loadingPromise) {
      this.loadingPromise.cancel();
    }
    this.loadingPromise = makeCancellable((async () => {
      // Load hunks
      const hunks = await this.props.patch.hunks();
      // Load lines
      const lines = hunks.flatMap((hunk) => hunk.lines);
      return [hunks, lines] as [Hunk[], DiffLine[]];
    })());
  }

  async updateEditor(scrollTop: number) {
    // Hide
    this.hide();
    // Update editor options
    this.editor.updateOptions({
      renderSideBySide: this.viewMode === ViewMode.Split
    });
    // Out of the split view, the original editor only shows the old line numbers and the keyboard skips it
    this.editor.getOriginalEditor().updateOptions({ tabIndex: this.viewMode === ViewMode.Split ? 0 : -1 });
    // Reset editor
    this.resetEditor();
    // Update models
    this.setModels();
    if (this.viewMode === ViewMode.Hunk && this.hunks.length > 0) {
      await this.customizeHunkView();
    }
    // Scroll
    this.editor.getModifiedEditor().setScrollTop(scrollTop);
    // Show
    this.show();
  }

  resetEditor() {
    // Reset view zones
    const editors = [this.editor.getOriginalEditor(), this.editor.getModifiedEditor()];
    for (let i = 0; i < Editor.Count; ++i) {
      const editor = editors[i];
      editor.changeViewZones((changeAccessor: any) => {
        for (const viewZoneId of this.viewZoneIds[i]) {
          changeAccessor.removeZone(viewZoneId);
        }
      });
      this.viewZoneIds[i] = [];
      // Reset overlay widgets
      for (const overlayWidget of this.overlayWidgets[i]) {
        editor.removeOverlayWidget(overlayWidget);
      }
      this.overlayWidgets[i] = [];
    }
    // Reset context menu
    for (const actionDisposable of this.actionDisposables) {
      actionDisposable.dispose();
    }
    this.actionDisposables = [];
    // Reset margin buttons
    this.marginButtonsDirty = true;
  }

  setModels() {
    function createModel(prefix: string, path: string, value: string) {
      const uri = monaco.Uri.parse(`file://${prefix}/${path}`);
      return monaco.editor.createModel(value, undefined, uri);
    }

    const patch = this.props.patch;
    this.disposeModels();
    const originalModel = createModel('a', patch.oldFile.path, this.props.oldString);
    const modifiedModel = createModel('b', patch.newFile.path, this.props.newString);
    this.editor.setModel({
      original: originalModel,
      modified: modifiedModel
    });
  }

  disposeModels() {
    const model = this.editor.getModel();
    // The diff editor must release the models before they are disposed
    this.editor.setModel(null);
    if (model) {
      if (model.original) {
        model.original.dispose();
      }
      if (model.modified) {
        model.modified.dispose();
      }
    }
  }

  customizeHunkView() {
    return new Promise<void>((resolve) => {
      // We must wait the the editor has finished to add the hunk widgets
      // before hiding areas otherwise there are problems with line numbers.
      // However there are no simple ways to know that the editor has finished
      // updating. Here, we hide areas when the editor has not updated since 200ms.
      let isSetHiddenAreasScheduled = false;
      let lastUpdate: number;

      const startScheduling = () => {
        lastUpdate = Date.now();
        if (!isSetHiddenAreasScheduled) {
          isSetHiddenAreasScheduled = true;
          scheduleSetHiddenAreas();
        }
      };
      const scheduleSetHiddenAreas = () => {
        if (Date.now() - lastUpdate < 200) {
          setTimeout(scheduleSetHiddenAreas, 50);
        } else {
          // Remove listeners
          listenerDisposables.forEach((listenerDisposable) => listenerDisposable.dispose());
          // Set hidden areas
          this.setHiddenAreas();
          resolve();
        }
      };

      // Listen to onDidChangeModelDecorations events
      // Apparently, the original editor is always updated first
      // so one listener should be sufficient
      const listenerDisposables = [
        this.editor.getOriginalEditor().onDidChangeModelDecorations(startScheduling),
        this.editor.getModifiedEditor().onDidChangeModelDecorations(startScheduling),
      ];
      // Add hunk widgets
      this.createHunkWidgets();
      // Customize context menu
      this.setContextMenu(this.editor.getModifiedEditor());
    });
  }

  createHunkHeader(hunk: Hunk, first: boolean) {
    const repo = this.props.repo;
    const patch = this.props.patch;
    const header = createWidgetHeader('hunk-header', first);
    const [range, context] = splitHunkHeader(hunk.header);
    const rangeNode = document.createElement('code');
    rangeNode.className = 'hunk-range';
    rangeNode.textContent = range;
    header.appendChild(rangeNode);
    // The line that git shows for context, like the name of the function
    if (context) {
      const contextNode = document.createElement('code');
      contextNode.className = 'hunk-context';
      contextNode.textContent = context;
      header.appendChild(contextNode);
    }
    const actionsNode = document.createElement('div');
    actionsNode.className = 'widget-actions';
    if (this.props.type === PatchType.Unstaged) {
      actionsNode.append(
        createWidgetButton({
          label: 'Discard',
          title: 'Discard the changes of this hunk',
          classNames: ['danger-button'],
          icon: 'undo-2',
          onClick: repo.discardHunk.bind(repo, patch, hunk)
        }),
        createWidgetButton({ label: 'Stage', title: 'Stage this hunk', icon: 'plus', onClick: repo.stageHunk.bind(repo, patch, hunk) })
      );
    } else if (this.props.type === PatchType.Staged) {
      actionsNode.append(
        createWidgetButton({ label: 'Unstage', title: 'Unstage this hunk', icon: 'minus', onClick: repo.unstageHunk.bind(repo, patch, hunk) })
      );
    }
    header.appendChild(actionsNode);
    return header;
  }

  // In the hunk view, the original editor is the column of the old line numbers on the left. It gets a view
  // zone as high as the header of the hunk, which continues the header over the column.
  createHunkGutter(first: boolean) {
    const node = createWidgetHeader('hunk-gutter', first);
    node.setAttribute('aria-hidden', 'true');
    return node;
  }

  createHunkWidgets() {
    // Create widgets
    const overlayWidgets: any[] = [];
    for (let i = 0; i < this.hunks.length; ++i) {
      const hunk = this.hunks[i];
      const id = `hunk.${this.overlayWidgets[Editor.Modified].length}`;

      const overlayNode = document.createElement('div');
      overlayNode.classList.add('hunk-widget');
      overlayNode.appendChild(this.createHunkHeader(hunk, i === 0));

      overlayWidgets.push({
        getId: () => id,
        getDomNode: () => overlayNode,
        getPosition: () => null
      });
      this.overlayWidgets[Editor.Modified].push(overlayWidgets[overlayWidgets.length - 1]);
    }
    // Add the widgets (we batch the calls)
    const editors = [this.editor.getOriginalEditor(), this.editor.getModifiedEditor()];
    editors[Editor.Modified].changeViewZones((changeAccessor: any) => {
      for (let i = 0; i < this.hunks.length; ++i) {
        const overlayWidget = overlayWidgets[i];
        editors[Editor.Modified].addOverlayWidget(overlayWidget);

        // Used only to compute the position.
        this.viewZoneIds[Editor.Modified].push(changeAccessor.addZone({
          afterLineNumber: i === 0 ? 0 : this.hunks[i].newStart - 1,
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
    // The diff editor aligns the lines of the two editors, the zones of the same height at the
    // same lines keep them aligned
    editors[Editor.Original].changeViewZones((changeAccessor: any) => {
      for (let i = 0; i < this.hunks.length; ++i) {
        this.viewZoneIds[Editor.Original].push(changeAccessor.addZone({
          afterLineNumber: i === 0 ? 0 : this.hunks[i].oldStart - 1,
          heightInPx: WIDGET_HEADER_HEIGHT,
          domNode: this.createHunkGutter(i === 0),
          marginDomNode: this.createHunkGutter(i === 0)
        }));
      }
    });
  }

  setHiddenAreas() {
    function createRange(start: number, end: number) {
      return {
        startLineNumber: start,
        endLineNumber: end
      };
    }

    // Compute hidden areas
    let oldStart = 1;
    const oldHiddenAreas = [];
    let newStart = 1;
    const newHiddenAreas = [];
    for (const hunk of this.hunks) {
      if (hunk.oldStart - 1 >= oldStart) {
        oldHiddenAreas.push(createRange(oldStart, hunk.oldStart - 1));
      }
      oldStart = hunk.oldStart + hunk.oldLines;
      if (hunk.newStart - 1 >= newStart) {
        newHiddenAreas.push(createRange(newStart, hunk.newStart - 1));
      }
      newStart = hunk.newStart + hunk.newLines;
    }
    if (oldStart <= this.props.oldString.split('\n').length) {
      oldHiddenAreas.push(createRange(oldStart, Infinity));
    }
    if (newStart <= this.props.newString.split('\n').length) {
      newHiddenAreas.push(createRange(newStart, Infinity));
    }
    // Hide areas
    this.editor.getOriginalEditor().setHiddenAreas(oldHiddenAreas);
    this.editor.getModifiedEditor().setHiddenAreas(newHiddenAreas);
  }

  setContextMenu(editor: any) {
    if (this.props.type === PatchType.Unstaged) {
      this.actionDisposables.push(
        editor.addAction({
          id: 'discard-selected-lines',
          label: 'Discard selected lines',
          contextMenuGroupId: '1_modification',
          run: this.handleSelectedLinesDiscard
        }),
        editor.addAction({
          id: 'stage-selected-lines',
          label: 'Stage selected lines',
          contextMenuGroupId: '1_modification',
          run: this.handleSelectedLinesStage
        })
      );
    }
    else if (this.props.type === PatchType.Staged) {
      this.actionDisposables.push(editor.addAction({
        id: 'unstage-selected-lines',
        label: 'Unstage selected lines',
        contextMenuGroupId: '1_modification',
        run: this.handleSelectedLinesUnstage
      }));
    }
  }

  updateMarginButtons() {
    if (this.marginButtonsDirty && this.props.type !== PatchType.Committed && this.viewMode === ViewMode.Hunk) {
      // The line changes are not available until the diff is computed
      if (this.createMarginButtons()) {
        this.marginButtonsDirty = false;
      }
    }
  }

  createMarginButtons() {
    const unstaged = this.props.type === PatchType.Unstaged;
    const className = unstaged ? 'stage-line-button' : 'unstage-line-button';
    const editors = [this.editor.getOriginalEditor(), this.editor.getModifiedEditor()];
    // The buttons are as high as the lines, whatever the font size
    const lineHeight = editors[Editor.Modified].getOption(monaco.editor.EditorOption.lineHeight);

    const createMarginButton = (iEditor: Editor, i: number, prefix: string) => {
      // Create an overlay widget
      const overlayNode = document.createElement('div');
      overlayNode.addEventListener('mousedown', this.handleMarginButtonClick.bind(this, i, iEditor));
      overlayNode.classList.add('margin-button', className, 'tooltip-right');
      // A shortcut for the mouse, the context menu of the editor stages the selected lines with the keyboard
      overlayNode.setAttribute('aria-hidden', 'true');
      overlayNode.style.width = `${lineHeight}px`;
      overlayNode.style.height = `${lineHeight}px`;
      const faceNode = document.createElement('span');
      faceNode.className = 'margin-button-face';
      faceNode.appendChild(createIconElement(unstaged ? 'plus' : 'minus', 12));
      overlayNode.appendChild(faceNode);
      const tooltipNode = document.createElement('span');
      tooltipNode.classList.add('tooltip-text');
      tooltipNode.textContent = unstaged ? 'Stage this line' : 'Unstage this line';
      overlayNode.appendChild(tooltipNode);
      const overlayWidget = {
        getId: () => `${prefix}-${i}`,
        getDomNode: () => overlayNode,
        getPosition: () => null
      };
      editors[Editor.Modified].addOverlayWidget(overlayWidget);
      this.overlayWidgets[Editor.Modified].push(overlayWidget);
      // Create a view zone to compute the position
      editors[iEditor].changeViewZones((changeAccessor: any) => {
        this.viewZoneIds[iEditor].push(changeAccessor.addZone({
          afterLineNumber: i,
          heightInLines: 0,
          domNode: document.createElement('div'),
          onDomNodeTop: (top: number) => {
            overlayNode.style.top = top - lineHeight + 'px';
          }
        }));
      });
    };

    const lineChanges = this.editor.getLineChanges();
    if (!lineChanges) {
      return false;
    }
    for (const line of lineChanges) {
      for (let i = line.originalStartLineNumber; i <= line.originalEndLineNumber; ++i) {
        createMarginButton(Editor.Original, i, 'old');
      }
      for (let i = line.modifiedStartLineNumber; i <= line.modifiedEndLineNumber; ++i) {
        createMarginButton(Editor.Modified, i, 'new');
      }
    }
    return true;
  }

  async getSelectedLines(editor: any) {
    const selection = editor.getSelection();
    const start = this.lines.findIndex((line) => line.newLineno === selection.startLineNumber);
    const end = this.lines.findIndex((line) => line.newLineno === selection.endLineNumber);
    const selectedLines = this.lines.slice(start, end + 1);
    return selectedLines;
  }

  render() {
    const rightButtons = [];
    if (this.props.type === PatchType.Unstaged) {
      rightButtons.push(
        <button type='button'
          className='danger-button small-button'
          title='Discard all the changes of the file'
          onClick={this.handleFileDiscard}
          key='discard'>
          <Icon name='undo-2' />
          <span className='button-label'>Discard file</span>
        </button>,
        <button type='button'
          className='primary-button small-button'
          title='Stage all the changes of the file'
          onClick={this.handleFileStage}
          key='stage'>
          <Icon name='plus' />
          <span className='button-label'>Stage file</span>
        </button>
      );
    } else if (this.props.type === PatchType.Staged) {
      rightButtons.push(
        <button type='button'
          className='small-button'
          title='Unstage all the changes of the file'
          onClick={this.handleFileUnstage}
          key='unstage'>
          <Icon name='minus' />
          <span className='button-label'>Unstage file</span>
        </button>
      );
    }
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
          <div className='segmented-control view-mode-selector' role='radiogroup' aria-label='View mode'>
            <input type='radio' id='hunk-mode' name='view-mode-selector'
              defaultChecked={this.viewMode === ViewMode.Hunk}
              onInput={this.handleViewModeChange.bind(this, ViewMode.Hunk)} />
            <label htmlFor='hunk-mode'>Hunk</label>
            <input type='radio' id='inline-mode' name='view-mode-selector'
              defaultChecked={this.viewMode === ViewMode.Inline}
              onInput={this.handleViewModeChange.bind(this, ViewMode.Inline)} />
            <label htmlFor='inline-mode'>Inline</label>
            <input type='radio' id='split-mode' name='view-mode-selector'
              defaultChecked={this.viewMode === ViewMode.Split}
              onInput={this.handleViewModeChange.bind(this, ViewMode.Split)} />
            <label htmlFor='split-mode'>Split</label>
          </div>
          <div className='patch-toolbar-end'>
            {rightButtons}
          </div>
        </div>
        <div className='patch-editor' ref={this.divEditor} />
      </>
    );
  }
}
