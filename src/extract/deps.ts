// Module dependency graph from source: JS/TS (import, export from, require, import()), Python
// (import, from … import) and Go (package imports). Small projects get one box per file, larger ones
// are folded into directories until the diagram stays readable. Import cycles are highlighted.
import { existsSync, readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { basename, join, posix } from 'node:path';
import type { GraphInput } from '../schema.js';
import { idOf, stripComments, walk, type SourceFile } from './files.js';

export interface DepsOptions {
  /** One box per file, per directory, or whichever keeps the diagram under maxNodes (default). */
  by?: 'file' | 'dir' | 'auto';
  /** Directory depth to fold to with by: 'dir' (default: deepest that fits maxNodes). */
  depth?: number;
  /** Also draw the most used third-party packages. */
  external?: boolean;
  /** Include test files. */
  tests?: boolean;
  /** Keep every edge. Default: drop a→c when a→b→c already says it (transitive reduction). */
  allEdges?: boolean;
  /** Count `import type` / `export type … from` (TypeScript). Default: no, they vanish at runtime. */
  types?: boolean;
  maxNodes?: number;
}

export interface Extracted { graph: GraphInput; notes: string[] }

const JS = /\.(m|c)?[jt]sx?$/;
const CODE = /\.((m|c)?[jt]sx?|py|go)$/;
const TEST = /(^|\/)(__tests__|tests?|spec|e2e|fixtures?)\/|\.(test|spec|stories)\.[^/]+$|(^|\/)test_[^/]+\.py$|_test\.(go|py)$/;
const NODE_BUILTINS = new Set(builtinModules.flatMap((m) => [m, `node:${m}`]));
const PY_STDLIB = new Set(('abc argparse array ast asyncio base64 bisect builtins collections concurrent contextlib copy csv dataclasses datetime decimal '
  + 'enum functools glob hashlib heapq hmac html http importlib inspect io itertools json logging math multiprocessing os pathlib pickle '
  + 'platform pprint queue random re secrets shutil signal socket sqlite3 ssl statistics string struct subprocess sys tempfile textwrap '
  + 'threading time timeit traceback types typing unittest urllib uuid warnings weakref xml zipfile zoneinfo __future__').split(' '));

/** Raw import specifiers of one file. */
export function importsOf(f: SourceFile, types = true): string[] {
  const out: string[] = [];
  if (JS.test(f.rel)) {
    let t = stripComments(f.text, 'c');
    if (!types) t = t.replace(/(?:^|[\s;])(?:import|export)\s+type\s[^'"`;]*?\sfrom\s*['"][^'"]+['"]/g, ' ');
    for (const re of [/(?:^|[\s;])(?:import|export)\s[^'"`;]*?\sfrom\s*['"]([^'"]+)['"]/g, /(?:^|[\s;])import\s*['"]([^'"]+)['"]/g, /\b(?:import|require)\s*\(\s*['"]([^'"]+)['"]\s*\)/g]) {
      for (const m of t.matchAll(re)) out.push(m[1]);
    }
  } else if (f.rel.endsWith('.py')) {
    const t = stripComments(f.text, 'py');
    for (const m of t.matchAll(/^\s*import\s+([\w.]+(?:\s+as\s+\w+)?(?:\s*,\s*[\w.]+(?:\s+as\s+\w+)?)*)/gm)) {
      for (const part of m[1].split(',')) out.push(part.trim().split(/\s+/)[0]);
    }
    for (const m of t.matchAll(/^[ \t]*from[ \t]+(\.*[\w.]*)[ \t]+import[ \t]+(\([^)]*\)|[^\n]+)/gm)) {
      // "from a import b" may import module a.b or a name in a: the resolver tries a.b first, then a
      const names = m[2].replace(/[()\\]/g, ' ').split(',').map((n) => n.trim().split(/\s+/)[0]).filter((n) => n && n !== '*');
      const sep = /\.$/.test(m[1]) ? '' : '.';
      if (names.length) for (const n of names) out.push(m[1] + sep + n);
      else out.push(m[1]);
    }
  } else if (f.rel.endsWith('.go')) {
    const t = stripComments(f.text, 'c');
    for (const m of t.matchAll(/^\s*import\s+(?:[\w.]+\s+)?"([^"]+)"/gm)) out.push(m[1]);
    for (const m of t.matchAll(/^\s*import\s*\(([\s\S]*?)\)/gm)) for (const q of m[1].matchAll(/"([^"]+)"/g)) out.push(q[1]);
  }
  return [...new Set(out)];
}

interface Resolver { file: (from: SourceFile, spec: string) => string | undefined; pkg: (from: SourceFile, spec: string) => string | undefined }

function readJsonLoose(p: string): any { // eslint-disable-line @typescript-eslint/no-explicit-any
  try { return JSON.parse(stripComments(readFileSync(p, 'utf8'), 'c').replace(/,(\s*[}\]])/g, '$1')); } catch { return undefined; }
}

function resolver(root: string, files: SourceFile[]): Resolver {
  const have = new Set(files.map((f) => f.rel));
  const tryFile = (p: string): string | undefined => {
    p = posix.normalize(p).replace(/^\.\//, '');
    if (p.startsWith('../')) return undefined;
    const stem = p.replace(/\.(m|c)?js$/, '').replace(/\.jsx$/, '');
    const exts = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts'];
    for (const base of [p, stem]) for (const e of exts) if (have.has(base + e)) return base + e;
    for (const e of exts.slice(1)) if (have.has(`${p}/index${e}`)) return `${p}/index${e}`;
    return undefined;
  };
  // tsconfig/jsconfig "paths" and "baseUrl"
  const cfg = ['tsconfig.json', 'jsconfig.json'].map((n) => join(root, n)).filter(existsSync).map(readJsonLoose)[0]?.compilerOptions ?? {};
  const baseUrl: string = cfg.baseUrl ?? '.';
  const paths: Record<string, string[]> = cfg.paths ?? {};
  // go.mod module path
  const gomod = existsSync(join(root, 'go.mod')) ? /^module\s+(\S+)/m.exec(readFileSync(join(root, 'go.mod'), 'utf8'))?.[1] : undefined;
  const pyRoots = ['', 'src/', ...[...new Set(files.filter((f) => f.rel.endsWith('.py')).map((f) => f.rel.split('/')[0] + '/'))]];
  const goDirs = new Set(files.filter((f) => f.rel.endsWith('.go')).map((f) => posix.dirname(f.rel)));

  return {
    file(from, spec) {
      if (JS.test(from.rel)) {
        if (spec.startsWith('.')) return tryFile(posix.join(posix.dirname(from.rel), spec));
        for (const [pat, targets] of Object.entries(paths)) {
          const star = pat.indexOf('*');
          const hit = star < 0 ? spec === pat : spec.startsWith(pat.slice(0, star)) && spec.endsWith(pat.slice(star + 1));
          if (!hit) continue;
          const mid = star < 0 ? '' : spec.slice(star, spec.length - (pat.length - star - 1));
          for (const t of targets) { const r = tryFile(posix.join(baseUrl, t.replace('*', mid))); if (r) return r; }
        }
        if (cfg.baseUrl) return tryFile(posix.join(baseUrl, spec));
        return undefined;
      }
      if (from.rel.endsWith('.py')) {
        const dots = /^\.+/.exec(spec)?.[0].length ?? 0;
        const parts = spec.slice(dots).split('.').filter(Boolean);
        const bases = dots ? [posix.join(posix.dirname(from.rel), ...Array(dots - 1).fill('..')) + '/'] : pyRoots;
        for (const b of bases) {
          for (let k = parts.length; k >= 1; k--) {
            const p = (b === './' ? '' : b) + parts.slice(0, k).join('/');
            if (have.has(`${p}.py`)) return `${p}.py`;
            if (have.has(`${p}/__init__.py`)) return `${p}/__init__.py`;
          }
        }
        return undefined;
      }
      if (from.rel.endsWith('.go') && gomod && (spec === gomod || spec.startsWith(gomod + '/'))) {
        const dir = spec === gomod ? '.' : spec.slice(gomod.length + 1);
        return goDirs.has(dir) ? `${dir}/` : undefined; // Go: the package (directory) is the unit
      }
      return undefined;
    },
    pkg(from, spec) {
      if (spec.startsWith('.')) return undefined;
      if (JS.test(from.rel)) {
        if (NODE_BUILTINS.has(spec) || NODE_BUILTINS.has(spec.split('/')[0]) || spec.startsWith('node:')) return undefined;
        const parts = spec.split('/');
        return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
      }
      if (from.rel.endsWith('.py')) { const top = spec.split('.')[0]; return PY_STDLIB.has(top) ? undefined : top; }
      if (from.rel.endsWith('.go')) {
        if (!spec.split('/')[0].includes('.')) return undefined; // standard library
        const p = spec.split('/');
        return p[0] === 'github.com' || p[0] === 'gitlab.com' ? p.slice(0, 3).join('/') : p.slice(0, 2).join('/');
      }
      return undefined;
    },
  };
}

/** Strongly connected components (Tarjan); returns component index per node. */
function scc(nodes: string[], adj: Map<string, Set<string>>): Map<string, number> {
  let index = 0, comp = 0;
  const idx = new Map<string, number>(), low = new Map<string, number>(), on = new Set<string>(), stack: string[] = [], out = new Map<string, number>();
  const visit = (v: string) => {
    idx.set(v, index); low.set(v, index); index++; stack.push(v); on.add(v);
    for (const w of adj.get(v) ?? []) {
      if (!idx.has(w)) { visit(w); low.set(v, Math.min(low.get(v)!, low.get(w)!)); }
      else if (on.has(w)) low.set(v, Math.min(low.get(v)!, idx.get(w)!));
    }
    if (low.get(v) === idx.get(v)) { let w; do { w = stack.pop()!; on.delete(w); out.set(w, comp); } while (w !== v); comp++; }
  };
  for (const v of nodes) if (!idx.has(v)) visit(v);
  return out;
}

/**
 * Transitive reduction on the acyclic part: drop a→c when c is reachable from a another way.
 * Edges inside an import cycle are kept so the cycle stays visible.
 */
function reduce(units: string[], adj: Map<string, Set<string>>, comp: Map<string, number>) {
  const reach = (from: string, skip: string) => {
    const seen = new Set<string>(), stack = [...adj.get(from)!].filter((x) => x !== skip);
    while (stack.length) {
      const v = stack.pop()!;
      if (seen.has(v)) continue;
      seen.add(v);
      for (const w of adj.get(v) ?? []) stack.push(w);
    }
    return seen;
  };
  for (const a of units) {
    for (const c of [...adj.get(a)!]) {
      if (comp.get(a) === comp.get(c)) continue;
      if (reach(a, c).has(c)) adj.get(a)!.delete(c);
    }
  }
}

export function extractDeps(root: string, opts: DepsOptions = {}): Extracted {
  const maxNodes = opts.maxNodes ?? 40;
  let files = walk(root, CODE);
  if (!opts.tests) files = files.filter((f) => !TEST.test(f.rel));
  if (!files.length) throw new Error(`no source files (JS/TS, Python, Go) found under ${root}`);
  const r = resolver(root, files);

  // file-level edges (Go: package-level, "dir/")
  const unitOfFile = (f: SourceFile) => (f.rel.endsWith('.go') ? `${posix.dirname(f.rel)}/` : f.rel);
  const fileEdges: Array<[string, string]> = [];
  const pkgUse = new Map<string, Map<string, number>>();
  for (const f of files) {
    for (const spec of importsOf(f, !!opts.types)) {
      const target = r.file(f, spec);
      if (target) { fileEdges.push([unitOfFile(f), target]); continue; }
      const pkg = r.pkg(f, spec);
      if (pkg) { const m = pkgUse.get(pkg) ?? new Map<string, number>(); m.set(unitOfFile(f), (m.get(unitOfFile(f)) ?? 0) + 1); pkgUse.set(pkg, m); }
    }
  }
  const allUnits = [...new Set(files.map(unitOfFile))];

  // fold files into directories until it fits
  const dirOf = (u: string) => (u.endsWith('/') ? u.slice(0, -1) : posix.dirname(u));
  const fold = (u: string, depth: number) => { const d = dirOf(u); return d === '.' ? '.' : d.split('/').slice(0, depth).join('/'); };
  const maxDepth = Math.max(1, ...allUnits.map((u) => dirOf(u).split('/').length));
  let mode: 'file' | 'dir' = opts.by === 'dir' ? 'dir' : opts.by === 'file' ? 'file' : allUnits.length <= maxNodes ? 'file' : 'dir';
  let depth = opts.depth ?? maxDepth;
  let unitOf = (u: string) => u;
  if (mode === 'dir') {
    if (!opts.depth) while (depth > 1 && new Set(allUnits.map((u) => fold(u, depth))).size > maxNodes) depth--;
    unitOf = (u) => fold(u, depth);
  }
  if (mode === 'file' && allUnits.every((u) => u.endsWith('/'))) mode = 'dir'; // pure Go: packages already

  const units = [...new Set(allUnits.map(unitOf))].sort();
  const adj = new Map<string, Set<string>>(units.map((u) => [u, new Set<string>()]));
  for (const [a, b] of fileEdges) { const ua = unitOf(a), ub = unitOf(b); if (ua !== ub) adj.get(ua)?.add(ub); }
  const comp = scc(units, adj);
  const before = [...adj.values()].reduce((n, s) => n + s.size, 0);
  if (!opts.allEdges) reduce(units, adj, comp);
  const compSize = new Map<number, number>();
  for (const c of comp.values()) compSize.set(c, (compSize.get(c) ?? 0) + 1);
  const cyclic = (a: string, b: string) => comp.get(a) === comp.get(b) && (compSize.get(comp.get(a)!) ?? 0) > 1;

  // labels: drop the common directory prefix
  const dirs = units.map((u) => (u === '.' ? '' : (mode === 'dir' ? u : dirOf(u)) + '/')).map((d) => (d === './' ? '' : d));
  let prefix = dirs[0] ?? '';
  for (const d of dirs) while (!d.startsWith(prefix)) prefix = prefix.slice(0, prefix.lastIndexOf('/', prefix.length - 2) + 1);
  const strip = (s: string) => (s.startsWith(prefix) ? s.slice(prefix.length) : s);
  const rootName = basename(root.replace(/\/+$/, '')) || root;
  const label = (u: string) => {
    if (mode === 'dir') { const s = strip(u.replace(/\/$/, '') + '/').replace(/\/$/, ''); return s || (u === '.' ? rootName : u.replace(/\/$/, '')); }
    return posix.basename(u).replace(/\.[^.]+$/, '') === 'index' || posix.basename(u) === '__init__.py' ? strip(u) : posix.basename(u);
  };

  // groups (file mode): one per directory that holds 2+ boxes, nested like the tree
  const groups: NonNullable<GraphInput['groups']> = [];
  const groupOf = new Map<string, string>();
  if (mode === 'file') {
    const count = new Map<string, number>();
    for (const u of units) { const d = dirOf(u); count.set(d, (count.get(d) ?? 0) + 1); }
    const wanted = [...count].filter(([d, c]) => c >= 2 && d !== '.' && `${d}/` !== prefix && c < units.length).map(([d]) => d).sort();
    const gid = (d: string) => `dir:${idOf(d)}`;
    for (const d of wanted) {
      const parent = wanted.filter((p) => d.startsWith(p + '/')).sort((a, b) => b.length - a.length)[0];
      groups.push({ id: gid(d), label: `${strip(d + '/')}`, ...(parent ? { parent: gid(parent) } : {}) });
    }
    for (const u of units) if (wanted.includes(dirOf(u))) groupOf.set(u, gid(dirOf(u)));
  }

  const nodeId = (u: string) => `m:${idOf(u)}`;
  const nodes: GraphInput['nodes'] = units.map((u) => ({
    id: nodeId(u), label: label(u), kind: 'service' as const,
    caption: mode === 'dir' ? `${allUnits.filter((x) => unitOf(x) === u).length} ${allUnits.some((x) => x.endsWith('/')) ? 'packages' : 'files'}` : (u.endsWith('/') ? 'package' : false as const),
    icon: mode === 'dir' ? 'folder' : 'file',
    ...(groupOf.has(u) ? { group: groupOf.get(u) } : {}),
  }));
  const edges: NonNullable<GraphInput['edges']> = [];
  for (const [a, set] of adj) for (const b of [...set].sort()) edges.push({ from: nodeId(a), to: nodeId(b), ...(cyclic(a, b) ? { highlight: true } : {}) });

  if (opts.external) {
    const top = [...pkgUse].map(([p, m]) => [p, [...m.values()].reduce((x, y) => x + y, 0)] as const).sort((a, b) => b[1] - a[1]).slice(0, 12);
    for (const [p] of top) {
      nodes.push({ id: `pkg:${idOf(p)}`, label: p, kind: 'external' });
      const from = new Set([...pkgUse.get(p)!.keys()].map(unitOf));
      for (const u of from) edges.push({ from: nodeId(u), to: `pkg:${idOf(p)}`, style: 'dashed' });
    }
  }

  const kept = [...adj.values()].reduce((n, s) => n + s.size, 0);
  const notes: string[] = [`${files.length} files → ${units.length} ${mode === 'dir' ? `directories (depth ${depth})` : 'files'}, ${kept} dependencies`
    + (kept < before ? ` (${before - kept} implied by others left out; allEdges to draw them)` : '')];
  const cycles = [...compSize.values()].filter((n) => n > 1).length;
  if (cycles) notes.push(`${cycles} import cycle${cycles > 1 ? 's' : ''} (highlighted)`);
  return { graph: { type: 'graph', title: `Module dependencies: ${rootName}`, direction: 'RIGHT', nodes, edges, groups }, notes };
}
