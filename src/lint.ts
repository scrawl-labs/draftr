// Deterministic layout lint for ANY Excalidraw document. Replaces "squint at
// the PNG" with concrete, element-addressed findings a model can act on.
import { measureText } from './measure.js';
import type { Box, ExElement, ExcalidrawDoc, Pt } from './types.js';

export type Severity = 'error' | 'warning';
export type IssueCode =
  | 'shape-overlap' | 'shape-crowded' | 'group-boundary'
  | 'text-overflow' | 'text-over-shape' | 'text-overlap' | 'dangling-container'
  | 'arrow-through-shape' | 'arrow-through-text' | 'arrow-crossing' | 'arrow-dangling' | 'dangling-binding';

export interface Issue { severity: Severity; code: IssueCode; message: string; elements: string[]; fix?: string }
export interface LintReport { ok: boolean; score: number; summary: string; issues: Issue[] }
export interface LintOptions { minGap?: number }

const SHAPES = new Set(['rectangle', 'ellipse', 'diamond']);
const TEXT_PAD_X = 10;
const TEXT_PAD_Y = 4;

const rect = (el: ExElement): Box => ({ x: el.x, y: el.y, w: el.width, h: el.height });
const r2 = (n: number) => Math.round(n);
const inter = (a: Box, b: Box) => {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? { w, h } : null;
};
const contains = (o: Box, i: Box, slack = 0.5) =>
  i.x >= o.x - slack && i.y >= o.y - slack && i.x + i.w <= o.x + o.w + slack && i.y + i.h <= o.y + o.h + slack;
export const gapBetween = (a: Box, b: Box) => {
  const dx = Math.max(0, Math.max(a.x, b.x) - Math.min(a.x + a.w, b.x + b.w));
  const dy = Math.max(0, Math.max(a.y, b.y) - Math.min(a.y + a.h, b.y + b.h));
  return Math.hypot(dx, dy);
};
const shrink = (b: Box, d: number): Box => ({ x: b.x + d, y: b.y + d, w: b.w - 2 * d, h: b.h - 2 * d });

export function segIntersectsRect(p: Pt, q: Pt, b: Box): boolean {
  // Liang–Barsky clip
  let t0 = 0, t1 = 1;
  const dx = q.x - p.x, dy = q.y - p.y;
  const checks: Array<[number, number]> = [[-dx, p.x - b.x], [dx, b.x + b.w - p.x], [-dy, p.y - b.y], [dy, b.y + b.h - p.y]];
  for (const [pp, qq] of checks) {
    if (pp === 0) { if (qq < 0) return false; continue; }
    const t = qq / pp;
    if (pp < 0) { if (t > t1) return false; if (t > t0) t0 = t; }
    else { if (t < t0) return false; if (t < t1) t1 = t; }
  }
  return t1 - t0 > 1e-6;
}

function segsCross(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const o = (p: Pt, q: Pt, s: Pt) => Math.sign((q.x - p.x) * (s.y - p.y) - (q.y - p.y) * (s.x - p.x));
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0; // proper crossings only
}

export function distToSeg(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

export const absPoints = (a: ExElement): Pt[] => (a.points ?? []).map(([px, py]) => ({ x: a.x + px, y: a.y + py }));
const segsOf = (a: ExElement): Array<[Pt, Pt]> => {
  const pts = absPoints(a);
  return pts.slice(1).map((q, i) => [pts[i], q]);
};

/** Shapes that act as frames: flagged as groups, or fully containing another shape. */
export function classifyShapes(els: ExElement[]) {
  const shapes = els.filter((e) => SHAPES.has(e.type) && e.customData?.role !== 'label-bg');
  const isGroup = new Set<string>();
  for (const s of shapes) {
    if (s.customData?.role === 'group') { isGroup.add(s.id); continue; }
    if (shapes.some((o) => o !== s && contains(rect(s), rect(o)) && o.width * o.height < s.width * s.height)) isGroup.add(s.id);
  }
  return { shapes, leaves: shapes.filter((s) => !isGroup.has(s.id)), groups: shapes.filter((s) => isGroup.has(s.id)) };
}

export function lint(d: ExcalidrawDoc, { minGap = 16 }: LintOptions = {}): LintReport {
  const els = (d.elements ?? []).filter((e) => !e.isDeleted);
  const byId: Record<string, ExElement> = Object.fromEntries(els.map((e) => [e.id, e]));
  const issues: Issue[] = [];
  const add = (severity: Severity, code: IssueCode, message: string, elements: string[], fix?: string) =>
    issues.push({ severity, code, message, elements, ...(fix ? { fix } : {}) });

  const containerText: Record<string, string> = {};
  for (const t of els) if (t.type === 'text' && t.containerId && byId[t.containerId]) containerText[t.containerId] = String(t.text ?? '');
  const label = (el?: ExElement) => {
    if (!el) return '?';
    const t = containerText[el.id] ?? el.text;
    return t ? `${el.id} ("${String(t).split('\n')[0].slice(0, 30)}")` : el.id;
  };

  const { shapes, leaves, groups } = classifyShapes(els);

  // 1) leaf shapes overlapping / too close
  for (let i = 0; i < leaves.length; i++) for (let j = i + 1; j < leaves.length; j++) {
    const a = leaves[i], b = leaves[j];
    const ov = inter(rect(a), rect(b));
    if (ov) add('error', 'shape-overlap', `${label(a)} and ${label(b)} overlap by ${r2(ov.w)}×${r2(ov.h)}px`, [a.id, b.id], `move ${b.id} at least ${r2(Math.min(ov.w, ov.h) + minGap)}px away`);
    else {
      const g = gapBetween(rect(a), rect(b));
      if (g < minGap) add('warning', 'shape-crowded', `${label(a)} and ${label(b)} are only ${r2(g)}px apart (min ${minGap})`, [a.id, b.id], `increase spacing by ${r2(minGap - g)}px`);
    }
  }

  // 2) shapes straddling a group boundary
  for (const g of groups) for (const s of shapes) {
    if (s === g) continue;
    const ov = inter(rect(g), rect(s));
    if (ov && !contains(rect(g), rect(s)) && !contains(rect(s), rect(g)))
      add('error', 'group-boundary', `${label(s)} straddles the edge of group ${label(g)}`, [s.id, g.id], `move ${s.id} fully inside or outside ${g.id}, or resize the group`);
  }

  // 3) text that does not fit its container / free text colliding
  const freeText: Array<Box & { el: ExElement; owner?: string }> = [];
  for (const t of els.filter((e) => e.type === 'text')) {
    const m = measureText(t.text, t.fontSize ?? 16);
    const c = t.containerId ? byId[t.containerId] : undefined;
    if (c && SHAPES.has(c.type)) {
      let availW = c.width - 2 * TEXT_PAD_X, availH = c.height - 2 * TEXT_PAD_Y;
      if (c.type === 'ellipse') { availW = c.width * 0.707 - 2 * TEXT_PAD_X; availH = c.height * 0.707 - 2 * TEXT_PAD_Y; }
      if (c.type === 'diamond') { availW = c.width * 0.5 - TEXT_PAD_X; availH = c.height * 0.5 - TEXT_PAD_Y; }
      if (m.width > availW + 0.5) add('error', 'text-overflow', `text in ${label(c)} needs ~${r2(m.width)}px but only ${r2(availW)}px is available`, [t.id, c.id], `widen ${c.id} to ≥${r2(c.width + m.width - availW)}px or wrap the text`);
      if (m.height > availH + 0.5) add('error', 'text-overflow', `text in ${label(c)} needs ~${r2(m.height)}px height but only ${r2(availH)}px is available`, [t.id, c.id], `make ${c.id} ≥${r2(c.height + m.height - availH)}px tall`);
      continue;
    }
    if (t.containerId && !c) add('error', 'dangling-container', `text ${t.id} points to missing container ${t.containerId}`, [t.id]);
    const w = Math.max(m.width, t.width ?? 0), h = Math.max(m.height, t.height ?? 0);
    const tr = { x: t.textAlign === 'center' ? t.x + ((t.width ?? w) - w) / 2 : t.x, y: t.y, w, h, el: t };
    // Free text sitting fully inside a shape is that shape's (unbound) label.
    const owner = leaves.find((s) => contains(rect(s), tr));
    freeText.push({ ...tr, owner: owner?.id });
    for (const s of leaves) {
      if (s === owner) continue;
      const ov = inter(tr, rect(s));
      if (!ov) continue;
      const spills = tr.x >= s.x - 0.5 && tr.x < s.x + s.width && tr.y >= s.y - 0.5 && tr.y < s.y + s.height;
      if (spills) add('error', 'text-over-shape', `text ${label(t)} spills out of ${label(s)} by ${r2(tr.x + tr.w - (s.x + s.width))}px`, [t.id, s.id], `widen ${s.id} to ≥${r2(tr.x + tr.w - s.x + TEXT_PAD_X)}px, wrap the text, or bind it as the shape's label`);
      else add('error', 'text-over-shape', `free text ${label(t)} overlaps ${label(s)}`, [t.id, s.id], `move the text out of ${s.id}`);
    }
  }
  for (let i = 0; i < freeText.length; i++) for (let j = i + 1; j < freeText.length; j++) {
    if (freeText[i].owner && freeText[i].owner === freeText[j].owner) { /* multi-part label inside one shape */ }
    if (inter(freeText[i], freeText[j])) add('error', 'text-overlap', `texts ${label(freeText[i].el)} and ${label(freeText[j].el)} overlap`, [freeText[i].el.id, freeText[j].el.id], 'move one of them');
  }

  // 4) connectors. Lifelines (role=lifeline) are structure, not connectors.
  const lines = els.filter((e) => (e.type === 'arrow' || e.type === 'line') && e.points?.length);
  const connectors = lines.filter((e) => e.customData?.role !== 'lifeline');
  for (const a of connectors) {
    const segs = segsOf(a);
    const pts = absPoints(a);
    const ends = new Set([a.startBinding?.elementId, a.endBinding?.elementId].filter((x): x is string => !!x));
    for (const [idx, key] of [[0, 'startBinding'], [pts.length - 1, 'endBinding']] as const) {
      if (a[key]?.elementId) continue;
      const p = pts[idx];
      const near = leaves.find((s) => gapBetween(rect(s), { x: p.x, y: p.y, w: 0, h: 0 }) <= 12);
      if (near) { ends.add(near.id); continue; }
      const onLine = lines.some((l) => l !== a && segsOf(l).some(([s0, s1]) => distToSeg(p, s0, s1) <= 4));
      if (!onLine && a.type === 'arrow') add('warning', 'arrow-dangling', `${idx === 0 ? 'start' : 'end'} of ${a.id} is not attached to any shape`, [a.id], 'bind it to a shape or move the endpoint onto one');
    }
    for (const s of leaves) {
      if (ends.has(s.id)) continue;
      if (segs.some(([p, q]) => segIntersectsRect(p, q, shrink(rect(s), 2))))
        add('error', 'arrow-through-shape', `${a.id} passes through ${label(s)}`, [a.id, s.id], `reroute ${a.id} around ${s.id} (add bend points) or move ${s.id}`);
    }
    for (const tr of freeText) {
      if (tr.el.customData?.edge === a.id || tr.el.containerId === a.id || (tr.owner && ends.has(tr.owner))) continue;
      if (segs.some(([p, q]) => segIntersectsRect(p, q, shrink(tr, 1))))
        add('warning', 'arrow-through-text', `${a.id} runs through text ${label(tr.el)}`, [a.id, tr.el.id], `move the text off ${a.id}`);
    }
  }
  let crossings = 0;
  const arrows = connectors.filter((e) => e.type === 'arrow');
  for (let i = 0; i < arrows.length; i++) for (let j = i + 1; j < arrows.length; j++) {
    let n = 0;
    for (const [p, q] of segsOf(arrows[i])) for (const [s, t] of segsOf(arrows[j])) if (segsCross(p, q, s, t)) n++;
    if (n) {
      crossings += n;
      add('warning', 'arrow-crossing', `${arrows[i].id} crosses ${arrows[j].id}${n > 1 ? ` ${n}×` : ''}`, [arrows[i].id, arrows[j].id], 'reorder nodes or reroute one arrow');
    }
  }

  // 5) bindings that point nowhere
  for (const a of lines) for (const key of ['startBinding', 'endBinding'] as const) {
    const id = a[key]?.elementId;
    if (id && !byId[id]) add('error', 'dangling-binding', `${a.id}.${key} points to missing element ${id}`, [a.id]);
  }

  const errors = issues.filter((i) => i.severity === 'error').length;
  const warnings = issues.length - errors;
  return {
    ok: errors === 0,
    score: Math.max(0, 100 - errors * 10 - warnings * 2),
    summary: `${errors} error(s), ${warnings} warning(s), ${crossings} arrow crossing(s); ${leaves.length} shapes, ${groups.length} groups, ${connectors.length} connectors`,
    issues,
  };
}

export function formatReport(r: LintReport): string {
  return [
    `${r.ok ? '✔' : '✖'} score ${r.score}/100 — ${r.summary}`,
    ...r.issues.map((i) => `  ${i.severity === 'error' ? 'E' : 'W'} [${i.code}] ${i.message}${i.fix ? `\n      fix: ${i.fix}` : ''}`),
  ].join('\n');
}
