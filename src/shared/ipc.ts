// Menu items sent from the renderer to the main process,
// the main process answers with the id of the clicked item
export interface SerializedMenuItem {
  id?: number;
  label?: string;
  type?: 'normal' | 'separator';
  enabled?: boolean;
  submenu?: SerializedMenuItem[];
}

// Color scheme of the native parts of the window (menus, scrollbars, title bar),
// 'system' follows the OS
export type ThemeSource = 'system' | 'light' | 'dark';
