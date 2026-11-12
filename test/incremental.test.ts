import { describe, expect, it } from 'vitest';
import { build, pinsFromExcalidraw, type ExcalidrawDoc, type GraphInput } from '../src/index.js';
import { readJson, rng } from './helpers.js';

/** Drag a node the way a person would in Excalidraw: the shape and everything grouped with it. */
function drag(doc: ExcalidrawDoc, id: string, dx: number, dy: number): ExcalidrawDoc {
  const d = structuredClone(doc);
  const shape = d.elements.find((e) => e.customData?.nodeId === id && e.customData?.role === 'node')!;
  const grp = (shape.groupIds as string[] | undefined)?.[0];
  for (const e of d.elements) {
    if (e === shape || (grp && (e.groupIds as string[] | undefined)?.includes(grp)) || e.containerId === shape.id) { e.x += dx; e.y += dy; }
  }
  return d;
}
const shapeOf = (doc: ExcalidrawDoc, id: string) => doc.elements.find((e) => e.customData?.nodeId === id && e.customData?.role === 'node')!;

describe('incremental layout', () => {
  it('records where draftr placed each box', async () => {
    const { excalidraw } = await build(readJson('examples/checkout.json'));
    const s = shapeOf(excalidraw, 'order');
    expect(s.customData!.placed).toEqual({ x: s.x, y: s.y });
    expect(pinsFromExcalidraw(excalidraw)).toEqual({});
    expect(Object.keys(pinsFromExcalidraw(excalidraw, 'all'))).toHaveLength(10);
  });

  it('rebuilding an untouched file changes nothing', async () => {
    const g = readJson('examples/checkout.json');
    const v1 = await build(g);
    const v2 = await build(g, { keep: { from: v1.excalidraw } });
    expect(v2.file.content).toBe(v1.file.content);
  });

  it('keeps the box a person moved and lays out the rest around it', async () => {
    const g = readJson('examples/checkout.json') as GraphInput;
    const v1 = await build(g);
    const edited = drag(v1.excalidraw, 'stripe', -200, 260);
    g.nodes.push({ id: 'fraud', label: 'Fraud check', kind: 'service', group: 'core' });
    g.edges!.push({ from: 'pay', to: 'fraud', label: 'score' });
    const v2 = await build(g, { keep: { from: edited } });
    expect(v2.report.issues.filter((i) => i.severity === 'error')).toEqual([]);
    // the canvas may shift as a whole (measure it on a box that was laid out afresh); the moved box keeps its spot
    const fresh = await build(g);
    const shift = { x: shapeOf(v2.excalidraw, 'user').x - shapeOf(fresh.excalidraw, 'user').x, y: shapeOf(v2.excalidraw, 'user').y - shapeOf(fresh.excalidraw, 'user').y };
    const before = shapeOf(edited, 'stripe'), after = shapeOf(v2.excalidraw, 'stripe');
    expect(after.x - shift.x).toBeCloseTo(before.x, 0);
    expect(after.y - shift.y).toBeCloseTo(before.y, 0);
    // the next rebuild treats the kept spot as draftr's own
    expect(after.customData!.placed).toEqual({ x: after.x, y: after.y });
  });

  it('keep all: every existing box stays, new boxes fit around them', async () => {
    const g = readJson('examples/checkout.json') as GraphInput;
    const v1 = await build(g);
    g.nodes.push({ id: 'sms', label: 'SMS worker', kind: 'service', group: 'async' }, { id: 'audit', label: 'Audit log', kind: 'storage' });
    g.edges!.push({ from: 'q', to: 'sms', style: 'dashed' }, { from: 'order', to: 'audit' });
    const v2 = await build(g, { keep: { from: v1.excalidraw, mode: 'all' } });
    expect(v2.report.issues.filter((i) => i.severity === 'error')).toEqual([]);
    const ref1 = shapeOf(v1.excalidraw, 'user'), ref2 = shapeOf(v2.excalidraw, 'user');
    for (const id of ['web', 'gw', 'order', 'pay', 'db', 'q', 'mail', 'inv', 'stripe']) {
      const a = shapeOf(v1.excalidraw, id), b = shapeOf(v2.excalidraw, id);
      expect([b.x - ref2.x, b.y - ref2.y], id).toEqual([a.x - ref1.x, a.y - ref1.y]);
    }
  });

  it('treats every box as placed by hand in files without placement records', async () => {
    const g = readJson('examples/checkout.json');
    const v1 = await build(g);
    const old = structuredClone(v1.excalidraw);
    for (const e of old.elements) if (e.customData) delete e.customData.placed;
    expect(Object.keys(pinsFromExcalidraw(old))).toHaveLength(10);
  });

  it('stays free of lint errors for 20 random graphs with a dragged box and new nodes', async () => {
    const kinds = ['service', 'database', 'queue', 'external', 'user', 'client', 'storage', 'decision', 'note'] as const;
    for (let seed = 1; seed <= 20; seed++) {
      const r = rng(seed);
      const groups = [{ id: 'g1', label: 'Region' }, { id: 'g2', label: 'Cluster', parent: 'g1' }, { id: 'g3', label: 'Data' }];
      const mk = (i: number) => ({ id: `n${i}`, label: r() > 0.7 ? `A fairly long service name ${i}` : `svc ${i}`, kind: kinds[Math.floor(r() * kinds.length)], group: r() > 0.5 ? groups[Math.floor(r() * 3)].id : undefined });
      const nodes = Array.from({ length: 5 + Math.floor(r() * 10) }, (_, i) => mk(i));
      const edges: NonNullable<GraphInput['edges']> = [];
      for (let i = 1; i < nodes.length; i++) edges.push({ from: `n${Math.floor(r() * i)}`, to: `n${i}`, label: r() > 0.6 ? 'calls' : undefined });
      const g = { direction: r() > 0.5 ? 'RIGHT' : 'DOWN', nodes, edges, groups } as GraphInput;
      const v1 = await build(g);
      const victim = `n${Math.floor(r() * nodes.length)}`;
      const edited = drag(v1.excalidraw, victim, Math.round((r() - 0.5) * 600), Math.round((r() - 0.5) * 400));
      const n = nodes.length;
      nodes.push(mk(n), mk(n + 1));
      edges.push({ from: `n${n}`, to: `n${Math.floor(r() * n)}` }, { from: `n${Math.floor(r() * n)}`, to: `n${n + 1}`, label: 'new' });
      for (const mode of ['moved', 'all'] as const) {
        const res = await build(g, { keep: { from: edited, mode } });
        // only boxes the person placed may still collide (with each other or a group they were dropped on)
        const placedByHand = (el: string) => mode === 'all' ? !el.endsWith(`:n${n}`) && !el.endsWith(`:n${n + 1}`) : el.endsWith(`:${victim}`);
        const errs = res.report.issues.filter((i) => i.severity === 'error' && !i.elements.filter((x) => x.startsWith('node:')).every(placedByHand));
        expect(errs, `seed ${seed} ${mode}`).toEqual([]);
      }
    }
  }, 120_000);
});
