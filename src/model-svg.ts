// DiagramModel -> SVG for docs and READMEs: Pretendard (embedded, subset), Tone theme.
import { pretendardCss } from './fonts/index.js';
import { measureText } from './measure.js';
import type { DEdge, DiagramModel, DNode } from './model.js';
import { THEME } from './theme.js';
import type { Pt } from './types.js';

const T = THEME;
const PAD = 40;
const esc = (s: unknown) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const r = (n: number) => Math.round(n * 100) / 100;

export function modelToSvg(model: DiagramModel): string {
  const used: Record<number, string> = { 500: '' };
  const textEl = (x: number, y: number, s: string, size: number, weight: 500 | 600, fill: string, anchor = 'start', extra = '') => {
    used[weight] += s;
    return `<text x="${r(x)}" y="${r(y)}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}"${extra}>${esc(s)}</text>`;
  };
  const body: string[] = [];

  for (const g of [...model.groups].sort((a, b) => a.depth - b.depth)) {
    body.push(`<rect x="${r(g.x)}" y="${r(g.y)}" width="${r(g.w)}" height="${r(g.h)}" rx="12" fill="${T.group.fills[g.depth % T.group.fills.length]}" stroke="${T.group.line}"/>`);
    body.push(textEl(g.x + 16, g.y + 25, g.label, T.size.group, 500, T.group.label));
  }

  const labels: string[] = [];
  for (const e of model.edges.filter((x) => x.role === 'lifeline')) body.push(edgePath(e));
  for (const e of model.edges.filter((x) => x.role !== 'lifeline')) {
    body.push(edgePath(e));
    if (e.label && e.labelAt) {
      const m = measureText(e.label, T.size.edgeLabel, 'pretendard500');
      const backing = e.role === 'edge' || e.labelBacking;
      if (backing) labels.push(`<rect x="${r(e.labelAt.x - m.width / 2 - 4)}" y="${r(e.labelAt.y - 9)}" width="${r(m.width + 8)}" height="18" fill="${T.background}"/>`);
      labels.push(textEl(e.labelAt.x, e.labelAt.y + 4.5, e.label, T.size.edgeLabel, 500, e.labelColor ?? e.color, 'middle'));
    }
  }
  body.push(...labels);
  for (const n of model.nodes) body.push(...nodeSvg(n, textEl));
  for (const t of model.texts) body.push(textEl(t.x, t.y + t.size, t.text, t.size, t.weight, t.color));

  const w = model.width + 2 * PAD, h = model.height + 2 * PAD;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-PAD} ${-PAD} ${r(w)} ${r(h)}" width="${Math.ceil(w)}" height="${Math.ceil(h)}" font-family="Pretendard, 'Apple SD Gothic Neo', 'Segoe UI', system-ui, sans-serif">`,
    `<defs><style>${pretendardCss(used)}</style></defs>`,
    `<rect x="${-PAD}" y="${-PAD}" width="${r(w)}" height="${r(h)}" fill="${T.background}"/>`,
    ...body,
    '</svg>',
  ].join('\n');
}

function edgePath(e: DEdge): string {
  const dash = e.dashed ? ` stroke-dasharray="${e.role === 'lifeline' ? '4 4' : '5 4'}"` : '';
  if (!e.arrow) return `<polyline points="${e.points.map((p) => `${r(p.x)},${r(p.y)}`).join(' ')}" fill="none" stroke="${e.color}" stroke-width="${e.width}"${dash}/>`;
  const pts = e.points, b = pts[pts.length - 1], a = pts[pts.length - 2];
  const ang = Math.atan2(b.y - a.y, b.x - a.x);
  const head = 9, back: Pt = { x: b.x - (head - 2) * Math.cos(ang), y: b.y - (head - 2) * Math.sin(ang) };
  const p1 = { x: b.x - head * Math.cos(ang + 0.42), y: b.y - head * Math.sin(ang + 0.42) };
  const p2 = { x: b.x - head * Math.cos(ang - 0.42), y: b.y - head * Math.sin(ang - 0.42) };
  return `<polyline points="${[...pts.slice(0, -1), back].map((p) => `${r(p.x)},${r(p.y)}`).join(' ')}" fill="none" stroke="${e.color}" stroke-width="${e.width}" stroke-linejoin="round"${dash}/>`
    + `<path d="M${r(b.x)},${r(b.y)} L${r(p1.x)},${r(p1.y)} L${r(p2.x)},${r(p2.y)} Z" fill="${e.color}" stroke="${e.color}" stroke-width="1" stroke-linejoin="round"/>`;
}

function nodeSvg(n: DNode, textEl: (x: number, y: number, s: string, size: number, weight: 500 | 600, fill: string, anchor?: string) => string): string[] {
  const out: string[] = [];
  const fill = n.highlight ? n.hue.solid : n.hue.fill, stroke = n.highlight ? n.hue.solid : n.hue.line;
  const dash = n.dashed ? ' stroke-dasharray="5 4"' : '';
  const sw = T.node.border;
  if (n.shape === 'diamond') {
    const cx = n.x + n.w / 2, cy = n.y + n.h / 2;
    out.push(`<polygon points="${r(cx)},${r(n.y)} ${r(n.x + n.w)},${r(cy)} ${r(cx)},${r(n.y + n.h)} ${r(n.x)},${r(cy)}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round"${dash}/>`);
    const lines = n.title.split('\n'), lh = T.size.title * 1.25, top = cy - (lines.length * lh) / 2;
    lines.forEach((l, i) => out.push(textEl(cx, top + i * lh + T.size.title * 0.95, l, T.size.title, 500, n.highlight ? T.white : T.ink, 'middle')));
    return out;
  }
  const rx = n.shape === 'pill' ? n.h / 2 : T.node.radius;
  out.push(`<rect x="${r(n.x)}" y="${r(n.y)}" width="${r(n.w)}" height="${r(n.h)}" rx="${r(rx)}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"${dash}/>`);
  const cy = n.y + n.h / 2;
  let x = n.x + T.node.padX + (n.shape === 'pill' ? 14 : 0);
  if (n.icon) {
    const color = n.highlight ? T.white : n.icon.source === 'brand' ? undefined : n.hue.ink;
    const s = T.node.icon;
    out.push(`<image x="${r(x)}" y="${r(cy - s / 2)}" width="${s}" height="${s}" href="data:image/svg+xml;base64,${Buffer.from(n.icon.svg(color)).toString('base64')}"/>`);
    x += s + T.node.iconGap;
  }
  const lines = n.title.split('\n'), lh = T.size.title * 1.25;
  const capH = n.caption ? T.size.caption * 1.35 : 0;
  const top = cy - (lines.length * lh + capH) / 2;
  lines.forEach((l, i) => out.push(textEl(x, top + i * lh + T.size.title * 0.95, l, T.size.title, 500, n.highlight ? T.white : T.ink)));
  if (n.caption) out.push(textEl(x, top + lines.length * lh + T.size.caption * 1.05, n.caption, T.size.caption, 500, n.highlight ? 'rgba(255,255,255,0.82)' : T.muted));
  return out;
}
