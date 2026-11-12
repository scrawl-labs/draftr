// Sequence diagrams: participants as columns, messages as rows. Columns are
// spaced so every message label fits between the lifelines it connects.
import { base, doc, FileStore, iconImage, polyline, resetSeed, text } from './excalidraw.js';
import { IconLibrary } from './icons/index.js';
import { ICON_GAP, ICON_SIZE } from './layout.js';
import { measureText } from './measure.js';
import { parseSequence } from './schema.js';
import { THEME } from './theme.js';
import type { ExElement, ExcalidrawDoc } from './types.js';

const FONT = 16;
const MSG_FONT = 14;
const ROW = 52;
const SELF_H = 30;
const SELF_W = 36;
const COL_GAP = 48;

export function sequenceToExcalidraw(input: unknown, opts: { icons?: IconLibrary | false } = {}): ExcalidrawDoc {
  const s = parseSequence(input);
  resetSeed();
  const lib = opts.icons === false ? undefined : opts.icons ?? new IconLibrary();
  const icons = s.participants.map((p) => lib?.forNode(p));
  const store = new FileStore();
  const idx = Object.fromEntries(s.participants.map((p, i) => [p.id, i]));
  const labels = s.messages.map((m, i) => (s.autonumber ? `${i + 1}. ${m.label}` : m.label).trim());

  const heads = s.participants.map((p, i) => {
    const t = measureText(p.label, FONT);
    const iconW = icons[i] ? ICON_SIZE + ICON_GAP : 0;
    return { w: Math.max(120, Math.ceil(t.width + 40 + iconW)), h: Math.max(56, Math.ceil(t.height + 28)) };
  });
  const n = s.participants.length;

  // gaps[i] = distance between centers of column i and i+1
  const gaps = Array.from({ length: Math.max(0, n - 1) }, (_, i) => (heads[i].w + heads[i + 1].w) / 2 + COL_GAP);
  const need: Array<{ a: number; b: number; d: number }> = [];
  s.messages.forEach((m, i) => {
    const a = idx[m.from], b = idx[m.to];
    const w = measureText(labels[i], MSG_FONT).width;
    if (a === b) { if (a < n - 1) need.push({ a, b: a + 1, d: SELF_W + 12 + w + 24 }); }
    else need.push({ a: Math.min(a, b), b: Math.max(a, b), d: w + 40 });
  });
  need.sort((x, y) => (x.b - x.a) - (y.b - y.a));
  for (const { a, b, d } of need) {
    const cur = gaps.slice(a, b).reduce((p, c) => p + c, 0);
    if (cur < d) for (let k = a; k < b; k++) gaps[k] += (d - cur) / (b - a);
  }

  const top = s.title ? 48 : 0;
  const x0 = heads[0].w / 2;
  const cx = [x0];
  for (const g of gaps) cx.push(cx[cx.length - 1] + g);
  const headH = Math.max(...heads.map((h) => h.h));

  const els: ExElement[] = [];
  if (s.title) els.push(text('title', s.title, 0, 0, 20, { customData: { role: 'title' } }));

  // messages first so we know how tall lifelines are
  let y = top + headH + 48;
  const msgEls: ExElement[] = [];
  s.messages.forEach((m, i) => {
    const a = idx[m.from], b = idx[m.to];
    const color = m.highlight ? THEME.accent : THEME.ink;
    const common: Partial<ExElement> = {
      strokeColor: color, strokeWidth: m.highlight ? 3 : 2, strokeStyle: m.style === 'dashed' ? 'dashed' : 'solid',
      customData: { role: 'message', from: m.from, to: m.to, index: i },
    };
    const id = `msg:${i}`;
    const lw = measureText(labels[i], MSG_FONT);
    if (a === b) {
      const x = cx[a];
      msgEls.push(polyline('arrow', id, [{ x, y }, { x: x + SELF_W, y }, { x: x + SELF_W, y: y + SELF_H }, { x, y: y + SELF_H }], common));
      if (labels[i]) msgEls.push(text(`${id}:label`, labels[i], x + SELF_W + 10, y + (SELF_H - lw.height) / 2, MSG_FONT, { strokeColor: color, customData: { role: 'message-label', edge: id } }));
      y += ROW + SELF_H;
    } else {
      msgEls.push(polyline('arrow', id, [{ x: cx[a], y }, { x: cx[b], y }], common));
      if (labels[i]) {
        const mid = (cx[a] + cx[b]) / 2;
        const lx = mid - lw.width / 2, ly = y - lw.height - 6;
        if (cx.some((c, k) => k !== a && k !== b && c > lx - 12 && c < lx + lw.width + 12)) {
          msgEls.push(base('rectangle', `${id}:label-bg`, lx - 4, ly - 1, lw.width + 8, lw.height + 2, {
            strokeColor: 'transparent', backgroundColor: THEME.background, strokeWidth: 0,
            customData: { role: 'label-bg', edge: id },
          }));
        }
        msgEls.push(text(`${id}:label`, labels[i], mid - lw.width / 2, y - lw.height - 6, MSG_FONT, { strokeColor: color, customData: { role: 'message-label', edge: id } }));
      }
      y += ROW;
    }
  });
  const bottom = y;

  s.participants.forEach((p, i) => {
    const k = THEME.kinds[p.kind] ?? THEME.kinds.service;
    const h = heads[i];
    const id = `participant:${p.id}`;
    const shape = k.shape === 'diamond' ? 'rectangle' : k.shape;
    const hy = top + (headH - h.h) / 2;
    els.push(polyline('line', `lifeline:${p.id}`, [{ x: cx[i], y: top + headH }, { x: cx[i], y: bottom }], {
      strokeColor: THEME.muted, strokeWidth: 1, strokeStyle: 'dashed', customData: { role: 'lifeline', participant: p.id },
    }));
    const icon = icons[i];
    const grp = icon ? [`g:${p.id}`] : [];
    els.push(base(shape, id, cx[i] - h.w / 2, hy, h.w, h.h, {
      strokeColor: k.stroke, backgroundColor: k.bg, strokeStyle: k.dashed ? 'dashed' : 'solid',
      roundness: shape === 'rectangle' ? { type: 3 } : { type: 2 },
      boundElements: icon ? [] : [{ type: 'text', id: `${id}:text` }],
      groupIds: grp,
      customData: { role: 'participant', participant: p.id, kind: p.kind, ...(icon ? { icon: icon.name } : {}) },
    }));
    const m = measureText(p.label, FONT);
    if (icon) {
      const x0 = cx[i] - (ICON_SIZE + ICON_GAP + m.width) / 2;
      els.push(iconImage(`${id}:icon`, store, icon, x0, hy + (h.h - ICON_SIZE) / 2, ICON_SIZE, k.stroke, { groupIds: grp }));
      els.push(text(`${id}:text`, p.label, x0 + ICON_SIZE + ICON_GAP, hy + (h.h - m.height) / 2, FONT, { groupIds: grp, customData: { role: 'node-label', nodeId: p.id } }));
    } else {
      els.push(text(`${id}:text`, p.label, cx[i] - m.width / 2, hy + (h.h - m.height) / 2, FONT, {
        textAlign: 'center', verticalAlign: 'middle', containerId: id,
      }));
    }
  });

  return doc([...els, ...msgEls], store.files);
}
