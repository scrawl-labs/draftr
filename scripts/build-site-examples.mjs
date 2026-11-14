// Example images for the landing page's "New in 0.3" section, drawn by draftr itself.
// Run after `pnpm build`: node scripts/build-site-examples.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const { build, buildDiff, buildTrace, extract } = await import(new URL('dist/index.js', root).href);
const out = (name, svg) => writeFileSync(new URL(`site/assets/${name}`, root), svg);
const read = (p) => readFileSync(new URL(p, root), 'utf8');
const checkout = JSON.parse(read('examples/checkout.json'));

// 1) keep your edits: a person drags a box, the graph grows, draftr rebuilds around it
const small = {
  direction: 'RIGHT',
  nodes: [
    { id: 'web', label: 'Web app', kind: 'client' }, { id: 'api', label: 'API', kind: 'service', highlight: true },
    { id: 'db', label: 'Postgres', kind: 'database' }, { id: 'q', label: 'jobs', kind: 'queue' }, { id: 'worker', label: 'Worker', kind: 'service' },
  ],
  edges: [{ from: 'web', to: 'api' }, { from: 'api', to: 'db' }, { from: 'api', to: 'q', style: 'dashed' }, { from: 'q', to: 'worker', style: 'dashed' }],
};
const v1 = await build(small);
const edited = structuredClone(v1.excalidraw);
const drag = (id, dx, dy) => {
  const shape = edited.elements.find((e) => e.customData?.nodeId === id && e.customData?.role === 'node');
  const grp = shape.groupIds?.[0];
  for (const e of edited.elements) if (e === shape || (grp && e.groupIds?.includes(grp)) || e.containerId === shape.id) { e.x += dx; e.y += dy; }
};
drag('db', 0, -110);
// both pictures go through the same renderer: the edit as draftr reads it back, then the rebuild
const before = await build(small, { keep: { from: edited, mode: 'all' } });
const grown = structuredClone(small);
grown.nodes.push({ id: 'cache', label: 'Redis', kind: 'database' });
grown.edges.push({ from: 'api', to: 'cache', label: 'cache' });
const kept = await build(grown, { keep: { from: edited, mode: 'all' } });
out('keep-before.svg', before.svg);
out('keep-after.svg', kept.svg);

// 2) diagrams from code
const deps = extract('deps', new URL('test/fixtures/extract/express', root).pathname, { external: true });
out('extract-deps.svg', (await build(deps.graph)).svg);

// 3) traces
out('trace.svg', (await buildTrace(read('test/fixtures/traces/checkout.otlp.json'))).svg);

// 4) diagram diff
const after = structuredClone(checkout);
after.nodes = after.nodes.filter((n) => n.id !== 'mail');
after.edges = after.edges.filter((e) => e.to !== 'mail');
after.nodes.push({ id: 'fraud', label: 'Fraud check', kind: 'service', group: 'core' }, { id: 'sms', label: 'SMS worker', kind: 'service', group: 'async' });
after.edges.push({ from: 'pay', to: 'fraud', label: 'score' }, { from: 'q', to: 'sms', style: 'dashed' });
after.nodes.find((n) => n.id === 'db').label = 'Postgres';
after.edges.find((e) => e.from === 'order' && e.to === 'db').label = 'upsert';
out('diff.svg', (await buildDiff(checkout, after)).svg);
console.log('wrote site/assets/{keep-before,keep-after,extract-deps,trace,diff}.svg');
