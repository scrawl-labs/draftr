import { describe, expect, it } from 'vitest';
import { extractGraph, tidy } from '../src/index.js';
import { readJson } from './helpers.js';

describe('tidy', () => {
  it('recovers labels, kinds, groups and edge labels from a messy hand-written file', () => {
    const g = extractGraph(readJson('examples/messy.excalidraw'));
    const byId = Object.fromEntries(g.nodes.map((n) => [n.id, n]));
    expect(byId.auth.label).toBe('Auth service (JWT)'); // label that spilled out of its box
    expect(byId.pg.kind).toBe('database');
    expect(byId.kafka.kind).toBe('queue');
    expect(byId.mobile.kind).toBe('client');
    expect(byId.gw.group).toBe('frame');
    expect(g.groups![0].label).toBe('Backend');
    expect(g.edges!.find((e) => e.from === 'orders' && e.to === 'kafka')).toMatchObject({ label: 'order.created', style: 'dashed' });
    expect(g.edges!.find((e) => e.from === 'mobile')!.label).toBe('HTTPS');
  });

  it('turns a failing file into a clean one', async () => {
    const res = await tidy(readJson('examples/messy.excalidraw'));
    expect(res.before.ok).toBe(false);
    expect(res.report.issues).toEqual([]);
  });

  it('round-trips draftr output', async () => {
    const res = await tidy(readJson('examples/messy.excalidraw'));
    const again = extractGraph(res.excalidraw);
    expect(again.nodes.map((n) => n.label).sort()).toEqual(extractGraph(readJson('examples/messy.excalidraw')).nodes.map((n) => n.label).sort());
  });
});
