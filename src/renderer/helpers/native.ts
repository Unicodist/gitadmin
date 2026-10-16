import { ipcRenderer } from 'electron';
import { SerializedMenuItem, ThemeSource } from '../../shared/ipc';

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

// Asks the user to pick a directory, returns null if the dialog is cancelled
export async function showOpenDirectoryDialog() {
  const result: Electron.OpenDialogReturnValue = await ipcRenderer.invoke('show-open-dialog', {
    properties: ['openDirectory', 'createDirectory']
  });
  return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0];
}

// Sets the color scheme of the native parts of the window (menus, scrollbars, title bar),
// and the color shown before the page is painted
export async function setThemeSource(themeSource: ThemeSource, backgroundColor?: string) {
  await ipcRenderer.invoke('set-theme-source', themeSource, backgroundColor);
}
