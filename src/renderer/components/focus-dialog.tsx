import * as React from 'react';
import { Reference } from '../helpers/git/model';
import { MAX_FOCUSED_REFERENCES } from '../helpers/branch-focus';
import { BranchPicker } from './branch-picker';
import { makeModal } from './make-modal';

export type FocusDialogHandler = (references: Reference[], focus: string[], onFocusChange: (focus: string[]) => void) => void;

export class FocusFormProps {
  references: Reference[];
  focus: string[];
  onFocusChange: (focus: string[]) => void;
  onClose: () => void;
}

export class FocusFormState {
  draft: string[];
}

// Edits a copy of the focus, the graph only changes when it is applied
class FocusForm extends React.PureComponent<FocusFormProps, FocusFormState> {
  constructor(props: FocusFormProps) {
    super(props);
    this.state = {
      draft: [...this.props.focus]
    };
    this.handleDraftChange = this.handleDraftChange.bind(this);
    this.handleSubmit = this.handleSubmit.bind(this);
  }

  handleDraftChange(draft: string[]) {
    this.setState({ draft: draft });
  }

  handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // An empty focus shows every branch
    this.props.onFocusChange(this.state.draft);
    this.props.onClose();
  }

  render() {
    return (
      <form className='modal-form focus-form' onSubmit={this.handleSubmit}>
        <div className='modal-body'>
          <p className='field-hint'>
            The graph shows only the history of the chosen branches, and how they relate. Choose none to show everything.
          </p>
          <BranchPicker references={this.props.references}
            selected={this.state.draft}
            max={MAX_FOCUSED_REFERENCES}
            autoFocus={true}
            onChange={this.handleDraftChange} />
        </div>
        <div className='modal-footer'>
          <button type='button' onClick={this.props.onClose}>
            Cancel
          </button>
          <button className='primary-button' type='submit'>
            Show
          </button>
        </div>
      </form>
    );
  }
}

export const FocusDialog = makeModal(FocusForm);
