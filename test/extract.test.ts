import { describe, expect, it } from 'vitest';
import { build, extract, findRoutes, findSchema, type GraphInput } from '../src/index.js';
import { root } from './helpers.js';

const F = (d: string) => `${root}/test/fixtures/extract/${d}`;
const edgeSet = (g: GraphInput) => new Set((g.edges ?? []).map((e) => `${e.from} -> ${e.to}`));
const labels = (g: GraphInput) => g.nodes.map((n) => n.label);

describe('extract deps', () => {
  it('resolves relative, extension-mapped, index and tsconfig-alias imports; skips tests and type-only imports', () => {
    const { graph, notes } = extract('deps', F('express'), { allEdges: true });
    const e = edgeSet(graph);
    expect(e).toContain('m:src/server.ts -> m:src/routes/users.ts');
    expect(e).toContain('m:src/server.ts -> m:src/routes/orders.ts'); // './routes/orders.js' -> orders.ts
    expect(e).toContain('m:src/routes/orders.ts -> m:src/db/index.ts'); // '../db/index.js'
    expect(e).toContain('m:src/server.ts -> m:src/log.ts'); // '@/log' via tsconfig paths
    expect(e).not.toContain('m:src/routes/users.ts -> m:src/types.ts'); // import type
    expect(labels(graph)).not.toContain('server.ts'.replace('server', '__tests__/server'));
    expect(graph.nodes.some((n) => n.id.includes('__tests__'))).toBe(false);
    expect(notes.join(' ')).toMatch(/1 import cycle/);
    // the db <-> log cycle is highlighted
    expect(graph.edges!.filter((x) => x.highlight).map((x) => `${x.from} -> ${x.to}`).sort()).toEqual(['m:src/db/index.ts -> m:src/log.ts', 'm:src/log.ts -> m:src/db/index.ts']);
  });

  it('leaves out edges implied by others, but never cycle edges', () => {
    const all = edgeSet(extract('deps', F('express'), { allEdges: true }).graph);
    const reduced = edgeSet(extract('deps', F('express')).graph);
    expect(reduced.size).toBeLessThan(all.size);
    expect(reduced).not.toContain('m:src/server.ts -> m:src/log.ts'); // server -> users -> db -> log already says it
    expect(reduced).toContain('m:src/db/index.ts -> m:src/log.ts');
  });

  it('draws third-party packages on request', () => {
    const { graph } = extract('deps', F('express'), { external: true });
    expect(graph.nodes.filter((n) => n.kind === 'external').map((n) => n.label).sort()).toEqual(['express', 'pg']);
  });

  it('folds into directories when asked or when there are too many files', () => {
    const { graph } = extract('deps', F('express'), { by: 'dir' });
    expect(labels(graph).sort()).toEqual(['db', 'routes', 'src']);
    const small = extract('deps', F('express'), { maxNodes: 3 }).graph;
    expect(small.nodes.length).toBeLessThanOrEqual(3);
  });

  it('reads Python (absolute, relative, "from . import") and Go packages', () => {
    const py = edgeSet(extract('deps', F('py-deps'), { allEdges: true }).graph);
    expect(py).toContain('m:pkg/app.py -> m:pkg/core/engine.py'); // from pkg.core import engine
    expect(py).toContain('m:pkg/app.py -> m:pkg/core/models.py'); // from .core.models import User
    expect(py).toContain('m:pkg/app.py -> m:pkg/util.py'); // from . import util
    expect(py).toContain('m:pkg/core/engine.py -> m:pkg/core/models.py');
    const go = extract('deps', F('go-api'), { external: true }).graph;
    expect(edgeSet(go)).toContain('m:cmd/server/ -> m:internal/store/');
    expect(labels(go)).toContain('github.com/gin-gonic/gin');
    expect(labels(go)).not.toContain('net/http');
  });
});

describe('extract routes', () => {
  const list = (d: string) => findRoutes(F(d)).map((r) => `${r.method} ${r.path}`);

  it('Express: methods, router mounts, .route() chains; ignores comments', () => {
    expect(list('express').sort()).toEqual(['DELETE /api/orders/:id', 'GET /api/orders/:id', 'GET /api/users', 'GET /api/users/:id', 'GET /health', 'POST /api/orders', 'POST /api/users']);
  });

  it('NestJS, Next.js, FastAPI/Flask and Go', () => {
    expect(list('nest').sort()).toEqual(['DELETE /users/:id', 'GET /users', 'GET /users/:id', 'POST /users']);
    expect(list('next').sort()).toEqual(['ANY /api/legacy', 'GET /api/users', 'GET /api/users/:id', 'GET /cart', 'PATCH /api/users/:id', 'POST /api/users']);
    expect(list('fastapi').sort()).toEqual(['GET /admin/stats', 'GET /admin/users/:user_id', 'GET /health', 'GET /v1/items', 'GET /v1/items/:item_id', 'POST /admin/stats', 'POST /v1/items']);
    expect(list('go-api').sort()).toEqual(['GET /healthz', 'GET /products', 'POST /products']);
  });

  it('draws client -> prefix -> endpoint, with the source location as caption', async () => {
    const { graph } = extract('routes', F('fastapi'));
    expect(labels(graph)).toContain('/v1');
    expect(labels(graph)).not.toContain('/health'); // a prefix with one endpoint hangs off the client directly
    expect(graph.nodes.find((n) => n.label === 'POST /v1/items')!.caption).toBe('app/routers/items.py:10');
    const { report } = await build(graph);
    expect(report.issues.filter((i) => i.severity === 'error')).toEqual([]);
  });
});

describe('extract schema', () => {
  it('SQL: inline REFERENCES, table FOREIGN KEY, ALTER TABLE, quoted and schema-qualified names', () => {
    const { tables, fks } = findSchema(F('sql'));
    expect(tables.map((t) => t.name).sort()).toEqual(['billing.invoices', 'order_items', 'orders', 'users']);
    expect(tables.find((t) => t.name === 'orders')!.columns).toEqual(['id', 'user_id', 'total']);
    expect(fks.map((k) => `${k.from}.${k.column} -> ${k.to}`).sort()).toEqual(['billing.invoices.order_id -> orders', 'order_items.order_id -> orders', 'orders.user_id -> users']);
    const { graph } = extract('schema', F('sql'));
    expect(graph.groups!.map((g) => g.label)).toEqual(['billing']);
  });

  it('Prisma relations (including implicit many-to-many), Django and Rails', () => {
    const p = extract('schema', F('prisma')).graph;
    expect(p.edges!.map((e) => `${e.from} -> ${e.to} ${e.label}`).sort()).toEqual(['t:post -> t:tag many-to-many', 't:post -> t:user authorId']);
    const d = extract('schema', F('django')).graph;
    expect(labels(d).sort()).toEqual(['Customer', 'Order']); // abstract Base is not a table
    expect(d.edges!.map((e) => `${e.from} -> ${e.to}`)).toEqual(['t:order -> t:customer']);
    expect(d.nodes.find((n) => n.label === 'Order')!.caption).toMatch(/self: parent/);
    const r = extract('schema', F('rails')).graph;
    expect(r.edges!.map((e) => `${e.from} -> ${e.to} ${e.label}`)).toEqual(['t:projects -> t:accounts account_id']);
  });

  it('says what it looked for when there is nothing to find', () => {
    expect(() => extract('schema', F('nest'))).toThrow(/no tables found/);
    expect(() => extract('routes', F('sql'))).toThrow(/no HTTP routes found/);
  });
});
