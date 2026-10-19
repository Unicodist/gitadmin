import { ipcRenderer } from 'electron';
import { SerializedMenuItem, ThemeSource } from '../../shared/ipc';
import { CredentialAnswer, CredentialRequest } from '../../shared/askpass';
import { getDialogStartDirectory, rememberPickedDirectory } from './recent-directory';

export interface MenuItem {
  label?: string;
  type?: 'normal' | 'separator';
  enabled?: boolean;
  click?: () => void;
  submenu?: MenuItem[];
}

export class ContextMenu {
  template: MenuItem[];

  constructor(template: MenuItem[]) {
    this.template = template;
  }

  // Shows the menu and calls the handler of the clicked item
  async popup() {
    const handlers: (() => void)[] = [];
    const serialize = (items: MenuItem[]): SerializedMenuItem[] => items.map((item) => {
      const serialized: SerializedMenuItem = {
        label: item.label,
        type: item.type,
        enabled: item.enabled,
        submenu: item.submenu ? serialize(item.submenu) : undefined
      };
      if (item.click) {
        serialized.id = handlers.length;
        handlers.push(item.click);
      }
      return serialized;
    });
    const items = serialize(this.template);
    const id: number | null = await ipcRenderer.invoke('popup-context-menu', items);
    if (id !== null && handlers[id]) {
      handlers[id]();
    }
  }
}

export function buildMenu(template: MenuItem[]) {
  return new ContextMenu(template);
}

// Copies a text to the clipboard. The clipboard module of Electron is only available in the main process.
export function copyToClipboard(text: string) {
  return navigator.clipboard.writeText(text);
}

// Asks the user to pick a directory, returns null if the dialog is cancelled.
// The dialog starts where the user picked a directory last time.
export async function showOpenDirectoryDialog() {
  const result: Electron.OpenDialogReturnValue = await ipcRenderer.invoke('show-open-dialog', {
    defaultPath: getDialogStartDirectory(),
    properties: ['openDirectory', 'createDirectory']
  });
  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }
  rememberPickedDirectory(result.filePaths[0]);
  return result.filePaths[0];
}

// Sets the color scheme of the native parts of the window (menus, scrollbars, title bar),
// and the color shown before the page is painted
export async function setThemeSource(themeSource: ThemeSource, backgroundColor?: string) {
  await ipcRenderer.invoke('set-theme-source', themeSource, backgroundColor);
}

// Calls the listener when git or ssh asks for credentials, returns a function that removes the listener
export function onCredentialRequest(listener: (request: CredentialRequest) => void) {
  const handler = (_event: Electron.IpcRendererEvent, request: CredentialRequest) => listener(request);
  ipcRenderer.on('credential-request', handler);
  return () => {
    ipcRenderer.off('credential-request', handler);
  };
}

// Answers a request for credentials, null cancels it
export function answerCredentialRequest(id: number, answer: CredentialAnswer | null) {
  ipcRenderer.send('credential-response', id, answer);
}

// Number of passphrases and passwords remembered until the app quits
export async function getRememberedCredentialCount(): Promise<number> {
  return await ipcRenderer.invoke('get-remembered-credential-count');
}

export async function forgetCredentials() {
  await ipcRenderer.invoke('forget-credentials');
}
