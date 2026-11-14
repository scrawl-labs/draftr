// HTTP routes from source, drawn as a tree: client → path prefix → endpoint.
// Express / Koa-router / Hono / Fastify / Elysia style `app.get('/x')`, Fastify `route({ method, url })`,
// NestJS `@Controller` + `@Get`, Next.js app (`app/**/route.ts`) and pages (`pages/api/**`) routers,
// FastAPI / Flask decorators (APIRouter / Blueprint prefixes), and Go net/http, gin, echo, chi.
import { posix } from 'node:path';
import type { GraphInput } from '../schema.js';
import { idOf, stripComments, walk, type SourceFile } from './files.js';
import type { Extracted } from './deps.js';

export interface Route { method: string; path: string; file: string; line: number }

const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head', 'all'];
const lineAt = (text: string, i: number) => text.slice(0, i).split('\n').length;
const join = (...parts: string[]) => ('/' + parts.map((p) => p.replace(/^\/+|\/+$/g, '')).filter(Boolean).join('/')).replace(/\/+/g, '/');
const normPath = (p: string) => join(p.replace(/\{([^}:]+)(?::[^}]*)?\}/g, ':$1').replace(/<(?:\w+:)?(\w+)>/g, ':$1'));

/** Mount prefixes: `app.use('/api', usersRouter)` where usersRouter is imported from another file. */
function mounts(files: SourceFile[]): Map<string, string> {
  const prefixOf = new Map<string, string>();
  const byStem = new Map(files.map((f) => [f.rel.replace(/\.[^.]+$/, ''), f.rel]));
  for (const f of files) {
    if (!/\.(m|c)?[jt]sx?$/.test(f.rel)) continue;
    const t = stripComments(f.text, 'c');
    const imports = new Map<string, string>();
    for (const m of t.matchAll(/import\s+(\w+)\s+from\s*['"](\.[^'"]+)['"]/g)) imports.set(m[1], m[2]);
    for (const m of t.matchAll(/(?:const|let|var)\s+(\w+)\s*=\s*require\(\s*['"](\.[^'"]+)['"]\s*\)/g)) imports.set(m[1], m[2]);
    const mount = (spec: string, prefix: string) => {
      const target = byStem.get(posix.normalize(posix.join(posix.dirname(f.rel), spec)).replace(/\.[^./]+$/, ''))
        ?? byStem.get(posix.normalize(posix.join(posix.dirname(f.rel), spec, 'index')));
      if (target) prefixOf.set(target, join(prefixOf.get(f.rel) ?? '', prefix));
    };
    for (const m of t.matchAll(/\.(?:use|route|register)\(\s*['"]([^'"]+)['"]\s*,\s*(\w+)/g)) if (imports.has(m[2])) mount(imports.get(m[2])!, m[1]);
    for (const m of t.matchAll(/\.(?:use)\(\s*['"]([^'"]+)['"]\s*,\s*require\(\s*['"](\.[^'"]+)['"]\s*\)/g)) mount(m[2], m[1]);
    for (const m of t.matchAll(/\.register\(\s*(\w+)\s*,\s*\{[^}]*prefix:\s*['"]([^'"]+)['"]/g)) if (imports.has(m[1])) mount(imports.get(m[1])!, m[2]);
  }
  return prefixOf;
}

export function findRoutes(root: string): Route[] {
  const files = walk(root, /\.((m|c)?[jt]sx?|py|go)$/).filter((f) => !/(^|\/)(__tests__|tests?)\/|\.(test|spec)\./.test(f.rel));
  const prefixOf = mounts(files);
  const out: Route[] = [];
  const add = (method: string, path: string, f: SourceFile, idx: number) => out.push({ method: method.toUpperCase(), path: normPath(path), file: f.rel, line: lineAt(f.text, idx) });

  for (const f of files) {
    if (/\.py$/.test(f.rel)) {
      const t = stripComments(f.text, 'py');
      // router/blueprint prefixes defined in this file
      const pre = new Map<string, string>();
      for (const m of t.matchAll(/(\w+)\s*=\s*(?:APIRouter|Blueprint)\(([^)]*)\)/g)) {
        const p = /(?:prefix|url_prefix)\s*=\s*['"]([^'"]*)['"]/.exec(m[2]);
        pre.set(m[1], p?.[1] ?? '');
      }
      for (const m of t.matchAll(/(?:include_router|register_blueprint)\(\s*(?:[\w.]+\.)?(\w+)\s*,\s*(?:url_)?prefix\s*=\s*['"]([^'"]*)['"]/g)) {
        // prefix applied where the router is included; good enough when names are unique
        for (const g of files) if (g.rel.endsWith('.py') && new RegExp(`\\b${m[1]}\\s*=\\s*(?:APIRouter|Blueprint)\\(`).test(g.text)) prefixOf.set(`${g.rel}#${m[1]}`, m[2]);
      }
      for (const m of t.matchAll(/@(\w+)\.(get|post|put|patch|delete|options|head|api_route|route)\(\s*['"]([^'"]*)['"]([^)]*)\)/g)) {
        const base = join(prefixOf.get(`${f.rel}#${m[1]}`) ?? '', pre.get(m[1]) ?? '');
        const methods = m[2] === 'route' || m[2] === 'api_route' ? (/methods\s*=\s*\[([^\]]*)\]/.exec(m[4])?.[1].match(/\w+/g) ?? ['GET']) : [m[2]];
        for (const meth of methods) add(meth, join(base, m[3]), f, m.index!);
      }
      continue;
    }
    if (f.rel.endsWith('.go')) {
      const t = stripComments(f.text, 'c');
      for (const m of t.matchAll(/\b\w+\.(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD|Get|Post|Put|Patch|Delete|Options|Head)\(\s*"([^"]+)"/g)) add(m[1], m[2], f, m.index!);
      for (const m of t.matchAll(/\b(?:http|mux|\w+)\.HandleFunc\(\s*"(?:(GET|POST|PUT|PATCH|DELETE)\s+)?([^"]+)"/g)) add(m[1] ?? 'ANY', m[2], f, m.index!);
      continue;
    }
    const t = stripComments(f.text, 'c');
    // Next.js app router: app/**/route.ts exporting GET/POST/…
    const app = /(?:^|\/)app\/(.*\/)?route\.(m|c)?[jt]sx?$/.exec(f.rel);
    if (app) {
      const segs = (app[1] ?? '').split('/').filter(Boolean).filter((s) => !/^\(.*\)$/.test(s) && !s.startsWith('@'))
        .map((s) => s.replace(/^\[\.\.\.(\w+)\]$/, ':$1*').replace(/^\[\[\.\.\.(\w+)\]\]$/, ':$1*').replace(/^\[(\w+)\]$/, ':$1'));
      for (const m of t.matchAll(/export\s+(?:async\s+)?(?:function|const)\s+(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\b/g)) add(m[1], join(...segs), f, m.index!);
      continue;
    }
    // Next.js pages router: pages/api/**
    const pages = /(?:^|\/)pages\/(api\/.*)\.(m|c)?[jt]sx?$/.exec(f.rel);
    if (pages) {
      const segs = pages[1].split('/').filter((s) => s !== 'index').map((s) => s.replace(/^\[\.\.\.(\w+)\]$/, ':$1*').replace(/^\[(\w+)\]$/, ':$1'));
      add('ANY', join(...segs), f, 0);
      continue;
    }
    const base = prefixOf.get(f.rel) ?? '';
    // NestJS: @Controller('users') … @Get(':id')
    const ctrl = /@Controller\(\s*(?:['"]([^'"]*)['"]|\{[^}]*path:\s*['"]([^'"]*)['"][^}]*\})?\s*\)/.exec(t);
    if (ctrl) {
      for (const m of t.matchAll(/@(Get|Post|Put|Patch|Delete|Options|Head|All)\(\s*(?:['"]([^'"]*)['"])?\s*\)/g)) add(m[1], join(base, ctrl[1] ?? ctrl[2] ?? '', m[2] ?? ''), f, m.index!);
      continue;
    }
    // app.get('/x', …), router.post("/x", …), fastify.route({ method: 'GET', url: '/x' })
    const callRe = new RegExp(`\\b\\w+\\.(${METHODS.join('|')})\\(\\s*['"\`]([^'"\`]+)['"\`]`, 'g');
    for (const m of t.matchAll(callRe)) if (m[2].startsWith('/') || m[2] === '*') add(m[1] === 'all' ? 'ANY' : m[1], join(base, m[2]), f, m.index!);
    for (const m of t.matchAll(/\.route\(\s*\{([^}]*)\}/g)) {
      const meth = /method:\s*\[?\s*['"](\w+)['"]/.exec(m[1])?.[1], url = /(?:url|path):\s*['"]([^'"]+)['"]/.exec(m[1])?.[1];
      if (meth && url) add(meth, join(base, url), f, m.index!);
    }
    // router.route('/x').get(…).post(…)
    for (const m of t.matchAll(/\.route\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      const end = t.indexOf(';', m.index!);
      const chain = t.slice(m.index! + m[0].length, end < 0 ? undefined : end);
      for (const k of chain.matchAll(/\.\s*(get|post|put|patch|delete|all)\s*\(/g)) add(k[1] === 'all' ? 'ANY' : k[1], join(base, m[1]), f, m.index!);
    }
  }
  // de-duplicate (a route registered twice, or found by two patterns)
  const seen = new Set<string>();
  return out.filter((r) => { const k = `${r.method} ${r.path}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => a.path.localeCompare(b.path) || METHODS.indexOf(a.method.toLowerCase()) - METHODS.indexOf(b.method.toLowerCase()));
}

export function extractRoutes(root: string, opts: { maxNodes?: number } = {}): Extracted {
  const routes = findRoutes(root);
  if (!routes.length) throw new Error(`no HTTP routes found under ${root} (Express/Fastify/Hono/Koa, NestJS, Next.js, FastAPI/Flask, Go)`);
  const max = opts.maxNodes ?? 60;
  const shown = routes.slice(0, max);
  // group endpoints by their first path segment ("/users/:id" -> "/users"); skip "api"/"v1" style roots
  const segs = shown.map((r) => r.path.split('/').filter(Boolean));
  const common = (() => { let k = 0; while (segs.every((s) => s.length > k + 1 && s[k] === segs[0][k]) && !segs[0][k].startsWith(':')) k++; return k; })();
  const prefixOf = (r: Route) => join(...r.path.split('/').filter(Boolean).slice(0, common + 1).filter((s) => !s.startsWith(':')));
  const prefixes = [...new Set(shown.map(prefixOf))];
  const nodes: GraphInput['nodes'] = [{ id: 'client', label: 'HTTP client', kind: 'client' }];
  const edges: NonNullable<GraphInput['edges']> = [];
  const flat = prefixes.length === shown.length || prefixes.length === 1;
  const size = (p: string) => shown.filter((r) => prefixOf(r) === p).length;
  const hub = (r: Route) => (flat || size(prefixOf(r)) === 1 ? 'client' : `p:${idOf(prefixOf(r))}`);
  if (!flat) for (const p of prefixes.filter((x) => size(x) > 1)) { nodes.push({ id: `p:${idOf(p)}`, label: p, kind: 'service', icon: 'route', caption: `${size(p)} endpoints` }); edges.push({ from: 'client', to: `p:${idOf(p)}` }); }
  for (const r of shown) {
    const id = `r:${r.method}:${idOf(r.path)}`;
    nodes.push({ id, label: `${r.method} ${r.path}`, kind: 'service', icon: false, caption: `${r.file}:${r.line}` });
    edges.push({ from: hub(r), to: id });
  }
  const notes = [`${routes.length} routes in ${new Set(routes.map((r) => r.file)).size} files`];
  if (routes.length > max) notes.push(`showing the first ${max}; narrow the path to see the rest`);
  return { graph: { type: 'graph', title: 'HTTP routes', direction: 'RIGHT', nodes, edges, groups: [] }, notes };
}
