import * as React from 'react';
import { RepoDashboard } from './repo-dashboard';
import { RepoWrapper, RepoLocation, Commit } from '../helpers/repo-wrapper';
import { setThemeSource, showOpenDirectoryDialog } from '../helpers/native';
import { registerEditorTheme } from '../helpers/monaco-loader';
import { NotificationQueue } from './notification-queue';
import { WelcomeDashboard } from './welcome-dashboard';
import { NotificationType } from './notification-item';
import { CreateBranchDialog } from './create-branch-dialog';
import { CloneRepoDialog } from './clone-repo-dialog';
import { InitRepoDialog } from './init-repo-dialog';
import { TextPatchViewerOptions } from './text-patch-viewer';
import { PreferencesDialog } from './preferences-dialog';
import { Field, Settings } from '../../shared/settings';
import { DEFAULT_THEME, getBackgroundColor, getEditorThemeData, getEditorThemeName, SYSTEM_THEME, ThemeManager }
  from '../../shared/theme-manager';
import { InputDialog } from './input-dialog';

export interface AppState {
  repos: RepoWrapper[];
  editorTheme: string;
  patchViewerOptions: TextPatchViewerOptions;
  modalWindow: React.JSX.Element | null;
}

export class App extends React.PureComponent<{}, AppState> {
  notificationQueue: React.RefObject<NotificationQueue | null>;
  themeManager: ThemeManager;
  themeSetting: string;
  colorSchemeQuery: MediaQueryList;
  // Color scheme of the OS when the theme was applied
  prefersDark: boolean;

  constructor(props: {}) {
    super(props);
    this.notificationQueue = React.createRef();
    this.themeManager = new ThemeManager();
    this.themeSetting = Settings.get(Field.Theme, DEFAULT_THEME);
    this.colorSchemeQuery = window.matchMedia('(prefers-color-scheme: dark)');
    this.state = {
      repos: [],
      // The theme is applied before the first render so that the window never shows the page unstyled
      editorTheme: this.applyTheme(),
      patchViewerOptions: {
        fontSize: 14
      },
      modalWindow: null
    };
    this.updateTheme = this.updateTheme.bind(this);
    this.handleColorSchemeChange = this.handleColorSchemeChange.bind(this);
    this.updatePatchViewer = this.updatePatchViewer.bind(this);
    this.cloneRepo = this.cloneRepo.bind(this);
    this.initRepo = this.initRepo.bind(this);
    this.openRepo = this.openRepo.bind(this);
    this.openCloneRepoDialog = this.openCloneRepoDialog.bind(this);
    this.openInitRepoDialog = this.openInitRepoDialog.bind(this);
    this.openOpenRepoDialog = this.openOpenRepoDialog.bind(this);
    this.openCreateBranchDialog = this.openCreateBranchDialog.bind(this);
    this.openInputDialog = this.openInputDialog.bind(this);
    this.showNotification = this.showNotification.bind(this);
    this.closeModalWindow = this.closeModalWindow.bind(this);
  }

  componentDidMount() {
    this.colorSchemeQuery.addEventListener('change', this.handleColorSchemeChange);
    // The color scheme of the OS may have changed between the first render and now
    if (this.themeSetting === SYSTEM_THEME && this.colorSchemeQuery.matches !== this.prefersDark) {
      this.setState({
        editorTheme: this.applyTheme()
      });
    }
    this.updateNativeTheme();
    this.updatePatchViewer();
  }

  componentWillUnmount() {
    this.colorSchemeQuery.removeEventListener('change', this.handleColorSchemeChange);
  }

  // Applies the theme of the setting, returns the name of the theme of the editors
  applyTheme() {
    this.prefersDark = this.colorSchemeQuery.matches;
    const theme = this.themeManager.loadTheme(this.themeSetting, this.prefersDark);
    this.themeManager.applyTheme(theme);
    const editorTheme = getEditorThemeName(theme);
    registerEditorTheme(editorTheme, getEditorThemeData(theme));
    return editorTheme;
  }

  // The menus, the scrollbars and the title bar follow the color scheme of the theme
  updateNativeTheme() {
    const theme = this.themeManager.theme!;
    return setThemeSource(this.themeSetting === SYSTEM_THEME ? 'system' : theme.scheme, getBackgroundColor(theme));
  }

  handleColorSchemeChange() {
    if (this.themeSetting === SYSTEM_THEME) {
      this.setState({
        editorTheme: this.applyTheme()
      });
      this.updateNativeTheme();
    }
  }

  // Switches to the theme of a setting, the system setting follows the color scheme of the OS
  async updateTheme(setting: string) {
    this.themeSetting = setting;
    if (setting === SYSTEM_THEME) {
      // The page only gets the color scheme of the OS once the main process stops forcing one,
      // if it changes after, the theme is updated again by handleColorSchemeChange
      await setThemeSource('system');
      if (this.themeSetting !== setting) {
        return;
      }
    }
    this.setState({
      editorTheme: this.applyTheme()
    });
    await this.updateNativeTheme();
  }

  async updatePatchViewer(options?: TextPatchViewerOptions) {
    options = options || {fontSize: Settings.get(Field.FontSize)};
    this.setState({
      patchViewerOptions: options!
    });
  }

  async cloneRepo(url: string, path: string) {
    try {
      this.addRepo(await RepoWrapper.clone(url, path));
    } catch (e) {
      this.showNotification(`Unable to clone repo: ${e.message}`, NotificationType.Error);
    }
  }

  async initRepo(path: string) {
    try {
      this.addRepo(await RepoWrapper.init(path));
    } catch (e) {
      this.showNotification(`Unable to init repo: ${e.message}`, NotificationType.Error);
    }
  }

  async openRepo(path: string) {
    try {
      this.addRepo(await RepoWrapper.open(path));
    } catch (e) {
      this.showNotification(`Unable to open repo: ${e.message}`, NotificationType.Error);
    }
  }

  addRepo(location: RepoLocation) {
    const repoState = new RepoWrapper(location, this.showNotification);
    this.setState({
      repos: [repoState]
    });
    // Update settings
    const recentlyOpened: string[] = Settings.get(Field.RecentlyOpened, []);
    // Make sure that there is no duplicate
    const iPath = recentlyOpened.indexOf(repoState.workdir);
    if (iPath !== -1) {
      recentlyOpened.splice(iPath, 1);
    }
    Settings.set(Field.RecentlyOpened, [repoState.workdir, ...recentlyOpened.slice(0, 2)]);
  }

  closeRepo(i: number) {
    this.setState((prevState) => {
      const repos = prevState.repos.slice();
      repos.splice(i, 1);
      return {
        repos: repos
      };
    });
  }

  getCurrentRepo() {
    return this.state.repos[0];
  }

  showNotification(message: string, type: NotificationType) {
    if (this.notificationQueue.current) {
      this.notificationQueue.current.addNotification(message, type);
    }
  }

  // Modal components

  openCloneRepoDialog() {
    const element = <CloneRepoDialog title='Clone a repo'
      onCloneRepo={this.cloneRepo}
      onClose={this.closeModalWindow} />;
    this.setState({
      modalWindow: element
    });
  }

  openInitRepoDialog() {
    const element = <InitRepoDialog title='Initialize a repo'
      onInitRepo={this.initRepo}
      onClose={this.closeModalWindow} />;
    this.setState({
      modalWindow: element
    });
  }

  openOpenRepoDialog() {
    showOpenDirectoryDialog().then((path) => {
      if (path) {
        this.openRepo(path);
      }
    });
  }

  openPreferencesDialog() {
    const element = <PreferencesDialog title='Preferences'
      onClose={this.closeModalWindow}
      onThemeUpdate={this.updateTheme}
      onEditorPreferencesUpdate={this.updatePatchViewer} />;
    this.setState({
      modalWindow: element
    });
  }

  openCreateBranchDialog(commit: Commit) {
    const element = <CreateBranchDialog title='Create a branch'
      repo={this.getCurrentRepo()}
      commit={commit}
      onClose={this.closeModalWindow} />;
    this.setState({
      modalWindow: element
    });
  }

  openInputDialog(title: string, label: string, button: string, onSubmit: (value: string) => void, defaultValue = '') {
    const element = <InputDialog title={title}
      label={label}
      button={button}
      defaultValue={defaultValue}
      onSubmit={onSubmit}
      onClose={this.closeModalWindow} />;
    this.setState({
      modalWindow: element
    });
  }

  closeModalWindow() {
    this.setState({
      modalWindow: null
    });
  }

  render() {
    const repoDashboards = this.state.repos.length === 0 ?
      <WelcomeDashboard onRecentlyOpenedRepoClick={this.openRepo}
        onOpenRepo={this.openOpenRepoDialog}
        onInitRepo={this.openInitRepoDialog}
        onCloneRepo={this.openCloneRepoDialog} /> :
      this.state.repos.map((repo, i) => <RepoDashboard
        repo={repo}
        editorTheme={this.state.editorTheme}
        patchViewerOptions={this.state.patchViewerOptions}
        onRepoClose={() => this.closeRepo(i)}
        onCreateBranch={this.openCreateBranchDialog}
        onOpenInputDialog={this.openInputDialog}
        key={repo.path} />);
    return (
      <div id='app'>
        {repoDashboards}
        {this.state.modalWindow}
        <NotificationQueue ref={this.notificationQueue} />
      </div>
    );
  }
}
