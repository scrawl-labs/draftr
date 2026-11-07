// Every color draftr uses lives here. Swap these for your brand.
import type { Kind } from './schema.js';

export interface KindStyle { bg: string; stroke: string; shape: 'rectangle' | 'ellipse' | 'diamond'; dashed?: boolean }

export const THEME = {
  ink: '#1e1e1e',
  muted: '#868e96',
  accent: '#e03131',
  background: '#ffffff',
  kinds: {
    service: { bg: '#e7f5ff', stroke: '#1971c2', shape: 'rectangle' },
    database: { bg: '#fff3bf', stroke: '#e67700', shape: 'rectangle' },
    storage: { bg: '#fff3bf', stroke: '#e67700', shape: 'rectangle' },
    queue: { bg: '#f3f0ff', stroke: '#6741d9', shape: 'rectangle' },
    external: { bg: '#f8f9fa', stroke: '#495057', shape: 'rectangle', dashed: true },
    user: { bg: '#ebfbee', stroke: '#2f9e44', shape: 'ellipse' },
    client: { bg: '#ebfbee', stroke: '#2f9e44', shape: 'rectangle' },
    decision: { bg: '#fff4e6', stroke: '#d9480f', shape: 'diamond' },
    note: { bg: '#fff9db', stroke: '#f08c00', shape: 'rectangle' },
  } satisfies Record<Kind, KindStyle> as Record<Kind, KindStyle>,
  groupFills: ['#f8f9fa', '#f1f3f5', '#e9ecef'],
};
