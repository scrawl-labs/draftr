// Incremental layout: rebuild a diagram but keep the boxes a person placed by hand.
//
// draftr writes where it put each node into the Excalidraw file (customData.placed). On the next
// build, a node whose box sits somewhere else was moved by a person: it is pinned there. Everything
// else is laid out as usual, then nudged so nothing overlaps the pinned boxes, groups are refit
// around their members, and edges whose ends moved are re-routed with an orthogonal router.
import { clipToOutline } from './geom.js';
import { absPoints, segIntersectsRect } from './lint.js';
import { measureText } from './measure.js';
import { placeLabels, pointOnPolyline, type DEdge, type DGroup, type DiagramModel, type DNode } from './model.js';
import type { Box, ExcalidrawDoc, Pt } from './types.js';

/** moved: keep only boxes a person moved after draftr placed them. all: keep every box that already exists. */
export type KeepMode = 'moved' | 'all';
export interface Pin { x: number; y: number }

const GAP = 40; // free space kept around a pinned box
const MARGIN = 16; // edges keep this far from boxes
const BEND = 60; // router cost of one bend, in px of length
const PAD = 40; // canvas padding, as in the full layout
const TITLE_DY = 44;
const GROUP_PAD = { top: Math.ceil(14 * 1.35 + 28), side: 24, bottom: 24 };

/** Where nodes sit in a previous draftr Excalidraw file, keyed by node id. */
export function pinsFromExcalidraw(doc: ExcalidrawDoc, mode: KeepMode = 'moved'): Record<string, Pin> {
  const shapes = (doc.elements ?? []).filter((e) => !e.isDeleted && e.customData?.role === 'node' && typeof e.customData.nodeId === 'string');
  // files written before draftr recorded positions: every box counts as placed by hand
  const tracked = shapes.some((e) => e.customData?.placed);
  const pins: Record<string, Pin> = {};
  for (const e of shapes) {
    const placed = e.customData!.placed as Pin | undefined;
    const moved = !placed || Math.abs(placed.x - e.x) > 0.5 || Math.abs(placed.y - e.y) > 0.5;
    if (mode === 'all' || !tracked || moved) pins[String(e.customData!.nodeId)] = { x: e.x, y: e.y };
  }
  return pins;
}

/** Everything draftr reuses from a previous file: pins, where each box was, and the arrows between them. */
export interface Previous {
  pins: Record<string, Pin>;
  boxes: Record<string, Pin>;
  routes: Array<{ from: string; to: string; points: Pt[]; labelAt?: Pt }>;
}

export function previousFromExcalidraw(doc: ExcalidrawDoc, mode: KeepMode = 'moved'): Previous {
  const els = (doc.elements ?? []).filter((e) => !e.isDeleted);
  const boxes: Record<string, Pin> = {};
  for (const e of els) if (e.customData?.role === 'node' && typeof e.customData.nodeId === 'string') boxes[e.customData.nodeId] = { x: e.x, y: e.y };
  const routes = els.filter((e) => e.type === 'arrow' && e.customData?.role === 'edge' && e.points?.length).map((a) => {
    const t = els.find((x) => x.type === 'text' && x.containerId === a.id);
    return {
      from: String(a.customData!.from), to: String(a.customData!.to), points: simplify(absPoints(a)),
      labelAt: t ? { x: t.x + t.width / 2, y: t.y + t.height / 2 } : undefined,
    };
  });
  return { pins: pinsFromExcalidraw(doc, mode), boxes, routes };
}

const overlaps = (a: Box, b: Box, gap = 0) => a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;
const grow = (b: Box, d: number): Box => ({ x: b.x - d, y: b.y - d, w: b.w + 2 * d, h: b.h + 2 * d });
const same = (a: Pt, b: Pt) => Math.abs(a.x - b.x) < 0.01 && Math.abs(a.y - b.y) < 0.01;

/** Move pinned nodes to their pins and lay out the rest around them. Returns a new model. */
export function applyPins(input: DiagramModel, pins: Record<string, Pin>, mode: KeepMode = 'moved', previous?: Previous): DiagramModel {
  if (input.type !== 'graph') return input;
  // copy the geometry we change; icons and hues are shared
  const model: DiagramModel = {
    ...input,
    nodes: input.nodes.map((n) => ({ ...n })),
    groups: input.groups.map((g) => ({ ...g })),
    edges: input.edges.map((e) => ({ ...e, points: e.points.map((p) => ({ ...p })), labelAt: e.labelAt && { ...e.labelAt } })),
    texts: input.texts.map((t) => ({ ...t })),
  };
  const byId = Object.fromEntries(model.nodes.map((n) => [n.id, n]));
  const pinned = new Set(Object.keys(pins).filter((id) => byId[id]));
  if (!pinned.size) return model;
  const elk = Object.fromEntries(model.nodes.map((n) => [n.id, { x: n.x, y: n.y }]));

  // 1) offsets: pinned nodes go to their pin; in "all" mode new nodes follow their pinned neighbours
  const off: Record<string, Pt> = {};
  for (const id of pinned) off[id] = { x: pins[id].x - elk[id].x, y: pins[id].y - elk[id].y };
  const nbrs: Record<string, string[]> = Object.fromEntries(model.nodes.map((n) => [n.id, []]));
  for (const e of model.edges) if (e.from && e.to && nbrs[e.from] && nbrs[e.to]) { nbrs[e.from].push(e.to); nbrs[e.to].push(e.from); }
  const order: string[] = [];
  if (mode === 'all') {
    let left = model.nodes.filter((n) => !pinned.has(n.id)).map((n) => n.id);
    while (left.length) {
      const ready = left.filter((id) => nbrs[id].some((m) => off[m]));
      const batch = ready.length ? ready : [nearestTo(left, Object.keys(off), elk)];
      for (const id of batch) {
        const from = nbrs[id].filter((m) => off[m]);
        const src = from.length ? from : [nearestTo(Object.keys(off), [id], elk)];
        off[id] = { x: avg(src.map((m) => off[m].x)), y: avg(src.map((m) => off[m].y)) };
        order.push(id);
      }
      left = left.filter((id) => !off[id]);
    }
  } else {
    // a box dragged out of its group takes the rest of the group along; moves inside the group don't
    const origGroup = Object.fromEntries(input.groups.map((g) => [g.id, g]));
    const left = (id: string) => { const g = origGroup[byId[id].group!]; return g && !overlaps({ ...byId[id], ...pins[id] }, g); };
    for (const n of model.nodes) {
      if (pinned.has(n.id)) continue;
      const leaders = n.group ? [...pinned].filter((id) => byId[id].group === n.group && left(id)) : [];
      off[n.id] = leaders.length ? { x: avg(leaders.map((id) => off[id].x)), y: avg(leaders.map((id) => off[id].y)) } : { x: 0, y: 0 };
      order.push(n.id);
    }
  }
  for (const n of model.nodes) { n.x = elk[n.id].x + off[n.id].x; n.y = elk[n.id].y + off[n.id].y; }

  // 2) free nodes must not touch pinned boxes, each other, or groups they are not in
  const ancestors = groupAncestors(model.groups);
  const inGroup = (n: DNode, g: string) => !!n.group && (n.group === g || ancestors[n.group].includes(g));
  const place = (extra: Array<{ box: Box; group?: string }>) => {
    const placed: Box[] = model.nodes.filter((n) => pinned.has(n.id));
    for (const id of order) {
      const n = byId[id];
      const blocked = (b: Box) => placed.some((p) => overlaps(b, p, GAP)) || extra.some((x) => !(x.group && inGroup(n, x.group)) && overlaps(b, x.box, GAP / 2));
      const spot = nearestFree(n, blocked);
      n.x = spot.x; n.y = spot.y;
      placed.push(n);
    }
  };
  place([]);
  for (let i = 0; i < 4; i++) {
    fitGroups(model, input, elk);
    const strays = model.nodes.some((n) => model.groups.some((g) => !inGroup(n, g.id) && overlaps(n, g)));
    const groupClash = model.groups.some((a) => model.groups.some((b) => a !== b && !ancestors[a.id].includes(b.id) && !ancestors[b.id].includes(a.id) && overlaps(a, b)));
    if (!strays && !groupClash) break;
    // keep free nodes out of groups they don't belong to
    place(model.groups.map((g) => ({ box: { x: g.x, y: g.y, w: g.w, h: g.h }, group: g.id })));
  }
  fitGroups(model, input, elk);

  // 3) edges: keep the original route when both ends moved together, otherwise re-route
  const moved = (id?: string) => (id && byId[id] ? { x: byId[id].x - elk[id].x, y: byId[id].y - elk[id].y } : { x: 0, y: 0 });
  const boxes = model.nodes as Box[];
  const reroute: DEdge[] = [];
  // boxes that sit exactly where they were in the previous file keep the arrows between them
  const oldRoutes = [...(previous?.routes ?? [])];
  const atOld = (id?: string) => !!id && !!previous?.boxes[id] && same(byId[id], previous.boxes[id]);
  const clearOf = (e: DEdge, pts: Pt[]) => pts.slice(1).every((q, i) => model.nodes.every((n) => n.id === e.from || n.id === e.to || !segIntersectsRect(pts[i], q, n)));
  for (const e of model.edges) {
    if (atOld(e.from) && atOld(e.to)) {
      const k = oldRoutes.findIndex((r) => r.from === e.from && r.to === e.to);
      if (k >= 0 && clearOf(e, oldRoutes[k].points)) {
        const r = oldRoutes.splice(k, 1)[0];
        e.points = r.points.map((p) => ({ ...p }));
        if (e.label) e.labelAt = r.labelAt && r.points.length ? pointOnPolyline(r.points, r.labelAt) : midOfLongest(r.points);
        continue;
      }
    }
    const a = moved(e.from), b = moved(e.to);
    if (same(a, b)) {
      const pts = e.points.map((p) => ({ x: p.x + a.x, y: p.y + a.y }));
      const clear = pts.slice(1).every((q, i) => boxes.every((n) => (n as DNode).id === e.from || (n as DNode).id === e.to || !segIntersectsRect(pts[i], q, n)));
      if (clear) { e.points = pts; if (e.labelAt) e.labelAt = { x: e.labelAt.x + a.x, y: e.labelAt.y + a.y }; continue; }
    }
    reroute.push(e);
  }
  routeEdges(reroute, model.nodes, model.groups, model.edges.filter((e) => !reroute.includes(e)));
  if (reroute.length) placeLabels(model.edges, model.nodes);

  // 4) canvas: keep everything on the page, title on top
  normalize(model);
  return model;
}

const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

function nearestTo(cands: string[], refs: string[], at: Record<string, Pt>): string {
  let best = cands[0], bd = Infinity;
  for (const c of cands) for (const r of refs) {
    const d = Math.hypot(at[c].x - at[r].x, at[c].y - at[r].y);
    if (d < bd) { bd = d; best = c; }
  }
  return best;
}

/** Closest position to the node's current one where `blocked` is false, searched ring by ring. */
function nearestFree(n: Box, blocked: (b: Box) => boolean): Pt {
  const at = (dx: number, dy: number) => ({ x: n.x + dx, y: n.y + dy, w: n.w, h: n.h });
  if (!blocked(n)) return { x: n.x, y: n.y };
  const STEP = 20;
  for (let k = 1; k < 200; k++) {
    const ring: Pt[] = [];
    for (let i = -k; i <= k; i++) ring.push({ x: i, y: -k }, { x: i, y: k });
    for (let j = -k + 1; j < k; j++) ring.push({ x: -k, y: j }, { x: k, y: j });
    ring.sort((p, q) => Math.hypot(p.x, p.y) - Math.hypot(q.x, q.y));
    for (const p of ring) if (!blocked(at(p.x * STEP, p.y * STEP))) return { x: n.x + p.x * STEP, y: n.y + p.y * STEP };
  }
  return { x: n.x, y: n.y };
}

function groupAncestors(groups: DGroup[]): Record<string, string[]> {
  const parent = Object.fromEntries(groups.map((g) => [g.id, g.parent]));
  return Object.fromEntries(groups.map((g) => {
    const up: string[] = [];
    for (let p = g.parent; p; p = parent[p]) up.push(p);
    return [g.id, up];
  }));
}

/** Bounding box a group needs around the members that pass `keep` (and its child groups). */
function groupAround(g: DGroup, model: DiagramModel, keep: (n: DNode) => boolean = () => true): Box | undefined {
  const members: Box[] = [
    ...model.nodes.filter((n) => n.group === g.id && keep(n)),
    ...model.groups.filter((c) => c.parent === g.id),
  ];
  if (!members.length) return undefined;
  const x0 = Math.min(...members.map((m) => m.x)) - GROUP_PAD.side, y0 = Math.min(...members.map((m) => m.y)) - GROUP_PAD.top;
  const x1 = Math.max(...members.map((m) => m.x + m.w)) + GROUP_PAD.side, y1 = Math.max(...members.map((m) => m.y + m.h)) + GROUP_PAD.bottom;
  const minW = Math.ceil(measureText(g.label, 14, 'nunito').width + 48);
  return { x: x0, y: y0, w: Math.max(minW, x1 - x0), h: y1 - y0 };
}

/** Refit groups (deepest first). A group whose members all stayed put keeps its original box. */
function fitGroups(model: DiagramModel, original: DiagramModel, elk: Record<string, Pt>) {
  const orig = Object.fromEntries(original.groups.map((g) => [g.id, g]));
  const ancestors = groupAncestors(model.groups);
  const still = (g: DGroup) => model.nodes.filter((n) => n.group && (n.group === g.id || ancestors[n.group].includes(g.id)))
    .every((n) => same(n, elk[n.id]));
  for (const g of [...model.groups].sort((a, b) => b.depth - a.depth)) {
    const box = still(g) ? orig[g.id] : groupAround(g, model);
    if (box) Object.assign(g, { x: box.x, y: box.y, w: box.w, h: box.h });
  }
}

function normalize(model: DiagramModel) {
  const xs: number[] = [], ys: number[] = [], xe: number[] = [], ye: number[] = [];
  for (const b of [...model.nodes, ...model.groups]) { xs.push(b.x); ys.push(b.y); xe.push(b.x + b.w); ye.push(b.y + b.h); }
  for (const e of model.edges) for (const p of e.points) { xs.push(p.x); ys.push(p.y); xe.push(p.x); ye.push(p.y); }
  const top = PAD + (model.title ? TITLE_DY : 0);
  const dx = Math.max(0, PAD - Math.min(...xs)), dy = Math.max(0, top - Math.min(...ys));
  if (dx || dy) {
    for (const b of [...model.nodes, ...model.groups]) { b.x += dx; b.y += dy; }
    for (const e of model.edges) { e.points = e.points.map((p) => ({ x: p.x + dx, y: p.y + dy })); if (e.labelAt) e.labelAt = { x: e.labelAt.x + dx, y: e.labelAt.y + dy }; }
  }
  const minX = Math.min(...xs) + dx, minY = Math.min(...ys) + dy;
  for (const t of model.texts) if (t.role === 'title') { t.x = minX; t.y = minY - TITLE_DY - 20; }
  model.width = Math.max(...xe) + dx + PAD;
  model.height = Math.max(...ye) + dy + PAD;
}

// ---------- orthogonal edge router ----------

type Dir = 0 | 1 | 2 | 3; // right, down, left, up
const DX = [1, 0, -1, 0], DY = [0, 1, 0, -1];
interface Port { side: Dir; p: Pt; stub: Pt }

function ports(b: Box, side: Dir, t = 0.5, margin = MARGIN): Port {
  const p = side === 0 ? { x: b.x + b.w, y: b.y + b.h * t } : side === 2 ? { x: b.x, y: b.y + b.h * t }
    : side === 1 ? { x: b.x + b.w * t, y: b.y + b.h } : { x: b.x + b.w * t, y: b.y };
  return { side, p, stub: { x: p.x + DX[side] * margin, y: p.y + DY[side] * margin } };
}

/** Route edges between fixed boxes: A* on a sparse grid, then spread edges that share a side. */
export function routeEdges(edges: DEdge[], nodes: DNode[], groups: DGroup[] = [], fixed: DEdge[] = []) {
  if (!edges.length) return;
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const ancestors = groupAncestors(groups);
  // group titles are obstacles too; groups that contain neither end are expensive to cross
  const labels: Box[] = groups.map((g) => ({ x: g.x + 8, y: g.y + 4, w: Math.ceil(measureText(g.label, 14, 'nunito').width) + 16, h: 26 }));
  const env = (e: DEdge): Env => {
    const mine = new Set<string>();
    for (const id of [e.from!, e.to!]) { const g = byId[id]?.group; if (g) { mine.add(g); for (const a of ancestors[g]) mine.add(a); } }
    return { labels, foreign: groups.filter((g) => !mine.has(g.id)), segs };
  };
  // segments already drawn: crossing one costs as much as a bend
  const segs: Array<[Pt, Pt]> = [];
  const seed = () => { segs.length = 0; for (const f of fixed) for (let k = 1; k < f.points.length; k++) segs.push([f.points[k - 1], f.points[k]]); };
  const keep = (pts: Pt[]) => { for (let k = 1; k < pts.length; k++) segs.push([pts[k - 1], pts[k]]); };
  seed();
  const used = new Map<string, number>();
  const sides: Array<{ s: Dir; t: Dir } | undefined> = [];
  // pass 1: free choice of sides
  edges.forEach((e, i) => {
    const s = byId[e.from!], t = byId[e.to!];
    const r = route(s, t, nodes, env(e), used, [0, 1, 2, 3].map((d) => ports(s, d as Dir)), [0, 1, 2, 3].map((d) => ports(t, d as Dir)));
    sides[i] = r ? { s: r.src.side, t: r.dst.side } : undefined;
    if (r) keep(r.points);
  });
  // pass 2: spread ports of edges that leave/enter the same side, ordered by where the other end is
  const slots = new Map<string, Array<{ i: number; end: 's' | 't'; key: number }>>();
  edges.forEach((e, i) => {
    const sd = sides[i];
    if (!sd) return;
    const s = byId[e.from!], t = byId[e.to!];
    const other = (b: Box) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
    for (const [end, node, side, far] of [['s', s, sd.s, other(t)], ['t', t, sd.t, other(s)]] as const) {
      const k = `${node.id}:${side}`;
      if (!slots.has(k)) slots.set(k, []);
      slots.get(k)!.push({ i, end, key: side % 2 === 0 ? far.y : far.x });
    }
  });
  const at = new Map<string, number>();
  for (const list of slots.values()) {
    list.sort((a, b) => a.key - b.key);
    list.forEach((x, j) => at.set(`${x.i}:${x.end}`, (j + 1) / (list.length + 1)));
  }
  used.clear();
  seed();
  const finish = (e: DEdge, pts: Pt[]) => {
    const s = byId[e.from!], t = byId[e.to!];
    e.points = pts;
    if (s.shape === 'diamond') e.points[0] = clipToOutline(e.points[1], e.points[0], 'diamond', s);
    if (t.shape === 'diamond') e.points[e.points.length - 1] = clipToOutline(e.points[e.points.length - 2], e.points[e.points.length - 1], 'diamond', t);
    if (e.label) e.labelAt = midOfLongest(e.points);
  };
  const all = (s: DNode) => [0, 1, 2, 3].map((d) => ports(s, d as Dir));
  edges.forEach((e, i) => {
    const s = byId[e.from!], t = byId[e.to!], sd = sides[i];
    let r = sd ? route(s, t, nodes, env(e), used, [ports(s, sd.s, at.get(`${i}:s`))], [ports(t, sd.t, at.get(`${i}:t`))]) : undefined;
    r ??= route(s, t, nodes, env(e), used, all(s), all(t));
    finish(e, r ? r.points : fallback(s, t));
    keep(e.points);
  });
  // pass 3: rip up each edge that crosses others and route it again knowing where every other edge went
  const crossCount = (pts: Pt[]) => pts.slice(1).reduce((n, q, k) => n + crossings(pts[k], q, segs), 0);
  for (let round = 0; round < 2; round++) {
    edges.forEach((e, i) => {
      segs.length = 0;
      for (const f of [...fixed, ...edges.filter((_, j) => j !== i)]) for (let k = 1; k < f.points.length; k++) segs.push([f.points[k - 1], f.points[k]]);
      const now = crossCount(e.points);
      if (!now) return;
      const s = byId[e.from!], t = byId[e.to!], sd = sides[i];
      const starts = sd ? [ports(s, sd.s, at.get(`${i}:s`)), ...all(s)] : all(s);
      const goals = sd ? [ports(t, sd.t, at.get(`${i}:t`)), ...all(t)] : all(t);
      const r = route(s, t, nodes, env(e), new Map(), starts, goals);
      if (r && crossCount(r.points) < now) finish(e, r.points);
    });
  }
}

function midOfLongest(pts: Pt[]): Pt {
  let best = 1, bl = -1;
  for (let i = 1; i < pts.length; i++) { const l = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y); if (l > bl) { bl = l; best = i; } }
  const a = pts[best - 1], b = pts[best];
  return pointOnPolyline(pts, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
}

function fallback(s: Box, t: Box): Pt[] {
  const a = { x: s.x + s.w, y: s.y + s.h / 2 }, b = { x: t.x, y: t.y + t.h / 2 };
  const mx = (a.x + b.x) / 2;
  return simplify([a, { x: mx, y: a.y }, { x: mx, y: b.y }, b]);
}

function simplify(pts: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) {
    if (out.length && same(out[out.length - 1], p)) continue;
    if (out.length >= 2) {
      const a = out[out.length - 2], b = out[out.length - 1];
      if ((Math.abs(a.x - b.x) < 0.01 && Math.abs(b.x - p.x) < 0.01) || (Math.abs(a.y - b.y) < 0.01 && Math.abs(b.y - p.y) < 0.01)) { out[out.length - 1] = p; continue; }
    }
    out.push(p);
  }
  return out;
}

class Heap {
  private a: Array<[number, number]> = [];
  get size() { return this.a.length; }
  push(k: number, v: number) {
    const a = this.a; a.push([k, v]);
    let i = a.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (a[p][0] <= a[i][0]) break; [a[p], a[i]] = [a[i], a[p]]; i = p; }
  }
  pop(): number {
    const a = this.a, top = a[0][1], last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]]; i = m;
      }
    }
    return top;
  }
}

interface Env { labels: Box[]; foreign: Box[]; segs: Array<[Pt, Pt]> }

/** Proper crossings of an axis-aligned segment with drawn segments perpendicular to it. */
function crossings(a: Pt, b: Pt, segs: Array<[Pt, Pt]>): number {
  let n = 0;
  const horiz = Math.abs(a.y - b.y) < 0.01;
  const lo = horiz ? Math.min(a.x, b.x) : Math.min(a.y, b.y), hi = horiz ? Math.max(a.x, b.x) : Math.max(a.y, b.y);
  for (const [p, q] of segs) {
    if (horiz) {
      if (Math.abs(p.x - q.x) > 0.01) continue;
      if (p.x > lo + 0.01 && p.x < hi - 0.01 && a.y > Math.min(p.y, q.y) + 0.01 && a.y < Math.max(p.y, q.y) - 0.01) n++;
    } else {
      if (Math.abs(p.y - q.y) > 0.01) continue;
      if (p.y > lo + 0.01 && p.y < hi - 0.01 && a.x > Math.min(p.x, q.x) + 0.01 && a.x < Math.max(p.x, q.x) - 0.01) n++;
    }
  }
  return n;
}

function route(src: DNode, dst: DNode, nodes: DNode[], env: Env, used: Map<string, number>, starts: Port[], goals: Port[]) {
  const obstacles = [...nodes.map((n) => grow(n, MARGIN)), ...env.labels.map((l) => grow(l, 4))];
  const xsF = env.foreign.flatMap((g) => [g.x, g.x + g.w]), ysF = env.foreign.flatMap((g) => [g.y, g.y + g.h]);
  // inside a foreign group, or running along its border
  const inForeign = (p: Pt) => env.foreign.some((g) => p.x > g.x - 6 && p.x < g.x + g.w + 6 && p.y > g.y - 6 && p.y < g.y + g.h + 6);
  const inside = (p: Pt) => obstacles.some((o) => p.x > o.x + 0.01 && p.x < o.x + o.w - 0.01 && p.y > o.y + 0.01 && p.y < o.y + o.h - 0.01);
  starts = starts.filter((s) => !inside(s.stub));
  goals = goals.filter((g) => !inside(g.stub));
  if (!starts.length || !goals.length) return undefined;

  const uniq = (v: number[]) => [...new Set(v.map((x) => Math.round(x * 100) / 100))].sort((a, b) => a - b);
  let xs = uniq([...xsF, ...obstacles.flatMap((o) => [o.x, o.x + o.w]), ...starts.map((s) => s.stub.x), ...goals.map((g) => g.stub.x)]);
  let ys = uniq([...ysF, ...obstacles.flatMap((o) => [o.y, o.y + o.h]), ...starts.map((s) => s.stub.y), ...goals.map((g) => g.stub.y)]);
  xs = uniq([...xs, ...xs.slice(1).map((x, i) => (x + xs[i]) / 2)]);
  ys = uniq([...ys, ...ys.slice(1).map((y, i) => (y + ys[i]) / 2)]);
  const W = xs.length, H = ys.length;
  const xi = new Map(xs.map((x, i) => [x, i])), yi = new Map(ys.map((y, i) => [y, i]));
  const key = (p: Pt) => [xi.get(Math.round(p.x * 100) / 100)!, yi.get(Math.round(p.y * 100) / 100)!] as const;
  const free = new Uint8Array(W * H);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) free[j * W + i] = inside({ x: xs[i], y: ys[j] }) ? 0 : 1;
  const segFree = (i: number, j: number, d: Dir) => {
    const i2 = i + DX[d], j2 = j + DY[d];
    if (i2 < 0 || j2 < 0 || i2 >= W || j2 >= H || !free[j2 * W + i2]) return false;
    return !inside({ x: (xs[i] + xs[i2]) / 2, y: (ys[j] + ys[j2]) / 2 });
  };

  const goalAt = new Map<number, Port>();
  for (const g of goals) { const [i, j] = key(g.stub); goalAt.set(j * W + i, g); }
  const gpts = goals.map((g) => g.stub);
  const h = (i: number, j: number) => Math.min(...gpts.map((g) => Math.abs(xs[i] - g.x) + Math.abs(ys[j] - g.y)));

  const N = W * H * 4;
  const cost = new Float64Array(N).fill(Infinity);
  const prev = new Int32Array(N).fill(-1);
  const heap = new Heap();
  const startOf = new Map<number, Port>();
  for (const s of starts) {
    const [i, j] = key(s.stub);
    const st = (j * W + i) * 4 + s.side;
    if (cost[st] > 0) { cost[st] = 0; heap.push(h(i, j), st); startOf.set(st, s); }
  }
  let end = -1, endPort: Port | undefined, best = Infinity;
  while (heap.size) {
    const st = heap.pop();
    const c = cost[st];
    if (c >= best) break;
    const cell = st >> 2, d = (st & 3) as Dir, i = cell % W, j = (cell / W) | 0;
    const g = goalAt.get(cell);
    if (g) {
      // arrive heading into the box (opposite of the port's outward side)
      const into = ((g.side + 2) % 4) as Dir;
      const total = c + (d === into ? 0 : BEND);
      if (total < best) { best = total; end = st; endPort = g; }
    }
    for (let nd = 0 as Dir; nd < 4; nd = (nd + 1) as Dir) {
      if (nd === (d + 2) % 4 || !segFree(i, j, nd)) continue;
      const i2 = i + DX[nd], j2 = j + DY[nd];
      const len = Math.abs(xs[i2] - xs[i]) + Math.abs(ys[j2] - ys[j]);
      const sk = segKey(xs[i], ys[j], xs[i2], ys[j2]);
      const foreign = inForeign({ x: (xs[i] + xs[i2]) / 2, y: (ys[j] + ys[j2]) / 2 }) ? len * 2 : 0;
      const cross = crossings({ x: xs[i], y: ys[j] }, { x: xs[i2], y: ys[j2] }, env.segs) * BEND * 2;
      const nc = c + len + foreign + cross + (nd === d ? 0 : BEND) + (used.get(sk) ?? 0) * len * 1.5;
      const ns = ((j2 * W + i2) << 2) + nd;
      if (nc < cost[ns]) { cost[ns] = nc; prev[ns] = st; heap.push(nc + h(i2, j2), ns); }
    }
  }
  if (end < 0 || !endPort) return undefined;
  const path: Pt[] = [];
  let st = end, first = end;
  while (st >= 0) { const cell = st >> 2; path.push({ x: xs[cell % W], y: ys[(cell / W) | 0] }); first = st; st = prev[st]; }
  path.reverse();
  const src0 = startOf.get(first)!;
  for (let k = 1; k < path.length; k++) { const sk = segKey(path[k - 1].x, path[k - 1].y, path[k].x, path[k].y); used.set(sk, (used.get(sk) ?? 0) + 1); }
  return { src: src0, dst: endPort, points: simplify([src0.p, ...path, endPort.p]) };
}

const segKey = (x1: number, y1: number, x2: number, y2: number) =>
  x1 < x2 || (x1 === x2 && y1 < y2) ? `${x1},${y1},${x2},${y2}` : `${x2},${y2},${x1},${y1}`;
