/*
 * Icons of Lucide (https://lucide.dev), stored as the lists of SVG elements that
 * Lucide generates for its packages. Only the icons used by the app are included.
 *
 * ISC License
 *
 * Copyright (c) 2026 Lucide Icons and Contributors
 *
 * Permission to use, copy, modify, and/or distribute this software for any
 * purpose with or without fee is hereby granted, provided that the above
 * copyright notice and this permission notice appear in all copies.
 *
 * THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
 * WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
 * MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
 * ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
 * WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
 * ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
 * OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
 *
 * Some of these icons are derived from Feather (https://feathericons.com):
 *
 * The MIT License (MIT)
 *
 * Copyright (c) 2013-present Cole Bemis
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

// Attributes of the svg element, Lucide draws its icons on a 24x24 grid
export const ICON_ATTRIBUTES = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  'stroke-width': '2',
  'stroke-linecap': 'round',
  'stroke-linejoin': 'round'
};

export const DEFAULT_ICON_SIZE = 16;

export type IconNode = [string, Record<string, string>][];

// The paths of some icons are longer than the maximum line length
/* eslint-disable max-len */
const ICONS = {
  'archive': [
    ['rect', { width: '20', height: '5', x: '2', y: '3', rx: '1' }],
    ['path', { d: 'M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8' }],
    ['path', { d: 'M10 12h4' }]
  ],
  'archive-restore': [
    ['rect', { width: '20', height: '5', x: '2', y: '3', rx: '1' }],
    ['path', { d: 'M4 8v11a2 2 0 0 0 2 2h2' }],
    ['path', { d: 'M20 8v11a2 2 0 0 1-2 2h-2' }],
    ['path', { d: 'm9 15 3-3 3 3' }],
    ['path', { d: 'M12 12v9' }]
  ],
  'arrow-down-to-line': [
    ['path', { d: 'M12 17V3' }],
    ['path', { d: 'm6 11 6 6 6-6' }],
    ['path', { d: 'M19 21H5' }]
  ],
  'arrow-up-from-line': [
    ['path', { d: 'm18 9-6-6-6 6' }],
    ['path', { d: 'M12 3v14' }],
    ['path', { d: 'M5 21h14' }]
  ],
  'binary': [
    ['rect', { x: '14', y: '14', width: '4', height: '6', rx: '2' }],
    ['rect', { x: '6', y: '4', width: '4', height: '6', rx: '2' }],
    ['path', { d: 'M6 20h4' }],
    ['path', { d: 'M14 10h4' }],
    ['path', { d: 'M6 14h2v6' }],
    ['path', { d: 'M14 4h2v6' }]
  ],
  'calendar': [
    ['path', { d: 'M8 2v3' }],
    ['path', { d: 'M16 2v3' }],
    ['rect', { x: '3', y: '3', width: '18', height: '18', rx: '2' }],
    ['path', { d: 'M3 9h18' }]
  ],
  'check': [
    ['path', { d: 'M20 6 9 17l-5-5' }]
  ],
  'chevron-down': [
    ['path', { d: 'm6 9 6 6 6-6' }]
  ],
  'chevron-right': [
    ['path', { d: 'm9 18 6-6-6-6' }]
  ],
  'circle-alert': [
    ['circle', { cx: '12', cy: '12', r: '10' }],
    ['line', { x1: '12', x2: '12', y1: '8', y2: '12' }],
    ['line', { x1: '12', x2: '12.01', y1: '16', y2: '16' }]
  ],
  'circle-check': [
    ['circle', { cx: '12', cy: '12', r: '10' }],
    ['path', { d: 'm16 9-5.5 5.5L8 12' }]
  ],
  'clock': [
    ['circle', { cx: '12', cy: '12', r: '10' }],
    ['path', { d: 'M12 6v6l4 2' }]
  ],
  'cloud': [
    ['path', { d: 'M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z' }]
  ],
  'cloud-download': [
    ['path', { d: 'M12 13v8l-4-4' }],
    ['path', { d: 'm12 21 4-4' }],
    ['path', { d: 'M4.393 15.269A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.436 8.284' }]
  ],
  'code': [
    ['path', { d: 'm16 18 6-6-6-6' }],
    ['path', { d: 'm8 6-6 6 6 6' }]
  ],
  'copy': [
    ['rect', { width: '14', height: '14', x: '8', y: '8', rx: '2', ry: '2' }],
    ['path', { d: 'M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2' }]
  ],
  'download': [
    ['path', { d: 'M12 15V3' }],
    ['path', { d: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' }],
    ['path', { d: 'm7 10 5 5 5-5' }]
  ],
  'external-link': [
    ['path', { d: 'M15 3h6v6' }],
    ['path', { d: 'M10 14 21 3' }],
    ['path', { d: 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6' }]
  ],
  'file-exclamation-point': [
    ['path', { d: 'M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z' }],
    ['path', { d: 'M12 9v4' }],
    ['path', { d: 'M12 17h.01' }]
  ],
  'file-minus': [
    ['path', { d: 'M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z' }],
    ['path', { d: 'M14 2v5a1 1 0 0 0 1 1h5' }],
    ['path', { d: 'M9 15h6' }]
  ],
  'file-pen': [
    ['path', { d: 'M12.659 22H18a2 2 0 0 0 2-2V8a2.4 2.4 0 0 0-.706-1.706l-3.588-3.588A2.4 2.4 0 0 0 14 2H6a2 2 0 0 0-2 2v9.34' }],
    ['path', { d: 'M14 2v5a1 1 0 0 0 1 1h5' }],
    ['path', { d: 'M10.378 12.622a1 1 0 0 1 3 3.003L8.36 20.637a2 2 0 0 1-.854.506l-2.867.837a.5.5 0 0 1-.62-.62l.836-2.869a2 2 0 0 1 .506-.853z' }]
  ],
  'file-plus': [
    ['path', { d: 'M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z' }],
    ['path', { d: 'M14 2v5a1 1 0 0 0 1 1h5' }],
    ['path', { d: 'M9 15h6' }],
    ['path', { d: 'M12 18v-6' }]
  ],
  'file-symlink': [
    ['path', { d: 'M4 11V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.706.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h7' }],
    ['path', { d: 'M14 2v5a1 1 0 0 0 1 1h5' }],
    ['path', { d: 'm10 18 3-3-3-3' }]
  ],
  'folder-git-2': [
    ['path', { d: 'M18 19a5 5 0 0 1-5-5v8' }],
    ['path', { d: 'M9 20H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v5' }],
    ['circle', { cx: '13', cy: '12', r: '2' }],
    ['circle', { cx: '20', cy: '19', r: '2' }]
  ],
  'folder-open': [
    ['path', { d: 'm6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2' }]
  ],
  'folder-plus': [
    ['path', { d: 'M12 10v6' }],
    ['path', { d: 'M9 13h6' }],
    ['path', { d: 'M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z' }]
  ],
  'git-branch': [
    ['path', { d: 'M15 6a9 9 0 0 0-9 9V3' }],
    ['circle', { cx: '18', cy: '6', r: '3' }],
    ['circle', { cx: '6', cy: '18', r: '3' }]
  ],
  'git-branch-plus': [
    ['path', { d: 'M6 3v12' }],
    ['path', { d: 'M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6z' }],
    ['path', { d: 'M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z' }],
    ['path', { d: 'M15 6a9 9 0 0 0-9 9' }],
    ['path', { d: 'M18 15v6' }],
    ['path', { d: 'M21 18h-6' }]
  ],
  'git-commit-horizontal': [
    ['circle', { cx: '12', cy: '12', r: '3' }],
    ['line', { x1: '3', x2: '9', y1: '12', y2: '12' }],
    ['line', { x1: '15', x2: '21', y1: '12', y2: '12' }]
  ],
  'git-fork': [
    ['circle', { cx: '12', cy: '18', r: '3' }],
    ['circle', { cx: '6', cy: '6', r: '3' }],
    ['circle', { cx: '18', cy: '6', r: '3' }],
    ['path', { d: 'M18 9v2c0 .6-.4 1-1 1H7c-.6 0-1-.4-1-1V9' }],
    ['path', { d: 'M12 12v3' }]
  ],
  'git-merge': [
    ['circle', { cx: '18', cy: '18', r: '3' }],
    ['circle', { cx: '6', cy: '6', r: '3' }],
    ['path', { d: 'M6 21V9a9 9 0 0 0 9 9' }]
  ],
  'git-merge-conflict': [
    ['path', { d: 'M12 6h4a2 2 0 0 1 2 2v7' }],
    ['path', { d: 'M6 12v9' }],
    ['path', { d: 'm8.5 3.5-5 5' }],
    ['path', { d: 'm8.5 8.5-5-5' }],
    ['circle', { cx: '18', cy: '18', r: '3' }]
  ],
  'inbox': [
    ['polyline', { points: '22 12 16 12 14 15 10 15 8 12 2 12' }],
    ['path', { d: 'M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z' }]
  ],
  'info': [
    ['circle', { cx: '12', cy: '12', r: '10' }],
    ['path', { d: 'M12 16v-4' }],
    ['path', { d: 'M12 8h.01' }]
  ],
  'key-round': [
    ['path', { d: 'M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z' }],
    ['circle', { cx: '16.5', cy: '7.5', r: '.5', fill: 'currentColor' }]
  ],
  'list': [
    ['path', { d: 'M3 5h.01' }],
    ['path', { d: 'M3 12h.01' }],
    ['path', { d: 'M3 19h.01' }],
    ['path', { d: 'M8 5h13' }],
    ['path', { d: 'M8 12h13' }],
    ['path', { d: 'M8 19h13' }]
  ],
  'list-filter': [
    ['path', { d: 'M2 5h20' }],
    ['path', { d: 'M6 12h12' }],
    ['path', { d: 'M9 19h6' }]
  ],
  'loader-circle': [
    ['path', { d: 'M21 12a9 9 0 1 1-6.219-8.56' }]
  ],
  'locate-fixed': [
    ['line', { x1: '2', x2: '5', y1: '12', y2: '12' }],
    ['line', { x1: '19', x2: '22', y1: '12', y2: '12' }],
    ['line', { x1: '12', x2: '12', y1: '2', y2: '5' }],
    ['line', { x1: '12', x2: '12', y1: '19', y2: '22' }],
    ['circle', { cx: '12', cy: '12', r: '7' }],
    ['circle', { cx: '12', cy: '12', r: '3' }]
  ],
  'map': [
    ['path', { d: 'M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.619v12.764a1 1 0 0 1-.553.894l-4.553 2.277a2 2 0 0 1-1.788 0l-4.212-2.106a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.381V6.618a1 1 0 0 1 .553-.894l4.553-2.277a2 2 0 0 1 1.788 0z' }],
    ['path', { d: 'M15 5.764v15' }],
    ['path', { d: 'M9 3.236v15' }]
  ],
  'minus': [
    ['path', { d: 'M5 12h14' }]
  ],
  'palette': [
    ['path', { d: 'M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8z' }],
    ['circle', { cx: '13.5', cy: '6.5', r: '.5', fill: 'currentColor' }],
    ['circle', { cx: '17.5', cy: '10.5', r: '.5', fill: 'currentColor' }],
    ['circle', { cx: '6.5', cy: '12.5', r: '.5', fill: 'currentColor' }],
    ['circle', { cx: '8.5', cy: '7.5', r: '.5', fill: 'currentColor' }]
  ],
  'pencil-line': [
    ['path', { d: 'M13 21h8' }],
    ['path', { d: 'm15 5 4 4' }],
    ['path', { d: 'M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z' }]
  ],
  'plus': [
    ['path', { d: 'M5 12h14' }],
    ['path', { d: 'M12 5v14' }]
  ],
  'rotate-ccw-clock': [
    ['path', { d: 'M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8' }],
    ['path', { d: 'M3 3v5h5' }],
    ['path', { d: 'M12 7v5l4 2' }]
  ],
  'scan': [
    ['path', { d: 'M3 7V5a2 2 0 0 1 2-2h2' }],
    ['path', { d: 'M17 3h2a2 2 0 0 1 2 2v2' }],
    ['path', { d: 'M21 17v2a2 2 0 0 1-2 2h-2' }],
    ['path', { d: 'M7 21H5a2 2 0 0 1-2-2v-2' }]
  ],
  'search': [
    ['path', { d: 'm21 21-4.34-4.34' }],
    ['circle', { cx: '11', cy: '11', r: '8' }]
  ],
  'tag': [
    ['path', { d: 'M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z' }],
    ['circle', { cx: '7.5', cy: '7.5', r: '.5', fill: 'currentColor' }]
  ],
  'undo-2': [
    ['path', { d: 'M9 14 4 9l5-5' }],
    ['path', { d: 'M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11' }]
  ],
  'user': [
    ['path', { d: 'M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2' }],
    ['circle', { cx: '12', cy: '7', r: '4' }]
  ],
  'waypoints': [
    ['path', { d: 'm10.586 5.414-5.172 5.172' }],
    ['path', { d: 'm18.586 13.414-5.172 5.172' }],
    ['path', { d: 'M6 12h12' }],
    ['circle', { cx: '12', cy: '20', r: '2' }],
    ['circle', { cx: '12', cy: '4', r: '2' }],
    ['circle', { cx: '20', cy: '12', r: '2' }],
    ['circle', { cx: '4', cy: '12', r: '2' }]
  ],
  'x': [
    ['path', { d: 'M18 6 6 18' }],
    ['path', { d: 'm6 6 12 12' }]
  ],
  'zoom-in': [
    ['circle', { cx: '11', cy: '11', r: '8' }],
    ['line', { x1: '21', x2: '16.65', y1: '21', y2: '16.65' }],
    ['line', { x1: '11', x2: '11', y1: '8', y2: '14' }],
    ['line', { x1: '8', x2: '14', y1: '11', y2: '11' }]
  ],
  'zoom-out': [
    ['circle', { cx: '11', cy: '11', r: '8' }],
    ['line', { x1: '21', x2: '16.65', y1: '21', y2: '16.65' }],
    ['line', { x1: '8', x2: '14', y1: '11', y2: '11' }]
  ]
} satisfies Record<string, IconNode>;
/* eslint-enable max-len */

export type IconName = keyof typeof ICONS;

export const ICON_NAMES = Object.keys(ICONS) as IconName[];

export function getIconNode(name: IconName): IconNode {
  return ICONS[name];
}

// Creates the icon as a DOM element, for the widgets that are not rendered by React
export function createIconElement(name: IconName, size = DEFAULT_ICON_SIZE) {
  const svg = document.createElementNS(SVG_NAMESPACE, 'svg');
  for (const [attribute, value] of Object.entries(ICON_ATTRIBUTES)) {
    svg.setAttribute(attribute, value);
  }
  svg.setAttribute('width', `${size}`);
  svg.setAttribute('height', `${size}`);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.classList.add('icon', `icon-${name}`);
  for (const [tag, attributes] of getIconNode(name)) {
    const child = document.createElementNS(SVG_NAMESPACE, tag);
    for (const [attribute, value] of Object.entries(attributes)) {
      child.setAttribute(attribute, value);
    }
    svg.appendChild(child);
  }
  return svg;
}
