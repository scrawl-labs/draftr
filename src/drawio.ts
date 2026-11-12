// DiagramModel -> draw.io (diagrams.net) file: uncompressed mxGraph XML.
//
// Nodes are `label` shapes (a box that carries an image), so the icon is part of the box; groups are
// containers, so dragging a group drags its boxes; edges keep draftr's route as waypoints plus
// exit/entry constraints, and their labels are native edge labels.
import { iconColor } from './excalidraw.js';
import type { DEdge, DGroup, DiagramModel, DNode } from './model.js';
import { THEME } from './theme.js';
import type { Pt } from './types.js';

const T = THEME;
/** Pretendard for draw.io: loaded by the app from this stylesheet, falls back to Helvetica offline. */
const FONT = 'fontFamily=Pretendard,Helvetica,Arial,sans-serif;fontSource=https%3A%2F%2Fcdn.jsdelivr.net%2Fgh%2Forioncactus%2Fpretendard%40v1.3.9%2Fdist%2Fweb%2Fstatic%2Fpretendard-dynamic-subset.css;';

const xml = (s: unknown) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const html = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
const n2 = (v: number) => Math.round(v * 100) / 100;
const style = (o: Record<string, string | number | undefined | false>) =>
  Object.entries(o).filter(([, v]) => v !== undefined && v !== false).map(([k, v]) => (v === '' ? `${k};` : `${k}=${v};`)).join('');

export function toDrawio(model: DiagramModel, name = 'draftr'): string {
  const cells: string[] = [];
  const cellId = (kind: string, id: string) => `${kind}-${id}`.replace(/[^A-Za-z0-9_.:-]/g, '_');

  // ---- groups (containers), outermost first so parents exist before children ----
  const groupAbs = new Map<string, DGroup>();
  for (const g of [...model.groups].sort((a, b) => a.depth - b.depth)) {
    groupAbs.set(g.id, g);
    const parent = g.parent ? groupAbs.get(g.parent) : undefined;
    const s = style({
      rounded: 1, absoluteArcSize: 1, arcSize: 24, whiteSpace: 'wrap', html: 1, container: 1, collapsible: 0, recursiveResize: 0,
      fillColor: T.group.fills[g.depth % T.group.fills.length], strokeColor: T.group.line,
      verticalAlign: 'top', align: 'left', spacingLeft: 12, spacingTop: 2, fontColor: T.group.label, fontSize: T.size.group,
    }) + FONT;
    cells.push(vertex(cellId('group', g.id), xml(g.label), s, parent ? cellId('group', parent.id) : '1', g.x - (parent?.x ?? 0), g.y - (parent?.y ?? 0), g.w, g.h));
  }

  // ---- nodes ----
  for (const n of model.nodes) {
    const parent = n.group ? groupAbs.get(n.group) : undefined;
    cells.push(vertex(cellId('node', n.id), xml(nodeLabel(n)), nodeStyle(n), parent ? cellId('group', parent.id) : '1', n.x - (parent?.x ?? 0), n.y - (parent?.y ?? 0), n.w, n.h));
  }

  // ---- edges ----
  const byId = Object.fromEntries(model.nodes.map((n) => [n.id, n]));
  for (const e of model.edges) cells.push(edgeCell(e, cellId(e.role === 'edge' ? 'edge' : e.role, e.id), e.from ? byId[e.from] : undefined, e.to ? byId[e.to] : undefined, cellId));

  // ---- free text (diagram title) ----
  for (const t of model.texts) {
    const w = Math.max(200, t.text.length * t.size * 0.62);
    cells.push(vertex(cellId('text', t.id), xml(html(t.text)), style({ text: '', html: 1, align: 'left', verticalAlign: 'top', fontSize: t.size, fontColor: t.color, whiteSpace: 'nowrap' }) + FONT, '1', t.x, t.y, w, t.size * 1.6));
  }

  return [
    `<mxfile host="draftr" agent="https://github.com/scrawl-labs/draftr" type="device">`,
    `  <diagram id="${xml(cellId('diagram', name))}" name="${xml(name)}">`,
    `    <mxGraphModel grid="0" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="0" pageScale="1" math="0" shadow="0" background="${T.background}">`,
    '      <root>',
    '        <mxCell id="0"/>',
    '        <mxCell id="1" parent="0"/>',
    ...cells.map((c) => `        ${c}`),
    '      </root>',
    '    </mxGraphModel>',
    '  </diagram>',
    '</mxfile>',
    '',
  ].join('\n');
}

function vertex(id: string, value: string, s: string, parent: string, x: number, y: number, w: number, h: number): string {
  return `<mxCell id="${id}" value="${value}" style="${xml(s)}" vertex="1" parent="${parent}"><mxGeometry x="${n2(x)}" y="${n2(y)}" width="${n2(w)}" height="${n2(h)}" as="geometry"/></mxCell>`;
}

function nodeLabel(n: DNode): string {
  const title = html(n.title);
  if (!n.caption) return title;
  const capColor = n.highlight ? 'rgba(255,255,255,0.82)' : T.muted;
  return `${title}<br><span style="font-size:${T.size.caption}px;color:${capColor}">${html(n.caption)}</span>`;
}

function nodeStyle(n: DNode): string {
  const fill = n.highlight ? n.hue.solid : n.hue.fill;
  const stroke = n.highlight ? n.hue.solid : n.hue.line;
  const common = {
    whiteSpace: 'wrap', html: 1, fillColor: fill, strokeColor: stroke, strokeWidth: T.node.border,
    dashed: n.dashed ? 1 : undefined, fontColor: n.highlight ? T.white : T.ink, fontSize: T.size.title,
  };
  if (n.shape === 'diamond') return style({ rhombus: '', ...common, align: 'center', verticalAlign: 'middle' }) + FONT;
  const indent = T.node.padX + (n.shape === 'pill' ? 14 : 0);
  const iconPart = n.icon ? {
    shape: 'label',
    image: `data:image/svg+xml,${Buffer.from(n.icon.svg(iconColor(n.icon, n))).toString('base64')}`,
    imageWidth: T.node.icon, imageHeight: T.node.icon, imageAlign: 'left', imageVerticalAlign: 'middle',
  } : {};
  return style({
    ...iconPart,
    rounded: 1,
    ...(n.shape === 'pill' ? { arcSize: 50 } : { absoluteArcSize: 1, arcSize: T.node.radius * 2 }),
    ...common,
    align: 'left', verticalAlign: 'middle',
    // label shapes place the image at `spacing` from the left; the text starts after the icon
    spacing: n.icon ? indent : undefined,
    spacingLeft: n.icon ? T.node.icon + T.node.iconGap + 2 : indent,
    spacingTop: 0, spacingBottom: 0, spacingRight: 8,
  }) + FONT;
}

/** Fraction along the polyline (by length) closest to p, mapped to draw.io's -1..1 label position. */
function labelPosition(points: Pt[], p: Pt): number {
  const seg = points.slice(1).map((b, i) => ({ a: points[i], b, len: Math.hypot(b.x - points[i].x, b.y - points[i].y) }));
  const total = seg.reduce((s, x) => s + x.len, 0) || 1;
  let acc = 0, best = 0, bd = Infinity;
  for (const { a, b, len } of seg) {
    if (len) {
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / (len * len)));
      const d = Math.hypot(a.x + t * (b.x - a.x) - p.x, a.y + t * (b.y - a.y) - p.y);
      if (d < bd) { bd = d; best = (acc + t * len) / total; }
    }
    acc += len;
  }
  return n2(best * 2 - 1);
}

function pointAt(points: Pt[], frac: number): Pt {
  const lens = points.slice(1).map((b, i) => Math.hypot(b.x - points[i].x, b.y - points[i].y));
  let target = lens.reduce((s, l) => s + l, 0) * frac;
  for (let i = 0; i < lens.length; i++) {
    if (target <= lens[i] || i === lens.length - 1) {
      const t = lens[i] ? Math.min(1, target / lens[i]) : 0;
      return { x: points[i].x + (points[i + 1].x - points[i].x) * t, y: points[i].y + (points[i + 1].y - points[i].y) * t };
    }
    target -= lens[i];
  }
  return points[0];
}

function edgeCell(e: DEdge, id: string, src: DNode | undefined, dst: DNode | undefined, cellId: (k: string, id: string) => string): string {
  const pts = e.points;
  const rel = (n: DNode, p: Pt) => ({ x: n2(Math.max(0, Math.min(1, (p.x - n.x) / n.w))), y: n2(Math.max(0, Math.min(1, (p.y - n.y) / n.h))) });
  const bound = !!(src && dst);
  const s: Record<string, string | number | undefined | false> = {
    edgeStyle: bound ? 'orthogonalEdgeStyle' : 'none', rounded: 0, orthogonalLoop: 1, jettySize: 'auto', html: 1,
    endArrow: e.arrow ? 'block' : 'none', endFill: e.arrow ? 1 : undefined, endSize: e.arrow ? 6 : undefined, startArrow: 'none',
    strokeColor: e.color, strokeWidth: e.width, dashed: e.dashed ? 1 : undefined, dashPattern: e.dashed ? (e.role === 'lifeline' ? '4 4' : '5 4') : undefined,
    fontColor: e.labelColor ?? e.color, fontSize: T.size.edgeLabel, labelBackgroundColor: e.role === 'message' && !e.labelBacking ? 'none' : T.background,
  };
  if (bound) {
    const ex = rel(src!, pts[0]), en = rel(dst!, pts[pts.length - 1]);
    Object.assign(s, { exitX: ex.x, exitY: ex.y, exitDx: 0, exitDy: 0, entryX: en.x, entryY: en.y, entryDx: 0, entryDy: 0 });
  }
  const conn = bound ? ` source="${cellId('node', src!.id)}" target="${cellId('node', dst!.id)}"` : '';
  const waypoints = pts.slice(1, -1);
  let geomAttrs = 'relative="1"';
  let offset = '';
  if (e.label && e.labelAt) {
    if (e.role === 'edge') geomAttrs = `x="${labelPosition(pts, e.labelAt)}" relative="1"`;
    else {
      const c = pointAt(pts, 0.5);
      offset = `<mxPoint x="${n2(e.labelAt.x - c.x)}" y="${n2(e.labelAt.y - c.y)}" as="offset"/>`;
    }
  }
  const inner = [
    bound ? '' : `<mxPoint x="${n2(pts[0].x)}" y="${n2(pts[0].y)}" as="sourcePoint"/><mxPoint x="${n2(pts[pts.length - 1].x)}" y="${n2(pts[pts.length - 1].y)}" as="targetPoint"/>`,
    waypoints.length ? `<Array as="points">${waypoints.map((p) => `<mxPoint x="${n2(p.x)}" y="${n2(p.y)}"/>`).join('')}</Array>` : '',
    offset,
  ].join('');
  return `<mxCell id="${id}" value="${xml(e.label ? html(e.label) : '')}" style="${xml(style(s) + FONT)}" edge="1" parent="1"${conn}><mxGeometry ${geomAttrs} as="geometry">${inner}</mxGeometry></mxCell>`;
}
