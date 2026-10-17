import * as fs from 'fs';
import * as Path from 'path';

// Theme setting that follows the color scheme of the OS
export const SYSTEM_THEME = 'system';
export const DEFAULT_THEME = SYSTEM_THEME;

export type ColorScheme = 'light' | 'dark';

export interface Theme {
  name: string;
  scheme: ColorScheme;
  // Values of the CSS variables, without the leading dashes
  css: Record<string, string>;
  // Colors of the Monaco editors
  monaco: {
    base: string;
    colors: Record<string, string>;
  };
}

// Theme data of monaco.editor.defineTheme
export interface EditorThemeData {
  base: string;
  inherit: boolean;
  rules: any[];
  colors: Record<string, string>;
}

const THEMES_PATH = Path.join(__dirname, '../../assets/themes');

// Themes that come with the app, the other themes extend the one of their color scheme
const BUILT_IN_THEMES: Record<ColorScheme, string> = {
  light: 'light',
  dark: 'dark'
};

const EDITOR_BASES = ['vs', 'vs-dark', 'hc-black', 'hc-light'];

// Variables that were renamed, the themes written before can still use the old names
const LEGACY_VARIABLES: Record<string, string> = {
  'font-famliy': 'font-family'
};

function getScheme(json: any): ColorScheme {
  if (json.scheme === 'light' || json.scheme === 'dark') {
    return json.scheme;
  }
  // Themes written before the scheme was added only name the theme of the editor
  const monaco = json.monaco || {};
  return [monaco.base, monaco.theme].some((base) => base === 'vs-dark' || base === 'hc-black') ? 'dark' : 'light';
}

function getEditorBase(json: any, scheme: ColorScheme): string {
  const monaco = json.monaco || {};
  const base = [monaco.base, monaco.theme].find((base) => EDITOR_BASES.includes(base));
  return base || (scheme === 'dark' ? 'vs-dark' : 'vs');
}

function renameLegacyVariables(css: Record<string, string>) {
  const renamed: Record<string, string> = {};
  for (const [key, value] of Object.entries(css)) {
    const newKey = LEGACY_VARIABLES[key] || key;
    // If a theme has both names, the new one wins
    if (newKey === key || !(newKey in renamed)) {
      renamed[newKey] = value;
    }
  }
  return renamed;
}

// Makes a theme from the content of its file, the values that it does not define come from base
export function parseTheme(name: string, json: any, base?: Theme): Theme {
  const scheme = getScheme(json);
  return {
    name: name,
    scheme: scheme,
    css: {
      ...(base ? base.css : {}),
      ...renameLegacyVariables(json.css || {})
    },
    monaco: {
      base: getEditorBase(json, scheme),
      colors: {
        ...(base ? base.monaco.colors : {}),
        ...((json.monaco && json.monaco.colors) || {})
      }
    }
  };
}

// Name of the theme of a setting, the system setting picks the theme of the color scheme of the OS
export function resolveThemeName(setting: string, prefersDark: boolean) {
  if (setting === SYSTEM_THEME) {
    return prefersDark ? BUILT_IN_THEMES.dark : BUILT_IN_THEMES.light;
  }
  return setting;
}

// Names of the themes, which are the names of their files
export async function listThemes(path = THEMES_PATH) {
  const files = await fs.promises.readdir(path);
  return files.filter((file) => file.endsWith('.json'))
    .map((file) => file.substring(0, file.length - '.json'.length))
    .sort();
}

// Name of the theme of the editors, Monaco only accepts letters, digits and dashes
export function getEditorThemeName(theme: Theme) {
  return `gitadmin-${theme.name.toLowerCase().replace(/[^a-z0-9-]/g, '-')}`;
}

export function getEditorThemeData(theme: Theme): EditorThemeData {
  return {
    base: theme.monaco.base,
    inherit: true,
    rules: [],
    colors: theme.monaco.colors
  };
}

export class ThemeManager {
  path: string;
  // Theme set on the document
  theme: Theme | null;
  appliedVariables: string[];

  constructor(path = THEMES_PATH) {
    this.path = path;
    this.theme = null;
    this.appliedVariables = [];
  }

  // The files are small and read synchronously so that the theme is applied before the first render
  readTheme(name: string): Theme {
    const json = JSON.parse(fs.readFileSync(Path.join(this.path, `${name}.json`)).toString());
    const builtInName = BUILT_IN_THEMES[getScheme(json)];
    const base = name !== builtInName ? this.readTheme(builtInName) : undefined;
    return parseTheme(name, json, base);
  }

  // Loads the theme of a setting, falls back to the theme of the color scheme of the OS if
  // the theme cannot be read (for instance if its file was removed)
  loadTheme(setting: string, prefersDark: boolean) {
    const name = resolveThemeName(setting, prefersDark);
    try {
      return this.readTheme(name);
    } catch (e) {
      console.error(`Unable to load the theme ${name}`, e);
      return this.readTheme(resolveThemeName(SYSTEM_THEME, prefersDark));
    }
  }

  // Sets the CSS variables of a theme on the root element
  applyTheme(theme: Theme, root: HTMLElement = document.documentElement) {
    // The previous theme may define variables that the new one does not
    for (const variable of this.appliedVariables) {
      root.style.removeProperty(`--${variable}`);
    }
    this.appliedVariables = Object.keys(theme.css);
    for (const variable of this.appliedVariables) {
      root.style.setProperty(`--${variable}`, theme.css[variable]);
    }
    // Native controls follow the color scheme
    root.style.colorScheme = theme.scheme;
    root.dataset.scheme = theme.scheme;
    this.theme = theme;
  }
}

export function getBackgroundColor(theme: Theme) {
  return theme.css['surface-0'];
}
