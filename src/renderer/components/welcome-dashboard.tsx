import * as os from 'os';
import * as React from 'react';
import { Field, Settings } from '../../shared/settings';
import { IconName } from '../helpers/icons';
import { getRepoName } from '../helpers/repo-wrapper';
import { getCommandShortcut, getWorkingDirectory, shortenRepoPath } from '../helpers/welcome-format';
import { Icon } from './icon';

export class WelcomeDashboardProps {
  onRecentlyOpenedRepoClick: (path: string) => void;
  onOpenRepo: () => void;
  onInitRepo: () => void;
  onCloneRepo: () => void;
}

export class WelcomeDashboard extends React.PureComponent<WelcomeDashboardProps, {}> {
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
    // The title gives the full path as the description of the button, the two parts of the shortened
    // path would be read as two words
    return (
      <li className='recent-repo' key={path}>
        <span className='welcome-tile'>
          <Icon name='folder-git-2' />
        </span>
        <div className='recent-repo-text'>
          <h3>
            <button type='button' title={getWorkingDirectory(path)} onClick={() => this.props.onRecentlyOpenedRepoClick(path)}>
              <span className='recent-repo-name'>{getRepoName(path)}</span>
            </button>
          </h3>
          <p className='ellipsis-middle' aria-hidden='true'>
            <span className='left'>{shortenedPath.folder}</span>
            <span className='right'>{shortenedPath.name}</span>
          </p>
        </div>
      </li>
    );
  }

  render() {
    const homeDir = os.homedir();
    const recentlyOpened: string[] = Settings.get(Field.RecentlyOpened, []);
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
                <ul className='recent-repos'>
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
