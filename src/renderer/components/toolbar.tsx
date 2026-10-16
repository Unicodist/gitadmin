import * as React from 'react';
import { RepoWrapper, removeReferencePrefix, Commit } from '../helpers/repo-wrapper';
import { Icon } from './icon';
import { SpinnerButton } from './spinner-button';

export class ToolbarProps {
  repo: RepoWrapper;
  selectedCommit: Commit | null;
  onRepoClose: () => void;
  onCreateBranch: (commit: Commit) => void;
}

export class Toolbar extends React.PureComponent<ToolbarProps, {}> {
  constructor(props: ToolbarProps) {
    super(props);
    this.handleFetchButtonClick = this.handleFetchButtonClick.bind(this);
    this.handlePullButtonClick = this.handlePullButtonClick.bind(this);
    this.handlePushButtonClick = this.handlePushButtonClick.bind(this);
    this.handleBranchButtonClick = this.handleBranchButtonClick.bind(this);
    this.handleStashButtonClick = this.handleStashButtonClick.bind(this);
    this.handlePopButtonClick = this.handlePopButtonClick.bind(this);
  }

  async handleFetchButtonClick() {
    await this.props.repo.fetchAll();
  }

  async handlePullButtonClick() {
    if (this.props.repo.head) {
      await this.props.repo.pull(removeReferencePrefix(this.props.repo.head.name()));
    }
  }

  async handlePushButtonClick() {
    await this.props.repo.push();
  }

  handleBranchButtonClick() {
    // Replace sha by commit
    if (this.props.selectedCommit === null && this.props.repo.headCommit) {
      this.props.onCreateBranch(this.props.repo.headCommit);
    } else if (this.props.selectedCommit) {
      this.props.onCreateBranch(this.props.selectedCommit);
    }
  }

  async handleStashButtonClick() {
    await this.props.repo.stash();
  }

  async handlePopButtonClick() {
    await this.props.repo.popStash();
  }

  render() {
    return (
      <div className='repo-toolbar'>
        <div className='repo-title' title={this.props.repo.workdir}>
          <span className='repo-icon'>
            <Icon name='folder-git-2' />
          </span>
          <h1>{this.props.repo.name}</h1>
        </div>
        <div className='toolbar-buttons'>
          <div className='toolbar-group' role='group' aria-label='Remote actions'>
            <SpinnerButton value='Fetch'
              icon='cloud-download'
              className='ghost-button'
              title='Fetch from all the remotes'
              onClick={this.handleFetchButtonClick} />
            <SpinnerButton value='Pull'
              icon='arrow-down-to-line'
              className='ghost-button'
              title='Pull the current branch from origin'
              onClick={this.handlePullButtonClick} />
            <SpinnerButton value='Push'
              icon='arrow-up-from-line'
              className='ghost-button'
              title='Push the current branch to origin'
              onClick={this.handlePushButtonClick} />
          </div>
          <div className='toolbar-group' role='group' aria-label='Branch actions'>
            <button type='button'
              className='ghost-button'
              title='Create a branch at the selected commit'
              onClick={this.handleBranchButtonClick}>
              <Icon name='git-branch-plus' />
              Branch
            </button>
          </div>
          <div className='toolbar-group' role='group' aria-label='Stash actions'>
            <SpinnerButton value='Stash'
              icon='archive'
              className='ghost-button'
              title='Stash the uncommitted changes'
              onClick={this.handleStashButtonClick} />
            <SpinnerButton value='Pop'
              icon='archive-restore'
              className='ghost-button'
              title='Apply the last stash and remove it'
              onClick={this.handlePopButtonClick} />
          </div>
        </div>
        <div className='toolbar-end'>
          <button type='button'
            className='ghost-button'
            title='Close the repository'
            onClick={this.props.onRepoClose}>
            <Icon name='x' />
            Close
          </button>
        </div>
      </div>
    );
  }
}