#!/usr/bin/env node
// MCP server: the model describes WHAT (semantic graph), draftr decides WHERE,
// and returns a deterministic lint report + a PNG preview it can look at.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { build, buildMermaid, FORMAT_NAMES, FORMATS, IconLibrary, lint, svgToPng, tidy, toSvg, GraphSchema, SequenceSchema, type BuildOptions, type BuildResult, type Format, type LintReport } from './index.js';
import { createRequire } from 'node:module';

const pkg = createRequire(import.meta.url)('../package.json') as { version: string };

type Content = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string };

const server = new McpServer({ name: 'draftr', version: pkg.version });

const reportText = (r: LintReport) =>
  [`${r.ok ? 'OK' : 'ISSUES'} score ${r.score}/100 — ${r.summary}`,
    ...r.issues.map((i) => `- ${i.severity} [${i.code}] ${i.message}${i.fix ? ` → ${i.fix}` : ''} (elements: ${i.elements.join(', ')})`)].join('\n');

async function preview(svg: string, want: boolean): Promise<Content[]> {
  if (!want) return [];
  try {
    return [{ type: 'image', data: (await svgToPng(svg, { scale: 1 })).toString('base64'), mimeType: 'image/png' }];
  } catch (e) {
    return [{ type: 'text', text: `(preview unavailable: ${(e as Error).message})` }];
  }
}

function writeOut(path: string, data: string): string {
  const p = resolve(path);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, data);
  return p;
}

const KNOWN_EXT = new RegExp(`(${[...Object.values(FORMATS).map((f) => f.ext), '.svg', '.png'].map((e) => e.replace('.', '\\.')).join('|')})$`);

async function emit(res: BuildResult, out: string, want: boolean, extra = ''): Promise<{ content: Content[] }> {
  const stem = out.replace(KNOWN_EXT, '');
  const file = writeOut(`${stem}${res.file.ext}`, res.file.content);
  const svgFile = writeOut(`${stem}.svg`, res.svg);
  return { content: [{ type: 'text', text: `wrote ${file}\nwrote ${svgFile}\n${extra}${reportText(res.report)}` }, ...(await preview(res.svg, want))] };
}

const guard = <A>(fn: (a: A) => Promise<{ content: Content[] }>) => async (a: A) => {
  try { return await fn(a); } catch (e) { return { isError: true, content: [{ type: 'text' as const, text: (e as Error).message }] }; }
};

const out = z.string().describe('output path, e.g. docs/diagrams/checkout (the editable file gets the format\'s extension; an .svg is written next to it)');
const formatArg = z.enum(FORMAT_NAMES as [Format, ...Format[]]).default('excalidraw').describe(`editable output format: ${Object.entries(FORMATS).map(([k, v]) => `${k} = ${v.label}`).join('; ')}`);
const wantPreview = z.boolean().default(true).describe('return a PNG preview');
const iconsArg = z.boolean().default(true).describe('draw icons (picked automatically from labels unless a node sets `icon`)');
const keepArg = z.string().optional().describe('path of the existing .excalidraw of this diagram, when you are updating one: boxes the user moved there keep their place and only the rest is laid out again. Pass it whenever the output file already exists.');
const keepAllArg = z.boolean().default(false).describe('with keep: every box that already exists keeps its place (new boxes fit around them), for minimal visual change');
const opts = (icons: boolean, format: Format, keep?: string, keepAll = false): BuildOptions => ({
  icons: icons ? {} : false, format,
  ...(keep ? { keep: { from: JSON.parse(readFileSync(resolve(keep), 'utf8')), mode: keepAll ? 'all' as const : 'moved' as const } } : {}),
});

server.registerTool('build_diagram', {
  title: 'Build an architecture / flow diagram',
  description: [
    'Create an architecture or flow diagram from a semantic graph. Give nodes, edges and groups only — never coordinates:',
    'layout (ELK, orthogonal routing, nested groups) is computed for you. Writes an editable file (Excalidraw by default, see format) plus a docs-ready .svg, and returns a lint report and a PNG preview.',
    'Tips: mark the 1–2 nodes/edges that carry the point of the diagram with highlight:true; use groups for trust/deployment boundaries;',
    'use dashed edges for async; kinds: service, database, queue, external, user, client, storage, decision, note.',
  ].join(' '),
  inputSchema: { graph: GraphSchema, out, preview: wantPreview, icons: iconsArg, format: formatArg, keep: keepArg, keep_all: keepAllArg },
}, guard(async ({ graph, out: o, preview: p, icons, format, keep, keep_all }) => emit(await build(graph, opts(icons, format, keep, keep_all)), o, p)));

server.registerTool('build_sequence', {
  title: 'Build a sequence diagram',
  description: 'Create a sequence diagram from participants and ordered messages (dashed = reply/async; a message to itself draws a loop). Column spacing is computed so every label fits. Writes an editable file (Excalidraw by default, see format) plus a docs-ready .svg, and returns a lint report and a PNG preview.',
  inputSchema: { sequence: SequenceSchema, out, preview: wantPreview, icons: iconsArg, format: formatArg },
}, guard(async ({ sequence, out: o, preview: p, icons, format }) => emit(await build(sequence, opts(icons, format)), o, p)));

server.registerTool('build_from_mermaid', {
  title: 'Build a diagram from Mermaid',
  description: 'Convert Mermaid source (flowchart/graph or sequenceDiagram) into a laid-out, editable diagram (see format) with lint report and preview. Useful for upgrading existing Mermaid docs.',
  inputSchema: { source: z.string().describe('Mermaid source text'), out, preview: wantPreview, icons: iconsArg, format: formatArg, keep: keepArg, keep_all: keepAllArg },
}, guard(async ({ source, out: o, preview: p, icons, format, keep, keep_all }) => emit(await buildMermaid(source, opts(icons, format, keep, keep_all)), o, p)));

server.registerTool('lint_diagram', {
  title: 'Lint an Excalidraw file',
  description: 'Deterministic layout check for ANY .excalidraw file (including hand-written ones): overlaps, crowding, text overflow, arrows through shapes or text, arrow crossings, group-boundary violations, dangling arrows. Each issue names element ids and a concrete fix.',
  inputSchema: { path: z.string(), preview: z.boolean().default(false) },
}, guard(async ({ path, preview: p }) => {
  const d = JSON.parse(readFileSync(resolve(path), 'utf8'));
  return { content: [{ type: 'text', text: reportText(lint(d)) }, ...(await preview(toSvg(d), p))] };
}));

server.registerTool('tidy_diagram', {
  title: 'Tidy a messy Excalidraw file',
  description: 'Recover the graph (shapes, labels, arrows, groups) from an existing .excalidraw file and re-lay it out cleanly. Prefer this over hand-editing coordinates to fix lint errors.',
  inputSchema: { path: z.string(), out: out.optional().describe('defaults to <name>.tidy'), preview: wantPreview, icons: iconsArg, format: formatArg },
}, guard(async ({ path, out: o, preview: p, icons, format }) => {
  const res = await tidy(JSON.parse(readFileSync(resolve(path), 'utf8')), opts(icons, format));
  return emit(res, o ?? resolve(path).replace(/\.excalidraw$/, '') + '.tidy', p, `before: score ${res.before.score}/100 — ${res.before.summary}\nafter:  `);
}));

server.registerTool('render_diagram', {
  title: 'Render an Excalidraw file',
  description: 'Render a .excalidraw file offline (no CDN) to a PNG preview; also writes an .svg next to it.',
  inputSchema: { path: z.string() },
}, guard(async ({ path }) => {
  const p = resolve(path);
  const svg = toSvg(JSON.parse(readFileSync(p, 'utf8')));
  writeOut(p.replace(/\.excalidraw$/, '') + '.svg', svg);
  return { content: await preview(svg, true) };
}));

server.registerTool('search_icons', {
  title: 'Search icons',
  description: 'Find icon names for the `icon` field of nodes/participants: 240 developer brands (postgresql, kafka, stripe, kubernetes…), 120+ generic icons (server, database, mail, credit-card…) and the user\'s own icons from DRAFTR_ICONS folders. Icons are also picked automatically from labels, so only use this to override or when a label is ambiguous.',
  inputSchema: { query: z.string().describe('e.g. "postgres", "queue", "payment"'), limit: z.number().int().min(1).max(50).default(15) },
}, guard(async ({ query, limit }) => {
  const hits = new IconLibrary().search(query, limit);
  return { content: [{ type: 'text', text: hits.length ? hits.map((i) => `${i.name} (${i.source}) — ${i.title}`).join('\n') : `no icons match "${query}"` }] };
}));

await server.connect(new StdioServerTransport());
