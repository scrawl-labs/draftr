import { XMLParser } from 'fast-xml-parser';
import { describe, expect, it } from 'vitest';
import { build, buildMermaid } from '../src/index.js';
import { readJson, readText } from './helpers.js';

type Cell = { id: string; parent?: string; vertex?: string; edge?: string; source?: string; target?: string; style?: string; value?: string; mxGeometry?: Record<string, unknown> };

function cellsOf(xml: string): Cell[] {
  const doc = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '' }).parse(xml);
  const cells = doc.mxfile.diagram.mxGraphModel.root.mxCell;
  return Array.isArray(cells) ? cells : [cells];
}
const styleOf = (c: Cell) => Object.fromEntries((c.style ?? '').split(';').filter(Boolean).map((kv) => { const i = kv.indexOf('='); return i < 0 ? [kv, ''] : [kv.slice(0, i), kv.slice(i + 1)]; }));

describe('draw.io export', () => {
  it('writes a well-formed mxfile where every reference resolves', async () => {
    const { file } = await build(readJson('examples/checkout.json'), { format: 'drawio' });
    expect(file).toMatchObject({ format: 'drawio', ext: '.drawio' });
    const cells = cellsOf(file.content);
    const ids = new Set(cells.map((c) => c.id));
    expect(ids.size).toBe(cells.length);
    expect(ids.has('0') && ids.has('1')).toBe(true);
    for (const c of cells) {
      if (c.parent) expect(ids.has(c.parent), `${c.id} parent ${c.parent}`).toBe(true);
      if (c.source) expect(ids.has(c.source)).toBe(true);
      if (c.target) expect(ids.has(c.target)).toBe(true);
    }
    expect(cells.filter((c) => c.vertex && c.id.startsWith('node-'))).toHaveLength(10);
    expect(cells.filter((c) => c.edge)).toHaveLength(9);
  });

  it('nests boxes in their group containers with relative coordinates', async () => {
    const { file, model } = await build(readJson('examples/checkout.json'), { format: 'drawio' });
    const cells = cellsOf(file.content);
    const order = cells.find((c) => c.id === 'node-order')!;
    expect(order.parent).toBe('group-core');
    const core = model.groups.find((g) => g.id === 'core')!;
    const n = model.nodes.find((x) => x.id === 'order')!;
    expect(Number(order.mxGeometry!.x)).toBeCloseTo(n.x - core.x, 1);
    expect(styleOf(cells.find((c) => c.id === 'group-core')!).container).toBe('1');
  });

  it('carries icons inside the box, theme colors, captions and highlight', async () => {
    const { file } = await build(readJson('examples/checkout.json'), { format: 'drawio' });
    const cells = cellsOf(file.content);
    const db = styleOf(cells.find((c) => c.id === 'node-db')!);
    expect(db.shape).toBe('label');
    expect(db.image).toMatch(/^data:image\/svg\+xml,[A-Za-z0-9+/=]+$/); // no ";base64" — draw.io styles use ';' as separator
    expect(Buffer.from(db.image.split(',')[1], 'base64').toString()).toMatch(/^<svg/);
    expect(db.fillColor).toBe('#fff3e6');
    expect(cells.find((c) => c.id === 'node-db')!.value).toContain('Database');
    const order = styleOf(cells.find((c) => c.id === 'node-order')!);
    expect(order.fillColor).toBe('#3b5bdb');
    expect(order.fontColor).toBe('#ffffff');
  });

  it('keeps draftr routes as waypoints and labels on the line', async () => {
    const { file, model } = await build(readJson('examples/checkout.json'), { format: 'drawio' });
    const cells = cellsOf(file.content);
    for (const e of model.edges) {
      const c = cells.find((x) => x.id === `edge-${e.id}`)!;
      const st = styleOf(c);
      expect(st.edgeStyle).toBe('orthogonalEdgeStyle');
      expect(Number(st.exitX)).toBeGreaterThanOrEqual(0); expect(Number(st.exitX)).toBeLessThanOrEqual(1);
      const pts = (c.mxGeometry as { Array?: { mxPoint: unknown } }).Array?.mxPoint;
      const n = pts ? (Array.isArray(pts) ? pts.length : 1) : 0;
      expect(n).toBe(e.points.length - 2);
      if (e.label) {
        expect(c.value).toBe(e.label);
        const x = Number(c.mxGeometry!.x);
        expect(x).toBeGreaterThanOrEqual(-1); expect(x).toBeLessThanOrEqual(1);
      }
    }
  });

  it('exports sequence diagrams with free-floating lifelines and messages', async () => {
    const { file } = await buildMermaid(readText('examples/login.mmd'), { format: 'drawio' });
    const cells = cellsOf(file.content);
    const life = cells.find((c) => c.id === 'lifeline-lifeline:U')!;
    expect(styleOf(life).endArrow).toBe('none');
    expect(life.source).toBeUndefined();
    const self = cells.find((c) => c.id === 'message-msg:4')!;
    expect(styleOf(self).edgeStyle).toBe('none');
  });

  it('escapes text', async () => {
    const { file } = await build({ nodes: [{ id: 'a', label: 'A & <B> "C"' }] }, { format: 'drawio' });
    expect(cellsOf(file.content).find((c) => c.id === 'node-a')!.value).toContain('A &amp; &lt;B&gt;');
  });
});
