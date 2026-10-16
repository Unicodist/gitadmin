import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as Path from 'path';
import {
  getEditorThemeData, getEditorThemeName, listThemes, parseTheme, resolveThemeName, SYSTEM_THEME, Theme, ThemeManager
} from '../src/shared/theme-manager';
import { BRANCH_COLORS } from '../src/renderer/helpers/commit-graph';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const less = require('less');

const ROOT = Path.join(__dirname, '../..');
const THEMES_PATH = Path.join(ROOT, 'assets/themes');
const LESS_PATH = Path.join(ROOT, 'assets/less');
const SRC_PATH = Path.join(ROOT, 'src');

function readThemeFile(name: string) {
  return JSON.parse(fs.readFileSync(Path.join(THEMES_PATH, `${name}.json`)).toString());
}

function listFiles(dir: string, extensions: string[]): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = Path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return listFiles(path, extensions);
    }
    return extensions.some((extension) => entry.name.endsWith(extension)) ? [path] : [];
  });
}

// Variables defined in the :root block of tokens.less
function getTokenVariables() {
  const tokens = fs.readFileSync(Path.join(LESS_PATH, 'tokens.less')).toString();
  return [...tokens.matchAll(/^\s*--([a-z0-9-]+):/gm)].map((match) => match[1]);
}

// Variables set by the components, like style={{'--branch-color': color}}
function getComponentVariables() {
  return listFiles(SRC_PATH, ['.ts', '.tsx']).flatMap((path) => {
    const content = fs.readFileSync(path).toString();
    return [...content.matchAll(/['"`]--([a-z0-9-]+)['"`]/g)].map((match) => match[1]);
  });
}

// Variables used with var() in a file, with the line of each use
function getUsedVariables(path: string) {
  const lines = fs.readFileSync(path).toString().split('\n');
  return lines.flatMap((line, i) => [...line.matchAll(/var\(--([a-z0-9-]+)/g)].map((match) => ({
    variable: match[1],
    location: `${Path.relative(ROOT, path)}:${i + 1}`
  })));
}

// Colors

type Rgba = [number, number, number, number];

function parseColor(color: string): Rgba {
  const hex = color.match(/^#([0-9a-f]{3,8})$/i);
  if (hex) {
    let digits = hex[1];
    if (digits.length <= 4) {
      digits = [...digits].map((digit) => digit + digit).join('');
    }
    const values = digits.match(/../g)!.map((value) => parseInt(value, 16));
    return [values[0], values[1], values[2], values.length > 3 ? values[3] / 255 : 1];
  }
  const rgb = color.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/);
  if (rgb) {
    return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3]), rgb[4] !== undefined ? Number(rgb[4]) : 1];
  }
  throw new Error(`Unsupported color ${color}`);
}

// Paints color over an opaque background
function composite(color: string, background: Rgba): Rgba {
  const [r, g, b, a] = parseColor(color);
  return [r * a + background[0] * (1 - a), g * a + background[1] * (1 - a), b * a + background[2] * (1 - a), 1];
}

// Mixes two colors like color-mix(in srgb, color p, background)
function mix(color: string, p: number, background: Rgba): Rgba {
  const [r, g, b] = parseColor(color);
  return [r * p + background[0] * (1 - p), g * p + background[1] * (1 - p), b * p + background[2] * (1 - p), 1];
}

function luminance([r, g, b]: Rgba) {
  const linear = (value: number) => {
    value /= 255;
    return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

function contrast(foreground: Rgba, background: Rgba) {
  const [l1, l2] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (l1 + 0.05) / (l2 + 0.05);
}

// Tests

describe('themes', () => {
  const light = readThemeFile('light');
  const dark = readThemeFile('dark');

  it('lists the built-in themes', async () => {
    assert.deepEqual(await listThemes(THEMES_PATH), ['dark', 'light']);
  });

  it('defines the same variables and editor colors in the light and dark themes', () => {
    assert.equal(light.scheme, 'light');
    assert.equal(dark.scheme, 'dark');
    assert.deepEqual(Object.keys(dark.css).sort(), Object.keys(light.css).sort());
    assert.deepEqual(Object.keys(dark.monaco.colors).sort(), Object.keys(light.monaco.colors).sort());
    assert.equal(light.monaco.base, 'vs');
    assert.equal(dark.monaco.base, 'vs-dark');
  });

  it('only uses variables that are defined by the tokens or the themes', () => {
    const defined = new Set([...getTokenVariables(), ...getComponentVariables(), ...Object.keys(light.css)]);
    const files = [...listFiles(LESS_PATH, ['.less']), ...listFiles(SRC_PATH, ['.ts', '.tsx'])];
    const undefinedUses = files.flatMap(getUsedVariables).filter((use) => !defined.has(use.variable))
      .map((use) => `--${use.variable} at ${use.location}`);
    assert.deepEqual(undefinedUses, []);
  });

  it('uses every variable of the themes', () => {
    const files = [...listFiles(LESS_PATH, ['.less']), ...listFiles(SRC_PATH, ['.ts', '.tsx'])];
    const used = new Set(files.flatMap(getUsedVariables).map((use) => use.variable));
    assert.deepEqual(Object.keys(light.css).filter((variable) => !used.has(variable)), []);
  });

  it('compiles the stylesheet', async () => {
    const path = Path.join(LESS_PATH, 'index.less');
    const output = await less.render(fs.readFileSync(path).toString(), { filename: path });
    assert.match(output.css, /--surface-0|var\(--surface-0\)/);
    assert.doesNotMatch(output.css, /font-famliy/);
  });
});

describe('parseTheme', () => {
  const base = parseTheme('dark', readThemeFile('dark'));

  it('reads the variables that were renamed', () => {
    const theme = parseTheme('old', { css: { 'font-famliy': 'Arial' } });
    assert.equal(theme.css['font-family'], 'Arial');
    assert.equal(theme.css['font-famliy'], undefined);
    const both = parseTheme('both', { css: { 'font-family': 'Inter', 'font-famliy': 'Arial' } });
    assert.equal(both.css['font-family'], 'Inter');
  });

  it('finds the color scheme of the themes written before the scheme was added', () => {
    assert.equal(parseTheme('old', { css: {}, monaco: { theme: 'vs-dark' } }).scheme, 'dark');
    assert.equal(parseTheme('old', { css: {}, monaco: { theme: 'vs-dark' } }).monaco.base, 'vs-dark');
    assert.equal(parseTheme('old', { css: {}, monaco: { theme: 'vs-light' } }).scheme, 'light');
    // vs-light is not a theme of Monaco
    assert.equal(parseTheme('old', { css: {}, monaco: { theme: 'vs-light' } }).monaco.base, 'vs');
    assert.equal(parseTheme('old', {}).scheme, 'light');
  });

  it('takes the values that a theme does not define from its base', () => {
    const theme = parseTheme('custom', { scheme: 'dark', css: { accent: '#ff0000' }, monaco: { colors: { 'editor.background': '#000000' } } }, base);
    assert.equal(theme.css['accent'], '#ff0000');
    assert.equal(theme.css['surface-0'], base.css['surface-0']);
    assert.equal(theme.monaco.colors['editor.background'], '#000000');
    assert.equal(theme.monaco.colors['editor.foreground'], base.monaco.colors['editor.foreground']);
  });
});

describe('ThemeManager', () => {
  let path: string;

  before(() => {
    path = fs.mkdtempSync(Path.join(os.tmpdir(), 'gitadmin-themes-'));
    for (const name of ['light', 'dark']) {
      fs.copyFileSync(Path.join(THEMES_PATH, `${name}.json`), Path.join(path, `${name}.json`));
    }
    fs.writeFileSync(Path.join(path, 'Solarized Dark.json'), JSON.stringify({
      css: { 'font-famliy': 'Fira Sans', accent: '#268bd2' },
      monaco: { theme: 'vs-dark' }
    }));
  });

  after(() => {
    fs.rmSync(path, { recursive: true, force: true });
  });

  it('follows the color scheme of the OS with the system setting', () => {
    const manager = new ThemeManager(path);
    assert.equal(resolveThemeName(SYSTEM_THEME, true), 'dark');
    assert.equal(manager.loadTheme(SYSTEM_THEME, true).name, 'dark');
    assert.equal(manager.loadTheme(SYSTEM_THEME, false).name, 'light');
    assert.equal(manager.loadTheme('dark', false).name, 'dark');
  });

  it('extends the built-in theme of the color scheme of a custom theme', () => {
    const theme = new ThemeManager(path).loadTheme('Solarized Dark', false);
    const dark = readThemeFile('dark');
    assert.equal(theme.scheme, 'dark');
    assert.equal(theme.css['accent'], '#268bd2');
    assert.equal(theme.css['font-family'], 'Fira Sans');
    assert.equal(theme.css['surface-1'], dark.css['surface-1']);
    assert.equal(theme.monaco.base, 'vs-dark');
    assert.deepEqual(theme.monaco.colors, dark.monaco.colors);
  });

  it('falls back to the theme of the OS if the theme cannot be read', (t) => {
    t.mock.method(console, 'error', () => {});
    const manager = new ThemeManager(path);
    assert.equal(manager.loadTheme('removed', true).name, 'dark');
    assert.equal(manager.loadTheme('removed', false).name, 'light');
  });

  it('sets the variables of the theme on the root element', () => {
    const properties = new Map<string, string>();
    const root = {
      style: {
        setProperty: (name: string, value: string) => properties.set(name, value),
        removeProperty: (name: string) => properties.delete(name),
        colorScheme: ''
      },
      dataset: {} as Record<string, string>
    };
    const manager = new ThemeManager(path);
    const custom: Theme = {
      name: 'custom',
      scheme: 'dark',
      css: { 'only-custom': 'red', 'accent': 'blue' },
      monaco: { base: 'vs-dark', colors: {} }
    };
    manager.applyTheme(custom, root as any);
    assert.equal(properties.get('--only-custom'), 'red');
    const light = manager.loadTheme('light', false);
    manager.applyTheme(light, root as any);
    assert.equal(properties.has('--only-custom'), false);
    assert.equal(properties.get('--accent'), light.css['accent']);
    assert.equal(root.style.colorScheme, 'light');
    assert.equal(root.dataset.scheme, 'light');
    assert.equal(manager.theme, light);
  });

  it('names the editor themes with the characters that Monaco accepts', () => {
    const theme = new ThemeManager(path).loadTheme('Solarized Dark', false);
    assert.equal(getEditorThemeName(theme), 'gitadmin-solarized-dark');
    assert.match(getEditorThemeName(theme), /^[a-z0-9-]+$/);
    assert.deepEqual(getEditorThemeData(theme), { base: 'vs-dark', inherit: true, rules: [], colors: theme.monaco.colors });
  });
});

// WCAG AA: 4.5:1 for text, 3:1 for large text and for the parts of the controls
for (const name of ['light', 'dark']) {
  describe(`contrast of the ${name} theme`, () => {
    const theme = readThemeFile(name);
    const css: Record<string, string> = theme.css;
    const color = (variable: string) => parseColor(css[variable]);
    const surfaces = ['surface-0', 'surface-1', 'surface-2'];
    // Surfaces, and rows of the lists and ghost buttons, which are on the surfaces 0 and 1
    const backgrounds = [
      ...surfaces.map((surface) => ({ name: surface, color: color(surface) })),
      ...['surface-0', 'surface-1'].flatMap((surface) => ['hover', 'active', 'selected', 'selected-hover'].map((overlay) => ({
        name: `${overlay} on ${surface}`,
        color: composite(css[overlay], color(surface))
      })))
    ];

    function check(foreground: string, backgrounds: { name: string, color: Rgba }[], ratio: number) {
      const failures = backgrounds.map((background) => ({ ...background, contrast: contrast(color(foreground), background.color) }))
        .filter((background) => background.contrast < ratio)
        .map((background) => `${foreground} on ${background.name}: ${background.contrast.toFixed(2)}`);
      assert.deepEqual(failures, []);
    }

    it('has readable text on the surfaces and the rows of the lists', () => {
      for (const text of ['text-primary', 'text-secondary', 'text-muted', 'accent-text', 'success', 'warning', 'danger']) {
        check(text, backgrounds, 4.5);
      }
      check('text-primary', [{ name: 'surface-3', color: color('surface-3') }], 4.5);
    });

    it('has readable text on the subtle backgrounds of the status colors', () => {
      for (const status of ['accent', 'success', 'warning', 'danger']) {
        const text = status === 'accent' ? 'accent-text' : status;
        check(text, surfaces.map((surface) => ({
          name: `${status}-subtle on ${surface}`,
          color: composite(css[`${status}-subtle`], color(surface))
        })), 4.5);
      }
    });

    it('has readable text on the filled buttons and badges', () => {
      const filled = (names: string[]) => names.map((name) => ({ name: name, color: color(name) }));
      check('text-on-accent', filled(['accent', 'accent-hover', 'accent-pressed']), 4.5);
      check('text-on-emphasis', filled(['success-emphasis', 'warning-emphasis', 'danger-emphasis']), 4.5);
      check('tooltip-text', filled(['tooltip-background']), 4.5);
    });

    it('has visible focus rings', () => {
      check('focus-ring', surfaces.map((surface) => ({ name: surface, color: color(surface) })), 3);
    });

    it('has branch colors that stand out from the commit list', () => {
      const backgrounds = [
        { name: 'surface-1', color: color('surface-1') },
        { name: 'selected', color: composite(css['selected'], color('surface-1')) }
      ];
      for (const branchColor of BRANCH_COLORS) {
        for (const background of backgrounds) {
          const ratio = contrast(parseColor(branchColor), background.color);
          assert.ok(ratio >= 3, `${branchColor} on ${background.name}: ${ratio.toFixed(2)}`);
        }
        // Text of the reference badges, drawn on a tint of the color of the branch
        const tint = mix(branchColor, 0.3, color('surface-1'));
        const ratio = contrast(color('text-primary'), tint);
        assert.ok(ratio >= 4.5, `text-primary on ${branchColor} tint: ${ratio.toFixed(2)}`);
      }
    });

    it('has readable code and diffs in the editor', () => {
      const colors: Record<string, string> = theme.monaco.colors;
      const background = parseColor(colors['editor.background']);
      const foreground = parseColor(colors['editor.foreground']);
      assert.ok(contrast(foreground, background) >= 4.5);
      assert.ok(contrast(parseColor(colors['editorLineNumber.foreground']), background) >= 4.5);
      for (const diff of ['diffEditor.insertedLineBackground', 'diffEditor.removedLineBackground']) {
        const line = composite(colors[diff], background);
        assert.ok(contrast(foreground, line) >= 4.5, diff);
        for (const text of ['diffEditor.insertedTextBackground', 'diffEditor.removedTextBackground']) {
          const ratio = contrast(foreground, composite(colors[text], line));
          assert.ok(ratio >= 4.5, `${text} on ${diff}: ${ratio.toFixed(2)}`);
        }
      }
    });
  });
}
