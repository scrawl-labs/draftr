// A pragmatic Mermaid subset -> draftr input, so existing diagrams (and the
// syntax every model already knows) get draftr's layout and lint for free.
//
// flowchart/graph: TD|TB|LR|RL|BT, node shapes [] () ([]) [()] (()) {} [//],
//   edges --> --- -.-> ==> with |label| or "-- label -->", chains, A & B --> C,
//   nested subgraphs. classDef/style/click/linkStyle lines are ignored.
// sequenceDiagram: participant/actor [as Label], ->> -->> -> --> -x -) messages,
//   autonumber, title. Notes/loops/alt blocks are ignored.
import type { GraphInput, Kind, SequenceInput } from './schema.js';

const DIRS: Record<string, 'RIGHT' | 'DOWN' | 'LEFT' | 'UP'> = { LR: 'RIGHT', RL: 'LEFT', TD: 'DOWN', TB: 'DOWN', BT: 'UP' };

const clean = (s: string) => s.trim().replace(/^"(.*)"$/s, '$1').replace(/<br\s*\/?>/gi, '\n').replace(/\\n/g, '\n').trim();

export function parseMermaid(src: string): GraphInput | SequenceInput {
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

interface Cursor { s: string; i: number }
const ws = (c: Cursor) => { while (c.i < c.s.length && /\s/.test(c.s[c.i])) c.i++; };

function readNode(c: Cursor): { id: string; label?: string; kind?: Kind } | null {
  ws(c);
  const m = /^[A-Za-z0-9_\-.\u0080-￿]+/.exec(c.s.slice(c.i));
  if (!m) return null;
  // don't swallow the start of an arrow like "A--> B"
  let id = m[0];
  const arrowAt = id.search(/--|==|-\./);
  if (arrowAt > 0) id = id.slice(0, arrowAt);
  c.i += id.length;
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
  const nodes = new Map<string, { id: string; label: string; kind: Kind; group?: string }>();
  const edges: NonNullable<GraphInput['edges']> = [];
  const groups: NonNullable<GraphInput['groups']> = [];
  const stack: string[] = [];
  let direction: GraphInput['direction'] = 'DOWN';
  let title: string | undefined;
  let anon = 0;

  const touch = (n: { id: string; label?: string; kind?: Kind }) => {
    const cur = nodes.get(n.id);
    if (!cur) nodes.set(n.id, { id: n.id, label: n.label ?? n.id, kind: n.kind ?? 'service', group: stack[stack.length - 1] });
    else if (n.label) { cur.label = n.label; cur.kind = n.kind ?? cur.kind; }
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
function parseSequenceDiagram(lines: string[]): SequenceInput {
  const participants = new Map<string, { id: string; label: string; kind: Kind }>();
  const messages: NonNullable<SequenceInput['messages']> = [];
  let autonumber = false;
  let title: string | undefined;
  const touch = (id: string, label?: string, kind?: Kind) => {
    const cur = participants.get(id);
    if (!cur) participants.set(id, { id, label: label ?? id, kind: kind ?? 'service' });
    else if (label) cur.label = label;
  };
  for (const l of lines.slice(1)) {
    if (/^autonumber\b/.test(l)) { autonumber = true; continue; }
    if (/^title:?\s/.test(l)) { title = l.replace(/^title:?\s*/, ''); continue; }
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
