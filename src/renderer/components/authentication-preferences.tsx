import * as React from 'react';
import { Field, Settings } from '../../shared/settings';
import { getSshHostKeys, hasCredentialManager, isCredentialManagerBuiltIn, isCredentialManagerEnabled } from '../helpers/git/network';
import { forgetCredentials, getRememberedCredentialCount } from '../helpers/native';
import { AgentStatus, SshKey, getAgentStatus, listSshKeys } from '../helpers/ssh-keys';
import { Icon } from './icon';

export class AuthenticationPreferencesState {
  agent: AgentStatus;
  keys: SshKey[];
  // Key of each host, by host name in lowercase
  hostKeys: Record<string, string>;
  newHost: string;
  newKey: string;
  rememberedCount: number;
  credentialManager: boolean;
}

function getKeyLabel(key: SshKey) {
  const details = [key.type.replace(/^ssh-/, ''), key.encrypted ? 'passphrase' : ''].filter((detail) => detail);
  return details.length > 0 ? `${key.name} (${details.join(', ')})` : key.name;
}

// Authentication section of the preferences: the agent, the keys of ~/.ssh, the key of each host and
// where the HTTPS credentials are saved
export class AuthenticationPreferences extends React.PureComponent<{}, AuthenticationPreferencesState> {
  unmounted: boolean;

  constructor(props: {}) {
    super(props);
    const keys = listSshKeys();
    this.state = {
      agent: getAgentStatus(),
      keys: keys,
      hostKeys: getSshHostKeys(),
      newHost: '',
      newKey: keys.length > 0 ? keys[0].path : '',
      rememberedCount: 0,
      credentialManager: isCredentialManagerEnabled()
    };
    this.unmounted = false;
    this.handleNewHostChange = this.handleNewHostChange.bind(this);
    this.handleNewKeyChange = this.handleNewKeyChange.bind(this);
    this.handleAddHostKey = this.handleAddHostKey.bind(this);
    this.handleForgetClick = this.handleForgetClick.bind(this);
    this.handleCredentialManagerChange = this.handleCredentialManagerChange.bind(this);
  }

  componentDidMount() {
    this.updateRememberedCount();
  }

  componentWillUnmount() {
    this.unmounted = true;
  }

  async updateRememberedCount() {
    const count = await getRememberedCredentialCount();
    if (!this.unmounted) {
      this.setState({rememberedCount: count});
    }
  }

  handleNewHostChange(event: React.ChangeEvent<HTMLInputElement>) {
    this.setState({newHost: event.target.value});
  }

  handleNewKeyChange(event: React.ChangeEvent<HTMLSelectElement>) {
    this.setState({newKey: event.target.value});
  }

  handleAddHostKey(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const host = this.state.newHost.trim().toLowerCase();
    if (host && this.state.newKey) {
      this.saveHostKeys({...this.state.hostKeys, [host]: this.state.newKey});
      this.setState({newHost: ''});
    }
  }

  handleRemoveHostKey(host: string) {
    const hostKeys = {...this.state.hostKeys};
    delete hostKeys[host];
    this.saveHostKeys(hostKeys);
  }

  saveHostKeys(hostKeys: Record<string, string>) {
    this.setState({hostKeys: hostKeys});
    Settings.set(Field.SshHostKeys, hostKeys);
  }

  handleCredentialManagerChange(event: React.ChangeEvent<HTMLInputElement>) {
    this.setState({credentialManager: event.target.checked});
    Settings.set(Field.CredentialManager, event.target.checked);
  }

  async handleForgetClick() {
    if (this.state.rememberedCount === 0) {
      return;
    }
    await forgetCredentials();
    this.updateRememberedCount();
  }

  renderAgent() {
    const agent = this.state.agent;
    return (
      <div className='preferences-note'>
        <Icon name={agent.running ? 'circle-check' : 'info'} />
        <p>
          {agent.running ?
            'An SSH agent is running, its keys are used first.' :
            'No SSH agent is running.'}
          {' '}Gitadmin asks for the passphrase of a key, the password of a server or the username and the token of an
          HTTPS remote when they are needed, and for your confirmation before connecting to a new host.
        </p>
      </div>
    );
  }

  renderKeys() {
    if (this.state.keys.length === 0) {
      return <p className='preferences-text'>No private key found in ~/.ssh</p>;
    }
    return (
      <ul className='ssh-key-list' aria-label='SSH keys'>
        {this.state.keys.map((key) => (
          <li key={key.path} title={key.path}>
            <Icon name='key-round' />
            <span className='ssh-key-name'>{key.name}</span>
            {key.type ? <span className='ssh-key-detail'>{key.type.replace(/^ssh-/, '')}</span> : null}
            {key.encrypted ? <span className='ssh-key-detail'>passphrase</span> : null}
            {key.comment ? <span className='ssh-key-comment'>{key.comment}</span> : null}
          </li>
        ))}
      </ul>
    );
  }

  renderHostKeys() {
    const hosts = Object.keys(this.state.hostKeys).sort();
    const keyOptions = this.state.keys.map((key) => <option value={key.path} key={key.path}>{getKeyLabel(key)}</option>);
    return (
      <>
        {hosts.length > 0 ?
          <ul className='ssh-host-key-list' aria-label='Keys of the hosts'>
            {hosts.map((host) => (
              <li key={host}>
                <span className='ssh-host'>{host}</span>
                <span className='ssh-host-key' title={this.state.hostKeys[host]}>{this.state.hostKeys[host]}</span>
                <button type='button'
                  className='ghost-button icon-button'
                  aria-label={`Use the agent for ${host}`}
                  title='Remove'
                  onClick={() => this.handleRemoveHostKey(host)}>
                  <Icon name='x' />
                </button>
              </li>
            ))}
          </ul> :
          null}
        <form className='ssh-host-key-form' onSubmit={this.handleAddHostKey}>
          <div className='field'>
            <label htmlFor='preferences-ssh-host'>Host</label>
            <input type='text'
              id='preferences-ssh-host'
              placeholder='github.com'
              spellCheck={false}
              value={this.state.newHost}
              onChange={this.handleNewHostChange} />
          </div>
          <div className='field'>
            <label htmlFor='preferences-ssh-key'>Key</label>
            <div className='select'>
              <select id='preferences-ssh-key'
                value={this.state.newKey}
                disabled={keyOptions.length === 0}
                onChange={this.handleNewKeyChange}>
                {keyOptions}
              </select>
              <Icon name='chevron-down' />
            </div>
          </div>
          <button type='submit' disabled={!this.state.newHost.trim() || !this.state.newKey}>
            <Icon name='plus' />
            Add
          </button>
        </form>
      </>
    );
  }

  renderCredentialManager() {
    const builtIn = isCredentialManagerBuiltIn();
    const available = hasCredentialManager();
    let description: string;
    if (!available) {
      description = 'Git Credential Manager is not available on this system. Gitadmin asks for the username and the ' +
        'token of an HTTPS remote when they are needed.';
    } else if (builtIn) {
      description = 'Git for Windows always uses Git Credential Manager. It saves the username and the token of the ' +
        'HTTPS remotes in the Windows Credential Manager, and signs in to GitHub, GitLab, Bitbucket and Azure DevOps ' +
        'in the browser.';
    } else {
      description = 'Saves the username and the token of the HTTPS remotes in the keychain of the system, and signs in ' +
        'to GitHub, GitLab, Bitbucket and Azure DevOps in the browser. Without it, Gitadmin asks for them and can ' +
        'remember them until it quits.';
    }
    return (
      <>
        <div className='check-field'>
          <input type='checkbox'
            id='preferences-credential-manager'
            aria-describedby='preferences-credential-manager-description'
            checked={available && (builtIn || this.state.credentialManager)}
            disabled={!available || builtIn}
            onChange={this.handleCredentialManagerChange} />
          <label htmlFor='preferences-credential-manager'>Save HTTPS credentials with Git Credential Manager</label>
        </div>
        <p className='preferences-text' id='preferences-credential-manager-description'>{description}</p>
      </>
    );
  }

  render() {
    const count = this.state.rememberedCount;
    return (
      <>
        {this.renderAgent()}
        <h4>SSH keys</h4>
        {this.renderKeys()}
        <h4>Key of a host</h4>
        <p className='preferences-text'>
          The remotes on a host use only its key instead of the keys of the agent. The other hosts use the agent and
          your SSH configuration.
        </p>
        {this.renderHostKeys()}
        <h4>HTTPS remotes</h4>
        {this.renderCredentialManager()}
        <h4>Remembered passwords</h4>
        <div className='preferences-row'>
          <p className='preferences-text' id='preferences-remembered'>
            {count === 0 ? 'No passphrase or password is remembered.' :
              `${count} ${count === 1 ? 'passphrase or password is' : 'passphrases or passwords are'} remembered until ` +
              'Gitadmin quits.'}
          </p>
          {/* aria-disabled rather than disabled, the button keeps the focus once it forgets everything */}
          <button type='button'
            aria-disabled={count === 0}
            aria-describedby='preferences-remembered'
            onClick={this.handleForgetClick}>
            Forget
          </button>
        </div>
      </>
    );
  }
}
