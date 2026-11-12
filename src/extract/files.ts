// Small file-system helpers shared by the extractors.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

export const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', 'coverage', 'vendor', '__pycache__', '.next', '.nuxt', '.svelte-kit',
  '.turbo', '.venv', 'venv', 'env', '.tox', 'target', '.idea', '.vscode', '.cache', 'tmp',
]);

export interface SourceFile { path: string; rel: string; text: string }

/** Every file under `root` whose name matches `re`, skipping build output and dependencies. */
export function walk(root: string, re: RegExp, limit = 5000): SourceFile[] {
  const out: SourceFile[] = [];
  const st = statSync(root);
  if (st.isFile()) return [{ path: root, rel: root.split(sep).pop()!, text: readFileSync(root, 'utf8') }];
  (function go(dir: string) {
    for (const d of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (out.length >= limit) return;
      const p = join(dir, d.name);
      if (d.isDirectory()) { if (!SKIP_DIRS.has(d.name) && !d.name.startsWith('.')) go(p); continue; }
      if (!d.isFile() || !re.test(d.name) || /\.d\.[cm]?ts$/.test(d.name)) continue;
      const size = statSync(p).size;
      if (size > 1_000_000) continue;
      out.push({ path: p, rel: relative(root, p).split(sep).join('/'), text: readFileSync(p, 'utf8') });
    }
  })(root);
  return out;
}

/** Strip comments so commented-out code doesn't count. Strings are kept (imports live in them). */
export function stripComments(text: string, lang: 'c' | 'py'): string {
  if (lang === 'py') return text.replace(/^\s*#.*$/gm, '');
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i], n = text[i + 1];
    if (c === '"' || c === "'" || c === '`') {
      const q = c; let j = i + 1;
      while (j < text.length && text[j] !== q && !(q !== '`' && text[j] === '\n')) j += text[j] === '\\' ? 2 : 1;
      out += text.slice(i, j + 1); i = j; continue;
    }
    if (c === '/' && n === '/') { while (i < text.length && text[i] !== '\n') i++; out += '\n'; continue; }
    if (c === '/' && n === '*') { const e = text.indexOf('*/', i + 2); const chunk = text.slice(i, e < 0 ? text.length : e + 2); out += chunk.replace(/[^\n]/g, ' '); i = e < 0 ? text.length : e + 1; continue; }
    out += c;
  }
  return out;
}

/** A graph id from a path or name. */
export const idOf = (s: string) => s.replace(/[^A-Za-z0-9_\-.:/]/g, '_') || '_';
