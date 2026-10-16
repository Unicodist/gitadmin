import * as React from 'react';
import { RepoWrapper, Patch } from '../helpers/repo-wrapper';
import { IconName } from '../helpers/icons';
import { formatFileSize } from '../helpers/viewer-format';
import { Icon } from './icon';

interface ImageSize {
  width: number;
  height: number;
}

export interface ImagePatchViewerProps {
  repo: RepoWrapper;
  patch: Patch;
  oldBuffer: Buffer;
  newBuffer: Buffer;
}

export interface ImagePatchViewerState {
  // Sizes in pixels, known once the images are loaded
  oldSize: ImageSize | null;
  newSize: ImageSize | null;
}

export class ImagePatchViewer extends React.PureComponent<ImagePatchViewerProps, ImagePatchViewerState> {
  oldUrl: string;
  newUrl: string;
  oldBuffer: Buffer | null;
  newBuffer: Buffer | null;

  constructor(props: ImagePatchViewerProps) {
    super(props);
    this.oldBuffer = null;
    this.newBuffer = null;
    this.state = {
      oldSize: null,
      newSize: null
    };
    this.handleOldImageLoad = this.handleOldImageLoad.bind(this);
    this.handleNewImageLoad = this.handleNewImageLoad.bind(this);
  }

  componentDidUpdate(prevProps: ImagePatchViewerProps) {
    if (this.props.oldBuffer !== prevProps.oldBuffer || this.props.newBuffer !== prevProps.newBuffer) {
      this.setState({
        oldSize: null,
        newSize: null
      });
    }
  }

  componentWillUnmount() {
    if (this.oldUrl) {
      URL.revokeObjectURL(this.oldUrl);
    }
    if (this.newUrl) {
      URL.revokeObjectURL(this.newUrl);
    }
  }

  handleOldImageLoad(event: React.SyntheticEvent<HTMLImageElement>) {
    this.setState({ oldSize: { width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight } });
  }

  handleNewImageLoad(event: React.SyntheticEvent<HTMLImageElement>) {
    this.setState({ newSize: { width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight } });
  }

  // The urls are only created again for new buffers, the images would be loaded again at each render
  updateUrls() {
    if (this.props.oldBuffer !== this.oldBuffer) {
      if (this.oldUrl) {
        URL.revokeObjectURL(this.oldUrl);
      }
      this.oldUrl = URL.createObjectURL(new Blob([new Uint8Array(this.props.oldBuffer)]));
      this.oldBuffer = this.props.oldBuffer;
    }
    if (this.props.newBuffer !== this.newBuffer) {
      if (this.newUrl) {
        URL.revokeObjectURL(this.newUrl);
      }
      this.newUrl = URL.createObjectURL(new Blob([new Uint8Array(this.props.newBuffer)]));
      this.newBuffer = this.props.newBuffer;
    }
  }

  renderImage(label: string, url: string, buffer: Buffer, size: ImageSize | null, onLoad: React.ReactEventHandler<HTMLImageElement>) {
    const details = [size ? `${size.width} × ${size.height} px` : null, formatFileSize(buffer.length)];
    return (
      <>
        <div className='image-frame'>
          <img src={url} alt={`${label} version`} onLoad={onLoad} />
        </div>
        <p className='image-details'>{details.filter((detail) => detail).join(' · ')}</p>
      </>
    );
  }

  renderMissingImage(icon: IconName, title: string, hint: string) {
    return (
      <div className='image-frame image-missing'>
        <div className='viewer-empty-state'>
          <Icon name={icon} size={24} />
          <p className='empty-state-title'>{title}</p>
          <p className='empty-state-hint'>{hint}</p>
        </div>
      </div>
    );
  }

  render() {
    this.updateUrls();
    const patch = this.props.patch;
    return (
      <div className='image-viewer'>
        <figure className='image-side'>
          <figcaption className='section-label'>Old</figcaption>
          {patch.oldFile.exists ?
            this.renderImage('Old', this.oldUrl, this.props.oldBuffer, this.state.oldSize, this.handleOldImageLoad) :
            this.renderMissingImage('file-plus', 'No old version', 'The file is new')}
        </figure>
        <figure className='image-side'>
          <figcaption className='section-label'>New</figcaption>
          {patch.newFile.exists ?
            this.renderImage('New', this.newUrl, this.props.newBuffer, this.state.newSize, this.handleNewImageLoad) :
            this.renderMissingImage('file-minus', 'No new version', 'The file was deleted')}
        </figure>
      </div>
    );
  }
}
