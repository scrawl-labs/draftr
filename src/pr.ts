// `draftr pr`: before/after diagrams of what a pull request changed.
//
// Looks at every diagram source the PR touches (draftr graph .json, Mermaid flowcharts, .excalidraw)
// and, optionally, at graphs extracted from the code itself (`--extract deps:src`), on the base and
// head commits. For each one that changed it writes a diff diagram plus before/after SVGs, and a
// Markdown report that a CI job can post as a PR comment.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describeDiff, diffGraphs, diffModel, isDiagramSource, readGraph, type GraphDiff } from './diff.js';
import { extract, EXTRACTORS, type ExtractorName } from './extract/index.js';
import { graphModel } from './model.js';
import { modelToSvg } from './model-svg.js';
import type { GraphInput } from './schema.js';
import { IconLibrary } from './icons/index.js';

export interface PrOptions {
  /** Base commit (e.g. origin/main). The diff is taken from the merge base. */
  base: string;
  /** Head commit (default HEAD). "WORKTREE" reads files from disk instead. */
  head?: string;
  /** Extractors to run on both commits, as "kind:path" (e.g. "deps:src"). */
  extract?: string[];
  /** Only diagram files whose path matches one of these globs. */
  paths?: string[];
  /** Directory to write SVGs and report.md into. */
  out: string;
  /** URL the SVGs will be reachable at, for the report's image links: a prefix, or a template with {file}. Default: relative paths. */
  imageBase?: string;
  /** Repository root (default: cwd). */
  cwd?: string;
}

export interface PrItem { name: string; source: string; diff: GraphDiff; files: { diff: string; before?: string; after?: string } }
export interface PrReport { items: PrItem[]; markdown: string; unchanged: string[] }

export const MARKER = '<!-- draftr-pr-bot -->';

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
const gitOr = (cwd: string, fallback: string | undefined, ...args: string[]) => { try { return git(cwd, ...args); } catch { return fallback; } };

/** "docs/**\/*.json" -> RegExp */
export function globToRegExp(glob: string): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') { re += '.*'; i++; if (glob[i + 1] === '/') i++; continue; }
    if (c === '*') { re += '[^/]*'; continue; }
    if (c === '?') { re += '[^/]'; continue; }
    re += /[.+^${}()|[\]\\]/.test(c) ? `\\${c}` : c;
  }
  return new RegExp(`^${re}${glob.endsWith('/') ? '.*' : ''}$`);
}

const slug = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'diagram';

export async function prReport(opts: PrOptions): Promise<PrReport> {
  const cwd = opts.cwd ?? process.cwd();
  const head = opts.head ?? 'HEAD';
  const fromDisk = head === 'WORKTREE';
  const base = git(cwd, 'merge-base', opts.base, fromDisk ? 'HEAD' : head).trim();
  const lib = new IconLibrary();
  mkdirSync(opts.out, { recursive: true });

  const pairs: Array<{ name: string; source: string; before?: GraphInput; after?: GraphInput }> = [];

  // 1) diagram files the PR touches
  const changed = (fromDisk ? git(cwd, 'diff', '--name-only', base) : git(cwd, 'diff', '--name-only', base, head)).split('\n').filter(Boolean);
  const wanted = (opts.paths ?? []).map(globToRegExp);
  for (const path of changed) {
    if (!/\.(json|mmd|mermaid|excalidraw)$/i.test(path)) continue;
    if (wanted.length && !wanted.some((r) => r.test(path))) continue;
    const beforeText = gitOr(cwd, undefined, 'show', `${base}:${path}`);
    const afterText = fromDisk ? (() => { try { return readFileSync(join(cwd, path), 'utf8'); } catch { return undefined; } })() : gitOr(cwd, undefined, 'show', `${head}:${path}`);
    if (![beforeText, afterText].some((t) => t !== undefined && isDiagramSource(path, t))) continue;
    try {
      pairs.push({
        name: path, source: path,
        before: beforeText !== undefined && isDiagramSource(path, beforeText) ? readGraph(beforeText, path) : undefined,
        after: afterText !== undefined && isDiagramSource(path, afterText) ? readGraph(afterText, path) : undefined,
      });
    } catch (e) { process.stderr.write(`draftr pr: skipped ${path}: ${(e as Error).message}\n`); }
  }

  // 2) graphs extracted from the code on both commits
  if (opts.extract?.length) {
    const tmp = mkdtempSync(join(tmpdir(), 'draftr-base-'));
    const headTmp = fromDisk ? undefined : mkdtempSync(join(tmpdir(), 'draftr-head-'));
    try {
      git(cwd, 'worktree', 'add', '--detach', '--force', tmp, base);
      if (headTmp) git(cwd, 'worktree', 'add', '--detach', '--force', headTmp, head);
      for (const spec of opts.extract) {
        const [kind, ...rest] = spec.split(':');
        const path = rest.join(':') || '.';
        if (!(kind in EXTRACTORS)) throw new Error(`unknown extractor "${kind}" in "${spec}" (use ${Object.keys(EXTRACTORS).join(', ')})`);
        const run = (root: string) => { try { return extract(kind as ExtractorName, join(root, path)).graph; } catch { return undefined; } };
        pairs.push({ name: `${kind} of ${path}`, source: spec, before: run(tmp), after: run(headTmp ?? cwd) });
      }
    } finally {
      gitOr(cwd, undefined, 'worktree', 'remove', '--force', tmp);
      if (headTmp) gitOr(cwd, undefined, 'worktree', 'remove', '--force', headTmp);
      rmSync(tmp, { recursive: true, force: true });
      if (headTmp) rmSync(headTmp, { recursive: true, force: true });
    }
  }

  // 3) diff, draw, report
  const items: PrItem[] = [];
  const unchanged: string[] = [];
  const url = (f: string) => (!opts.imageBase ? f : opts.imageBase.includes('{file}') ? opts.imageBase.replace('{file}', f) : `${opts.imageBase.replace(/\/?$/, '/')}${f}`);
  for (const p of pairs) {
    if (!p.before && !p.after) continue;
    const diff = diffGraphs(p.before, p.after);
    if (diff.same) { unchanged.push(p.name); continue; }
    const stem = slug(p.name);
    const files: PrItem['files'] = { diff: `${stem}.diff.svg` };
    writeFileSync(join(opts.out, files.diff), modelToSvg(await diffModel(diff, { icons: lib })));
    for (const side of ['before', 'after'] as const) {
      const g = p[side];
      if (!g?.nodes?.length) continue;
      files[side] = `${stem}.${side}.svg`;
      writeFileSync(join(opts.out, files[side]!), modelToSvg(await graphModel(g, { icons: lib })));
    }
    items.push({ name: p.name, source: p.source, diff, files });
  }

  const lines = [MARKER, '### 🗺️ Diagram changes', ''];
  if (!items.length) lines.push('No diagram changes in this pull request.');
  for (const it of items) {
    lines.push(`#### \`${it.name}\``, '', `${describeDiff(it.diff)}. Green = added, red = removed, amber = changed.`, '', `![${it.name} diff](${url(it.files.diff)})`, '');
    if (it.files.before || it.files.after) {
      lines.push('<details><summary>Before / after</summary>', '', '| Before | After |', '| --- | --- |',
        `| ${it.files.before ? `![before](${url(it.files.before)})` : '*(new)*'} | ${it.files.after ? `![after](${url(it.files.after)})` : '*(deleted)*'} |`, '', '</details>', '');
    }
  }
  if (unchanged.length) lines.push(`<sub>Checked, no change: ${unchanged.map((u) => `\`${u}\``).join(', ')}</sub>`, '');
  lines.push('<sub>Drawn by [draftr](https://github.com/scrawl-labs/draftr)</sub>');
  const markdown = lines.join('\n') + '\n';
  writeFileSync(join(opts.out, 'report.md'), markdown);
  return { items, markdown, unchanged };
}
