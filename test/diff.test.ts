import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildDiff, describeDiff, diffGraphs, globToRegExp, isDiagramSource, prReport, PR_MARKER, readGraph, type GraphInput } from '../src/index.js';
import { readJson, readText } from './helpers.js';

function edited(): GraphInput {
  const g = structuredClone(readJson('examples/checkout.json')) as GraphInput;
  g.nodes = g.nodes.filter((n) => n.id !== 'mail');
  g.edges = g.edges!.filter((e) => e.to !== 'mail');
  g.nodes.push({ id: 'fraud', label: 'Fraud check', kind: 'service', group: 'core' });
  g.edges!.push({ from: 'pay', to: 'fraud', label: 'score' });
  g.nodes.find((n) => n.id === 'db')!.label = 'Postgres';
  g.edges!.find((e) => e.from === 'order' && e.to === 'db')!.label = 'upsert';
  return g;
}

describe('diagram diff', () => {
  it('classifies boxes and arrows', () => {
    const d = diffGraphs(readJson('examples/checkout.json'), edited());
    expect(d.nodes).toMatchObject({ fraud: 'added', mail: 'removed', db: 'changed', order: 'same' });
    expect(d.summary).toEqual({ nodes: { added: 1, removed: 1, changed: 1 }, edges: { added: 1, removed: 1, changed: 1 } });
    expect(describeDiff(d)).toBe('+1 box, −1 box, 1 box changed, +1 arrow, −1 arrow, 1 arrow changed');
    expect(d.graph.nodes.find((n) => n.id === 'db')!.caption).toBe('was: MongoDB');
    expect(d.graph.edges!.find((e) => e.from === 'order' && e.to === 'db')!.label).toBe('insert → upsert');
    expect(diffGraphs(readJson('examples/checkout.json'), readJson('examples/checkout.json')).same).toBe(true);
  });

  it('a new file is all added, a deleted one all removed', () => {
    expect(describeDiff(diffGraphs(undefined, readJson('examples/checkout.json')))).toMatch(/^\+10 boxes, \+9 arrows$/);
    expect(describeDiff(diffGraphs(readJson('examples/checkout.json'), undefined))).toMatch(/^−10 boxes, −9 arrows$/);
  });

  it('draws one lint-clean diagram colored by change', async () => {
    const r = await buildDiff(readJson('examples/checkout.json'), edited());
    expect(r.report.issues.filter((i) => i.severity === 'error')).toEqual([]);
    const fill = (id: string) => r.excalidraw.elements.find((e) => e.id === `node:${id}`)!.backgroundColor;
    expect(fill('fraud')).toBe('#ebfbee');
    expect(fill('mail')).toBe('#fff5f5');
    expect(fill('db')).toBe('#fff9db');
    expect(fill('order')).toBe('#f8f9fa');
    expect(r.excalidraw.elements.find((e) => e.id === 'node:mail')!.strokeStyle).toBe('dashed');
  });

  it('reads graph JSON, Mermaid flowcharts and Excalidraw; recognises diagram sources', async () => {
    expect(readGraph(readText('examples/pipeline.mmd'), 'pipeline.mmd').nodes.length).toBeGreaterThan(2);
    const ex = (await buildDiff(undefined, readJson('examples/checkout.json'))).excalidraw;
    expect(readGraph(JSON.stringify(ex), 'x.excalidraw').nodes.length).toBe(10);
    expect(isDiagramSource('a.json', '{"nodes":[{"id":"a","label":"A"}]}')).toBe(true);
    expect(isDiagramSource('package.json', '{"name":"x"}')).toBe(false);
    expect(isDiagramSource('seq.mmd', 'sequenceDiagram\n A->>B: hi')).toBe(false);
  });

  it('globs', () => {
    expect(globToRegExp('docs/**').test('docs/a/b.json')).toBe(true);
    expect(globToRegExp('docs/*.json').test('docs/a/b.json')).toBe(false);
    expect(globToRegExp('**/*.mmd').test('x/y/z.mmd')).toBe(true);
  });
});

describe('draftr pr', () => {
  it('diffs the diagrams and extracted graphs a branch changed, and writes a report', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'draftr-pr-'));
    const sh = (...a: string[]) => execFileSync('git', a, { cwd: dir, encoding: 'utf8' });
    sh('init', '-q', '-b', 'main'); sh('config', 'user.email', 't@t'); sh('config', 'user.name', 't');
    mkdirSync(join(dir, 'docs')); mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'docs/arch.json'), readText('examples/checkout.json'));
    writeFileSync(join(dir, 'docs/same.mmd'), 'flowchart LR\n a --> b\n');
    writeFileSync(join(dir, 'src/a.ts'), "import { b } from './b';\n");
    writeFileSync(join(dir, 'src/b.ts'), 'export const b = 1;\n');
    writeFileSync(join(dir, 'package.json'), '{"name":"x"}\n');
    sh('add', '-A'); sh('commit', '-q', '-m', 'base');
    sh('checkout', '-q', '-b', 'feature');
    writeFileSync(join(dir, 'docs/arch.json'), JSON.stringify(edited()));
    writeFileSync(join(dir, 'docs/new.mmd'), 'flowchart LR\n x[New] --> y[Thing]\n');
    writeFileSync(join(dir, 'src/b.ts'), "import { c } from './c';\nexport const b = c;\n");
    writeFileSync(join(dir, 'src/c.ts'), 'export const c = 1;\n');
    writeFileSync(join(dir, 'package.json'), '{"name":"y"}\n');
    sh('add', '-A'); sh('commit', '-q', '-m', 'feature');

    const out = join(dir, '.out');
    const r = await prReport({ base: 'main', extract: ['deps:src'], out, cwd: dir, imageBase: 'https://img/{file}?raw=true' });
    expect(r.items.map((i) => `${i.name}: ${describeDiff(i.diff)}`)).toEqual([
      'docs/arch.json: +1 box, −1 box, 1 box changed, +1 arrow, −1 arrow, 1 arrow changed',
      'docs/new.mmd: +2 boxes, +1 arrow',
      'deps of src: +1 box, +1 arrow',
    ]);
    expect(r.items[1].files.before).toBeUndefined(); // new file: no "before"
    const md = readFileSync(join(out, 'report.md'), 'utf8');
    expect(md.startsWith(PR_MARKER)).toBe(true);
    expect(md).toContain('![docs/arch.json diff](https://img/docs-arch.json.diff.svg?raw=true)');
    expect(readFileSync(join(out, 'docs-arch.json.diff.svg'), 'utf8')).toMatch(/^<svg/);
    expect(sh('worktree', 'list').trim().split('\n')).toHaveLength(1); // temporary checkouts cleaned up
  }, 60_000);
});
