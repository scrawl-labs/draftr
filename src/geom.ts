// Shape outlines: ELK routes edges to bounding boxes; these move endpoints onto the real outline.
import type { Box, Pt } from './types.js';

export type Outline = 'rectangle' | 'ellipse' | 'diamond';

function outside(shape: Outline, b: Box, p: Pt): number {
  const a = b.w / 2, c = b.h / 2, dx = Math.abs(p.x - (b.x + a)), dy = Math.abs(p.y - (b.y + c));
  if (shape === 'diamond') return dx / a + dy / c - 1;
  if (shape === 'ellipse') return (dx / a) ** 2 + (dy / c) ** 2 - 1;
  return Math.max(dx - a, dy - c);
}

/** ELK routes to bounding boxes; slide an endpoint along its last segment onto an ellipse/diamond outline. */
export function clipToOutline(from: Pt, end: Pt, shape: Outline, b: Box): Pt {
  if (shape === 'rectangle') return end;
  const at = (t: number) => ({ x: from.x + (end.x - from.x) * t, y: from.y + (end.y - from.y) * t });
  if (outside(shape, b, from) <= 0) return end;
  let lo = 0, hi = 1;
  while (outside(shape, b, at(hi)) > 0 && hi < 4) hi += 0.25;
  if (outside(shape, b, at(hi)) > 0) return end;
  for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (outside(shape, b, at(m)) > 0) lo = m; else hi = m; }
  return at(lo);
}

