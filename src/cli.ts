#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { build, buildMermaid, extract, EXTRACTORS, FORMAT_NAMES, FORMATS, formatReport, IconLibrary, lint, svgToPng, tidy, toSvg, type BuildOptions, type Format, type LintReport } from './index.js';

const USAGE = `draftr — the model says what, draftr decides where.

usage: draftr <command> <file> [options]

  build  <graph.json | seq.json | diagram.mmd>   layout -> editable file + .svg (+ .png), then lint
  lint   <file.excalidraw>                       lint ANY Excalidraw file (exit 1 on errors)
  tidy   <file.excalidraw>                       recover the graph from a messy file and re-lay it out
  render <file.excalidraw>                       offline render -> .svg (+ .png)
  icons  [query]                                 search the icon library (no query: counts)
  extract <${Object.keys(EXTRACTORS).join('|')}> <dir>        read code -> graph .json + diagram
${Object.entries(EXTRACTORS).map(([k, v]) => `           ${k.padEnd(8)} ${v}`).join('\n')}

options:
  -o, --out <prefix>   output path prefix (default: next to the input; tidy adds ".tidy")
  -f, --format <name>  editable output: ${FORMAT_NAMES.join(' | ')} (default: excalidraw)
  --no-png             skip PNG (no Playwright needed)
  --no-icons           draw no icons
  --icons <dir>        add a folder of your own .svg icons (repeatable; also DRAFTR_ICONS)
  --json               print the lint report as JSON

extract options:
  --by <file|dir>      deps: one box per file or per directory (default: whichever fits)
  --depth <n>          deps: directory depth to fold to with --by dir
  --external           deps: also draw the most used third-party packages
  --tests              deps: include test files
  --all-edges          deps: keep edges already implied by others
  --graph-only         write the graph .json only (edit it, then draftr build it)
  -h, --help           show this help`;

const args = process.argv.slice(2);
const flag = (...k: string[]) => args.some((a) => k.includes(a));
const opt = (...k: string[]) => { const i = args.findIndex((a) => k.includes(a)); return i >= 0 ? args[i + 1] : undefined; };
const VALUED = ['-o', '--out', '--icons', '-f', '--format', '--keep', '--by', '--depth'];
const [cmd, file, arg2] = args.filter((a, i) => !a.startsWith('-') && !VALUED.includes(args[i - 1]));
const iconDirs = args.flatMap((a, i) => (a === '--icons' && args[i + 1] ? [args[i + 1]] : []));
const format = (opt('-f', '--format') ?? 'excalidraw') as Format;
if (!FORMATS[format]) { console.error(`draftr: unknown format "${format}" (use one of: ${FORMAT_NAMES.join(', ')})`); process.exit(1); }
const buildOpts: BuildOptions = { icons: flag('--no-icons') ? false : { dirs: iconDirs }, format };

if (flag('-h', '--help') || !cmd) { console.log(USAGE); process.exit(cmd || flag('-h', '--help') ? 0 : 1); }
if (!file && cmd !== 'icons') { console.error(`draftr ${cmd}: missing <file>\n\n${USAGE}`); process.exit(1); }

const stem = file ? join(dirname(file), basename(file, extname(file))) : '';
const wantPng = !flag('--no-png');

function show(r: LintReport) { console.log(flag('--json') ? JSON.stringify(r, null, 2) : formatReport(r)); }

async function write(prefix: string, file: { ext: string; content: string } | null, svg: string): Promise<string[]> {
  mkdirSync(dirname(prefix), { recursive: true });
  const out: string[] = [];
  if (file) { writeFileSync(`${prefix}${file.ext}`, file.content); out.push(`${prefix}${file.ext}`); }
  writeFileSync(`${prefix}.svg`, svg); out.push(`${prefix}.svg`);
  if (wantPng) {
    try { writeFileSync(`${prefix}.png`, await svgToPng(svg)); out.push(`${prefix}.png`); }
    catch (e) { console.error(`(png skipped: ${(e as Error).message})`); }
  }
  return out;
}

async function main() {
  if (cmd === 'icons') {
    const lib = new IconLibrary({ dirs: iconDirs });
    if (!file) {
      const n = lib.names();
      console.log(`${n.brand.length} brand, ${n.generic.length} generic, ${n.custom.length} custom icons. Search: draftr icons <query>`);
      return 0;
    }
    const hits = lib.search(file, 30);
    if (!hits.length) { console.log(`no icons match "${file}"`); return 1; }
    for (const i of hits) console.log(`${i.name.padEnd(24)} ${i.source.padEnd(8)} ${i.title}`);
    return 0;
  }
  if (cmd === 'extract') {
    if (!arg2) { console.error(`draftr extract: usage: draftr extract <${Object.keys(EXTRACTORS).join('|')}> <dir>`); return 1; }
    const kind = file as keyof typeof EXTRACTORS;
    const by = opt('--by') as 'file' | 'dir' | undefined;
    const { graph, notes } = extract(kind, arg2, {
      by, depth: opt('--depth') ? Number(opt('--depth')) : undefined,
      external: flag('--external'), tests: flag('--tests'), allEdges: flag('--all-edges'),
    });
    const prefix = opt('-o', '--out') ?? `${basename(arg2.replace(/\/+$/, '')) || 'code'}.${kind}`;
    mkdirSync(dirname(prefix), { recursive: true });
    writeFileSync(`${prefix}.json`, JSON.stringify(graph, null, 2) + '\n');
    for (const n of notes) console.error(n);
    if (flag('--graph-only')) { console.error(`wrote ${prefix}.json`); return 0; }
    const res = await build(graph, buildOpts);
    const files = await write(prefix, res.file, res.svg);
    show(res.report);
    console.error(`wrote ${prefix}.json, ${files.join(', ')}`);
    return res.report.ok ? 0 : 1;
  }
  const src = readFileSync(file, 'utf8');
  switch (cmd) {
    case 'build': {
      const res = /\.(mmd|mermaid)$/i.test(file) ? await buildMermaid(src, buildOpts) : await build(JSON.parse(src), buildOpts);
      const files = await write(opt('-o', '--out') ?? stem, res.file, res.svg);
      show(res.report);
      console.error(`wrote ${files.join(', ')}`);
      return res.report.ok ? 0 : 1;
    }
    case 'lint': {
      const r = lint(JSON.parse(src));
      show(r);
      return r.ok ? 0 : 1;
    }
    case 'tidy': {
      const res = await tidy(JSON.parse(src), buildOpts);
      const files = await write(opt('-o', '--out') ?? `${stem}.tidy`, res.file, res.svg);
      console.log(`before: score ${res.before.score}/100 — ${res.before.summary}`);
      console.log(`after:  score ${res.report.score}/100 — ${res.report.summary}`);
      if (!res.report.ok) show(res.report);
      console.error(`wrote ${files.join(', ')}`);
      return res.report.ok ? 0 : 1;
    }
    case 'render': {
      const files = await write(opt('-o', '--out') ?? stem, null, toSvg(JSON.parse(src)));
      console.error(`wrote ${files.join(', ')}`);
      return 0;
    }
    default:
      console.error(`unknown command "${cmd}"\n\n${USAGE}`);
      return 1;
  }
}

main().then((code) => process.exit(code), (e) => { console.error(`draftr: ${(e as Error).message}`); process.exit(2); });
