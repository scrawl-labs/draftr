// DiagramModel -> tldraw file (.tldr), tldraw 5.x record format.
//
// Groups become frames (drag a frame, its boxes come along). Each box is a tldraw group of a geo shape,
// its icon (image), title and caption (text), so the parts move together. Edges are elbow arrows bound
// to the boxes; labels are arrow labels. Colors use tldraw's named palette (see Hue.tldraw).
import { iconColor } from './excalidraw.js';
import type { DEdge, DiagramModel, DNode } from './model.js';
import { THEME } from './theme.js';
import type { Pt } from './types.js';
import { measureText } from './measure.js';

const T = THEME;
/** tldraw sizes are multiples of a 16px base: size "s" text is 18px, so text shapes are scaled down. */
const TL_S_FONT = 18;

/** Serialized schema of tldraw 5.6; newer tldraw versions migrate files written against it. */
export const TLDRAW_SCHEMA = {
  schemaVersion: 2,
  sequences: {
    'com.tldraw.store': 5, 'com.tldraw.asset': 1, 'com.tldraw.camera': 1, 'com.tldraw.document': 2, 'com.tldraw.instance': 26,
    'com.tldraw.instance_page_state': 5, 'com.tldraw.page': 1, 'com.tldraw.instance_presence': 6, 'com.tldraw.pointer': 1,
    'com.tldraw.shape': 4, 'com.tldraw.user': 1, 'com.tldraw.asset.image': 6, 'com.tldraw.asset.video': 5,
    'com.tldraw.asset.bookmark': 2, 'com.tldraw.shape.arrow': 8, 'com.tldraw.shape.bookmark': 2, 'com.tldraw.shape.draw': 5,
    'com.tldraw.shape.embed': 4, 'com.tldraw.shape.frame': 1, 'com.tldraw.shape.geo': 12, 'com.tldraw.shape.group': 0,
    'com.tldraw.shape.highlight': 4, 'com.tldraw.shape.image': 5, 'com.tldraw.shape.line': 5, 'com.tldraw.shape.note': 13,
    'com.tldraw.shape.text': 4, 'com.tldraw.shape.video': 4, 'com.tldraw.binding.arrow': 1,
  },
} as const;

type Rec = Record<string, unknown> & { id: string; typeName: string };

const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
/** Valid, increasing fractional-index keys: a1..az, then b01.., then c001.. */
function indexKey(i: number): string {
  if (i < 61) return `a${DIGITS[i + 1]}`;
  i -= 61;
  if (i < 62 * 62 - 1) { i += 1; return `b${DIGITS[Math.floor(i / 62)]}${DIGITS[i % 62]}`; }
  i -= 62 * 62 - 1;
  i += 1;
  return `c${DIGITS[Math.floor(i / 3844) % 62]}${DIGITS[Math.floor(i / 62) % 62]}${DIGITS[i % 62]}`;
}

const richText = (s: string) => ({
  type: 'doc',
  content: s ? s.split('\n').map((line) => (line ? { type: 'paragraph', content: [{ type: 'text', text: line }] } : { type: 'paragraph' })) : [{ type: 'paragraph' }],
});
const safe = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, '_');
const r2 = (n: number) => Math.round(n * 100) / 100;

export function toTldraw(model: DiagramModel, name = 'draftr'): string {
  const page = 'page:page';
  const records: Rec[] = [
    { id: 'document:document', typeName: 'document', gridSize: 10, name, meta: {} },
    { id: page, typeName: 'page', name, index: 'a1', meta: {} },
  ];
  let z = 0;
  const shape = (id: string, type: string, parentId: string, x: number, y: number, props: Record<string, unknown>, meta: Record<string, unknown> = {}): Rec => ({
    id, typeName: 'shape', type, x: r2(x), y: r2(y), rotation: 0, index: indexKey(z++), parentId, isLocked: false, opacity: 1, props, meta,
  });
  const assets = new Map<string, Rec>();
  const assetFor = (n: DNode) => {
    const icon = n.icon!;
    const color = iconColor(icon, n);
    const id = `asset:${safe(`icon-${icon.source}-${icon.name}-${color ?? 'brand'}`)}`;
    if (!assets.has(id)) {
      const svg = icon.svg(color);
      assets.set(id, {
        id, typeName: 'asset', type: 'image',
        props: { name: `${icon.name}.svg`, src: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`, w: 24, h: 24, mimeType: 'image/svg+xml', isAnimated: false, fileSize: svg.length },
        meta: {},
      });
    }
    return id;
  };

  // ---- frames for groups (outer first) ----
  const frameId = (g: string) => `shape:${safe(`group-${g}`)}`;
  const groupById = Object.fromEntries(model.groups.map((g) => [g.id, g]));
  for (const g of [...model.groups].sort((a, b) => a.depth - b.depth)) {
    const parent = g.parent ? groupById[g.parent] : undefined;
    records.push(shape(frameId(g.id), 'frame', parent ? frameId(parent.id) : page, g.x - (parent?.x ?? 0), g.y - (parent?.y ?? 0),
      { w: r2(g.w), h: r2(g.h), name: g.label, color: 'black' }, { draftr: { role: 'group', id: g.id } }));
  }

  // ---- edges first (below boxes) ----
  const nodeShapeId = (n: DNode) => `shape:${safe(`node-${n.id}`)}`;
  const byId = Object.fromEntries(model.nodes.map((n) => [n.id, n]));
  const bindings: Rec[] = [];
  for (const e of model.edges) records.push(...edgeRecords(e, e.from ? byId[e.from] : undefined, e.to ? byId[e.to] : undefined, nodeShapeId, shape, page, bindings));

  // ---- boxes ----
  for (const n of model.nodes) {
    const parentFrame = n.group ? groupById[n.group] : undefined;
    const parent = parentFrame ? frameId(parentFrame.id) : page;
    const ox = n.x - (parentFrame?.x ?? 0), oy = n.y - (parentFrame?.y ?? 0);
    const geo = n.shape === 'pill' ? 'oval' : n.shape === 'diamond' ? 'diamond' : 'rectangle';
    const geoProps = {
      geo, dash: n.dashed ? 'dashed' : 'solid', url: '', w: r2(n.w), h: r2(n.h), growY: 0, scale: 1, flipX: false, flipY: false,
      labelColor: n.highlight ? 'white' : 'black', color: n.hue.tldraw, fill: n.highlight ? 'fill' : 'solid', size: 's', font: 'sans',
      align: 'middle', verticalAlign: 'middle', richText: richText(n.shape === 'diamond' ? n.title : ''),
    };
    const meta = { draftr: { role: n.role, id: n.id, kind: n.kind, ...(n.icon ? { icon: n.icon.name } : {}) } };
    if (n.shape === 'diamond') { records.push(shape(nodeShapeId(n), 'geo', parent, ox, oy, geoProps, meta)); continue; }

    // a tldraw group of box + icon + title + caption, positioned at the box's corner
    const gid = `shape:${safe(`node-${n.id}-group`)}`;
    records.push(shape(gid, 'group', parent, ox, oy, {}, { draftr: { role: 'node-group', id: n.id } }));
    records.push(shape(nodeShapeId(n), 'geo', gid, 0, 0, geoProps, meta));
    const cy = n.h / 2;
    let x = T.node.padX + (n.shape === 'pill' ? 14 : 0);
    if (n.icon) {
      records.push(shape(`shape:${safe(`node-${n.id}-icon`)}`, 'image', gid, x, cy - T.node.icon / 2,
        { w: T.node.icon, h: T.node.icon, playing: true, url: '', assetId: assetFor(n), crop: null, flipX: false, flipY: false, altText: n.icon.title }));
      x += T.node.icon + T.node.iconGap;
    }
    const titleScale = T.size.title / TL_S_FONT, capScale = T.size.caption / TL_S_FONT;
    const lines = n.title.split('\n').length;
    const titleH = lines * TL_S_FONT * 1.35 * titleScale, capH = n.caption ? TL_S_FONT * 1.35 * capScale : 0;
    const top = cy - (titleH + capH) / 2;
    const textW = (n.w - x - 8) / titleScale;
    records.push(shape(`shape:${safe(`node-${n.id}-title`)}`, 'text', gid, x, top,
      { color: n.highlight ? 'white' : 'black', size: 's', font: 'sans', textAlign: 'start', w: r2(textW), richText: richText(n.title), scale: r2(titleScale), autoSize: true },
      { draftr: { role: 'node-label', id: n.id } }));
    if (n.caption) {
      records.push(shape(`shape:${safe(`node-${n.id}-caption`)}`, 'text', gid, x, top + titleH,
        { color: n.highlight ? 'white' : n.hue.tldraw, size: 's', font: 'sans', textAlign: 'start', w: r2((n.w - x - 8) / capScale), richText: richText(n.caption), scale: r2(capScale), autoSize: true },
        { draftr: { role: 'node-caption', id: n.id } }));
    }
  }

  for (const t of model.texts) {
    records.push(shape(`shape:${safe(`text-${t.id}`)}`, 'text', page, t.x, t.y,
      { color: 'black', size: 's', font: 'sans', textAlign: 'start', w: 400, richText: richText(t.text), scale: r2(t.size / TL_S_FONT), autoSize: true },
      { draftr: { role: t.role } }));
  }

  records.push(...assets.values(), ...bindings);
  return JSON.stringify({ tldrawFileFormatVersion: 1, schema: TLDRAW_SCHEMA, records }, null, 2);
}

function polylineFraction(points: Pt[], p: Pt): number {
  const segs = points.slice(1).map((b, i) => ({ a: points[i], b, len: Math.hypot(b.x - points[i].x, b.y - points[i].y) }));
  const total = segs.reduce((s, x) => s + x.len, 0) || 1;
  let acc = 0, best = 0.5, bd = Infinity;
  for (const { a, b, len } of segs) {
    if (len) {
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / (len * len)));
      const d = Math.hypot(a.x + t * (b.x - a.x) - p.x, a.y + t * (b.y - a.y) - p.y);
      if (d < bd) { bd = d; best = (acc + t * len) / total; }
    }
    acc += len;
  }
  return Math.round(best * 1000) / 1000;
}

function edgeRecords(
  e: DEdge, src: DNode | undefined, dst: DNode | undefined, nodeShapeId: (n: DNode) => string,
  shape: (id: string, type: string, parentId: string, x: number, y: number, props: Record<string, unknown>, meta?: Record<string, unknown>) => Rec,
  page: string, bindings: Rec[],
): Rec[] {
  const pts = e.points, a = pts[0], b = pts[pts.length - 1];
  const id = `shape:${safe(`${e.role}-${e.id}`)}`;
  const color = e.highlight ? (src?.hue.tldraw ?? 'black') : e.role === 'lifeline' ? 'grey' : 'black';
  if (e.role === 'lifeline') {
    return [shape(id, 'line', page, a.x, a.y, {
      color, dash: 'dashed', size: 's', spline: 'line', scale: 1,
      points: { a1: { id: 'a1', index: 'a1', x: 0, y: 0 }, a2: { id: 'a2', index: 'a2', x: r2(b.x - a.x), y: r2(b.y - a.y) } },
    }, { draftr: { role: 'lifeline', id: e.id } })];
  }
  const selfLoop = e.role === 'message' && pts.length === 4 && Math.abs(a.x - b.x) < 1;
  const props = {
    kind: e.role === 'edge' ? 'elbow' : 'arc', labelColor: color, color, fill: 'none', dash: e.dashed ? 'dashed' : 'solid', size: 's',
    arrowheadStart: 'none', arrowheadEnd: e.arrow ? 'triangle' : 'none', font: 'sans',
    start: { x: 0, y: 0 }, end: { x: r2(b.x - a.x), y: r2(b.y - a.y) },
    // a message to oneself: an arc bulging to the right of the lifeline
    bend: selfLoop ? -r2(Math.max(36, Math.abs(pts[1].x - a.x))) : 0,
    // graph edges carry their label; message labels are separate text above the line (arrow labels wrap at 18px)
    richText: richText(e.role === 'edge' ? e.label ?? '' : ''), labelPosition: e.label && e.labelAt && e.role === 'edge' ? polylineFraction(pts, e.labelAt) : 0.5,
    // scale 1: tldraw wraps arrow labels incorrectly on scaled arrows, so labels stay at tldraw's 18px
    scale: 1, elbowMidPoint: 0.5,
  };
  const rec = shape(id, 'arrow', page, a.x, a.y, props, { draftr: { role: e.role, id: e.id } });
  const extra: Rec[] = [];
  if (e.role === 'message' && e.label && e.labelAt) {
    const scale = T.size.edgeLabel / TL_S_FONT;
    const w = measureText(e.label, T.size.edgeLabel, 'nunito').width * 1.08;
    const h = e.label.split('\n').length * T.size.edgeLabel * 1.35;
    extra.push(shape(`${id}_label`.replace(':', ':'), 'text', page, e.labelAt.x - w / 2, e.labelAt.y - h / 2,
      { color, size: 's', font: 'sans', textAlign: 'middle', w: r2(w / scale), richText: richText(e.label), scale: r2(scale), autoSize: true },
      { draftr: { role: 'message-label', id: e.id } }));
  }
  if (src && dst) {
    const anchor = (n: DNode, p: Pt) => ({ x: r2(Math.max(0, Math.min(1, (p.x - n.x) / n.w))), y: r2(Math.max(0, Math.min(1, (p.y - n.y) / n.h))) });
    for (const [terminal, n, p] of [['start', src, a], ['end', dst, b]] as const) {
      bindings.push({
        id: `binding:${safe(`${e.id}-${terminal}`)}`, typeName: 'binding', type: 'arrow', fromId: id, toId: nodeShapeId(n),
        props: { terminal, normalizedAnchor: anchor(n, p), isExact: false, isPrecise: true, snap: 'none' }, meta: {},
      });
    }
  }
  return [rec, ...extra];
}
