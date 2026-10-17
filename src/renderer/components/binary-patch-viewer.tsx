import * as React from 'react';
import { Icon } from './icon';

export class BinaryPatchViewer extends React.PureComponent<{}, {}> {
  render() {
    return (
      <div className='binary-viewer'>
        <div className='viewer-empty-state'>
          <Icon name='binary' size={32} />
          <p className='empty-state-title'>Binary file</p>
          <p className='empty-state-hint'>No preview available</p>
        </div>
      </div>
    );
  }
}
