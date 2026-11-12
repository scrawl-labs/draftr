// Recover the semantic graph from an existing (often hand-written, messy)
// Excalidraw file, so it can be re-laid out cleanly: `draftr tidy`.
import { absPoints, classifyShapes, DECOR, distToSeg, gapBetween } from './lint.js';
import { measureText } from './measure.js';
import { IconLibrary } from './icons/index.js';
import { KINDS, type GraphInput, type Kind } from './schema.js';
import type { Box, ExElement, ExcalidrawDoc } from './types.js';

const rect = (e: ExElement): Box => ({ x: e.x, y: e.y, w: e.width, h: e.height });
const inside = (o: Box, i: Box) => i.x >= o.x - 1 && i.y >= o.y - 1 && i.x + i.w <= o.x + o.w + 1 && i.y + i.h <= o.y + o.h + 1;
const center = (b: Box) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
const slug = (s: string) => s.replace(/[^A-Za-z0-9_\-:.]/g, '_');

export function extractGraph(d: ExcalidrawDoc): GraphInput {
  const knownIcons = new IconLibrary();
  const els = (d.elements ?? []).filter((e) => !e.isDeleted);
  const { leaves, groups } = classifyShapes(els.filter((e) => !DECOR.has(String(e.customData?.role))));
  const texts = els.filter((e) => e.type === 'text');
  // captions ("Service", "Database") are decoration, not labels
  const used = new Set<string>(texts.filter((t) => t.customData?.role === 'node-caption').map((t) => t.id));

  // Assign each free text to the leaf it overlaps most (handles labels that spill out of their box).
  const overlapArea = (a: Box, b: Box) =>
    Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const textBox = (t: ExElement): Box => {
    const m = measureText(t.text, t.fontSize ?? 16);
    return { x: t.x, y: t.y, w: Math.max(m.width, t.width ?? 0), h: Math.max(m.height, t.height ?? 0) };
  };
  const labelOf = new Map<string, string>();
  for (const t of texts) if (t.containerId && t.text) { labelOf.set(t.containerId, String(t.text)); used.add(t.id); }
  // draftr's own icon nodes: the label is a grouped free text tagged with the node id
  for (const t of texts) {
    const nid = t.customData?.role === 'node-label' ? t.customData.nodeId : undefined;
    const owner = nid ? leaves.find((l) => l.customData?.nodeId === nid || l.customData?.participant === nid) : undefined;
    if (owner && t.text) { labelOf.set(owner.id, String(t.text)); used.add(t.id); }
  }
  for (const t of texts) {
    if (t.containerId || used.has(t.id)) continue;
    const tb = textBox(t);
    let best: ExElement | undefined, bestA = 0;
    for (const l of leaves) { const a = overlapArea(tb, rect(l)); if (a > bestA) { bestA = a; best = l; } }
    if (best && bestA / (tb.w * tb.h) >= 0.3 && !labelOf.has(best.id)) { labelOf.set(best.id, String(t.text ?? '')); used.add(t.id); }
  }
  const boundText = (shape: ExElement) => labelOf.get(shape.id);

  const strokeKind = new Map<string, Kind>([['#e67700', 'database'], ['#6741d9', 'queue'], ['#2f9e44', 'client'], ['#d9480f', 'decision'], ['#f08c00', 'note']]);
  const inferKind = (s: ExElement, lab = ''): Kind => {
    const known = s.customData?.kind as Kind | undefined;
    if (known && (KINDS as readonly string[]).includes(known)) return known;
    if (s.type === 'ellipse') return 'user';
    if (s.type === 'diamond') return 'decision';
    if (/postgres|mysql|maria|mongo|dynamo|sqlite|database|\bdb\b|redis|cassandra|elastic/i.test(lab)) return 'database';
    if (/kafka|queue|sqs|sns|rabbit|pub\/?sub|topic|stream|nats/i.test(lab)) return 'queue';
    if (/\bs3\b|bucket|blob|storage/i.test(lab)) return 'storage';
    if (/stripe|twilio|sendgrid|third.?party|external|github/i.test(lab)) return 'external';
    if (/app|browser|web client|mobile|frontend|cli\b/i.test(lab)) return 'client';
    if (/user|customer|admin|shopper/i.test(lab)) return 'user';
    return strokeKind.get(String(s.strokeColor).toLowerCase()) ?? 'service';
  };

  // smallest enclosing group
  const area = (e: ExElement) => e.width * e.height;
  const parentGroup = (b: Box, self?: ExElement) =>
    groups.filter((g) => g !== self && inside(rect(g), b) && !(self && area(g) <= area(self))).sort((a, b2) => area(a) - area(b2))[0];

  const nodes = leaves.map((s) => {
    const lab = boundText(s);
    return {
      id: slug(String(s.customData?.nodeId ?? s.id)),
      label: lab ?? String(s.customData?.nodeId ?? s.id),
      kind: inferKind(s, lab),
      ...(typeof s.customData?.icon === 'string' && knownIcons.get(s.customData.icon) ? { icon: s.customData.icon } : {}),
      group: parentGroup(rect(s)) ? slug(parentGroup(rect(s))!.id.replace(/^group:/, '')) : undefined,
      highlight: s.strokeWidth >= 3 || undefined,
      _el: s,
    };
  });
  const nodeOf = new Map(nodes.map((n) => [n._el.id, n]));

  const grs = groups.map((g) => {
    // group label: free text inside the group but not inside any of its children, nearest the top-left corner
    const candidates = texts.filter((t) => !t.containerId && !used.has(t.id) && inside(rect(g), rect(t))
      && !leaves.some((l) => inside(rect(l), rect(t))) && !groups.some((o) => o !== g && area(o) < area(g) && inside(rect(o), rect(t))));
    candidates.sort((a, b) => (a.y - g.y + (a.x - g.x)) - (b.y - g.y + (b.x - g.x)));
    const t = candidates[0];
    if (t) used.add(t.id);
    const parent = parentGroup(rect(g), g);
    return { id: slug(g.id.replace(/^group:/, '')), label: t?.text ? String(t.text) : ' ', parent: parent ? slug(parent.id.replace(/^group:/, '')) : undefined };
  });

  const nearestShape = (p: { x: number; y: number }) => {
    let best: ExElement | undefined, bd = 24;
    for (const s of leaves) { const d2 = gapBetween(rect(s), { x: p.x, y: p.y, w: 0, h: 0 }); if (d2 < bd) { bd = d2; best = s; } }
    return best;
  };

  const edges: NonNullable<GraphInput['edges']> = [];
  let dx = 0, dy = 0;
  for (const a of els.filter((e) => e.type === 'arrow' && e.points?.length)) {
    const pts = absPoints(a);
    const from = (a.startBinding?.elementId && nodeOf.get(a.startBinding.elementId)?._el) || nearestShape(pts[0]);
    const to = (a.endBinding?.elementId && nodeOf.get(a.endBinding.elementId)?._el) || nearestShape(pts[pts.length - 1]);
    if (!from || !to || !nodeOf.has(from.id) || !nodeOf.has(to.id)) continue;
    const c0 = center(rect(from)), c1 = center(rect(to));
    dx += Math.abs(c1.x - c0.x); dy += Math.abs(c1.y - c0.y);
    let lab = texts.find((t) => t.containerId === a.id || t.customData?.edge === a.id);
    if (!lab) {
      const segs = pts.slice(1).map((q, i) => [pts[i], q] as const);
      let bd = 40;
      for (const t of texts) {
        if (t.containerId || used.has(t.id)) continue;
        const c = center(textBox(t));
        const d2 = Math.min(...segs.map(([p, q]) => distToSeg(c, p, q)));
        if (d2 < bd) { bd = d2; lab = t; }
      }
    }
    if (lab) used.add(lab.id);
    edges.push({
      from: nodeOf.get(from.id)!.id, to: nodeOf.get(to.id)!.id,
      ...(lab?.text ? { label: String(lab.text) } : {}),
      style: a.strokeStyle === 'dashed' || a.strokeStyle === 'dotted' ? 'dashed' : 'solid',
      ...(a.strokeWidth >= 3 ? { highlight: true } : {}),
    });
  }

  const title = texts.find((t) => t.customData?.role === 'title');
  return {
    type: 'graph',
    title: title?.text ? String(title.text) : undefined,
    direction: dy > dx ? 'DOWN' : 'RIGHT',
    nodes: nodes.map(({ _el, ...n }) => n),
    edges,
    groups: grs,
  };
}
