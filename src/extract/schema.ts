// Database schema from source: SQL DDL (CREATE TABLE / ALTER TABLE … FOREIGN KEY), Prisma models,
// Django models and Rails db/schema.rb. Tables become boxes, foreign keys become arrows
// (from the referencing table to the referenced one, labelled with the column).
import type { GraphInput } from '../schema.js';
import { idOf, stripComments, walk, type SourceFile } from './files.js';
import type { Extracted } from './deps.js';

export interface Table { name: string; schema?: string; columns: string[] }
export interface ForeignKey { from: string; to: string; column: string }

const unq = (s: string) => s.trim().replace(/^[`"[]|[`"\]]$/g, '');
const qname = (s: string) => s.split('.').map(unq).join('.');

function splitTopLevel(body: string): string[] {
  const parts: string[] = [];
  let depth = 0, cur = '';
  for (const c of body) {
    if (c === '(') depth++;
    if (c === ')') depth--;
    if (c === ',' && depth === 0) { parts.push(cur); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) parts.push(cur);
  return parts.map((p) => p.trim()).filter(Boolean);
}

const NAME = String.raw`((?:[\w$]+|"[^"]+"|\`[^\`]+\`|\[[^\]]+\])(?:\.(?:[\w$]+|"[^"]+"|\`[^\`]+\`|\[[^\]]+\]))?)`;

export function parseSql(text: string, tables: Map<string, Table>, fks: ForeignKey[]) {
  const t = text.replace(/--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const create = new RegExp(String.raw`create\s+(?:(?:global\s+|local\s+)?(?:temporary|temp)\s+|unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?${NAME}\s*\(`, 'gi');
  for (const m of t.matchAll(create)) {
    // body: up to the matching parenthesis
    let depth = 1, i = m.index! + m[0].length;
    const start = i;
    while (i < t.length && depth) { if (t[i] === '(') depth++; else if (t[i] === ')') depth--; i++; }
    const name = qname(m[1]);
    const table: Table = { name, schema: name.includes('.') ? name.split('.')[0] : undefined, columns: [] };
    tables.set(name.toLowerCase(), table);
    for (const part of splitTopLevel(t.slice(start, i - 1))) {
      const fk = new RegExp(String.raw`^(?:constraint\s+\S+\s+)?foreign\s+key\s*\(([^)]+)\)\s*references\s+${NAME}`, 'i').exec(part);
      if (fk) { fks.push({ from: name, to: qname(fk[2]), column: fk[1].split(',').map(unq).join(', ') }); continue; }
      if (/^(constraint|primary\s+key|unique|check|index|key|exclude)\b/i.test(part)) continue;
      const col = /^([`"[]?[\w$ ]+?[`"\]]?)\s/.exec(part + ' ');
      if (!col) continue;
      table.columns.push(unq(col[1]));
      const ref = new RegExp(String.raw`\breferences\s+${NAME}`, 'i').exec(part);
      if (ref) fks.push({ from: name, to: qname(ref[1]), column: unq(col[1]) });
    }
  }
  const alter = new RegExp(String.raw`alter\s+table\s+(?:only\s+)?(?:if\s+exists\s+)?${NAME}\s+add\s+(?:constraint\s+\S+\s+)?foreign\s+key\s*\(([^)]+)\)\s*references\s+${NAME}`, 'gi');
  for (const m of t.matchAll(alter)) fks.push({ from: qname(m[1]), to: qname(m[3]), column: m[2].split(',').map(unq).join(', ') });
}

export function parsePrisma(text: string, tables: Map<string, Table>, fks: ForeignKey[]) {
  const t = stripComments(text, 'c');
  const lists = new Set<string>(); // "A>B": model A has a B[] field
  for (const m of t.matchAll(/^\s*model\s+(\w+)\s*\{([\s\S]*?)^\s*\}/gm)) {
    const table: Table = { name: m[1], columns: [] };
    tables.set(m[1].toLowerCase(), table);
    for (const line of m[2].split('\n')) {
      const f = /^\s*(\w+)\s+(\w+)(\[\])?(\?)?(.*)$/.exec(line);
      if (!f || f[1].startsWith('@')) continue;
      const rel = /@relation\(([^)]*)\)/.exec(f[5]);
      const fields = rel && /fields:\s*\[([^\]]+)\]/.exec(rel[1]);
      if (fields) { fks.push({ from: m[1], to: f[2], column: fields[1].split(',').map((x) => x.trim()).join(', ') }); continue; }
      if (f[3] && !/@relation\([^)]*fields/.test(f[5])) lists.add(`${m[1]}>${f[2]}`);
      if (/^[A-Z]/.test(f[2]) && !['String', 'Int', 'BigInt', 'Float', 'Decimal', 'Boolean', 'DateTime', 'Json', 'Bytes', 'Unsupported'].includes(f[2])) continue; // back-relation field
      table.columns.push(f[1]);
    }
  }
  // implicit many-to-many: both sides hold a list of the other
  for (const k of lists) {
    const [a, b] = k.split('>');
    if (a < b && lists.has(`${b}>${a}`)) fks.push({ from: a, to: b, column: 'many-to-many' });
  }
}

export function parseDjango(text: string, app: string, tables: Map<string, Table>, fks: ForeignKey[]) {
  const t = stripComments(text, 'py');
  const classes = [...t.matchAll(/^class\s+(\w+)\s*\(([^)]*)\)\s*:/gm)];
  const modelish = new Set<string>();
  classes.forEach((c, k) => {
    // a model: subclasses models.Model, or a model class defined above (abstract bases included)
    if (!/Model\b/.test(c[2]) && !c[2].split(',').some((b) => modelish.has(b.trim()))) return;
    modelish.add(c[1]);
    const body = t.slice(c.index! + c[0].length, classes[k + 1]?.index ?? t.length);
    if (/^\s+class\s+Meta\b[\s\S]*?abstract\s*=\s*True/m.test(body)) return;
    const table: Table = { name: c[1], columns: [] };
    tables.set(c[1].toLowerCase(), table);
    for (const f of body.matchAll(/^\s{4}(\w+)\s*=\s*(?:models\.)?(\w+)\(\s*(?:to\s*=\s*)?(['"]?[\w.]+['"]?)?/gm)) {
      if (!/Field$|^ForeignKey$|^OneToOneField$|^ManyToManyField$/.test(f[2])) continue;
      table.columns.push(f[1]);
      if (/^(ForeignKey|OneToOneField|ManyToManyField)$/.test(f[2]) && f[3]) {
        let target = f[3].replace(/['"]/g, '');
        if (target === 'self') target = c[1];
        target = target.split('.').pop()!;
        fks.push({ from: c[1], to: target, column: f[1] });
      }
    }
  });
  void app;
}

export function parseRails(text: string, tables: Map<string, Table>, fks: ForeignKey[]) {
  for (const m of text.matchAll(/create_table\s+["'](\w+)["'][^\n]*\n([\s\S]*?)^\s*end\b/gm)) {
    const table: Table = { name: m[1], columns: ['id'] };
    tables.set(m[1].toLowerCase(), table);
    for (const c of m[2].matchAll(/^\s*t\.(\w+)\s+["'](\w+)["']/gm)) if (c[1] !== 'index') table.columns.push(c[2]);
  }
  for (const m of text.matchAll(/add_foreign_key\s+["'](\w+)["']\s*,\s*["'](\w+)["'](?:[^\n]*column:\s*["'](\w+)["'])?/g)) {
    fks.push({ from: m[1], to: m[2], column: m[3] ?? `${m[2].replace(/s$/, '')}_id` });
  }
}

export function findSchema(root: string): { tables: Table[]; fks: ForeignKey[]; sources: string[] } {
  const files = walk(root, /\.(sql|prisma|py|rb)$/);
  const tables = new Map<string, Table>();
  const fks: ForeignKey[] = [];
  const sources: string[] = [];
  const use = (f: SourceFile, fn: () => void) => { const n = tables.size + fks.length; fn(); if (tables.size + fks.length > n) sources.push(f.rel); };
  for (const f of files) {
    if (f.rel.endsWith('.sql')) use(f, () => parseSql(f.text, tables, fks));
    else if (f.rel.endsWith('.prisma')) use(f, () => parsePrisma(f.text, tables, fks));
    else if (f.rel.endsWith('.py') && /(^|\/)models(\.py|\/)/.test(f.rel) && /\bmodels\.Model\b|\(Model\)/.test(f.text)) use(f, () => parseDjango(f.text, f.rel.split('/')[0], tables, fks));
    else if (/(^|\/)schema\.rb$/.test(f.rel)) use(f, () => parseRails(f.text, tables, fks));
  }
  // SQL migrations can repeat a foreign key; keep one per (from, to, column)
  const seen = new Set<string>();
  const unique = fks.filter((k) => { const key = `${k.from}|${k.to}|${k.column}`.toLowerCase(); if (seen.has(key)) return false; seen.add(key); return true; });
  return { tables: [...tables.values()], fks: unique, sources };
}

export function extractSchema(root: string): Extracted {
  const { tables, fks, sources } = findSchema(root);
  if (!tables.length) throw new Error(`no tables found under ${root} (SQL CREATE TABLE, Prisma, Django models, Rails schema.rb)`);
  const id = (n: string) => `t:${idOf(n.toLowerCase())}`;
  const known = new Map(tables.map((t) => [t.name.toLowerCase(), t]));
  // a reference to "users" from schema-qualified tables, or the other way round
  const find = (n: string) => known.get(n.toLowerCase()) ?? tables.find((t) => t.name.toLowerCase().split('.').pop() === n.toLowerCase().split('.').pop());
  const schemas = [...new Set(tables.map((t) => t.schema).filter(Boolean))] as string[];
  const groups = schemas.length > 1 || (schemas.length === 1 && tables.some((t) => !t.schema)) ? schemas.map((s) => ({ id: `s:${idOf(s)}`, label: s })) : [];
  // a table pointing at itself (parent_id) is noted on the box rather than drawn as a loop
  const selfRefs = new Map<string, string[]>();
  for (const k of fks) { const a = find(k.from), b = find(k.to); if (a && a === b) selfRefs.set(a.name, [...(selfRefs.get(a.name) ?? []), k.column]); }
  const nodes: GraphInput['nodes'] = tables.map((t) => ({
    id: id(t.name), label: groups.length ? t.name.split('.').pop()! : t.name, kind: 'database' as const, icon: 'table',
    caption: `${t.columns.length} column${t.columns.length === 1 ? '' : 's'}${selfRefs.has(t.name) ? `, self: ${selfRefs.get(t.name)!.join(', ')}` : ''}`,
    ...(groups.length && t.schema ? { group: `s:${idOf(t.schema)}` } : {}),
  }));
  const edges: NonNullable<GraphInput['edges']> = [];
  const missing = new Set<string>();
  for (const k of fks) {
    const a = find(k.from), b = find(k.to);
    if (!a || !b) { missing.add(!a ? k.from : k.to); continue; }
    if (a === b) continue;
    edges.push({ from: id(a.name), to: id(b.name), label: k.column });
  }
  const notes = [`${tables.length} tables, ${edges.length} foreign keys from ${sources.join(', ')}`];
  if (missing.size) notes.push(`references to tables not defined here: ${[...missing].join(', ')}`);
  return { graph: { type: 'graph', title: 'Database schema', direction: 'RIGHT', nodes, edges, groups }, notes };
}
