import * as React from 'react';
import { RepoPath } from '../helpers/dialogs';
import { Icon } from './icon';

export interface RepoPathHintProps {
  id: string;
  // Path of the repository that the dialog creates, null until it is known
  path: RepoPath | null;
  // What is missing to know the path
  hint: string;
}

// Hint of the dialogs that create a repository: its full path, shortened in the middle, or what is missing to know it
export class RepoPathHint extends React.PureComponent<RepoPathHintProps, {}> {
  render() {
    const path = this.props.path;
    return (
      <p className='field-hint repo-path' id={this.props.id} title={path ? path.fullPath : undefined}>
        <Icon name='folder-git-2' size={14} />
        {path ?
          <>
            <span className='ellipsis-middle' aria-hidden='true'>
              <span className='left'>{path.location}</span>
              <span className='right'>{path.name}</span>
            </span>
            {/* Read instead of the shortened path, which screen readers would read in two parts */}
            <span className='visually-hidden'>{path.fullPath}</span>
          </> :
          <span>{this.props.hint}</span>}
      </p>
    );
  }
}
