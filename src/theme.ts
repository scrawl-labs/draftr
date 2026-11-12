// The "Tone" theme. Every color lives here.
//
// It only uses what Excalidraw, tldraw and draw.io can all draw: solid fills, a border in the same hue,
// rounded rectangles, dashes, image icons and native edge labels. Each hue also has a `tldraw` name so
// the tldraw export can pick the closest color from tldraw's fixed palette.
import type { Kind } from './schema.js';

export interface Hue {
  /** Box background. */
  fill: string;
  /** Box border (same hue, a few steps darker than the fill). */
  line: string;
  /** Icon color on the light fill. */
  ink: string;
  /** Solid color for highlighted boxes and edges (white text on top). */
  solid: string;
  /** Closest named color in tldraw's palette. */
  tldraw: 'blue' | 'orange' | 'violet' | 'green' | 'grey' | 'yellow' | 'red' | 'black' | 'light-blue' | 'light-violet' | 'light-green' | 'light-red';
}

export type Shape = 'rect' | 'pill' | 'diamond';

const BLUE: Hue = { fill: '#eef2fd', line: '#9db0ee', ink: '#3b5bdb', solid: '#3b5bdb', tldraw: 'blue' };
const ORANGE: Hue = { fill: '#fff3e6', line: '#f2b47a', ink: '#d9480f', solid: '#e8590c', tldraw: 'orange' };
const VIOLET: Hue = { fill: '#f6effc', line: '#c9a6e6', ink: '#9c36b5', solid: '#9c36b5', tldraw: 'violet' };
const GREEN: Hue = { fill: '#ebf7f0', line: '#93cfaa', ink: '#2b8a3e', solid: '#2b8a3e', tldraw: 'green' };
const GREY: Hue = { fill: '#f3f4f6', line: '#b6bdc6', ink: '#5c6672', solid: '#495057', tldraw: 'grey' };
const YELLOW: Hue = { fill: '#fff8e1', line: '#efc65e', ink: '#b07b06', solid: '#e67700', tldraw: 'yellow' };

export const THEME = {
  name: 'tone',
  background: '#ffffff',
  ink: '#1d2433',
  muted: '#6b7280',
  edge: '#5b6472',
  white: '#ffffff',
  group: { fills: ['#fafbfc', '#f6f7f9', '#f1f3f5'], line: '#e3e6ea', label: '#6b7280' },
  lifeline: '#c4c9d1',
  kinds: {
    service: { hue: BLUE, shape: 'rect', caption: 'Service' },
    database: { hue: ORANGE, shape: 'rect', caption: 'Database' },
    storage: { hue: ORANGE, shape: 'rect', caption: 'Storage' },
    queue: { hue: VIOLET, shape: 'rect', caption: 'Queue' },
    user: { hue: GREEN, shape: 'pill', caption: 'Actor' },
    client: { hue: GREEN, shape: 'rect', caption: 'Client' },
    external: { hue: GREY, shape: 'rect', caption: 'External', dashed: true },
    decision: { hue: YELLOW, shape: 'diamond', caption: 'Decision' },
    note: { hue: YELLOW, shape: 'rect', caption: 'Note' },
  } satisfies Record<Kind, { hue: Hue; shape: Shape; caption: string; dashed?: boolean }> as Record<Kind, { hue: Hue; shape: Shape; caption: string; dashed?: boolean }>,
  /** Sizes in px. Excalidraw text is set in Nunito and one point larger (it renders smaller). */
  size: { title: 15, caption: 12, edgeLabel: 12.5, group: 12.5, docTitle: 20, excalidrawTitle: 16, excalidrawCaption: 12, excalidrawEdgeLabel: 13, excalidrawGroup: 14 },
  node: { height: 56, minWidth: 140, padX: 16, padRight: 18, icon: 18, iconGap: 10, radius: 10, border: 1.5 },
  stroke: { width: 1.4, highlightWidth: 2 },
};

export const kindStyle = (kind: Kind) => THEME.kinds[kind] ?? THEME.kinds.service;
