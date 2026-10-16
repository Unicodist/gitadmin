import * as React from 'react';
import { makeModal } from './make-modal';
import { showOpenDirectoryDialog } from '../helpers/native';
import { getCloneFolderName, getRepoPath } from '../helpers/dialogs';
import { Icon } from './icon';
import { RepoPathHint } from './repo-path-hint';

export class CloneRepoFormProps {
  onClose: () => void;
  onCloneRepo: (url: string, path: string) => void;
}

export class CloneRepoFormState {
  repoPath: string;
  repoUrl: string;
  repoFolder: string;
}

class CloneRepoForm extends React.PureComponent<CloneRepoFormProps, CloneRepoFormState> {
  constructor(props: CloneRepoFormProps) {
    super(props);
    this.state = {
      repoPath: '',
      repoUrl: '',
      repoFolder: ''
    };
    this.handleRepoPathChange = this.handleRepoPathChange.bind(this);
    this.handleBrowseClick = this.handleBrowseClick.bind(this);
    this.handleRepoUrlChange = this.handleRepoUrlChange.bind(this);
    this.handleRepoFolderChange = this.handleRepoFolderChange.bind(this);
    this.handleSubmit = this.handleSubmit.bind(this);
  }

  handleRepoPathChange(event: React.ChangeEvent<HTMLInputElement>) {
    this.setState({repoPath: event.target.value});
  }

  handleBrowseClick() {
    showOpenDirectoryDialog().then((path) => {
      if (path) {
        this.setState({repoPath: path});
      }
    });
  }

  handleRepoUrlChange(event: React.ChangeEvent<HTMLInputElement>) {
    this.setState({repoUrl: event.target.value});
  }

  handleRepoFolderChange(event: React.ChangeEvent<HTMLInputElement>) {
    this.setState({repoFolder: event.target.value});
  }

  handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const path = this.getPath();
    if (path) {
      this.props.onCloneRepo(this.state.repoUrl.trim(), path.fullPath);
      this.props.onClose();
    }
  }

  // Path of the clone, the name of its folder comes from the URL unless it is given
  getPath() {
    if (!this.state.repoUrl.trim()) {
      return null;
    }
    return getRepoPath(this.state.repoPath, this.state.repoFolder || getCloneFolderName(this.state.repoUrl));
  }

  // What is missing to know the path of the clone
  getPathHint() {
    if (!this.state.repoPath) {
      return 'Choose where to put the repository';
    }
    return this.state.repoUrl.trim() ? 'Enter the name of the folder' : 'Enter the URL of the repository';
  }

  render() {
    const path = this.getPath();
    return (
      <form className='modal-form repo-path-form' onSubmit={this.handleSubmit}>
        <div className='modal-body'>
          <div className='field'>
            <label htmlFor='clone-url'>Repository URL</label>
            <input type='text'
              id='clone-url'
              name='repo-url'
              placeholder='https://example.com/owner/repo.git'
              value={this.state.repoUrl}
              autoFocus={true}
              spellCheck={false}
              onChange={this.handleRepoUrlChange} />
          </div>
          <div className='field'>
            <label htmlFor='clone-location'>Location</label>
            <div className='input-row'>
              <input type='text'
                id='clone-location'
                name='repo-path'
                value={this.state.repoPath}
                spellCheck={false}
                onChange={this.handleRepoPathChange} />
              <button type='button' onClick={this.handleBrowseClick}>
                <Icon name='folder-open' />
                Browse
              </button>
            </div>
          </div>
          <div className='field'>
            <label htmlFor='clone-folder'>Folder name</label>
            <input type='text'
              id='clone-folder'
              name='repo-folder'
              placeholder={getCloneFolderName(this.state.repoUrl)}
              value={this.state.repoFolder}
              spellCheck={false}
              aria-describedby='clone-full-path'
              onChange={this.handleRepoFolderChange} />
            <RepoPathHint id='clone-full-path' path={path} hint={this.getPathHint()} />
          </div>
        </div>
        <div className='modal-footer'>
          <button type='button' onClick={this.props.onClose}>
            Cancel
          </button>
          <button className='primary-button'
            type='submit'
            disabled={path === null}>
            Clone
          </button>
        </div>
      </form>
    );
  }
}

export const CloneRepoDialog = makeModal(CloneRepoForm);
