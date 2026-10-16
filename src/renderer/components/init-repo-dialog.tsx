import * as Path from 'path';
import * as React from 'react';
import { makeModal } from './make-modal';
import { showOpenDirectoryDialog } from '../helpers/native';

export class InitRepoFormProps {
  onClose: () => void;
  onInitRepo: (path: string) => void;
}

export class InitRepoFormState {
  repoName: string;
  repoPath: string;
  repoFolder: string;
}

class InitRepoForm extends React.PureComponent<InitRepoFormProps, InitRepoFormState> {
  constructor(props: InitRepoFormProps) {
    super(props);
    this.state = {
      repoName: '',
      repoPath: '',
      repoFolder: ''
    };
    this.handleRepoNameChange = this.handleRepoNameChange.bind(this);
    this.handleRepoPathChange = this.handleRepoPathChange.bind(this);
    this.handleBrowseClick = this.handleBrowseClick.bind(this);
    this.handleRepoFolderChange = this.handleRepoFolderChange.bind(this);
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

  handleRepoFolderChange(event: React.ChangeEvent<HTMLInputElement>) {
    this.setState({repoFolder: event.target.value});
  }

  handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (this.isPathValid()) {
      const folderName = this.state.repoFolder || this.state.repoName;
      const fullPath = Path.join(this.state.repoPath, folderName);
      this.props.onInitRepo(fullPath);
      this.props.onClose();
    }
  }

  isPathValid() {
    const folderName = this.state.repoFolder || this.state.repoName;
    return this.state.repoPath.length > 0 && folderName.length > 0;
  }

  render() {
    return (
      <form className='modal-form' onSubmit={this.handleSubmit}>
        <div className='field-container'>
          <label htmlFor='name'>Name:</label>
          <input type='text'
            id='name'
            name='repo-name'
            value={this.state.repoName}
            autoFocus={true}
            onChange={this.handleRepoNameChange} />
        </div>
        <div className='field-container'>
          <label htmlFor='path'>Initialize in:</label>
          <input type='text'
            id='path'
            name='repo-path'
            value={this.state.repoPath}
            onChange={this.handleRepoPathChange} />
          <button type='button'
            onClick={this.handleBrowseClick}>
            Browse
          </button>
        </div>
        <div className='field-container'>
          <label htmlFor='folder'>Full path:</label>
          <span id='prefix'>{this.state.repoPath}{Path.sep}</span>
          <input type='text'
            id='folder'
            name='repo-folder'
            placeholder={this.state.repoName}
            value={this.state.repoFolder}
            onChange={this.handleRepoFolderChange} />
        </div>
        <div className='button-container'>
          <button className='green-button'
            type='submit'
            disabled={!this.isPathValid()}>
            Create repository
          </button>
        </div>
      </form>
    );
  }
}

export const InitRepoDialog = makeModal(InitRepoForm);