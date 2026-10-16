import * as React from 'react';
import { makeModal } from './make-modal';
import { TextPatchViewerOptions } from './text-patch-viewer';
import { Settings, Field } from '../../shared/settings';
import { DEFAULT_THEME, listThemes, SYSTEM_THEME } from '../../shared/theme-manager';
import { CancellablePromise, makeCancellable } from '../helpers/make-cancellable';
import { getThemeOptions } from '../helpers/dialogs';
import { IconName } from '../helpers/icons';
import { Icon } from './icon';

enum Section {
  Profile,
  Authentication,
  Appearance,
  Editor
}

interface SectionTab {
  section: Section;
  // Suffix of the ids of the tab and of its panel
  id: string;
  label: string;
  icon: IconName;
}

const SECTION_TABS: SectionTab[] = [
  { section: Section.Profile, id: 'profile', label: 'Profile', icon: 'user' },
  { section: Section.Authentication, id: 'authentication', label: 'Authentication', icon: 'key-round' },
  { section: Section.Appearance, id: 'appearance', label: 'Appearance', icon: 'palette' },
  { section: Section.Editor, id: 'editor', label: 'Editor', icon: 'code' }
];

export class PreferencesProps {
  onClose: () => void;
  onThemeUpdate: (theme: string) => void;
  onEditorPreferencesUpdate: (options: TextPatchViewerOptions) => void;
}

export class PreferencesState {
  section: Section;
  themes: string[];
  name: string;
  email: string;
  theme: string;
  fontSize: number;
}

class Preferences extends React.PureComponent<PreferencesProps, PreferencesState> {
  themesPromise: CancellablePromise<string[]>;

  constructor(props: PreferencesProps) {
    super(props);
    const settings = Settings.exists() ? Settings.getAll() : {};
    this.state = {
      section: Section.Profile,
      themes: [],
      name: settings[Field.Name] || '',
      email: settings[Field.Email] || '',
      theme: settings[Field.Theme] || DEFAULT_THEME,
      fontSize: settings[Field.FontSize] || 14
    };
    // Maybe we should refactor that when there will be more fields
    this.handleTabKeyDown = this.handleTabKeyDown.bind(this);
    this.handleNameChange = this.handleNameChange.bind(this);
    this.handleEmailChange = this.handleEmailChange.bind(this);
    this.handleThemeChange = this.handleThemeChange.bind(this);
    this.handleFontSizeChange = this.handleFontSizeChange.bind(this);
    this.handleEditorPreferencesChange = this.handleEditorPreferencesChange.bind(this);
    this.handleSubmit = this.handleSubmit.bind(this);
  }

  componentDidMount() {
    this.loadThemes();
  }

  componentWillUnmount() {
    this.saveSettings();
    if (this.themesPromise) {
      this.themesPromise.cancel();
    }
  }

  handleTabClick(section: Section) {
    this.setState({
      section: section
    });
  }

  // The arrow keys go through the tabs and select them, Tab goes to the content of the selected one
  handleTabKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    const i = SECTION_TABS.findIndex((tab) => tab.section === this.state.section);
    let next: number;
    if (event.key === 'ArrowDown') {
      next = (i + 1) % SECTION_TABS.length;
    } else if (event.key === 'ArrowUp') {
      next = (i - 1 + SECTION_TABS.length) % SECTION_TABS.length;
    } else if (event.key === 'Home') {
      next = 0;
    } else if (event.key === 'End') {
      next = SECTION_TABS.length - 1;
    } else {
      return;
    }
    event.preventDefault();
    this.setState({section: SECTION_TABS[next].section});
    const tab = event.currentTarget.querySelector<HTMLElement>(`#preferences-tab-${SECTION_TABS[next].id}`);
    if (tab) {
      tab.focus();
    }
  }

  handleNameChange(event: React.ChangeEvent<HTMLInputElement>) {
    this.setState({name: event.target.value});
  }

  handleEmailChange(event: React.ChangeEvent<HTMLInputElement>) {
    this.setState({email: event.target.value});
  }

  handleThemeChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const theme = event.target.value;
    this.setState({theme: theme});
    this.props.onThemeUpdate(theme);
  }

  handleFontSizeChange(event: React.ChangeEvent<HTMLInputElement>) {
    this.setState({fontSize: Number(event.target.value)}, this.handleEditorPreferencesChange);
  }

  handleEditorPreferencesChange() {
    this.props.onEditorPreferencesUpdate({
      fontSize: this.state.fontSize
    });
  }

  handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
  }

  async loadThemes() {
    this.themesPromise = makeCancellable(listThemes());
    try {
      this.setState({
        themes: await this.themesPromise.promise
      });
    } catch (e) {
    }
  }

  saveSettings() {
    Settings.set(Field.Name, this.state.name);
    Settings.set(Field.Email, this.state.email);
    Settings.set(Field.Theme, this.state.theme);
    Settings.set(Field.FontSize, this.state.fontSize);
  }

  renderTab(tab: SectionTab) {
    const selected = tab.section === this.state.section;
    // Only the selected tab is in the tab sequence, the arrow keys reach the others
    return (
      <button type='button'
        role='tab'
        id={`preferences-tab-${tab.id}`}
        aria-controls={`preferences-panel-${tab.id}`}
        aria-selected={selected}
        tabIndex={selected ? 0 : -1}
        onClick={() => this.handleTabClick(tab.section)}
        key={tab.id}>
        <Icon name={tab.icon} />
        <span>{tab.label}</span>
      </button>
    );
  }

  renderPanel(section: Section, content: React.ReactNode) {
    const tab = SECTION_TABS.find((tab) => tab.section === section)!;
    return (
      <section role='tabpanel'
        id={`preferences-panel-${tab.id}`}
        aria-labelledby={`preferences-tab-${tab.id}`}
        hidden={section !== this.state.section}>
        <h3>{tab.label}</h3>
        {content}
      </section>
    );
  }

  render() {
    const themeOptions = getThemeOptions(this.state.themes, this.state.theme).map((option) => (
      <option value={option.value} key={option.value}>
        {option.label}
      </option>
    ));
    const systemTheme = this.state.theme === SYSTEM_THEME;
    return (
      <div className='preferences'>
        <nav role='tablist' aria-label='Sections' aria-orientation='vertical' onKeyDown={this.handleTabKeyDown}>
          {SECTION_TABS.map((tab) => this.renderTab(tab))}
        </nav>
        <div className='preferences-content'>
          {this.renderPanel(Section.Profile, <>
            <p className='preferences-description'>
              The author of your commits. When a field is empty, the commits use the identity of your Git configuration.
            </p>
            <form onSubmit={this.handleSubmit}>
              <div className='field'>
                <label htmlFor='preferences-name'>Name</label>
                <input type='text'
                  id='preferences-name'
                  name='profile-name'
                  autoFocus={true}
                  spellCheck={false}
                  value={this.state.name}
                  onChange={this.handleNameChange} />
              </div>
              <div className='field'>
                <label htmlFor='preferences-email'>Email</label>
                <input type='text'
                  id='preferences-email'
                  name='profile-email'
                  spellCheck={false}
                  value={this.state.email}
                  onChange={this.handleEmailChange} />
              </div>
            </form>
          </>)}
          {this.renderPanel(Section.Authentication, <>
            <div className='preferences-note'>
              <Icon name='info' />
              <p>The authentication uses your local SSH agent.</p>
            </div>
          </>)}
          {this.renderPanel(Section.Appearance, <>
            <form onSubmit={this.handleSubmit}>
              <div className='field'>
                <label htmlFor='preferences-theme'>Theme</label>
                <div className='select'>
                  <select id='preferences-theme'
                    value={this.state.theme}
                    aria-describedby={systemTheme ? 'preferences-theme-hint' : undefined}
                    onChange={this.handleThemeChange}>
                    {themeOptions}
                  </select>
                  <Icon name='chevron-down' />
                </div>
                {systemTheme ?
                  <p className='field-hint' id='preferences-theme-hint'>Switches between light and dark with your system</p> :
                  null}
              </div>
            </form>
          </>)}
          {this.renderPanel(Section.Editor, <>
            <form onSubmit={this.handleSubmit}>
              <div className='field'>
                <label htmlFor='preferences-font-size'>Font size</label>
                <input type='number'
                  id='preferences-font-size'
                  name='font-size'
                  aria-describedby='preferences-font-size-hint'
                  value={this.state.fontSize}
                  onChange={this.handleFontSizeChange}/>
                <p className='field-hint' id='preferences-font-size-hint'>Size of the text of the diffs, in pixels</p>
              </div>
            </form>
          </>)}
        </div>
      </div>
    );
  }
}

export const PreferencesDialog = makeModal(Preferences);
