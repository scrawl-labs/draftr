// The tool-neutral diagram model. Layout produces it; every exporter (Excalidraw, SVG, draw.io,
// tldraw) only translates it. Anything visual that all formats share is decided here.
import type { Icon } from './icons/index.js';
import { IconLibrary } from './icons/index.js';
import { layoutGraph } from './layout.js';
import { measureText, wrapText } from './measure.js';
import type { Graph, Kind } from './schema.js';
import { kindStyle, THEME, type Hue, type Shape } from './theme.js';
import type { Pt } from './types.js';
import { clipToOutline } from './geom.js';
import { segIntersectsRect } from './lint.js';

export interface DNode {
  id: string;
  kind: Kind;
  shape: Shape;
  x: number; y: number; w: number; h: number;
  title: string;
  /** Small second line, e.g. "Database". Omitted for diamonds. */
  caption?: string;
  icon?: Icon;
  hue: Hue;
  highlight: boolean;
  dashed: boolean;
  group?: string;
  /** Where this node came from: a graph node or a sequence participant. */
  role: 'node' | 'participant';
}

export interface DGroup { id: string; label: string; parent?: string; depth: number; x: number; y: number; w: number; h: number }

export interface DEdge {
  id: string;
  role: 'edge' | 'message' | 'lifeline';
  /** Bound endpoints (graph edges). Messages and lifelines are free-floating. */
  from?: string;
  to?: string;
  points: Pt[];
  color: string;
  width: number;
  dashed: boolean;
  arrow: boolean;
  highlight: boolean;
  label?: string;
  /** Center of the label. Graph edges: on the line. Messages: just above it. */
  labelAt?: Pt;
  labelColor?: string;
  /** Message labels that cross another participant's lifeline get an opaque backing. */
  labelBacking?: boolean;
}

export interface DText { id: string; text: string; x: number; y: number; size: number; weight: 500 | 600; color: string; role: 'title' }

export interface DiagramModel {
  type: 'graph' | 'sequence';
  title?: string;
  /** Bounding box of everything, before padding. */
  width: number; height: number;
  nodes: DNode[];
  groups: DGroup[];
  edges: DEdge[];
  texts: DText[];
}

export interface ModelOptions { icons?: IconLibrary | false }

const T = THEME;
const MAX_TITLE_W = 220;

/** Width a node's text block needs, in both the SVG font (Pretendard) and Excalidraw's (Nunito). */
export function textBlockWidth(title: string, caption: string | undefined): number {
  const svg = Math.max(measureText(title, T.size.title, 'pretendard500').width, caption ? measureText(caption, T.size.caption, 'pretendard500').width : 0);
  const ex = Math.max(measureText(title, T.size.excalidrawTitle, 'nunito').width, caption ? measureText(caption, T.size.excalidrawCaption, 'nunito').width : 0);
  return Math.ceil(Math.max(svg, ex));
}

/** Size of a node box for the Tone theme. */
export function nodeBox(label: string, kind: Kind, icon?: Icon, captionOverride?: string | false): { title: string; caption?: string; w: number; h: number } {
  const st = kindStyle(kind);
  if (st.shape === 'diamond') {
    const title = wrapText(label, 160, T.size.excalidrawTitle, 'nunito');
    const m = Math.max(measureText(title, T.size.excalidrawTitle, 'nunito').width, measureText(title, T.size.title, 'pretendard500').width);
    const lines = title.split('\n').length;
    return { title, w: Math.max(150, Math.ceil(2 * (m + 16) + 6)), h: Math.max(92, Math.ceil(2 * (lines * T.size.excalidrawTitle * 1.25 + 8) + 6)) };
  }
  const title = wrapText(label, MAX_TITLE_W, T.size.excalidrawTitle, 'nunito');
  const caption = captionOverride === false ? undefined : captionOverride ?? st.caption;
  const lines = title.split('\n').length;
  const iconW = icon ? T.node.icon + T.node.iconGap : 0;
  let w = T.node.padX + iconW + textBlockWidth(title, caption) + T.node.padRight;
  let h = Math.max(caption ? T.node.height : 46, Math.ceil(lines * T.size.excalidrawTitle * 1.35 + (caption ? T.size.excalidrawCaption * 1.35 : 0) + 22));
  if (st.shape === 'pill') { w += 28; h = Math.max(h, 56); } // ends are round: keep text off the curve
  return { title, caption, w: Math.max(T.node.minWidth, Math.ceil(w)), h };
}

export function toDNode(n: { id: string; label: string; kind: Kind; highlight?: boolean; group?: string; caption?: string | false }, box: { x: number; y: number; w: number; h: number }, icon: Icon | undefined, role: DNode['role']): DNode {
  const st = kindStyle(n.kind);
  const sized = nodeBox(n.label, n.kind, icon, n.caption);
  return {
    id: n.id, kind: n.kind, shape: st.shape, ...box,
    title: sized.title, caption: sized.caption, icon: st.shape === 'diamond' ? undefined : icon,
    hue: st.hue, highlight: !!n.highlight, dashed: !!st.dashed, group: n.group, role,
  };
}

/** Point on a polyline closest to q, kept away from the corners. */
export function pointOnPolyline(pts: Pt[], q: Pt): Pt {
  let best = pts[0], bd = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], dx = b.x - a.x, dy = b.y - a.y, len = dx * dx + dy * dy;
    if (!len) continue;
    const t = Math.max(0.2, Math.min(0.8, ((q.x - a.x) * dx + (q.y - a.y) * dy) / len));
    const p = { x: a.x + t * dx, y: a.y + t * dy };
    const d = Math.hypot(p.x - q.x, p.y - q.y);
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}

/** Label box (the larger of the SVG and Excalidraw renderings) centered at p. */
function labelRect(label: string, p: Pt) {
  const w = Math.max(measureText(label, T.size.edgeLabel, 'pretendard500').width, measureText(label, T.size.excalidrawEdgeLabel, 'nunito').width) + 8;
  const h = label.split('\n').length * T.size.excalidrawEdgeLabel * 1.35 + 2;
  return { x: p.x - w / 2, y: p.y - h / 2, w, h };
}
const overlaps = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * Edges that leave the same node share their first segment, so their preferred label spots can
 * coincide. Keep the preferred spot when it is free; otherwise try other spots along the edge.
 */
export function placeLabels(edges: DEdge[], nodes: Array<{ x: number; y: number; w: number; h: number }>) {
  const taken: Array<{ x: number; y: number; w: number; h: number }> = [];
  const free = (r: { x: number; y: number; w: number; h: number }) => !taken.some((t) => overlaps(t, r)) && !nodes.some((n) => overlaps(n, r));
  for (const e of edges) {
    if (!e.label || !e.labelAt) continue;
    const candidates: Pt[] = [e.labelAt];
    for (let i = 1; i < e.points.length; i++) {
      const a = e.points[i - 1], b = e.points[i];
      if (Math.hypot(b.x - a.x, b.y - a.y) < 30) continue;
      for (const t of [0.5, 0.3, 0.7, 0.2, 0.8]) candidates.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
    const pick = candidates.find((c) => free(labelRect(e.label!, c))) ?? e.labelAt;
    e.labelAt = pick;
    taken.push(labelRect(e.label, pick));
  }
}

type Side = 'right' | 'left' | 'bottom' | 'top';

function sideOf(n: DNode, p: Pt): Side | undefined {
  if (Math.abs(p.x - (n.x + n.w)) < 1) return 'right';
  if (Math.abs(p.x - n.x) < 1) return 'left';
  if (Math.abs(p.y - (n.y + n.h)) < 1) return 'bottom';
  if (Math.abs(p.y - n.y) < 1) return 'top';
  return undefined;
}

const tipOf = (n: DNode, side: Side): Pt => ({
  right: { x: n.x + n.w, y: n.y + n.h / 2 }, left: { x: n.x, y: n.y + n.h / 2 },
  bottom: { x: n.x + n.w / 2, y: n.y + n.h }, top: { x: n.x + n.w / 2, y: n.y },
}[side]);

function tidyPath(pts: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - p.x) < 0.01 && Math.abs(last.y - p.y) < 0.01) continue;
    if (out.length >= 2) {
      const a = out[out.length - 2];
      if ((Math.abs(a.x - last.x) < 0.01 && Math.abs(last.x - p.x) < 0.01) || (Math.abs(a.y - last.y) < 0.01 && Math.abs(last.y - p.y) < 0.01)) { out[out.length - 1] = p; continue; }
    }
    out.push(p);
  }
  return out;
}

/**
 * ELK spreads the edges of a node along its bounding box side. On a diamond that leaves them starting
 * part-way down a slanted side, or in mid-air. Like a hand-drawn flowchart, they should leave the tip
 * as one trunk and split outside: tip -> split point -> each branch.
 */
export function diamondTrunks(edges: DEdge[], byId: Record<string, DNode>) {
  const nodes = Object.values(byId);
  const clear = (e: DEdge, pts: Pt[]) => pts.slice(1).every((q, i) => nodes.every((n) => n.id === e.from || n.id === e.to || !segIntersectsRect(pts[i], q, n)));
  for (const end of ['from', 'to'] as const) {
    const sides = new Map<string, Array<{ e: DEdge; pts: Pt[]; side: Side; node: DNode }>>();
    for (const e of edges) {
      const n = byId[e[end]!];
      if (n?.shape !== 'diamond' || e.points.length < 2) continue;
      const pts = end === 'from' ? e.points : [...e.points].reverse();
      const side = sideOf(n, pts[0]);
      if (!side) continue;
      // the first segment must leave the side straight out
      const horiz = side === 'right' || side === 'left';
      if (horiz ? Math.abs(pts[1].y - pts[0].y) > 0.5 : Math.abs(pts[1].x - pts[0].x) > 0.5) continue;
      const k = `${n.id}:${side}`;
      sides.set(k, [...(sides.get(k) ?? []), { e, pts, side, node: n }]);
    }
    for (const list of sides.values()) {
      const { side, node } = list[0];
      const tip = tipOf(node, side);
      const horiz = side === 'right' || side === 'left';
      const out = side === 'right' || side === 'bottom' ? 1 : -1;
      // split where the first branch bends, but at least a little way out from the tip
      const firsts = list.map((x) => (horiz ? x.pts[1].x : x.pts[1].y));
      let split = out > 0 ? Math.min(...firsts) : Math.max(...firsts);
      const min = (horiz ? tip.x : tip.y) + out * 16;
      if (out * (split - min) < 0) split = min;
      for (const { e, pts } of list) {
        const p0 = pts[0];
        const aligned = horiz ? Math.abs(p0.y - tip.y) < 0.5 : Math.abs(p0.x - tip.x) < 0.5;
        // a branch that turns right after leaving: make the turn on the trunk line, so there is no jog
        const turns = pts.length >= 3 && (horiz ? Math.abs(pts[1].x - pts[2].x) < 0.5 : Math.abs(pts[1].y - pts[2].y) < 0.5);
        const rest = turns ? pts.slice(2) : pts.slice(1);
        const along = turns ? pts[2] : p0;
        const path = aligned && !turns ? [tip, ...pts.slice(1)]
          : horiz ? [tip, { x: split, y: tip.y }, { x: split, y: along.y }, ...rest]
            : [tip, { x: tip.x, y: split }, { x: along.x, y: split }, ...rest];
        const fixed = tidyPath(path);
        if (!clear(e, fixed)) continue; // the trunk would cut through another box: keep ELK's route
        e.points = end === 'from' ? fixed : fixed.reverse();
        if (e.labelAt) e.labelAt = pointOnPolyline(e.points, e.labelAt);
      }
    }
  }
}

export async function graphModel(input: unknown, opts: ModelOptions = {}): Promise<DiagramModel> {
  const lib = opts.icons === false ? false : opts.icons ?? new IconLibrary();
  const scene = await layoutGraph(input, {
    icons: lib,
    nodeSize: (n, icon) => { const b = nodeBox(n.label, n.kind, icon, n.caption); return { label: n.label, w: b.w, h: b.h }; },
  });
  const nodes = scene.nodes.map((n) => toDNode(n, { x: n.x, y: n.y, w: n.w, h: n.h }, n.icon, 'node'));
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const edges: DEdge[] = scene.edges.filter((e) => e.points.length >= 2).map((e) => {
    const hue = byId[e.from]?.hue;
    const color = e.highlight && hue ? hue.solid : T.edge;
    const at = e.labelBox ? pointOnPolyline(e.points, { x: e.labelBox.x + e.labelBox.w / 2, y: e.labelBox.y + e.labelBox.h / 2 }) : undefined;
    return {
      id: e.id, role: 'edge', from: e.from, to: e.to, points: e.points.map((p) => ({ ...p })), color,
      width: e.highlight ? T.stroke.highlightWidth : T.stroke.width, dashed: e.style === 'dashed', arrow: true, highlight: !!e.highlight,
      label: e.label, labelAt: at, labelColor: e.highlight && hue ? hue.solid : T.edge,
    };
  });
  // diamonds: edges on one side share a trunk from the tip; any other endpoint moves onto the outline
  diamondTrunks(edges, byId);
  for (const e of edges) {
    const s = byId[e.from!], d = byId[e.to!], p = e.points;
    if (s?.shape === 'diamond') p[0] = clipToOutline(p[1], p[0], 'diamond', s);
    if (d?.shape === 'diamond') p[p.length - 1] = clipToOutline(p[p.length - 2], p[p.length - 1], 'diamond', d);
  }
  placeLabels(edges, nodes);
  const texts: DText[] = [];
  let { width, height } = scene;
  if (scene.title) {
    // Put the title above everything and shift the drawing down to make room.
    const dy = 44;
    for (const n of nodes) n.y += dy;
    for (const g of scene.groups) g.y += dy;
    for (const e of edges) { e.points = e.points.map((p) => ({ x: p.x, y: p.y + dy })); if (e.labelAt) e.labelAt = { x: e.labelAt.x, y: e.labelAt.y + dy }; }
    texts.push({ id: 'title', text: scene.title, x: 40, y: 20, size: T.size.docTitle, weight: 500, color: T.ink, role: 'title' });
    height += dy;
  }
  return {
    type: 'graph', title: scene.title, width, height,
    nodes, groups: scene.groups.map((g) => ({ id: g.id, label: g.label, parent: g.parent, depth: g.depth, x: g.x, y: g.y, w: g.w, h: g.h })),
    edges, texts,
  };
}

export type { Graph };
