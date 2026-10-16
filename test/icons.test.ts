import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as Path from 'path';
import { getIconNode, ICON_NAMES } from '../src/renderer/helpers/icons';
import { listFiles } from './helpers';

const SRC_PATH = Path.join(__dirname, '../../src');
const ICONS_PATH = Path.join(SRC_PATH, 'renderer/helpers/icons.ts');

describe('icons', () => {
  it('only includes the icons that the app uses', () => {
    // The names are written as strings, like <Icon name='check' /> or createIconElement('copy'). An icon whose name is
    // also a string of another kind in the sources, like the git command 'list', is not caught.
    const sources = listFiles(SRC_PATH, ['.ts', '.tsx'])
      .filter((path) => path !== ICONS_PATH)
      .map((path) => fs.readFileSync(path).toString());
    const unused = ICON_NAMES.filter((name) => !sources.some((source) => source.includes(`'${name}'`)));
    assert.deepEqual(unused, []);
  });

  it('draws each icon', () => {
    for (const name of ICON_NAMES) {
      assert.ok(getIconNode(name).length > 0, name);
    }
  });
});
