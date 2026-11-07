import { describe, expect, it } from 'vitest';
import { lint } from '../src/index.js';
import type { ExcalidrawDoc, ExElement } from '../src/types.js';
import { readJson } from './helpers.js';

const el = (o: Partial<ExElement> & Pick<ExElement, 'id' | 'type'>): ExElement => ({
  x: 0, y: 0, width: 100, height: 60, strokeColor: '#000', backgroundColor: 'transparent', strokeWidth: 2, strokeStyle: 'solid', ...o,
});
const docOf = (...elements: ExElement[]): ExcalidrawDoc => ({ type: 'excalidraw', version: 2, elements });
const codes = (d: ExcalidrawDoc) => lint(d).issues.map((i) => i.code);

describe('lint', () => {
  it('catches every planted defect in a hand-written file', () => {
    const found = codes(readJson('examples/bad-handwritten.excalidraw'));
    for (const c of ['shape-overlap', 'group-boundary', 'text-overflow', 'text-over-shape', 'arrow-through-shape', 'arrow-dangling', 'arrow-crossing'])
      expect(found).toContain(c);
  });

  it('flags the messy example and points at concrete fixes', () => {
    const r = lint(readJson('examples/messy.excalidraw'));
    expect(r.ok).toBe(false);
    const spill = r.issues.find((i) => i.code === 'text-over-shape' && i.elements.includes('auth'));
    expect(spill?.fix).toMatch(/widen auth to ≥\d+px/);
  });

  it('treats free text fully inside a shape as its label, not an overlap', () => {
    const d = docOf(el({ id: 'box', type: 'rectangle', width: 200 }), el({ id: 't', type: 'text', x: 10, y: 20, width: 80, height: 20, text: 'Hello', fontSize: 16 }));
    expect(codes(d)).toEqual([]);
  });

  it('measures CJK text as wide', () => {
    const d = docOf(
      el({ id: 'box', type: 'rectangle', width: 120 }),
      el({ id: 't', type: 'text', containerId: 'box', text: '이메일 발송 워커 서비스', fontSize: 16 }),
    );
    expect(codes(d)).toContain('text-overflow');
  });

  it('reports crowding and dangling bindings', () => {
    const d = docOf(
      el({ id: 'a', type: 'rectangle' }),
      el({ id: 'b', type: 'rectangle', x: 105 }),
      el({ id: 'arr', type: 'arrow', x: 0, y: 200, points: [[0, 0], [100, 0]], startBinding: { elementId: 'ghost' }, endArrowhead: 'arrow' }),
    );
    const c = codes(d);
    expect(c).toContain('shape-crowded');
    expect(c).toContain('dangling-binding');
  });

  it('does not count lifelines as connectors', () => {
    const d = docOf(
      el({ id: 'life', type: 'line', x: 50, y: 0, points: [[0, 0], [0, 300]], customData: { role: 'lifeline' } }),
      el({ id: 'msg', type: 'arrow', x: 0, y: 100, points: [[0, 0], [50, 0]], endArrowhead: 'arrow' }),
      el({ id: 'msg2', type: 'arrow', x: 50, y: 150, points: [[0, 0], [-50, 0]], endArrowhead: 'arrow' }),
      el({ id: 'life2', type: 'line', x: 0, y: 0, points: [[0, 0], [0, 300]], customData: { role: 'lifeline' } }),
    );
    expect(codes(d)).toEqual([]);
  });
});
