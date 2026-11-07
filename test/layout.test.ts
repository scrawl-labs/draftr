import { describe, expect, it } from 'vitest';
import { build, parseGraph, type GraphInput } from '../src/index.js';
import { clipToOutline } from '../src/excalidraw.js';
import { readJson, rng } from './helpers.js';

describe('graph layout', () => {
  it('lays out the checkout example with zero lint findings', async () => {
    const { report, excalidraw } = await build(readJson('examples/checkout.json'));
    expect(report.issues).toEqual([]);
    const arrow = excalidraw.elements.find((e) => e.type === 'arrow' && e.startBinding?.elementId === 'node:order');
    expect(arrow).toBeTruthy();
    // shapes know about the arrows bound to them (so dragging in Excalidraw keeps them attached)
    const order = excalidraw.elements.find((e) => e.id === 'node:order')!;
    expect(order.boundElements!.some((b) => b.type === 'arrow')).toBe(true);
  });

  it('produces lint-clean output for 40 random graphs (nested groups, labels, all kinds)', async () => {
    const kinds = ['service', 'database', 'queue', 'external', 'user', 'client', 'storage', 'decision', 'note'] as const;
    for (let seed = 1; seed <= 40; seed++) {
      const r = rng(seed);
      const groups = [{ id: 'g1', label: 'Region' }, { id: 'g2', label: 'Cluster', parent: 'g1' }, { id: 'g3', label: '데이터 계층' }];
      const nodes = Array.from({ length: 5 + Math.floor(r() * 12) }, (_, i) => ({
        id: `n${i}`,
        label: r() > 0.75 ? `A fairly long service name number ${i}` : r() > 0.5 ? `서비스 ${i}` : `svc ${i}`,
        kind: kinds[Math.floor(r() * kinds.length)],
        group: r() > 0.5 ? groups[Math.floor(r() * groups.length)].id : undefined,
      }));
      const edges: NonNullable<GraphInput['edges']> = [];
      for (let i = 1; i < nodes.length; i++) {
        edges.push({ from: `n${Math.floor(r() * i)}`, to: `n${i}`, label: r() > 0.6 ? 'calls' : undefined, style: r() > 0.7 ? 'dashed' : 'solid' });
        if (r() > 0.8) edges.push({ from: `n${i}`, to: `n${Math.floor(r() * i)}` });
      }
      const { report } = await build({ direction: r() > 0.5 ? 'RIGHT' : 'DOWN', nodes, edges, groups });
      const errors = report.issues.filter((i) => i.severity === 'error');
      expect(errors, `seed ${seed}`).toEqual([]);
    }
  }, 60_000);

  it('rejects broken references with every problem listed', () => {
    expect(() => parseGraph({ nodes: [{ id: 'a', label: 'A', group: 'nope' }], edges: [{ from: 'a', to: 'b' }] }))
      .toThrow(/unknown group "nope"[\s\S]*unknown node "b"/);
  });

  it('rejects group cycles', () => {
    expect(() => parseGraph({ nodes: [{ id: 'a', label: 'A' }], groups: [{ id: 'x', label: 'X', parent: 'y' }, { id: 'y', label: 'Y', parent: 'x' }] }))
      .toThrow(/group cycle/);
  });

  it('clips edge endpoints to diamond and ellipse outlines', () => {
    const box = { x: 0, y: 0, w: 200, h: 100 };
    const p = clipToOutline({ x: -50, y: 50 }, { x: 0, y: 50 }, 'diamond', box);
    expect(p.x).toBeCloseTo(0, 0); // left corner of the diamond at mid-height
    const q = clipToOutline({ x: -50, y: 25 }, { x: 0, y: 25 }, 'diamond', box);
    expect(q.x).toBeCloseTo(50, 0); // |x-100|/100 + |25-50|/50 = 1  ->  x = 50
    const e = clipToOutline({ x: 100, y: -50 }, { x: 100, y: 0 }, 'ellipse', box);
    expect(e.y).toBeCloseTo(0, 0);
    expect(clipToOutline({ x: -5, y: 5 }, { x: 0, y: 5 }, 'rectangle', box)).toEqual({ x: 0, y: 5 });
  });
});
