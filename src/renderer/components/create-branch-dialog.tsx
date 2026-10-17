import * as React from 'react';
import { RepoWrapper, Commit } from '../helpers/repo-wrapper';
import { makeModal } from './make-modal';

export class CreateBranchFormProps {
  repo: RepoWrapper;
  commit: Commit;
  onClose: () => void;
}

export class CreateBranchFormState {
  branchName: string;
  checkout: boolean;
}

class CreateBranchForm extends React.PureComponent<CreateBranchFormProps, CreateBranchFormState> {
  constructor(props: CreateBranchFormProps) {
    super(props);
    this.state = {
      branchName: '',
      checkout: true
    };
    this.handleBranchNameChange = this.handleBranchNameChange.bind(this);
    this.handleCheckoutChange = this.handleCheckoutChange.bind(this);
    this.handleSubmit = this.handleSubmit.bind(this);
  }

  handleBranchNameChange(event: React.ChangeEvent<HTMLInputElement>) {
    this.setState({branchName: event.target.value});
  }

  handleCheckoutChange(event: React.ChangeEvent<HTMLInputElement>) {
    this.setState({checkout: event.target.checked});
  }

  async handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (this.state.branchName) {
      const reference = await this.props.repo.createBranch(this.state.branchName, this.props.commit);
      if (reference && this.state.checkout) {
        this.props.repo.checkoutReference(reference);
      }
      this.props.onClose();
    }
  }

  render() {
    const commit = this.props.commit;
    return (
      <form className='modal-form' onSubmit={this.handleSubmit}>
        <div className='modal-body'>
          <div className='field'>
            <label htmlFor='branch-name'>Name</label>
            <input type='text'
              id='branch-name'
              name='branch-name'
              value={this.state.branchName}
              autoFocus={true}
              spellCheck={false}
              aria-describedby='branch-start'
              onChange={this.handleBranchNameChange} />
            <p className='field-hint branch-start' id='branch-start' title={commit.summary()}>
              Starts at <code>{commit.sha().substring(0, 7)}</code> {commit.summary()}
            </p>
          </div>
          <div className='check-field'>
            <input type='checkbox'
              id='branch-checkout'
              name='checkout'
              checked={this.state.checkout}
              onChange={this.handleCheckoutChange} />
            <label htmlFor='branch-checkout'>Check out the new branch</label>
          </div>
        </div>
        <div className='modal-footer'>
          <button type='button' onClick={this.props.onClose}>
            Cancel
          </button>
          <button className='primary-button'
            type='submit'
            disabled={!this.state.branchName}>
            Create branch
          </button>
        </div>
      </form>
    );
  }
}

export const CreateBranchDialog = makeModal(CreateBranchForm);
