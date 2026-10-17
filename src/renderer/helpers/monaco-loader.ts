import * as Path from 'path';
import { pathToFileURL } from 'url';

// Monaco is loaded with its AMD build, which works in a renderer with Node integration
// without a bundler. The stylesheet is linked in index.html.
const MONACO_PATH = Path.join(__dirname, '../../../node_modules/monaco-editor/min');

let monacoPromise: Promise<any> | null = null;
let loadedMonaco: any = null;

// Editor themes made from the app themes, they are defined as soon as Monaco is loaded
const editorThemes = new Map<string, any>();

export function loadMonaco(): Promise<any> {
  if (!monacoPromise) {
    monacoPromise = new Promise((resolve, reject) => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const amdRequire = require(Path.join(MONACO_PATH, 'vs/loader.js')).require;
      // Modules loaded with script tags register themselves with a global define.
      // It has no amd property so that UMD modules loaded with require are not affected.
      (self as any).define = (...args: any[]) => amdRequire.define(...args);
      amdRequire.config({
        baseUrl: pathToFileURL(MONACO_PATH).href,
        // Load the modules like in a browser rather than with Node's vm module
        preferScriptTags: true
      });
      // Monaco's language features do not understand the Node environment
      (self as any).module = undefined;
      amdRequire(['vs/editor/editor.main'], (monaco: any) => {
        loadedMonaco = monaco;
        for (const [name, data] of editorThemes) {
          monaco.editor.defineTheme(name, data);
        }
        resolve(monaco);
      }, reject);
    });
  }
  return monacoPromise;
}

// Registers an editor theme (Monaco's IStandaloneThemeData) under a name that can be passed
// to monaco.editor.setTheme. Registering a name again updates the theme.
export function registerEditorTheme(name: string, data: any) {
  editorThemes.set(name, data);
  if (loadedMonaco) {
    loadedMonaco.editor.defineTheme(name, data);
  }
}

// Font of the editors, Monaco needs the names of the fonts rather than a CSS variable
export function getEditorFontFamily() {
  return getComputedStyle(document.documentElement).getPropertyValue('--font-mono').trim();
}
