import * as React from 'react';
import { PatchList } from './patch-list';
import { Icon } from './icon';
import { RepoWrapper, PatchType, RepoState, Patch } from '../helpers/repo-wrapper';

export interface IndexViewerProps {
  repo: RepoWrapper;
  repoState: RepoState;
  selectedPatch: Patch | null;
  onPatchSelect: (patch: Patch | null, type: PatchType) => void;
}

export interface IndexViewerState {
  amend: boolean;
  summary: string;
  description: string;
  selectedUnstagedPatches: Set<Patch>;
  selectedStagedPatches: Set<Patch>;
}

export class IndexViewer extends React.PureComponent<IndexViewerProps, IndexViewerState> {
  form: React.RefObject<HTMLFormElement | null>;
  iSelectedPatch: number;

  constructor(props: IndexViewerProps) {
    super(props);
    this.form = React.createRef<HTMLFormElement>();
    this.state = {
      amend: false,
      summary: '',
      description: '',
      selectedUnstagedPatches: new Set(),
      selectedStagedPatches: new Set()
    };
    this.handleUnstagedPatchSelect = this.handleUnstagedPatchSelect.bind(this);
    this.handleSelectedUnstagedPatchesChange = this.handleSelectedUnstagedPatchesChange.bind(this);
    this.handleStagedPatchSelect = this.handleStagedPatchSelect.bind(this);
    this.handleSelectedStagedPatchesChange = this.handleSelectedStagedPatchesChange.bind(this);
    this.handlePatchesStage = this.handlePatchesStage.bind(this);
    this.handlePatchesUnstage = this.handlePatchesUnstage.bind(this);
    this.handleAmendChange = this.handleAmendChange.bind(this);
    this.handleSummaryChange = this.handleSummaryChange.bind(this);
    this.handleDescriptionChange = this.handleDescriptionChange.bind(this);
    this.handleSubmit = this.handleSubmit.bind(this);
  }

  async componentDidMount() {
    if (this.props.repoState === RepoState.Merge) {
      this.setState({
        summary: await this.props.repo.getMergeMessage()
      });
    }
  }

  async componentDidUpdate(prevProps: IndexViewerProps) {
    if (prevProps.repoState !== this.props.repoState) {
      this.setState({
        summary: this.props.repoState === RepoState.Merge ? await this.props.repo.getMergeMessage() : ''
      });
    }
  }

  handleUnstagedPatchSelect(patch: Patch) {
    this.setState({
      selectedUnstagedPatches: new Set([patch]),
      selectedStagedPatches: new Set()
    });
    this.iSelectedPatch = this.props.repo.unstagedPatches.indexOf(patch);
    this.props.onPatchSelect(patch, PatchType.Unstaged);
  }

  handleSelectedUnstagedPatchesChange(selectedPatches: Set<Patch>) {
    this.setState({
      selectedUnstagedPatches: selectedPatches,
      selectedStagedPatches: new Set()
    });
    this.props.onPatchSelect(null, PatchType.Staged);
  }

  handleStagedPatchSelect(patch: Patch) {
    this.setState({
      selectedUnstagedPatches: new Set(),
      selectedStagedPatches: new Set([patch])
    });
    this.iSelectedPatch = this.props.repo.stagedPatches.indexOf(patch);
    this.props.onPatchSelect(patch, PatchType.Staged);
  }

  handleSelectedStagedPatchesChange(selectedPatches: Set<Patch>) {
    this.setState({
      selectedUnstagedPatches: new Set(),
      selectedStagedPatches: selectedPatches
    });
    this.props.onPatchSelect(null, PatchType.Staged);
  }

  handlePatchesStage() {
    if (this.props.selectedPatch || this.state.selectedUnstagedPatches.size === 0) {
      this.props.repo.stageAll(this.props.repo.unstagedPatches);
    } else if (this.state.selectedUnstagedPatches.size > 0) {
      this.props.repo.stageAll([...this.state.selectedUnstagedPatches]);
    }
    this.setState({
      selectedUnstagedPatches: new Set()
    });
  }

  handlePatchesUnstage() {
    if (this.props.selectedPatch || this.state.selectedStagedPatches.size === 0) {
      this.props.repo.unstageAll(this.props.repo.stagedPatches);
    } else if (this.state.selectedStagedPatches.size > 0) {
      this.props.repo.unstageAll([...this.state.selectedStagedPatches]);
    }
    this.setState({
      selectedStagedPatches: new Set()
    });
  }

  handleAmendChange(event: React.ChangeEvent<HTMLInputElement>) {
    if (this.props.repo.headCommit) {
      const newState = {
        amend: event.target.checked
      } as IndexViewerState;
      if (newState.amend && !this.state.summary) {
        newState.summary = this.props.repo.headCommit.summary();
      }
      this.setState(newState);
    }
  }

  handleSummaryChange(event: React.ChangeEvent<HTMLInputElement>) {
    this.setState({summary: event.target.value});
  }

  handleDescriptionChange(event: React.ChangeEvent<HTMLTextAreaElement>) {
    this.setState({description: event.target.value});
  }

  refreshSelectedPatch(unstagedPatch: boolean) {
    const patches = unstagedPatch ?
      [this.props.repo.unstagedPatches, this.props.repo.stagedPatches] :
      [this.props.repo.stagedPatches, this.props.repo.unstagedPatches];
    const handler = unstagedPatch ?
      [this.handleUnstagedPatchSelect, this.handleStagedPatchSelect] :
      [this.handleStagedPatchSelect, this.handleUnstagedPatchSelect];
    const path = this.props.selectedPatch!.newFile.path;
    // Try to find the find in the same list
    let patch = patches[0].find((patch) => path === patch.newFile.path);
    if (patch) {
      handler[0].call(this, patch);
      return;
    }
    // If there is another patch in this list, select it
    if (patches[0].length > 0) {
      const i = this.iSelectedPatch < patches[0].length ?
        this.iSelectedPatch :
        Math.max(patches[0].length - 1, this.iSelectedPatch - 1);
      handler[0].call(this, patches[0][i]);
      return;
    }
    // Otherwise, try to find the file in the other list
    patch = patches[1].find((patch) => path === patch.newFile.path);
    if (patch) {
      handler[1].call(this, patch);
      return;
    }
    // Finally, if there nothing succeeded reset the selected patch
    this.props.onPatchSelect(null, PatchType.Committed);
  }

  resize(offset: number) {
    if (this.form.current) {
      this.form.current.style.width = `${this.form.current.clientWidth - offset}px`;
    }
  }

  async handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (this.state.summary) {
      const message = this.state.description ?
        `${this.state.summary}\n\n${this.state.description}` :
        this.state.summary;
      if (this.props.repoState === RepoState.Merge) {
        await this.props.repo.finishMerge(message);
      } else {
        if (this.state.amend) {
          await this.props.repo.amend(message);
        } else {
          await this.props.repo.commit(message);
        }
      }
      // Close path viewer if it is open
      this.props.onPatchSelect(null, PatchType.Committed);
      // Reset the state
      this.setState({
        amend: false,
        summary: '',
        description: '',
        selectedUnstagedPatches: new Set(),
        selectedStagedPatches: new Set()
      });
    }
  }

  formatButtonString(prefix: string, patches: Set<Patch>) {
    if (this.props.selectedPatch || patches.size === 0) {
      return `${prefix} all changes`;
    } else if (patches.size === 1) {
      return `${prefix} 1 file`;
    } else {
      return `${prefix} ${patches.size} files`;
    }
  }

  getSubmitButton() {
    if (this.props.repoState === RepoState.Merge) {
      return (
        <>
          <button className='primary-button'
            type='submit'
            disabled={this.props.repo.unstagedPatches.some((patch) => patch.isConflicted())}>
            <Icon name='git-merge' />
            Commit and merge
          </button>
          <button className='danger-button'
            type='button'
            onClick={() => this.props.repo.abortMerge()}>
            <Icon name='x' />
            Abort merge
          </button>
        </>
      );
    } else {
      return (
        <button className='primary-button'
          type='submit'
          disabled={this.state.summary.length === 0}>
          <Icon name='git-commit-horizontal' />
          {this.state.amend ? 'Amend' : 'Commit'}
        </button>
      );
    }
  }

  render() {
    const unstagedCount = this.props.repo.unstagedPatches.length;
    const stagedCount = this.props.repo.stagedPatches.length;
    const merging = this.props.repoState === RepoState.Merge;
    return (
      <form className='commit-viewer index-viewer' ref={this.form} onSubmit={this.handleSubmit}>
        <div className='viewer-header'>
          <h2 className='viewer-title'>Index</h2>
          {merging ?
            <span className='merge-state'>
              <Icon name='git-merge' size={14} />
              Merging
            </span> :
            null}
        </div>
        <div className='viewer-body'>
          <div className='index-section' role='group' aria-labelledby='unstaged-files-title'>
            <div className='section-header'>
              <h3 className='section-label' id='unstaged-files-title'>Unstaged files ({unstagedCount})</h3>
              <button className='small-button'
                type='button'
                disabled={unstagedCount === 0}
                onClick={this.handlePatchesStage}>
                <Icon name='plus' size={14} />
                {this.formatButtonString('Stage', this.state.selectedUnstagedPatches)}
              </button>
            </div>
            <PatchList repo={this.props.repo}
              patches={this.props.repo.unstagedPatches}
              type={PatchType.Unstaged}
              selectedPatch={this.props.selectedPatch}
              selectedPatches={this.state.selectedUnstagedPatches}
              onPatchSelect={this.handleUnstagedPatchSelect}
              onSelectedPatchesChange={this.handleSelectedUnstagedPatchesChange} />
          </div>
          <div className='index-section' role='group' aria-labelledby='staged-files-title'>
            <div className='section-header'>
              <h3 className='section-label' id='staged-files-title'>Staged files ({stagedCount})</h3>
              <button className='small-button'
                type='button'
                disabled={stagedCount === 0}
                onClick={this.handlePatchesUnstage}>
                <Icon name='minus' size={14} />
                {this.formatButtonString('Unstage', this.state.selectedStagedPatches)}
              </button>
            </div>
            <PatchList repo={this.props.repo}
              patches={this.props.repo.stagedPatches}
              type={PatchType.Staged}
              selectedPatch={this.props.selectedPatch}
              selectedPatches={this.state.selectedStagedPatches}
              onPatchSelect={this.handleStagedPatchSelect}
              onSelectedPatchesChange={this.handleSelectedStagedPatchesChange} />
          </div>
          <div className='commit-form' role='group' aria-labelledby='commit-message-title'>
            <div className='section-header'>
              <h3 className='section-label' id='commit-message-title'>Commit message</h3>
              {this.props.repo.headCommit && !merging ?
                <div className='check-field'>
                  <input type='checkbox' id='amend' name='amend' checked={this.state.amend} onChange={this.handleAmendChange} />
                  <label htmlFor='amend'>Amend</label>
                </div> :
                null}
            </div>
            <input placeholder='Summary'
              value={this.state.summary}
              onChange={this.handleSummaryChange} />
            <textarea rows={3}
              placeholder='Description'
              value={this.state.description}
              onChange={this.handleDescriptionChange} />
            <div className='submit-row'>
              {this.getSubmitButton()}
            </div>
          </div>
        </div>
      </form>
    );
  }
}
