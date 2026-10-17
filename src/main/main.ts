import * as Path from 'path';
import { app, BrowserWindow, dialog, ipcMain, Menu, MenuItemConstructorOptions, nativeTheme } from 'electron';
import { setMenu } from './menu';
import { startCredentialService } from './credentials';
import { DEFAULT_THEME, getBackgroundColor, SYSTEM_THEME, ThemeManager } from '../shared/theme-manager';
import { Field, Settings } from '../shared/settings';
import { SerializedMenuItem, ThemeSource } from '../shared/ipc';

// Use the production build of React in the packaged app (renderers inherit the environment)
if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = app.isPackaged ? 'production' : 'development';
}

// Report unhandled errors of the main process (electron-unhandled is an ES module with top-level await)
import('electron-unhandled').then(({ default: unhandled }) => unhandled());

// Handle the Squirrel events of the Windows installer
// eslint-disable-next-line @typescript-eslint/no-require-imports
if (process.platform === 'win32' && require('electron-squirrel-startup')) {
  app.quit();
}

async function initDevTools(window: BrowserWindow) {
  window.webContents.openDevTools();
  try {
    const { installExtension, REACT_DEVELOPER_TOOLS } = await import('electron-devtools-installer');
    await installExtension(REACT_DEVELOPER_TOOLS);
  } catch (e) {
    console.warn('Unable to install React developer tools', e);
  }
}

let mainWindow: BrowserWindow | null = null;

const createWindow = async () => {
  // The renderer applies the theme, the window and the native menus follow its color scheme
  nativeTheme.themeSource = 'system';
  const themeSetting = Settings.get(Field.Theme, DEFAULT_THEME);
  const theme = new ThemeManager().loadTheme(themeSetting, nativeTheme.shouldUseDarkColors);
  if (themeSetting !== SYSTEM_THEME) {
    nativeTheme.themeSource = theme.scheme;
  }

  // Create the browser window
  mainWindow = new BrowserWindow({
    show: false,
    minWidth: 800,
    minHeight: 600,
    width: 800,
    height: 600,
    backgroundColor: getBackgroundColor(theme),
    webPreferences: {
      // The renderer runs git and reads the repository directly. It only ever
      // loads the local app files, never remote content.
      nodeIntegration: true,
      contextIsolation: false,
      sandbox: false
    }
  });

  // Set the menu
  setMenu(mainWindow);

  // Load the index.html of the app
  await mainWindow.loadFile(Path.join(__dirname, '../../assets/html/index.html'));

  // Open the DevTools
  if (!app.isPackaged && !process.env.GITADMIN_NO_DEVTOOLS) {
    await initDevTools(mainWindow);
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
};

// Only show when the DOM is ready
app.on('browser-window-created', (_event, window) => {
  window.once('ready-to-show', () => window.show());
});

// IPC

ipcMain.on('get-user-data-path', (event) => {
  event.returnValue = app.getPath('userData');
});

ipcMain.handle('set-theme-source', (event, themeSource: ThemeSource, backgroundColor?: string) => {
  if (['system', 'light', 'dark'].includes(themeSource)) {
    nativeTheme.themeSource = themeSource;
  }
  const window = BrowserWindow.fromWebContents(event.sender);
  if (window && backgroundColor) {
    window.setBackgroundColor(backgroundColor);
  }
});

ipcMain.handle('show-open-dialog', (event, options: Electron.OpenDialogOptions) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  return window ? dialog.showOpenDialog(window, options) : dialog.showOpenDialog(options);
});

ipcMain.handle('popup-context-menu', (event, items: SerializedMenuItem[]) => {
  return new Promise<number | null>((resolve) => {
    const toTemplate = (items: SerializedMenuItem[]): MenuItemConstructorOptions[] => items.map((item) => ({
      label: item.label,
      type: item.type,
      enabled: item.enabled,
      submenu: item.submenu ? toTemplate(item.submenu) : undefined,
      click: item.id !== undefined ? () => resolve(item.id!) : undefined
    }));
    const window = BrowserWindow.fromWebContents(event.sender) || undefined;
    Menu.buildFromTemplate(toTemplate(items)).popup({
      window: window,
      // The menu may close before the click handler is called
      callback: () => setTimeout(() => resolve(null), 100)
    });
  });
});

app.on('ready', async () => {
  // Before the window, which may start a network command right away
  await startCredentialService();
  await createWindow();
});

app.on('window-all-closed', () => {
  // On OS X it is common for applications and their menu bar
  // to stay active until the user quits explicitly with Cmd + Q
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open
  if (mainWindow === null) {
    createWindow();
  }
});
