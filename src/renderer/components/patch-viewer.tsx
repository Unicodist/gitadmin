import * as React from 'react';
import { fileTypeFromBuffer, FileTypeResult } from 'file-type';
import { isBinaryFile } from 'isbinaryfile';
import { RepoWrapper, PatchType, Patch, DiffFile } from '../helpers/repo-wrapper';
import { CancellablePromise, makeCancellable } from '../helpers/make-cancellable';
import { arePatchesEqual } from '../helpers/patch-comparison';
import { describePatchPath, getPatchStatusDisplay, splitPath } from '../helpers/patch-status';
import { getPatchIcon } from '../helpers/viewer-format';
import { Icon } from './icon';
import { TextPatchViewer, TextPatchViewerOptions } from './text-patch-viewer';
import { BinaryPatchViewer } from './binary-patch-viewer';
import { ImagePatchViewer } from './image-patch-viewer';
import { ConflictViewer } from './conflict-viewer';

enum BlobType {
  Void,
  Text,
  Binary,
  Image
}

type Blob = [Buffer, BlobType];

// Util

function isImage(type: FileTypeResult | undefined) {
  return type !== undefined && type.mime.startsWith('image');
}

async function getBlob(repo: RepoWrapper, patch: Patch, file: DiffFile) {
  const buffer = await repo.readFile(file);
  let type = BlobType.Text;
  const binary = patch.isBinary || await isBinaryFile(buffer);
  if (binary) {
    type = isImage(await fileTypeFromBuffer(buffer)) ? BlobType.Image : BlobType.Binary;
  }
  return [buffer, type] as Blob;
}

function getViewerType(oldType: BlobType, newType: BlobType) {
  switch (oldType) {
    case BlobType.Void:
      return newType;
    case BlobType.Image:
      return newType === BlobType.Image || newType === BlobType.Void ? BlobType.Image : BlobType.Binary;
    case BlobType.Text:
      return newType === BlobType.Text || newType === BlobType.Void ? BlobType.Text : BlobType.Binary;
    default:
      return BlobType.Binary;
  }
}

// PatchViewer

export interface PatchViewerProps {
  repo: RepoWrapper;
  patch: Patch;
  patchType: PatchType;
  editorTheme: string;
  options: TextPatchViewerOptions;
  onClose: () => void;
}

export interface PatchViewerState {
  loadedPatch: Patch | null;
  oldBlob: Buffer;
  newBlob: Buffer;
  viewerType: BlobType;
}

export class PatchViewer extends React.PureComponent<PatchViewerProps, PatchViewerState> {
  blobsPromise: CancellablePromise<[Blob, Blob]>;

  constructor(props: PatchViewerProps) {
    super(props);
    this.state = {
      loadedPatch: null,
      oldBlob: Buffer.from(''),
      newBlob: Buffer.from(''),
      viewerType: BlobType.Text
    };
    this.handleKeyDown = this.handleKeyDown.bind(this);
  }

  componentDidMount() {
    window.addEventListener('keydown', this.handleKeyDown);
    this.loadData();
  }

  componentDidUpdate(prevProps: PatchViewerProps) {
    // If the patch objects are the same, we do not load a second time
    // If the pach is untracked, conflicted or the patches are not exactly the same, we update
    if (this.props.patch !== prevProps.patch &&
      (this.props.patch.isUntracked() || this.props.patch.isConflicted() || !arePatchesEqual(this.props.patch, prevProps.patch))) {
      this.loadData();
    }
  }

  componentWillUnmount() {
    if (this.blobsPromise) {
      this.blobsPromise.cancel();
    }
    window.removeEventListener('keydown', this.handleKeyDown);
  }

  handleKeyDown(event: KeyboardEvent) {
    // Escape is left to what handled it first, like the find widget of the editor, and to the dialogs
    if (event.key !== 'Escape' || event.defaultPrevented ||
      (event.target instanceof Element && event.target.closest('[aria-modal="true"]'))) {
      return;
    }
    this.props.onClose();
  }

  async loadData() {
    const repo = this.props.repo;
    const patch = this.props.patch;
    // Load old blob
    let oldPromise: Promise<Blob>;
    if (this.props.patch.isAdded() || this.props.patch.isUntracked()) {
      oldPromise = new Promise((resolve) => resolve([Buffer.from(''), BlobType.Void]));
    } else {
      oldPromise = getBlob(repo, patch, patch.oldFile);
    }
    // Load new blob
    let newPromise: Promise<Blob>;
    if (this.props.patch.isDeleted()) {
      newPromise = new Promise((resolve) => resolve([Buffer.from(''), BlobType.Void]));
    } else {
      newPromise = getBlob(repo, patch, patch.newFile);
    }
    // Create a cancellable promise
    if (this.blobsPromise) {
      this.blobsPromise.cancel();
    }
    this.blobsPromise = makeCancellable(Promise.all([oldPromise, newPromise]));
    try {
      const [[oldBlob, oldType], [newBlob, newType]] = await this.blobsPromise.promise;
      this.setState({
        loadedPatch: this.props.patch,
        oldBlob: oldBlob,
        newBlob: newBlob,
        viewerType: getViewerType(oldType, newType)
      });
    } catch (e) {
    }
  }

  render() {
    let viewer: React.JSX.Element | null = null;
    if (this.state.loadedPatch) {
      if (this.state.viewerType === BlobType.Text) {
        if (this.props.patchType === PatchType.Unstaged && this.props.patch.isConflicted()) {
          viewer = <ConflictViewer repo={this.props.repo}
            patch={this.props.patch}
            content={this.state.newBlob.toString()}
            editorTheme={this.props.editorTheme}
            options={this.props.options} />;
        } else {
          viewer = <TextPatchViewer repo={this.props.repo}
            patch={this.state.loadedPatch}
            oldString={this.state.oldBlob.toString()}
            newString={this.state.newBlob.toString()}
            type={this.props.patchType}
            editorTheme={this.props.editorTheme}
            options={this.props.options} />;
        }
      } else if (this.state.viewerType === BlobType.Image) {
        viewer = <ImagePatchViewer repo={this.props.repo}
          patch={this.props.patch}
          oldBuffer={this.state.oldBlob}
          newBuffer={this.state.newBlob} />;
      } else {
        viewer = <BinaryPatchViewer />;
      }
    }
    const patch = this.props.patch;
    const status = getPatchStatusDisplay(patch.status);
    const [folder, fileName] = splitPath(patch.newFile.path);
    return (
      <div className='patch-viewer'>
        <div className='patch-header'>
          <span className={`patch-file-icon ${status.className}`} title={status.label}>
            <Icon name={getPatchIcon(patch.status)} />
            <span className='visually-hidden'>{status.label}</span>
          </span>
          <h2 className='patch-path ellipsis-middle'
            aria-label={patch.newFile.path}
            title={describePatchPath(patch.status, patch.oldFile.path, patch.newFile.path)}>
            <span className='left'>{folder}</span>
            <span className='right'>{fileName}</span>
          </h2>
          <button type='button'
            className='ghost-button icon-button'
            aria-label='Close diff'
            aria-keyshortcuts='Escape'
            title='Close diff'
            onClick={this.props.onClose}>
            <Icon name='x' />
          </button>
        </div>
        {viewer}
      </div>
    );
  }
}
