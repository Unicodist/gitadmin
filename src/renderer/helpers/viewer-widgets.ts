import { createIconElement, IconName } from './icons';
import { getEditorFontFamily } from './monaco-loader';

// The scrollbars of the editors are as wide as the other scrollbars of the app (@scrollbar-size)
const EDITOR_SCROLLBAR_SIZE = 10;

// Height of the headers drawn across the editors above the hunks and the conflicts
export const WIDGET_HEADER_HEIGHT = 32;

// Options shared by the editors of the patch viewer, on top of their own
export function getEditorOptions() {
  return {
    fontFamily: getEditorFontFamily(),
    minimap: {
      enabled: false
    },
    // The editors are read-only, the position of the cursor does not matter
    hideCursorInOverviewRuler: true,
    scrollbar: {
      verticalScrollbarSize: EDITOR_SCROLLBAR_SIZE,
      horizontalScrollbarSize: EDITOR_SCROLLBAR_SIZE
    }
  };
}

// Header of a hunk or a conflict, the editors draw it over the view zone that makes room for it
export function createWidgetHeader(className: string, first: boolean) {
  const header = document.createElement('div');
  header.classList.add('widget-header', className);
  // The first header is at the top of the editor, right under the border of the toolbar
  if (first) {
    header.classList.add('first-widget');
  }
  return header;
}

export interface WidgetButtonOptions {
  label: string;
  // End of the label that narrow headers leave out, like " change" in "Accept current change". It
  // stays in the name of the button.
  labelEnd?: string;
  title: string;
  classNames?: string[];
  // An icon, or an element that takes its place
  icon: IconName | Element;
  onClick: () => void;
}

// Small button of the headers, which are not rendered by React
export function createWidgetButton(options: WidgetButtonOptions) {
  const button = document.createElement('button');
  button.type = 'button';
  button.classList.add('small-button', ...(options.classNames || []));
  button.title = options.title;
  button.append(typeof options.icon === 'string' ? createIconElement(options.icon, 14) : options.icon);
  const labelNode = document.createElement('span');
  labelNode.className = 'button-label';
  labelNode.textContent = options.label;
  if (options.labelEnd) {
    const endNode = document.createElement('span');
    endNode.className = 'label-end';
    endNode.textContent = options.labelEnd;
    labelNode.append(endNode);
  }
  button.append(labelNode);
  button.addEventListener('click', options.onClick);
  return button;
}
