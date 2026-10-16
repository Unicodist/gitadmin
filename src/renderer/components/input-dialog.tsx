import * as React from 'react';
import { makeModal } from './make-modal';

export type InputDialogHandler = (title: string,
  label: string,
  button: string,
  onSubmit: (value: string) => void,
  defaultValue?: string)
  => void;

export class InputFormProps {
  defaultValue = '';
  label: string;
  button: string;
  onSubmit: (value: string) => void;
  onClose: () => void;
}

export class InputFormState {
  value: string;
}

class InputForm extends React.PureComponent<InputFormProps, InputFormState> {
  input: React.RefObject<HTMLInputElement | null>;

  constructor(props: InputFormProps) {
    super(props);
    this.input = React.createRef();
    this.state = {
      value: this.props.defaultValue,
    };
    this.handleValueChange = this.handleValueChange.bind(this);
    this.handleSubmit = this.handleSubmit.bind(this);
  }

  componentDidMount() {
    // A name to change is selected, so that typing replaces it
    if (this.input.current && this.props.defaultValue) {
      this.input.current.select();
    }
  }

  handleValueChange(event: React.ChangeEvent<HTMLInputElement>) {
    this.setState({value: event.target.value});
  }

  async handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (this.state.value) {
      this.props.onSubmit(this.state.value);
      this.props.onClose();
    }
  }

  render() {
    return (
      <form className='modal-form' onSubmit={this.handleSubmit}>
        <div className='modal-body'>
          <div className='field'>
            <label htmlFor='input-dialog-value'>{this.props.label}</label>
            <input type='text'
              id='input-dialog-value'
              value={this.state.value}
              autoFocus={true}
              spellCheck={false}
              ref={this.input}
              onChange={this.handleValueChange} />
          </div>
        </div>
        <div className='modal-footer'>
          <button type='button' onClick={this.props.onClose}>
            Cancel
          </button>
          <button className='primary-button'
            type='submit'
            disabled={!this.state.value}>
            {this.props.button}
          </button>
        </div>
      </form>
    );
  }
}

export const InputDialog = makeModal(InputForm);
