import * as React from 'react';
import { makeModal } from './make-modal';
import { showOpenDirectoryDialog } from '../helpers/native';
import { getRepoPath } from '../helpers/dialogs';
import { Icon } from './icon';
import { RepoPathHint } from './repo-path-hint';

export class InitRepoFormProps {
  onClose: () => void;
  onInitRepo: (path: string) => void;
}

export class InitRepoFormState {
  repoName: string;
  repoPath: string;
}

class InitRepoForm extends React.PureComponent<InitRepoFormProps, InitRepoFormState> {
  constructor(props: InitRepoFormProps) {
    super(props);
    this.state = {
      repoName: '',
      repoPath: ''
    };
    this.handleRepoNameChange = this.handleRepoNameChange.bind(this);
    this.handleRepoPathChange = this.handleRepoPathChange.bind(this);
    this.handleBrowseClick = this.handleBrowseClick.bind(this);
    this.handleSubmit = this.handleSubmit.bind(this);
  }

  handleRepoNameChange(event: React.ChangeEvent<HTMLInputElement>) {
    this.setState({repoName: event.target.value});
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

  handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const path = getRepoPath(this.state.repoPath, this.state.repoName);
    if (path) {
      this.props.onInitRepo(path.fullPath);
      this.props.onClose();
    }
  }

  render() {
    const path = getRepoPath(this.state.repoPath, this.state.repoName);
    return (
      <form className='modal-form repo-path-form' onSubmit={this.handleSubmit}>
        <div className='modal-body'>
          <div className='field'>
            <label htmlFor='init-name'>Name</label>
            <input type='text'
              id='init-name'
              name='repo-name'
              value={this.state.repoName}
              autoFocus={true}
              spellCheck={false}
              onChange={this.handleRepoNameChange} />
          </div>
          <div className='field'>
            <label htmlFor='init-location'>Location</label>
            <div className='input-row'>
              <input type='text'
                id='init-location'
                name='repo-path'
                value={this.state.repoPath}
                spellCheck={false}
                aria-describedby='init-full-path'
                onChange={this.handleRepoPathChange} />
              <button type='button' onClick={this.handleBrowseClick}>
                <Icon name='folder-open' />
                Browse
              </button>
            </div>
            <RepoPathHint id='init-full-path'
              path={path}
              hint={this.state.repoPath ? 'Enter the name of the repository' : 'Choose where to put the repository'} />
          </div>
        </div>
        <div className='modal-footer'>
          <button type='button' onClick={this.props.onClose}>
            Cancel
          </button>
          <button className='primary-button'
            type='submit'
            disabled={path === null}>
            Create repository
          </button>
        </div>
      </form>
    );
  }
}

export const InitRepoDialog = makeModal(InitRepoForm);
