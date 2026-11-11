// Icon lookup: explicit names, automatic matching from labels, and user icon folders.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, delimiter, extname, join, resolve } from 'node:path';
import { BRANDS, EXACT_ONLY, GENERIC, GENERIC_KEYWORDS, KIND_ICONS, type BrandIcon } from './catalog.js';

export type IconSource = 'brand' | 'generic' | 'custom';

export interface Icon {
  /** Name to use in a node's `icon` field to get this icon again. */
  name: string;
  title: string;
  source: IconSource;
  /** Brand color (brand icons only), e.g. "#4169E1". */
  hex?: string;
  /** Standalone SVG document. `color` recolors brand and generic icons; custom icons keep their own colors. */
  svg(color?: string): string;
}

export interface IconOptions {
  /** Folders of your own .svg icons; file name (without .svg) is the icon name. Also read from DRAFTR_ICONS. */
  dirs?: string[];
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9.+#/]+/g, ' ').trim();
const compact = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

function brandIcon(b: BrandIcon): Icon {
  return {
    name: b.slug, title: b.title, source: 'brand', hex: `#${b.hex}`,
    svg: (color = `#${b.hex}`) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="${color}" d="${b.path}"/></svg>`,
  };
}

function genericIcon(name: string): Icon {
  const body = GENERIC[name];
  return {
    name, title: name, source: 'generic',
    svg: (color = '#1e1e1e') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`,
  };
}

function customIcon(name: string, file: string): Icon {
  return { name, title: name, source: 'custom', svg: () => readFileSync(file, 'utf8') };
}

// ---- brand index: every key (slug, title, alias) -> brand ----
interface Key { key: string; words: number; brand: BrandIcon; exactOnly: boolean }
const BRAND_KEYS: Key[] = [];
const BRAND_BY_NAME = new Map<string, BrandIcon>();
for (const b of BRANDS) {
  const keys = new Set([b.slug, norm(b.title), ...b.aliases.map(norm)]);
  for (const key of keys) {
    if (!key) continue;
    BRAND_KEYS.push({ key, words: key.split(' ').length, brand: b, exactOnly: EXACT_ONLY.includes(key) });
    BRAND_BY_NAME.set(compact(key), b);
  }
  BRAND_BY_NAME.set(b.slug, b);
}
// longest keys first so "google cloud storage" beats "google cloud"
BRAND_KEYS.sort((a, b) => b.key.length - a.key.length);

export class IconLibrary {
  private custom = new Map<string, Icon>();
  /** compacted name ("acme-billing" -> "acmebilling") -> icon, for matching labels */
  private customLoose = new Map<string, Icon>();

  constructor(opts: IconOptions = {}) {
    const dirs = [...(opts.dirs ?? []), ...(process.env.DRAFTR_ICONS ? process.env.DRAFTR_ICONS.split(delimiter) : [])];
    for (const dir of dirs) this.addDir(dir);
  }

  /** Register every .svg in a folder (non-recursive). Later folders win. */
  addDir(dir: string) {
    const d = resolve(dir);
    if (!existsSync(d) || !statSync(d).isDirectory()) throw new Error(`icon folder not found: ${dir}`);
    for (const f of readdirSync(d)) {
      if (extname(f).toLowerCase() !== '.svg') continue;
      const name = basename(f, extname(f)).toLowerCase();
      const icon = customIcon(name, join(d, f));
      this.custom.set(name, icon);
      this.customLoose.set(compact(name), icon);
    }
  }

  /** Look up an icon by exact name: custom name, brand slug/alias/title, or generic (Lucide) name. */
  get(name: string): Icon | undefined {
    const n = name.toLowerCase().trim();
    const c = this.custom.get(n) ?? this.customLoose.get(compact(n));
    if (c) return c;
    const b = BRAND_BY_NAME.get(n) ?? BRAND_BY_NAME.get(compact(n));
    if (b) return brandIcon(b);
    if (GENERIC[n]) return genericIcon(n);
    return undefined;
  }

  /**
   * Pick an icon for a node. Order: explicit `icon` → custom icon named like the label →
   * brand mentioned in the label → generic keyword → the node kind's default.
   */
  forNode(node: { label: string; kind?: string; icon?: string | false }): Icon | undefined {
    if (node.icon === false) return undefined;
    if (typeof node.icon === 'string') {
      const hit = this.get(node.icon);
      if (!hit) throw new Error(`unknown icon "${node.icon}"${suggest(this, node.icon)}`);
      return hit;
    }
    const label = node.label.replace(/\n/g, ' ');
    const custom = this.customLoose.get(compact(label));
    if (custom) return custom;
    const brand = matchBrand(label);
    if (brand) return brandIcon(brand);
    const kind = node.kind ?? 'service';
    // A queue or database is better described by its kind than by words in its name ("order.created").
    if (kind !== 'queue' && kind !== 'database' && kind !== 'storage') {
      const g = matchGeneric(label);
      if (g) return genericIcon(g);
    }
    const k = KIND_ICONS[kind];
    return k && GENERIC[k] ? genericIcon(k) : undefined;
  }

  /** Search names and titles (for agents and `draftr icons <query>`). */
  search(query: string, limit = 20): Icon[] {
    const q = compact(query);
    const out: Array<{ icon: Icon; score: number }> = [];
    const score = (cands: string[]) => {
      let best = 0;
      for (const c of cands.map(compact)) {
        if (!c) continue;
        if (c === q) best = Math.max(best, 3);
        else if (c.startsWith(q)) best = Math.max(best, 2);
        else if (c.includes(q)) best = Math.max(best, 1);
        else if (q.length >= 4 && Math.abs(c.length - q.length) <= 2 && editDistance(c, q) <= 2) best = Math.max(best, 0.8);
      }
      return best;
    };
    for (const icon of this.custom.values()) { const s = score([icon.name]); if (s) out.push({ icon, score: s + 0.5 }); }
    for (const b of BRANDS) { const s = score([b.slug, b.title, ...b.aliases]); if (s) out.push({ icon: brandIcon(b), score: s }); }
    const kindsFor = (name: string) => Object.entries(KIND_ICONS).filter(([, v]) => v === name).map(([k]) => k);
    for (const [name, kws] of GENERIC_KEYWORDS) { const s = score([name, ...kws, ...kindsFor(name)]); if (s) out.push({ icon: genericIcon(name), score: s - 0.1 }); }
    for (const [kind, name] of Object.entries(KIND_ICONS)) { if (out.some((o) => o.icon.name === name)) continue; const s = score([kind, name]); if (s && GENERIC[name]) out.push({ icon: genericIcon(name), score: s - 0.1 }); }
    for (const name of Object.keys(GENERIC)) { if (out.some((o) => o.icon.name === name)) continue; const s = score([name]); if (s) out.push({ icon: genericIcon(name), score: s - 0.2 }); }
    return out.sort((a, b) => b.score - a.score || a.icon.name.localeCompare(b.icon.name)).slice(0, limit).map((o) => o.icon);
  }

  /** Every icon name, for listings. */
  names(): { custom: string[]; brand: string[]; generic: string[] } {
    return { custom: [...this.custom.keys()].sort(), brand: BRANDS.map((b) => b.slug), generic: Object.keys(GENERIC) };
  }
}

function matchBrand(label: string): BrandIcon | undefined {
  const text = ` ${norm(label)} `;
  const whole = norm(label);
  for (const k of BRAND_KEYS) {
    if (k.exactOnly) { if (whole === k.key) return k.brand; continue; }
    if (text.includes(` ${k.key} `)) return k.brand;
  }
  // "PostgreSQL16", "MongoDBAtlas": try the label without spaces as a prefix match on long keys
  const c = compact(label);
  for (const k of BRAND_KEYS) if (!k.exactOnly && k.key.length >= 5 && c.startsWith(compact(k.key))) return k.brand;
  return undefined;
}

function matchGeneric(label: string): string | undefined {
  const text = ` ${norm(label)} `;
  for (const [name, kws] of GENERIC_KEYWORDS) {
    for (const kw of kws) if (text.includes(` ${norm(kw)} `)) return name;
  }
  return undefined;
}

function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0]; dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}

function suggest(lib: IconLibrary, name: string): string {
  const hits = lib.search(name, 5).map((i) => i.name);
  return hits.length ? ` — did you mean: ${hits.join(', ')}?` : ' — try `draftr icons <query>`';
}

export const defaultIcons = () => new IconLibrary();
export { BRANDS, GENERIC };
