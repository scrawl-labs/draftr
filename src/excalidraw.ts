// DiagramModel -> Excalidraw JSON (Tone theme), plus small element factories.
import type { Icon } from './icons/index.js';
import { measureText } from './measure.js';
import type { DEdge, DiagramModel, DNode } from './model.js';
import { THEME } from './theme.js';
import type { ExElement, ExFile, ExcalidrawDoc, Pt } from './types.js';
import { clipToOutline, type Outline } from './geom.js';
export { clipToOutline } from './geom.js';

const T = THEME;
/** Excalidraw's Nunito, its cleanest built-in sans. */
export const EX_FONT = 6;
const EX_LINE_HEIGHT = 1.35; // what Excalidraw uses for Nunito

let seed = 1000;
export const resetSeed = () => { seed = 1000; };
const nextSeed = () => ++seed;

export function base(type: string, id: string, x: number, y: number, w: number, h: number, extra: Partial<ExElement> = {}): ExElement {
  return {
    id, type, x, y, width: w, height: h, angle: 0,
    strokeColor: T.ink, backgroundColor: 'transparent', fillStyle: 'solid',
    strokeWidth: 1, strokeStyle: 'solid', roughness: 0, opacity: 100,
    groupIds: [], frameId: null, roundness: null,
    seed: nextSeed(), version: 1, versionNonce: nextSeed(), isDeleted: false,
    boundElements: [], updated: 1, link: null, locked: false,
    ...extra,
  };
}

/** A Nunito text element sized with real Nunito metrics. */
export function text(id: string, str: string, x: number, y: number, fontSize: number, extra: Partial<ExElement> = {}): ExElement {
  const m = measureText(str, fontSize, 'nunito');
  const lines = str.split('\n').length;
  return base('text', id, x, y, m.width, lines * fontSize * EX_LINE_HEIGHT, {
    text: str, originalText: str, fontSize, fontFamily: EX_FONT,
    textAlign: 'left', verticalAlign: 'top', containerId: null,
    lineHeight: EX_LINE_HEIGHT, autoResize: true, ...extra,
  });
}

export function polyline(type: 'arrow' | 'line', id: string, pts: Pt[], extra: Partial<ExElement> = {}): ExElement {
  const [p0] = pts;
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  return base(type, id, p0.x, p0.y, Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), {
    points: pts.map((p) => [p.x - p0.x, p.y - p0.y] as [number, number]),
    lastCommittedPoint: null, startBinding: null, endBinding: null,
    startArrowhead: null, endArrowhead: type === 'arrow' ? 'triangle' : null, elbowed: false,
    ...extra,
  });
}

export function doc(elements: ExElement[], files: Record<string, ExFile> = {}): ExcalidrawDoc {
  return {
    type: 'excalidraw', version: 2, source: 'https://github.com/scrawl-labs/draftr',
    elements, appState: { viewBackgroundColor: T.background, gridSize: null }, files,
  };
}

/** Collects icon SVGs as Excalidraw "files" so image elements can reference them. */
export class FileStore {
  files: Record<string, ExFile> = {};
  add(icon: Icon, color?: string): string {
    const id = `icon-${icon.source}-${icon.name}${color && icon.source !== 'custom' ? `-${color.replace('#', '')}` : ''}`;
    if (!this.files[id]) {
      this.files[id] = { id, mimeType: 'image/svg+xml', created: 1, dataURL: `data:image/svg+xml;base64,${Buffer.from(icon.svg(color)).toString('base64')}` };
    }
    return id;
  }
}

/** Icon color: brand icons keep their color on light boxes; everything turns white on a solid box. */
export function iconColor(icon: Icon, node: DNode): string | undefined {
  if (node.highlight) return T.white;
  return icon.source === 'brand' ? undefined : node.hue.ink;
}

export function iconImage(id: string, store: FileStore, icon: Icon, x: number, y: number, size: number, color: string | undefined, extra: Partial<ExElement> = {}): ExElement {
  const fileId = store.add(icon, color);
  return base('image', id, x, y, size, size, {
    strokeColor: 'transparent', fileId, status: 'saved', scale: [1, 1], crop: null,
    customData: { role: 'icon', icon: icon.name, source: icon.source }, ...extra,
  });
}

/**
 * Excalidraw puts an arrow's label on its middle point (odd point count) or the middle of its middle
 * segment (even count). Rebuild the polyline with extra collinear points so that "middle" is `at`.
 */
export function pointsForLabel(points: Pt[], at: Pt): Pt[] {
  let k = 0, best = Infinity;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
    if (!len) continue;
    const t = Math.max(0, Math.min(1, ((at.x - a.x) * dx + (at.y - a.y) * dy) / (len * len)));
    const d = Math.hypot(a.x + t * dx - at.x, a.y + t * dy - at.y);
    if (d < best) { best = d; k = i; }
  }
  const a = points[k - 1], b = points[k], len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const ux = (b.x - a.x) / len, uy = (b.y - a.y) / len, d = Math.min(2, len / 4);
  const pre = [...points.slice(0, k), { x: at.x - ux * d, y: at.y - uy * d }];
  const post = [{ x: at.x + ux * d, y: at.y + uy * d }, ...points.slice(k)];
  const pad = (side: Pt[], keepEnd: 'first' | 'last') => {
    // split the longest segment (never the tiny one next to the label)
    let li = -1, ll = 0;
    for (let i = 1; i < side.length; i++) {
      if ((keepEnd === 'last' && i === side.length - 1) || (keepEnd === 'first' && i === 1)) continue;
      const l = Math.hypot(side[i].x - side[i - 1].x, side[i].y - side[i - 1].y);
      if (l > ll) { ll = l; li = i; }
    }
    if (li < 0) li = keepEnd === 'last' ? 1 : side.length - 1;
    const p = side[li - 1], q = side[li];
    side.splice(li, 0, { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 });
  };
  while (pre.length < post.length) pad(pre, 'last');
  while (post.length < pre.length) pad(post, 'first');
  return [...pre, ...post];
}

// ---------- model -> excalidraw ----------
const nodeShapeType = (n: DNode) => (n.shape === 'pill' ? 'ellipse' : n.shape === 'diamond' ? 'diamond' : 'rectangle');
const nodeElementId = (n: DNode) => (n.role === 'participant' ? `participant:${n.id}` : `node:${n.id}`);

export function toExcalidraw(model: DiagramModel): ExcalidrawDoc {
  resetSeed();
  const store = new FileStore();
  const els: ExElement[] = [];
  const bound: Record<string, Array<{ type: string; id: string }>> = {};

  for (const g of [...model.groups].sort((a, b) => a.depth - b.depth)) {
    els.push(base('rectangle', `group:${g.id}`, g.x, g.y, g.w, g.h, {
      strokeColor: T.group.line, backgroundColor: T.group.fills[g.depth % T.group.fills.length],
      roundness: { type: 3 }, customData: { role: 'group', groupId: g.id },
    }));
    els.push(text(`group:${g.id}:label`, g.label, g.x + 16, g.y + 11, T.size.excalidrawGroup, {
      strokeColor: T.group.label, customData: { role: 'group-label', groupId: g.id },
    }));
  }

  // edges below nodes so boxes stay on top
  const nodeById = Object.fromEntries(model.nodes.map((n) => [n.id, n]));
  const edgeEls: ExElement[] = [];
  for (const e of model.edges) edgeEls.push(...edgeElements(e, nodeById, bound));
  els.push(...edgeEls.filter((x) => x.customData?.role === 'lifeline'));

  for (const n of model.nodes) {
    const id = nodeElementId(n);
    const type = nodeShapeType(n);
    const grp = n.shape === 'diamond' ? [] : [`g:${n.id}`];
    bound[id] ??= [];
    const fill = n.highlight ? n.hue.solid : n.hue.fill;
    els.push(base(type, id, n.x, n.y, n.w, n.h, {
      strokeColor: n.highlight ? n.hue.solid : n.hue.line, backgroundColor: fill,
      strokeWidth: n.highlight ? 2 : 1, strokeStyle: n.dashed ? 'dashed' : 'solid',
      roundness: type === 'rectangle' ? { type: 3 } : { type: 2 },
      groupIds: grp, boundElements: bound[id],
      customData: { role: n.role === 'participant' ? 'participant' : 'node', ...(n.role === 'participant' ? { participant: n.id } : { nodeId: n.id, placed: { x: n.x, y: n.y } }), kind: n.kind, ...(n.icon ? { icon: n.icon.name } : {}) },
    }));
    const ink = n.highlight ? T.white : T.ink;
    if (n.shape === 'diamond') {
      const m = measureText(n.title, T.size.excalidrawTitle, 'nunito');
      const tid = `${id}:text`;
      bound[id].push({ type: 'text', id: tid });
      els.push(text(tid, n.title, n.x + (n.w - m.width) / 2, n.y + (n.h - m.height * 1.08) / 2, T.size.excalidrawTitle, {
        strokeColor: ink, textAlign: 'center', verticalAlign: 'middle', containerId: id,
      }));
      continue;
    }
    const cy = n.y + n.h / 2;
    let x = n.x + T.node.padX + (n.shape === 'pill' ? 14 : 0);
    if (n.icon) {
      els.push(iconImage(`${id}:icon`, store, n.icon, x, cy - T.node.icon / 2, T.node.icon, iconColor(n.icon, n), { groupIds: grp }));
      x += T.node.icon + T.node.iconGap;
    }
    const titleH = n.title.split('\n').length * T.size.excalidrawTitle * EX_LINE_HEIGHT;
    const capH = n.caption ? T.size.excalidrawCaption * EX_LINE_HEIGHT : 0;
    const top = cy - (titleH + capH) / 2;
    els.push(text(`${id}:text`, n.title, x, top, T.size.excalidrawTitle, { strokeColor: ink, groupIds: grp, customData: { role: 'node-label', nodeId: n.id } }));
    if (n.caption) {
      els.push(text(`${id}:caption`, n.caption, x, top + titleH, T.size.excalidrawCaption, {
        strokeColor: n.highlight ? T.white : T.muted, opacity: n.highlight ? 85 : 100, groupIds: grp, customData: { role: 'node-caption', nodeId: n.id },
      }));
    }
  }
  els.push(...edgeEls.filter((x) => x.customData?.role !== 'lifeline'));

  for (const t of model.texts) {
    els.push(text(t.id, t.text, t.x, t.y, T.size.docTitle, { strokeColor: t.color, customData: { role: t.role } }));
  }
  return doc(els, store.files);
}

function edgeElements(e: DEdge, nodes: Record<string, DNode>, bound: Record<string, Array<{ type: string; id: string }>>): ExElement[] {
  const out: ExElement[] = [];
  if (e.role === 'lifeline') {
    out.push(polyline('line', e.id, e.points, { strokeColor: e.color, strokeWidth: 1, strokeStyle: 'dashed', customData: { role: 'lifeline', participant: e.id.replace(/^lifeline:/, '') } }));
    return out;
  }
  let pts = e.points.map((p) => ({ ...p }));
  const src = e.from ? nodes[e.from] : undefined, dst = e.to ? nodes[e.to] : undefined;
  const outline = (n: DNode): Outline => (n.shape === 'pill' ? 'ellipse' : n.shape === 'diamond' ? 'diamond' : 'rectangle');
  if (src) pts[0] = clipToOutline(pts[1], pts[0], outline(src), src);
  if (dst) pts[pts.length - 1] = clipToOutline(pts[pts.length - 2], pts[pts.length - 1], outline(dst), dst);
  const id = e.role === 'edge' ? `edge:${e.id}` : e.id;
  const labelId = `${id}:label`;
  const nativeLabel = e.role === 'edge' && e.label && e.labelAt;
  if (nativeLabel) pts = pointsForLabel(pts, e.labelAt!);
  out.push(polyline('arrow', id, pts, {
    strokeColor: e.color, strokeWidth: e.highlight ? 2 : 1, strokeStyle: e.dashed ? 'dashed' : 'solid',
    endArrowhead: e.arrow ? 'triangle' : null,
    ...(src && dst ? {
      startBinding: { elementId: `node:${src.id}`, focus: 0, gap: 1 } as ExElement['startBinding'],
      endBinding: { elementId: `node:${dst.id}`, focus: 0, gap: 1 } as ExElement['endBinding'],
    } : {}),
    boundElements: nativeLabel ? [{ type: 'text', id: labelId }] : [],
    customData: e.role === 'edge' ? { role: 'edge', from: e.from, to: e.to } : { role: 'message', index: Number(e.id.split(':')[1]) },
  }));
  if (src && dst) {
    (bound[`node:${src.id}`] ??= []).push({ type: 'arrow', id });
    if (dst !== src) (bound[`node:${dst.id}`] ??= []).push({ type: 'arrow', id });
  }
  if (e.label && e.labelAt) {
    const m = measureText(e.label, T.size.excalidrawEdgeLabel, 'nunito');
    const h = m.lines.length * T.size.excalidrawEdgeLabel * EX_LINE_HEIGHT;
    const x = e.labelAt.x - m.width / 2, y = e.labelAt.y - h / 2;
    if (nativeLabel) {
      out.push(text(labelId, e.label, x, y, T.size.excalidrawEdgeLabel, { strokeColor: e.labelColor ?? e.color, containerId: id, textAlign: 'center', verticalAlign: 'middle' }));
    } else {
      if (e.labelBacking) out.push(base('rectangle', `${labelId}-bg`, x - 4, y - 1, m.width + 8, h + 2, { strokeColor: 'transparent', backgroundColor: T.background, customData: { role: 'label-bg', edge: id } }));
      out.push(text(labelId, e.label, x, y, T.size.excalidrawEdgeLabel, { strokeColor: e.labelColor ?? e.color, customData: { role: 'message-label', edge: id } }));
    }
  }
  return out;
}
