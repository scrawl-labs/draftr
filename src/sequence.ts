// Sequence diagrams: participants as columns, messages as rows. Columns are spaced so every
// message label fits between the lifelines it connects. Produces the same DiagramModel as graphs.
import { IconLibrary } from './icons/index.js';
import { measureText } from './measure.js';
import { nodeBox, toDNode, type DEdge, type DiagramModel, type DText, type ModelOptions } from './model.js';
import { parseSequence } from './schema.js';
import { THEME } from './theme.js';

const T = THEME;
const ROW = 54;
const SELF_H = 30;
const SELF_W = 36;
const COL_GAP = 56;

const labelWidth = (s: string) => Math.max(measureText(s, T.size.edgeLabel, 'pretendard500').width, measureText(s, T.size.excalidrawEdgeLabel, 'nunito').width);

export function sequenceModel(input: unknown, opts: ModelOptions = {}): DiagramModel {
  const s = parseSequence(input);
  const lib = opts.icons === false ? undefined : opts.icons ?? new IconLibrary();
  const icons = s.participants.map((p) => lib?.forNode(p));
  const idx = Object.fromEntries(s.participants.map((p, i) => [p.id, i]));
  const labels = s.messages.map((m, i) => (s.autonumber ? `${i + 1}. ${m.label}` : m.label).trim());
  const heads = s.participants.map((p, i) => nodeBox(p.label, p.kind, icons[i], p.caption));
  const n = s.participants.length;

  // gaps[i] = distance between centers of column i and i+1
  const gaps = Array.from({ length: Math.max(0, n - 1) }, (_, i) => (heads[i].w + heads[i + 1].w) / 2 + COL_GAP);
  const need: Array<{ a: number; b: number; d: number }> = [];
  s.messages.forEach((m, i) => {
    const a = idx[m.from], b = idx[m.to];
    const w = labelWidth(labels[i]);
    if (a === b) { if (a < n - 1) need.push({ a, b: a + 1, d: SELF_W + 14 + w + 28 }); }
    else need.push({ a: Math.min(a, b), b: Math.max(a, b), d: w + 48 });
  });
  need.sort((x, y) => (x.b - x.a) - (y.b - y.a));
  for (const { a, b, d } of need) {
    const cur = gaps.slice(a, b).reduce((p, c) => p + c, 0);
    if (cur < d) for (let k = a; k < b; k++) gaps[k] += (d - cur) / (b - a);
  }

  const top = s.title ? 52 : 0;
  const cx = [heads[0].w / 2];
  for (const g of gaps) cx.push(cx[cx.length - 1] + g);
  const headH = Math.max(...heads.map((h) => h.h));

  const texts: DText[] = [];
  if (s.title) texts.push({ id: 'title', text: s.title, x: 0, y: 0, size: T.size.docTitle, weight: 500, color: T.ink, role: 'title' });

  const edges: DEdge[] = [];
  let y = top + headH + 52;
  s.messages.forEach((m, i) => {
    const a = idx[m.from], b = idx[m.to];
    const hue = T.kinds[s.participants[a].kind]?.hue ?? T.kinds.service.hue;
    const color = m.highlight ? hue.solid : T.edge;
    const base: Omit<DEdge, 'points' | 'labelAt'> = {
      id: `msg:${i}`, role: 'message', color, width: m.highlight ? T.stroke.highlightWidth : T.stroke.width,
      dashed: m.style === 'dashed', arrow: true, highlight: !!m.highlight,
      label: labels[i] || undefined, labelColor: m.highlight ? hue.solid : T.edge,
    };
    const lw = labelWidth(labels[i]);
    if (a === b) {
      const x = cx[a];
      edges.push({ ...base, points: [{ x, y }, { x: x + SELF_W, y }, { x: x + SELF_W, y: y + SELF_H }, { x, y: y + SELF_H }], labelAt: { x: x + SELF_W + 12 + lw / 2, y: y + SELF_H / 2 } });
      y += ROW + SELF_H;
    } else {
      const mid = (cx[a] + cx[b]) / 2;
      const crosses = cx.some((c, k) => k !== a && k !== b && c > mid - lw / 2 - 12 && c < mid + lw / 2 + 12);
      edges.push({ ...base, points: [{ x: cx[a], y }, { x: cx[b], y }], labelAt: { x: mid, y: y - 13 }, labelBacking: crosses });
      y += ROW;
    }
  });
  const bottom = y;

  const nodes = s.participants.map((p, i) => {
    const h = heads[i];
    return toDNode(p, { x: cx[i] - h.w / 2, y: top + (headH - h.h) / 2, w: h.w, h: h.h }, icons[i], 'participant');
  });
  const lifelines: DEdge[] = s.participants.map((p, i) => ({
    id: `lifeline:${p.id}`, role: 'lifeline', points: [{ x: cx[i], y: top + headH }, { x: cx[i], y: bottom }],
    color: T.lifeline, width: 1, dashed: true, arrow: false, highlight: false,
  }));

  const width = cx[n - 1] + heads[n - 1].w / 2;
  return { type: 'sequence', title: s.title, width, height: bottom, nodes, groups: [], edges: [...lifelines, ...edges], texts };
}
