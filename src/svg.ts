// Excalidraw JSON -> static SVG. Works on any simple Excalidraw file (ours or
// hand-written), offline, so previews never depend on a CDN.
import { measureText } from './measure.js';
import type { Box, ExElement, ExcalidrawDoc } from './types.js';

const esc = (s: unknown) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function bbox(elements: ExElement[], pad = 40): Box {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const el of elements) {
    if (el.isDeleted) continue;
    const pts = el.points
      ? el.points.map(([px, py]) => [el.x + px, el.y + py])
      : [[el.x, el.y], [el.x + el.width, el.y + el.height]];
    for (const [px, py] of pts) { x0 = Math.min(x0, px); y0 = Math.min(y0, py); x1 = Math.max(x1, px); y1 = Math.max(y1, py); }
  }
  if (!Number.isFinite(x0)) return { x: 0, y: 0, w: 2 * pad, h: 2 * pad };
  return { x: x0 - pad, y: y0 - pad, w: x1 - x0 + 2 * pad, h: y1 - y0 + 2 * pad };
}

const dash = (el: ExElement) =>
  el.strokeStyle === 'dashed' ? ` stroke-dasharray="${el.strokeWidth * 4} ${el.strokeWidth * 3}"`
    : el.strokeStyle === 'dotted' ? ` stroke-dasharray="2 ${el.strokeWidth * 2}"` : '';
const fill = (el: ExElement) => (el.backgroundColor && el.backgroundColor !== 'transparent' ? el.backgroundColor : 'none');
const r = (n: number) => Math.round(n * 100) / 100;

export function toSvg(d: ExcalidrawDoc): string {
  const elements = (d.elements ?? []).filter((e) => !e.isDeleted);
  const byId = Object.fromEntries(elements.map((e) => [e.id, e]));
  const b = bbox(elements);
  const bg = d.appState?.viewBackgroundColor ?? '#ffffff';
  const body: string[] = [];
  const markers = new Set<string>();
  for (const el of elements) {
    const stroke = el.strokeColor ?? '#1e1e1e';
    const sw = el.strokeWidth ?? 2;
    const common = `stroke="${stroke}" stroke-width="${sw}"${dash({ ...el, strokeWidth: sw })} opacity="${(el.opacity ?? 100) / 100}"`;
    if (el.type === 'rectangle') {
      const rad = el.roundness ? Math.min(12, Math.min(el.width, el.height) * 0.25) : 0;
      body.push(`<rect x="${r(el.x)}" y="${r(el.y)}" width="${r(el.width)}" height="${r(el.height)}" rx="${r(rad)}" fill="${fill(el)}" ${common}/>`);
    } else if (el.type === 'ellipse') {
      body.push(`<ellipse cx="${r(el.x + el.width / 2)}" cy="${r(el.y + el.height / 2)}" rx="${r(el.width / 2)}" ry="${r(el.height / 2)}" fill="${fill(el)}" ${common}/>`);
    } else if (el.type === 'diamond') {
      const cx = el.x + el.width / 2, cy = el.y + el.height / 2;
      body.push(`<polygon points="${r(cx)},${r(el.y)} ${r(el.x + el.width)},${r(cy)} ${r(cx)},${r(el.y + el.height)} ${r(el.x)},${r(cy)}" fill="${fill(el)}" stroke-linejoin="round" ${common}/>`);
    } else if ((el.type === 'arrow' || el.type === 'line') && el.points?.length) {
      const pts = el.points.map(([px, py]) => `${r(el.x + px)},${r(el.y + py)}`).join(' ');
      let m = '';
      if (el.type === 'arrow' && el.endArrowhead) { markers.add(stroke); m = ` marker-end="url(#ah-${stroke.replace('#', '')})"`; }
      body.push(`<polyline points="${pts}" fill="none" stroke-linejoin="round" ${common}${m}/>`);
    } else if (el.type === 'text') {
      body.push(renderText(el, el.containerId ? byId[el.containerId] : undefined));
    }
  }
  const defs = `<defs><style>text{font-family:"Cascadia Code","JetBrains Mono",Menlo,Consolas,"Noto Sans Mono CJK KR","Noto Sans CJK KR",monospace;}</style>${
    [...markers].map((c) => `<marker id="ah-${c.replace('#', '')}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${c}"/></marker>`).join('')}</defs>`;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${r(b.x)} ${r(b.y)} ${r(b.w)} ${r(b.h)}" width="${Math.ceil(b.w)}" height="${Math.ceil(b.h)}">`,
    defs,
    `<rect x="${r(b.x)}" y="${r(b.y)}" width="${r(b.w)}" height="${r(b.h)}" fill="${bg}"/>`,
    ...body,
    '</svg>',
  ].join('\n');
}

function renderText(el: ExElement, container?: ExElement): string {
  const fs = el.fontSize ?? 16;
  const lines = String(el.text ?? '').split('\n');
  const lh = fs * (el.lineHeight ?? 1.25);
  let x = el.x, anchor = 'start', y0 = el.y;
  if (container && container.type !== 'arrow') {
    // Center inside the container regardless of the text element's own geometry.
    const m = measureText(el.text, fs);
    x = container.x + container.width / 2; anchor = 'middle';
    y0 = container.y + (container.height - m.height) / 2;
  } else if (el.textAlign === 'center') { x = el.x + el.width / 2; anchor = 'middle'; }
  else if (el.textAlign === 'right') { x = el.x + el.width; anchor = 'end'; }
  const spans = lines.map((l, i) => `<tspan x="${r(x)}" y="${r(y0 + i * lh + fs * 0.95)}">${esc(l)}</tspan>`).join('');
  return `<text font-size="${fs}" fill="${el.strokeColor ?? '#1e1e1e'}" text-anchor="${anchor}">${spans}</text>`;
}
