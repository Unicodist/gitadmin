import * as React from 'react';
import { makeModal } from './make-modal';
import { ACCEPT_HOST_KEY, CredentialAnswer, CredentialRequest, PromptKind } from '../../shared/askpass';
import { Icon } from './icon';

export class CredentialFormProps {
  request: CredentialRequest;
  onAnswer: (answer: CredentialAnswer) => void;
  // Cancels the prompt
  onClose: () => void;
}

export class CredentialFormState {
  value: string;
  remember: boolean;
}

// What the dialog asks for, above the field
function getDescription(request: CredentialRequest): React.ReactNode {
  switch (request.kind) {
    case PromptKind.Passphrase:
      return <>Enter the passphrase of the SSH key <code>{request.subject}</code></>;
    case PromptKind.Password:
      return <>Enter the password of <code>{request.subject}</code></>;
    case PromptKind.Username:
      return <>Enter your username for <code>{request.subject}</code></>;
    case PromptKind.HttpsPassword:
      return <>Enter the password or the access token of <code>{request.subject}</code></>;
    default:
      return <span className='credential-prompt'>{request.text}</span>;
  }
}

function getFieldLabel(kind: PromptKind) {
  switch (kind) {
    case PromptKind.Passphrase:
      return 'Passphrase';
    case PromptKind.Username:
      return 'Username';
    case PromptKind.HttpsPassword:
      return 'Password or token';
    default:
      return 'Password';
  }
}

// Asks for a secret that git or ssh needs, or for the confirmation of an unknown host key
class CredentialForm extends React.PureComponent<CredentialFormProps, CredentialFormState> {
  constructor(props: CredentialFormProps) {
    super(props);
    this.state = {
      value: '',
      remember: false
    };
    this.handleValueChange = this.handleValueChange.bind(this);
    this.handleRememberChange = this.handleRememberChange.bind(this);
    this.handleSubmit = this.handleSubmit.bind(this);
  }

  handleValueChange(event: React.ChangeEvent<HTMLInputElement>) {
    this.setState({value: event.target.value});
  }

  handleRememberChange(event: React.ChangeEvent<HTMLInputElement>) {
    this.setState({remember: event.target.checked});
  }

  handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (this.props.request.kind === PromptKind.HostKey) {
      this.props.onAnswer({value: ACCEPT_HOST_KEY, remember: false});
    } else if (this.state.value) {
      this.props.onAnswer({value: this.state.value, remember: this.state.remember});
    }
  }

  renderHostKey() {
    const request = this.props.request;
    return (
      <form className='modal-form credential-form' onSubmit={this.handleSubmit}>
        <div className='modal-body'>
          <p>
            Gitadmin has never connected to <code>{request.subject || 'this host'}</code>, its identity cannot be checked.
          </p>
          {request.fingerprint ?
            <pre className='credential-fingerprint'>{request.fingerprint}</pre> :
            <pre className='credential-fingerprint'>{request.text}</pre>}
          <div className='credential-warning'>
            <Icon name='circle-alert' />
            <p>
              Only connect if this fingerprint matches the one published by the server, for instance in the
              documentation of your Git host. The key is then saved in your <code>known_hosts</code> file.
            </p>
          </div>
        </div>
        <div className='modal-footer'>
          <button type='button' onClick={this.props.onClose}>
            Cancel
          </button>
          <button className='primary-button' type='submit' autoFocus={true}>
            Trust and connect
          </button>
        </div>
      </form>
    );
  }

  render() {
    const request = this.props.request;
    if (request.kind === PromptKind.HostKey) {
      return this.renderHostKey();
    }
    const retry = request.attempt > 1;
    const hintIds = ['credential-description', ...(retry ? ['credential-retry'] : [])].join(' ');
    return (
      <form className='modal-form credential-form' onSubmit={this.handleSubmit}>
        <div className='modal-body'>
          <p id='credential-description'>{getDescription(request)}</p>
          <div className='field'>
            <label htmlFor='credential-value'>{getFieldLabel(request.kind)}</label>
            <input type={request.secret ? 'password' : 'text'}
              id='credential-value'
              autoFocus={true}
              autoComplete='off'
              spellCheck={false}
              aria-describedby={hintIds}
              aria-invalid={retry}
              value={this.state.value}
              onChange={this.handleValueChange} />
            {retry ?
              <p className='field-hint field-error' id='credential-retry'>
                That did not work, try again (attempt {request.attempt} of {request.maxAttempts})
              </p> :
              null}
          </div>
          {request.secret ?
            <div className='check-field'>
              <input type='checkbox'
                id='credential-remember'
                checked={this.state.remember}
                onChange={this.handleRememberChange} />
              <label htmlFor='credential-remember'>Remember until Gitadmin quits</label>
            </div> :
            null}
        </div>
        <div className='modal-footer'>
          <button type='button' onClick={this.props.onClose}>
            Cancel
          </button>
          <button className='primary-button'
            type='submit'
            disabled={!this.state.value}>
            {request.kind === PromptKind.Passphrase ? 'Unlock' : 'Continue'}
          </button>
        </div>
      </form>
    );
  }
}

export const CredentialDialog = makeModal(CredentialForm);
