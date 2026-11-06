import * as os from 'os';
import * as React from 'react';
import { Field, Settings } from '../../shared/settings';
import { IconName } from '../helpers/icons';
import { isFolderMissing, removeRecentRepo } from '../helpers/recent-repos';
import { getRepoName } from '../helpers/repo-wrapper';
import { getCommandShortcut, getWorkingDirectory, shortenRepoPath } from '../helpers/welcome-format';
import { Icon } from './icon';

export class WelcomeDashboardProps {
  onRecentlyOpenedRepoClick: (path: string) => void;
  onOpenRepo: () => void;
  onInitRepo: () => void;
  onCloneRepo: () => void;
}

export interface WelcomeDashboardState {
  recentRepos: string[];
  // Recent repositories whose folder was not found when they were opened
  missingRepos: Set<string>;
}

export class WelcomeDashboard extends React.PureComponent<WelcomeDashboardProps, WelcomeDashboardState> {
  list: React.RefObject<HTMLUListElement | null>;

  constructor(props: WelcomeDashboardProps) {
    super(props);
    this.list = React.createRef();
    this.state = {
      recentRepos: Settings.get(Field.RecentlyOpened, []),
      missingRepos: new Set()
    };
  }

  // A repository whose folder is gone shows a message and a button to remove it, instead of the error of git
  async openRecentRepo(path: string) {
    const missing = await isFolderMissing(path);
    this.setState((prevState) => {
      const missingRepos = new Set(prevState.missingRepos);
      if (missing) {
        missingRepos.add(path);
      } else {
        missingRepos.delete(path);
      }
      return { missingRepos };
    }, () => {
      if (missing) {
        this.focusEntry(this.state.recentRepos.indexOf(path), 'button.recent-repo-remove');
      }
    });
    if (!missing) {
      this.props.onRecentlyOpenedRepoClick(path);
    }
  }

  removeRecentRepo(path: string) {
    const i = this.state.recentRepos.indexOf(path);
    const recentRepos = removeRecentRepo(Settings.get(Field.RecentlyOpened, []), path);
    Settings.set(Field.RecentlyOpened, recentRepos);
    this.setState((prevState) => {
      const missingRepos = new Set(prevState.missingRepos);
      missingRepos.delete(path);
      return { recentRepos, missingRepos };
    }, () => {
      // The focus would be lost with the entry, it goes to the entry that takes its place
      this.focusEntry(Math.min(i, this.state.recentRepos.length - 1), 'h3 button');
    });
  }

  focusEntry(i: number, selector: string) {
    const entry = this.list.current && i >= 0 ? this.list.current.children[i] : null;
    const button = entry ? entry.querySelector<HTMLButtonElement>(selector) : null;
    if (button) {
      button.focus();
    }
  }

  // The shortcuts are the accelerators of the application menu
  renderAction(label: string, icon: IconName, key: string, onClick: () => void) {
    const shortcut = getCommandShortcut(key);
    return (
      <button type='button' className='welcome-action' aria-keyshortcuts={shortcut.aria} onClick={onClick}>
        <span className='welcome-tile'>
          <Icon name={icon} />
        </span>
        <span className='welcome-action-label'>{label}</span>
        <span className='welcome-action-shortcut' aria-hidden='true'>
          {shortcut.keys.map((key) => <kbd key={key}>{key}</kbd>)}
        </span>
      </button>
    );
  }

  // The button of the heading covers the whole entry, so that the name stays a heading
  renderRecentRepo(path: string, homeDir: string) {
    const shortenedPath = shortenRepoPath(path, homeDir);
    const name = getRepoName(path);
    const missing = this.state.missingRepos.has(path);
    // The title gives the full path as the description of the button, the two parts of the shortened
    // path would be read as two words
    return (
      <li className={missing ? 'recent-repo missing' : 'recent-repo'} key={path}>
        <span className='welcome-tile'>
          <Icon name={missing ? 'circle-alert' : 'folder-git-2'} />
        </span>
        <div className='recent-repo-text'>
          <h3>
            <button type='button' title={getWorkingDirectory(path)} onClick={() => this.openRecentRepo(path)}>
              <span className='recent-repo-name'>{name}</span>
            </button>
          </h3>
          {missing ?
            <p className='recent-repo-missing'>Folder not found</p> :
            <p className='ellipsis-middle' aria-hidden='true'>
              <span className='left'>{shortenedPath.folder}</span>
              <span className='right'>{shortenedPath.name}</span>
            </p>}
        </div>
        {missing ?
          <button type='button'
            className='small-button recent-repo-remove'
            aria-label={`Remove ${name} from the recent repositories`}
            title='Remove from the recent repositories'
            onClick={() => this.removeRecentRepo(path)}>
            Remove
          </button> : null}
      </li>
    );
  }

  render() {
    const homeDir = os.homedir();
    const recentlyOpened = this.state.recentRepos;
    return (
      <div className='welcome-dashboard'>
        <div className='welcome-content'>
          <header className='welcome-header'>
            <span className='welcome-logo'>
              <Icon name='folder-git-2' size={28} />
            </span>
            <div className='welcome-title'>
              <h1>Gitadmin</h1>
              <p>A graphical user interface for Git</p>
            </div>
          </header>
          <div className='welcome-sections'>
            <section className='welcome-start' aria-labelledby='welcome-start-title'>
              <h2 id='welcome-start-title'>Start</h2>
              <div className='welcome-actions'>
                {this.renderAction('Open a repository', 'folder-open', 'O', this.props.onOpenRepo)}
                {this.renderAction('Clone a repository', 'download', 'N', this.props.onCloneRepo)}
                {this.renderAction('Initialize a repository', 'folder-plus', 'I', this.props.onInitRepo)}
              </div>
            </section>
            <section className='welcome-recent' aria-labelledby='welcome-recent-title'>
              <h2 id='welcome-recent-title'>Recent repositories</h2>
              {recentlyOpened.length > 0 ?
                <ul className='recent-repos' ref={this.list}>
                  {recentlyOpened.map((path) => this.renderRecentRepo(path, homeDir))}
                </ul> :
                <div className='recent-repos-empty'>
                  <Icon name='rotate-ccw-clock' size={28} />
                  <p>No recent repositories</p>
                </div>}
            </section>
          </div>
        </div>
      </div>
    );
  }
}
