import { createTLSchema } from '@tldraw/tlschema';
import { describe, expect, it } from 'vitest';
import { build, buildMermaid } from '../src/index.js';
import { TLDRAW_SCHEMA } from '../src/tldraw.js';
import { readJson, readText } from './helpers.js';

type Rec = { id: string; typeName: string; type?: string; parentId?: string; index?: string; props?: Record<string, any>; fromId?: string; toId?: string; meta?: any };
const schema = createTLSchema();
const parse = (content: string) => JSON.parse(content) as { tldrawFileFormatVersion: number; schema: unknown; records: Rec[] };

function validateAll(records: Rec[]) {
  const errors: string[] = [];
  for (const r of records) {
    try { (schema.types as any)[r.typeName].validate(r); } catch (e) { errors.push(`${r.id}: ${(e as Error).message}`); }
  }
  return errors;
}

function checkReferences(records: Rec[]) {
  const ids = new Set(records.map((r) => r.id));
  expect(ids.size).toBe(records.length);
  for (const r of records) {
    if (r.typeName === 'shape') expect(ids.has(r.parentId!), `${r.id} parent ${r.parentId}`).toBe(true);
    if (r.typeName === 'binding') { expect(ids.has(r.fromId!)).toBe(true); expect(ids.has(r.toId!)).toBe(true); }
    if (r.typeName === 'shape' && r.type === 'image') expect(ids.has(r.props!.assetId)).toBe(true);
  }
  // sibling order keys must be unique
  const seen = new Set<string>();
  for (const r of records.filter((x) => x.typeName === 'shape')) {
    const k = `${r.parentId}|${r.index}`;
    expect(seen.has(k), k).toBe(false);
    seen.add(k);
  }
  // tldraw groups need at least two children
  for (const g of records.filter((r) => r.typeName === 'shape' && r.type === 'group')) expect(records.filter((r) => r.parentId === g.id).length).toBeGreaterThanOrEqual(2);
}

describe('tldraw export', () => {
  it('targets the schema of the tldraw version it was written against', () => {
    expect(TLDRAW_SCHEMA).toEqual(schema.serialize());
  });

  it('writes records that pass tldraw\'s own validators, with every reference resolved', async () => {
    const { file } = await build(readJson('examples/checkout.json'), { format: 'tldraw' });
    expect(file).toMatchObject({ format: 'tldraw', ext: '.tldr' });
    const doc = parse(file.content);
    expect(doc.tldrawFileFormatVersion).toBe(1);
    expect(validateAll(doc.records)).toEqual([]);
    checkReferences(doc.records);
  });

  it('turns groups into frames, boxes into grouped geo + icon + text, edges into bound elbow arrows', async () => {
    const { file, model } = await build(readJson('examples/checkout.json'), { format: 'tldraw' });
    const recs = parse(file.content).records;
    expect(recs.filter((r) => r.type === 'frame').map((r) => r.props!.name).sort()).toEqual(['Async workers', 'Core services', 'Edge']);
    const db = recs.find((r) => r.id === 'shape:node-db')!;
    expect(db.props).toMatchObject({ geo: 'rectangle', color: 'orange', fill: 'solid' });
    const order = recs.find((r) => r.id === 'shape:node-order')!;
    expect(order.props).toMatchObject({ color: 'blue', fill: 'fill' }); // highlight
    expect(recs.find((r) => r.id === 'shape:node-db-caption')!.props!.richText.content[0].content[0].text).toBe('Database');
    const arrows = recs.filter((r) => r.typeName === 'shape' && r.type === 'arrow');
    expect(arrows).toHaveLength(model.edges.length);
    expect(arrows.every((a) => a.props!.kind === 'elbow')).toBe(true);
    expect(recs.filter((r) => r.typeName === 'binding')).toHaveLength(model.edges.length * 2);
    const labelled = arrows.find((a) => a.meta.draftr.id === 'e5')!;
    expect(labelled.props!.richText.content[0].content[0].text).toBe('insert');
  });

  it('exports sequence diagrams and flowcharts with diamonds', async () => {
    for (const [src, opts] of [[readText('examples/login.mmd'), {}], [readText('examples/pipeline.mmd'), {}]] as const) {
      const recs = parse((await buildMermaid(src, { ...opts, format: 'tldraw' })).file.content).records;
      expect(validateAll(recs)).toEqual([]);
      checkReferences(recs);
    }
    const seq = parse((await buildMermaid(readText('examples/login.mmd'), { format: 'tldraw' })).file.content).records;
    expect(seq.filter((r) => r.typeName === 'shape' && r.type === 'line')).toHaveLength(5); // lifelines
    expect(seq.filter((r) => r.meta?.draftr?.role === 'message-label')).toHaveLength(8);
  });

  it('keeps valid order keys past 61 shapes', async () => {
    const nodes = Array.from({ length: 80 }, (_, i) => ({ id: `n${i}`, label: `Service ${i}` }));
    const edges = nodes.slice(1).map((n, i) => ({ from: `n${Math.floor(i / 3)}`, to: n.id }));
    const recs = parse((await build({ nodes, edges }, { format: 'tldraw' })).file.content).records;
    expect(recs.filter((r) => r.typeName === 'shape').length).toBeGreaterThan(300);
    expect(validateAll(recs)).toEqual([]);
    checkReferences(recs);
  });

  it('handles Korean and odd characters in text and ids', async () => {
    const recs = parse((await build({ nodes: [{ id: 'a b/c', label: '결제 서비스 & <API>' }], groups: [] }, { format: 'tldraw' })).file.content).records;
    expect(validateAll(recs)).toEqual([]);
    expect(JSON.stringify(recs)).toContain('결제 서비스 & <API>');
  });
});
