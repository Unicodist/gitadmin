import * as fs from 'fs';
import * as Path from 'path';
import { app, ipcRenderer } from 'electron';

const NAMESPACE = 'gitamine';

// Same file as electron-settings used, so existing preferences are kept
const SETTINGS_FILE = 'Settings';

export enum Field {
  Name = 'name',
  Email = 'email',
  RecentlyOpened = 'recentlyOpened',
  Theme = 'theme',
  FontSize = 'fontSize'
}

function getUserDataPath(): string {
  if (process.type === 'browser') {
    return app.getPath('userData');
  }
  return ipcRenderer.sendSync('get-user-data-path');
}

let settingsPath: string | null = null;

function getSettingsPath() {
  if (settingsPath === null) {
    settingsPath = Path.join(getUserDataPath(), SETTINGS_FILE);
  }
  return settingsPath;
}

function readAll(): Record<string, any> {
  try {
    return JSON.parse(fs.readFileSync(getSettingsPath()).toString());
  } catch (e) {
    return {};
  }
}

function writeAll(values: Record<string, any>) {
  const path = getSettingsPath();
  fs.mkdirSync(Path.dirname(path), { recursive: true });
  fs.writeFileSync(path, JSON.stringify(values, null, 2));
}

export class Settings {
  // Overrides the location of the settings file (used by tests)
  static setPath(path: string | null) {
    settingsPath = path;
  }

  static exists() {
    return NAMESPACE in readAll();
  }

  static getAll() {
    return readAll()[NAMESPACE];
  }

  static setAll(values: any) {
    const all = readAll();
    all[NAMESPACE] = values;
    writeAll(all);
  }

  static get(field: Field, defaultValue?: any) {
    const values = Settings.getAll();
    return values && values[field] !== undefined ? values[field] : defaultValue;
  }

  static set(field: Field, value: any) {
    const all = readAll();
    all[NAMESPACE] = { ...all[NAMESPACE], [field]: value };
    writeAll(all);
  }
}
