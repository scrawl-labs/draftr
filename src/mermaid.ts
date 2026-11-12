// A pragmatic Mermaid subset -> draftr input, so existing diagrams (and the
// syntax every model already knows) get draftr's layout and lint for free.
//
// flowchart/graph: TD|TB|LR|RL|BT, node shapes [] () ([]) [()] (()) {} [//],
//   edges --> --- -.-> ==> with |label| or "-- label -->", chains, A & B --> C,
//   nested subgraphs, and the v11 node metadata A@{ icon: "logos:kafka", label: "Events", shape: cyl }.
//   classDef/style/click/linkStyle lines are ignored.
// sequenceDiagram: participant/actor [as Label], participant A@{ "type": "database" },
//   ->> -->> -> --> -x -) messages, autonumber, title. Notes/loops/alt blocks are ignored.
import { IconLibrary } from './icons/index.js';
import type { GraphInput, Kind, SequenceInput } from './schema.js';

export interface MermaidOptions {
  /** Library that resolves `icon:` names; false drops them. Default: the built-in icons. */
  icons?: IconLibrary | false;
}

const DIRS: Record<string, 'RIGHT' | 'DOWN' | 'LEFT' | 'UP'> = { LR: 'RIGHT', RL: 'LEFT', TD: 'DOWN', TB: 'DOWN', BT: 'UP' };

const clean = (s: string) => s.trim().replace(/^"(.*)"$/s, '$1').replace(/<br\s*\/?>/gi, '\n').replace(/\\n/g, '\n').trim();

export function parseMermaid(src: string, opts: MermaidOptions = {}): GraphInput | SequenceInput {
  const lib = opts.icons === false ? false : opts.icons ?? new IconLibrary();
  const res = parse(src);
  // icon packs are named "pack:name" (logos:postgresql, fa:fa-user, aws:s3); keep what draftr can draw
  for (const n of 'nodes' in res ? res.nodes : res.participants) {
    if (typeof n.icon !== 'string') continue;
    const name = lib ? resolveIcon(lib, n.icon) : undefined;
    if (name) n.icon = name; else delete n.icon;
  }
  return res;
}

// Font Awesome names Mermaid users reach for, where Lucide calls the icon something else
const FA_NAMES: Record<string, string> = {
  envelope: 'mail', 'envelope-open': 'mail-open', gear: 'settings', cog: 'settings', gears: 'settings', 'user-circle': 'circle-user',
  'shopping-cart': 'shopping-cart', 'cart-shopping': 'shopping-cart', 'hdd': 'hard-drive', 'hard-drive': 'hard-drive', 'mobile': 'smartphone',
  'mobile-screen': 'smartphone', 'desktop': 'monitor', 'laptop': 'laptop', 'globe': 'globe', 'earth': 'globe', 'cloud': 'cloud', 'lock': 'lock',
  'key': 'key', 'bell': 'bell', 'file': 'file', 'file-alt': 'file-text', 'file-lines': 'file-text', 'search': 'search', 'magnifying-glass': 'search',
  'credit-card': 'credit-card', 'money-bill': 'banknote', 'users': 'users', 'user': 'user', 'server': 'server', 'database': 'database',
  'robot': 'bot', 'microchip': 'cpu', 'chart-line': 'chart-line', 'clock': 'clock', 'calendar': 'calendar', 'shield-alt': 'shield', 'shield-halved': 'shield',
};

export function resolveIcon(lib: IconLibrary, raw: string): string | undefined {
  const tail = raw.includes(':') ? raw.slice(raw.indexOf(':') + 1) : raw;
  const bare = tail.replace(/^(fa[brs]?|fa-solid|fa-brands|fa-regular)[- ]/, '').replace(/^fa-/, '');
  const pick = (s: string) => (lib.get(s) ? s : lib.get(FA_NAMES[s] ?? '') ? FA_NAMES[s] : undefined);
  return pick(raw) ?? pick(tail) ?? pick(bare) ?? pick(bare.replace(/-(icon|logo|plain|original|wordmark)$/g, ''))
    ?? (bare.includes('-') ? pick(bare.split('-').pop()!) : undefined);
}

function parse(src: string): GraphInput | SequenceInput {
  const lines = src.replace(/%%.*$/gm, '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const header = lines.find((l) => !l.startsWith('---') && !/^title:/.test(l)) ?? '';
  if (/^sequenceDiagram\b/.test(header)) return parseSequenceDiagram(lines);
  if (/^(graph|flowchart)\b/.test(header)) return parseFlowchart(lines);
  throw new Error(`Unsupported Mermaid diagram "${header.split(/\s/)[0]}". Supported: flowchart/graph, sequenceDiagram.`);
}

// ---------- flowchart ----------
const SHAPES: Array<{ open: string; close: string; kind: Kind }> = [
  { open: '([', close: '])', kind: 'client' },
  { open: '[(', close: ')]', kind: 'database' },
  { open: '((', close: '))', kind: 'user' },
  { open: '[[', close: ']]', kind: 'service' },
  { open: '[/', close: '/]', kind: 'queue' },
  { open: '[\\', close: '\\]', kind: 'queue' },
  { open: '{{', close: '}}', kind: 'decision' },
  { open: '[', close: ']', kind: 'service' },
  { open: '(', close: ')', kind: 'service' },
  { open: '{', close: '}', kind: 'decision' },
  { open: '>', close: ']', kind: 'note' },
];

// Mermaid v11 shape names (and their aliases) -> kind
const SHAPE_NAMES: Record<string, Kind> = {};
const shapeKinds: Array<[Kind, string]> = [
  ['database', 'cyl db database cylinder'],
  ['queue', 'h-cyl das horizontal-cylinder lean-r lean-right in-out lean-l lean-left out-in'],
  ['storage', 'lin-cyl disk lined-cylinder bow-rect stored-data win-pane internal-storage'],
  ['user', 'circle circ dbl-circ double-circle'],
  ['client', 'stadium terminal pill'],
  ['decision', 'diam decision diamond question hex hexagon prepare'],
  ['note', 'brace comment brace-r brace-l braces text doc document docs documents lin-doc lined-document tag-doc tagged-document flag paper-tape'],
];
for (const [k, names] of shapeKinds) for (const n of names.split(' ')) SHAPE_NAMES[n] = k;

/** `{ icon: "fa:user", label: "x", h: 60 }` -> { icon: 'fa:user', label: 'x', h: '60' }. Quotes optional. */
export function parseMeta(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /\s*"?([\w-]+)"?\s*:\s*("(?:[^"\\]|\\.)*"|'[^']*'|[^,]*)\s*(?:,|$)/gy;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) && m[0]) out[m[1]] = m[2].trim().replace(/^(["'])(.*)\1$/s, '$2');
  return out;
}

/** Reads `@{ ... }` at the cursor, if present. */
function readMeta(c: Cursor): Record<string, string> | undefined {
  if (!c.s.startsWith('@{', c.i)) return undefined;
  const end = c.s.indexOf('}', c.i + 2);
  if (end < 0) return undefined;
  const meta = parseMeta(c.s.slice(c.i + 2, end));
  c.i = end + 1;
  return meta;
}

interface Cursor { s: string; i: number }
const ws = (c: Cursor) => { while (c.i < c.s.length && /\s/.test(c.s[c.i])) c.i++; };

type ReadNode = { id: string; label?: string; kind?: Kind; icon?: string };

function readNode(c: Cursor): ReadNode | null {
  ws(c);
  const m = /^[A-Za-z0-9_\-.\u0080-￿]+/.exec(c.s.slice(c.i));
  if (!m) return null;
  // don't swallow the start of an arrow like "A--> B"
  let id = m[0];
  const arrowAt = id.search(/--|==|-\./);
  if (arrowAt > 0) id = id.slice(0, arrowAt);
  c.i += id.length;
  const meta = readMeta(c);
  if (meta) {
    const kind = meta.shape ? SHAPE_NAMES[meta.shape.toLowerCase()] ?? 'service' : undefined;
    return { id, ...(meta.label ? { label: clean(meta.label) } : {}), ...(kind ? { kind } : {}), ...(meta.icon ? { icon: meta.icon } : {}) };
  }
  for (const sh of SHAPES) {
    if (c.s.startsWith(sh.open, c.i)) {
      const end = c.s.indexOf(sh.close, c.i + sh.open.length);
      if (end < 0) continue;
      const label = clean(c.s.slice(c.i + sh.open.length, end));
      c.i = end + sh.close.length;
      return { id, label, kind: sh.kind };
    }
  }
  return { id };
}

function readEdge(c: Cursor): { label?: string; style: 'solid' | 'dashed'; highlight?: boolean } | null {
  ws(c);
  const rest = c.s.slice(c.i);
  const withText = /^(--|==|-\.)\s*([^>|-][^>]*?)\s*(-->|==>|\.->|---|===|\.-)/.exec(rest);
  if (withText && !/^(-->|---|==>|===|-\.->|-\.-)/.test(rest)) {
    c.i += withText[0].length;
    return { label: clean(withText[2]), style: withText[1] === '-.' ? 'dashed' : 'solid', highlight: withText[1] === '==' || undefined };
  }
  const m = /^<?(-{2,}>?|={2,}>?|-\.+->?|~~~)[ox]?/.exec(rest);
  if (!m) return null;
  c.i += m[0].length;
  const op = m[1];
  let label: string | undefined;
  ws(c);
  if (c.s[c.i] === '|') {
    const end = c.s.indexOf('|', c.i + 1);
    label = clean(c.s.slice(c.i + 1, end));
    c.i = end + 1;
  }
  return { label, style: op.includes('.') ? 'dashed' : 'solid', highlight: op.startsWith('=') || undefined };
}

function parseFlowchart(lines: string[]): GraphInput {
  const nodes = new Map<string, { id: string; label: string; kind: Kind; group?: string; icon?: string }>();
  const edges: NonNullable<GraphInput['edges']> = [];
  const groups: NonNullable<GraphInput['groups']> = [];
  const stack: string[] = [];
  let direction: GraphInput['direction'] = 'DOWN';
  let title: string | undefined;
  let anon = 0;

  const touch = (n: ReadNode) => {
    const cur = nodes.get(n.id);
    if (!cur) nodes.set(n.id, { id: n.id, label: n.label ?? n.id, kind: n.kind ?? 'service', group: stack[stack.length - 1], ...(n.icon ? { icon: n.icon } : {}) });
    else {
      if (n.label) cur.label = n.label;
      if (n.kind) cur.kind = n.kind;
      if (n.icon) cur.icon = n.icon;
    }
  };

  for (const raw of lines.flatMap((l) => l.split(/;\s*(?=(?:[^"]*"[^"]*")*[^"]*$)/)).map((l) => l.trim()).filter(Boolean)) {
    const head = /^(graph|flowchart)\s*(\w+)?/.exec(raw);
    if (head) { direction = DIRS[head[2]?.toUpperCase() ?? 'TD'] ?? 'DOWN'; continue; }
    if (/^title:?\s/.test(raw)) { title = raw.replace(/^title:?\s*/, ''); continue; }
    if (/^(classDef|class|style|linkStyle|click|direction|---|accTitle|accDescr)\b/.test(raw)) continue;
    const sg = /^subgraph\s+(.+)$/.exec(raw);
    if (sg) {
      const body = sg[1].trim();
      const m = /^([^\s[]+)\s*\[(.+)\]$/.exec(body);
      const id = m ? m[1] : /^[\w-]+$/.test(body) ? body : `subgraph_${++anon}`;
      groups.push({ id, label: clean(m ? m[2] : body), parent: stack[stack.length - 1] });
      stack.push(id);
      continue;
    }
    if (raw === 'end') { stack.pop(); continue; }

    const c: Cursor = { s: raw, i: 0 };
    let left: string[] = [];
    const readGroup = (): string[] | null => {
      const ids: string[] = [];
      for (;;) {
        const n = readNode(c);
        if (!n) return ids.length ? ids : null;
        touch(n);
        ids.push(n.id);
        ws(c);
        if (c.s[c.i] === '&') { c.i++; continue; }
        return ids;
      }
    };
    const first = readGroup();
    if (!first) continue;
    left = first;
    for (;;) {
      const e = readEdge(c);
      if (!e) break;
      const right = readGroup();
      if (!right) break;
      for (const a of left) for (const b of right) edges.push({ from: a, to: b, ...(e.label ? { label: e.label } : {}), style: e.style, ...(e.highlight ? { highlight: true } : {}) });
      left = right;
    }
  }
  // subgraph ids that were also used as plain nodes become groups only
  const groupIds = new Set(groups.map((g) => g.id));
  for (const id of groupIds) nodes.delete(id);
  return {
    type: 'graph', title, direction,
    nodes: [...nodes.values()],
    edges: edges.filter((e) => !groupIds.has(e.from) && !groupIds.has(e.to)),
    groups,
  };
}

// ---------- sequenceDiagram ----------
const PARTICIPANT_TYPES: Record<string, Kind> = { actor: 'user', database: 'database', queue: 'queue', collections: 'storage', boundary: 'service', control: 'service', entity: 'service' };

function parseSequenceDiagram(lines: string[]): SequenceInput {
  const participants = new Map<string, { id: string; label: string; kind: Kind; icon?: string }>();
  const messages: NonNullable<SequenceInput['messages']> = [];
  let autonumber = false;
  let title: string | undefined;
  const touch = (id: string, label?: string, kind?: Kind) => {
    const cur = participants.get(id);
    if (!cur) participants.set(id, { id, label: label ?? id, kind: kind ?? 'service' });
    else {
      if (label) cur.label = label;
      if (kind) cur.kind = kind;
    }
  };
  for (const l of lines.slice(1)) {
    if (/^autonumber\b/.test(l)) { autonumber = true; continue; }
    if (/^title:?\s/.test(l)) { title = l.replace(/^title:?\s*/, ''); continue; }
    const pm = /^(participant|actor)\s+([^\s@]+)@\{(.*)\}\s*(?:as\s+(.+))?$/.exec(l);
    if (pm) {
      const meta = parseMeta(pm[3]);
      const kind = pm[1] === 'actor' ? 'user' : PARTICIPANT_TYPES[meta.type?.toLowerCase() ?? ''] ?? 'service';
      touch(pm[2], pm[4] ? clean(pm[4]) : meta.alias ? clean(meta.alias) : meta.label ? clean(meta.label) : undefined, kind);
      if (meta.icon) participants.get(pm[2])!.icon = meta.icon;
      continue;
    }
    const p = /^(participant|actor)\s+(\S+?)(?:\s+as\s+(.+))?$/.exec(l);
    if (p) { touch(p[2], p[3] ? clean(p[3]) : undefined, p[1] === 'actor' ? 'user' : 'service'); continue; }
    const m = /^([^\s\-+>:]+)\s*(-->>|->>|-->|->|--x|-x|--\)|-\))\s*[+-]?\s*([^\s:]+)\s*:\s*(.*)$/.exec(l);
    if (m) {
      touch(m[1]); touch(m[3]);
      messages.push({ from: m[1], to: m[3], label: clean(m[4]), style: m[2].startsWith('--') ? 'dashed' : 'solid' });
    }
  }
  return { type: 'sequence', title, autonumber, participants: [...participants.values()], messages };
}
