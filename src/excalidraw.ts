// Scene -> Excalidraw JSON, plus small element factories shared with sequence.ts.
import { measureText } from './measure.js';
import { THEME } from './theme.js';
import type { ExElement, ExcalidrawDoc, Pt, Scene } from './types.js';

let seed = 1000;
export const resetSeed = () => { seed = 1000; };
const nextSeed = () => ++seed;

export function base(type: string, id: string, x: number, y: number, w: number, h: number, extra: Partial<ExElement> = {}): ExElement {
  return {
    id, type, x, y, width: w, height: h, angle: 0,
    strokeColor: THEME.ink, backgroundColor: 'transparent', fillStyle: 'solid',
    strokeWidth: 2, strokeStyle: 'solid', roughness: 0, opacity: 100,
    groupIds: [], frameId: null, roundness: null,
    seed: nextSeed(), version: 1, versionNonce: nextSeed(), isDeleted: false,
    boundElements: [], updated: 1, link: null, locked: false,
    ...extra,
  };
}

export function text(id: string, str: string, x: number, y: number, fontSize: number, extra: Partial<ExElement> = {}): ExElement {
  const m = measureText(str, fontSize);
  return base('text', id, x, y, m.width, m.height, {
    text: str, originalText: str, fontSize, fontFamily: 3,
    textAlign: 'left', verticalAlign: 'top', containerId: null,
    lineHeight: 1.25, autoResize: true, ...extra,
  });
}

export function polyline(type: 'arrow' | 'line', id: string, pts: Array<{ x: number; y: number }>, extra: Partial<ExElement> = {}): ExElement {
  const [p0] = pts;
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  return base(type, id, p0.x, p0.y, Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), {
    points: pts.map((p) => [p.x - p0.x, p.y - p0.y] as [number, number]),
    lastCommittedPoint: null,
    startBinding: null, endBinding: null,
    startArrowhead: null, endArrowhead: type === 'arrow' ? 'arrow' : null, elbowed: false,
    ...extra,
  });
}

export function doc(elements: ExElement[]): ExcalidrawDoc {
  return {
    type: 'excalidraw', version: 2, source: 'https://github.com/scrawl-labs/draftr',
    elements,
    appState: { viewBackgroundColor: THEME.background, gridSize: null },
    files: {},
  };
}

type Outline = 'rectangle' | 'ellipse' | 'diamond';

/** Signed "outside-ness" of a point for a shape outline (>0 outside, <=0 inside). */
function outside(shape: Outline, b: { x: number; y: number; w: number; h: number }, p: Pt): number {
  const a = b.w / 2, c = b.h / 2, dx = Math.abs(p.x - (b.x + a)), dy = Math.abs(p.y - (b.y + c));
  if (shape === 'diamond') return dx / a + dy / c - 1;
  if (shape === 'ellipse') return (dx / a) ** 2 + (dy / c) ** 2 - 1;
  return Math.max(dx - a, dy - c);
}

/**
 * ELK routes to bounding boxes. For ellipses and diamonds, slide the endpoint
 * along its last segment until it touches the real outline.
 */
export function clipToOutline(from: Pt, end: Pt, shape: Outline, b: { x: number; y: number; w: number; h: number }): Pt {
  if (shape === 'rectangle') return end;
  const at = (t: number) => ({ x: from.x + (end.x - from.x) * t, y: from.y + (end.y - from.y) * t });
  if (outside(shape, b, from) <= 0) return end;
  let lo = 0, hi = 1;
  // find a t that is inside the outline (extend past the bbox if needed)
  while (outside(shape, b, at(hi)) > 0 && hi < 4) hi += 0.25;
  if (outside(shape, b, at(hi)) > 0) return end;
  for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (outside(shape, b, at(m)) > 0) lo = m; else hi = m; }
  return at(lo);
}

export function toExcalidraw(scene: Scene): ExcalidrawDoc {
  resetSeed();
  const els: ExElement[] = [];

  // Groups first (painted underneath), outermost first.
  for (const gr of [...scene.groups].sort((a, b) => a.depth - b.depth)) {
    els.push(base('rectangle', `group:${gr.id}`, gr.x, gr.y, gr.w, gr.h, {
      strokeColor: THEME.muted, backgroundColor: THEME.groupFills[gr.depth % THEME.groupFills.length],
      strokeStyle: 'dashed', strokeWidth: 1, roundness: { type: 3 },
      customData: { role: 'group', groupId: gr.id },
    }));
    els.push(text(`group:${gr.id}:label`, gr.label, gr.x + 16, gr.y + 12, scene.groupFontSize, {
      strokeColor: THEME.muted, customData: { role: 'group-label', groupId: gr.id },
    }));
  }

  const shapeId = (id: string) => `node:${id}`;
  const bound: Record<string, Array<{ type: string; id: string }>> = {};

  for (const n of scene.nodes) {
    const k = THEME.kinds[n.kind] ?? THEME.kinds.service;
    const id = shapeId(n.id);
    const tid = `${id}:text`;
    bound[id] = [{ type: 'text', id: tid }];
    els.push(base(k.shape, id, n.x, n.y, n.w, n.h, {
      strokeColor: n.highlight ? THEME.accent : k.stroke,
      backgroundColor: k.bg,
      strokeWidth: n.highlight ? 3 : 2,
      strokeStyle: k.dashed ? 'dashed' : 'solid',
      roundness: k.shape === 'rectangle' ? { type: 3 } : { type: 2 },
      boundElements: bound[id],
      customData: { role: 'node', nodeId: n.id, kind: n.kind },
    }));
    const m = measureText(n.label, scene.fontSize);
    els.push(text(tid, n.label, n.x + (n.w - m.width) / 2, n.y + (n.h - m.height) / 2, scene.fontSize, {
      textAlign: 'center', verticalAlign: 'middle', containerId: id,
    }));
  }

  const nodeById = Object.fromEntries(scene.nodes.map((n) => [n.id, n]));
  const outlineOf = (id: string): Outline => (THEME.kinds[nodeById[id]?.kind]?.shape ?? 'rectangle');
  for (const e of scene.edges) {
    if (e.points.length < 2) continue;
    const id = `edge:${e.id}`;
    const pts = e.points.map((p) => ({ ...p }));
    const last = pts.length - 1;
    const src = nodeById[e.from], dst = nodeById[e.to];
    if (src) pts[0] = clipToOutline(pts[1], pts[0], outlineOf(e.from), src);
    if (dst) pts[last] = clipToOutline(pts[last - 1], pts[last], outlineOf(e.to), dst);
    const color = e.highlight ? THEME.accent : THEME.ink;
    els.push(polyline('arrow', id, pts, {
      strokeColor: color,
      strokeWidth: e.highlight ? 3 : 2,
      strokeStyle: e.style === 'dashed' ? 'dashed' : 'solid',
      startBinding: { elementId: shapeId(e.from), focus: 0, gap: 1 } as ExElement['startBinding'],
      endBinding: { elementId: shapeId(e.to), focus: 0, gap: 1 } as ExElement['endBinding'],
      customData: { role: 'edge', from: e.from, to: e.to },
    }));
    bound[shapeId(e.from)]?.push({ type: 'arrow', id });
    if (e.to !== e.from) bound[shapeId(e.to)]?.push({ type: 'arrow', id });
    if (e.labelBox) {
      els.push(text(`${id}:label`, e.labelBox.text, e.labelBox.x + 4, e.labelBox.y + 2, scene.labelFontSize, {
        strokeColor: color, customData: { role: 'edge-label', edge: id },
      }));
    }
  }

  if (scene.title) els.push(text('title', scene.title, 40, 4, 20, { customData: { role: 'title' } }));
  return doc(els);
}
