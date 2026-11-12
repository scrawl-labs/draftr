// Diagram diffs: what changed between two versions of a graph, drawn as one diagram.
// Added boxes and arrows are green, removed ones red and dashed, changed ones amber, and everything
// that stayed the same steps back into grey so the change is what you see first.
import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import { graphModel, type DiagramModel, type ModelOptions } from './model.js';
import { parseMermaid } from './mermaid.js';
import { parseGraph, type GraphInput } from './schema.js';
import type { Hue } from './theme.js';
import { THEME } from './theme.js';
import { extractGraph } from './tidy.js';
import type { ExcalidrawDoc } from './types.js';

export type Change = 'added' | 'removed' | 'changed' | 'same';

export interface GraphDiff {
  /** Both versions merged; captions say what changed. */
  graph: GraphInput;
  nodes: Record<string, Change>;
  edges: Change[];
  /** Counts, e.g. { added: 2, removed: 1, changed: 0 } for boxes and arrows. */
  summary: { nodes: Record<Exclude<Change, 'same'>, number>; edges: Record<Exclude<Change, 'same'>, number> };
  /** Nothing changed. */
  same: boolean;
}

export const DIFF_HUES: Record<Change, Hue> = {
  added: { fill: '#ebfbee', line: '#51cf66', ink: '#2b8a3e', solid: '#2f9e44', tldraw: 'green' },
  removed: { fill: '#fff5f5', line: '#ff8787', ink: '#c92a2a', solid: '#e03131', tldraw: 'red' },
  changed: { fill: '#fff9db', line: '#fcc419', ink: '#e67700', solid: '#f08c00', tldraw: 'yellow' },
  same: { fill: '#f8f9fa', line: '#ced4da', ink: '#868e96', solid: '#495057', tldraw: 'grey' },
};

const EMPTY: GraphInput = { nodes: [] as unknown as GraphInput['nodes'] };

/** Read a graph from draftr JSON, Mermaid flowchart or Excalidraw text. `name` picks the format by extension. */
export function readGraph(text: string, name: string): GraphInput {
  const ext = extname(name).toLowerCase();
  if (ext === '.mmd' || ext === '.mermaid') {
    const g = parseMermaid(text);
    if ((g as { type?: string }).type === 'sequence') throw new Error(`${name}: sequence diagrams can't be diffed yet`);
    return g as GraphInput;
  }
  const json = JSON.parse(text);
  if (ext === '.excalidraw' || json.type === 'excalidraw') return extractGraph(json as ExcalidrawDoc);
  if (json.type === 'sequence') throw new Error(`${name}: sequence diagrams can't be diffed yet`);
  if (!Array.isArray(json.nodes)) throw new Error(`${name}: not a draftr graph (no "nodes")`);
  return json as GraphInput;
}

export const readGraphFile = (path: string) => readGraph(readFileSync(path, 'utf8'), path);

/** Whether a file looks like a diagram source draftr can diff. */
export function isDiagramSource(name: string, text: string): boolean {
  if (/\.(mmd|mermaid)$/i.test(name)) return /^\s*(graph|flowchart)\b/m.test(text);
  if (/\.excalidraw$/i.test(name)) return true;
  if (/\.json$/i.test(name)) {
    try { const j = JSON.parse(text); return Array.isArray(j?.nodes) && j.nodes.every((n: unknown) => typeof (n as { id?: unknown })?.id === 'string') && j.type !== 'sequence'; } catch { return false; }
  }
  return false;
}

const edgeKey = (e: { from: string; to: string }) => `${e.from}\u0000${e.to}`;

export function diffGraphs(before: GraphInput | undefined, after: GraphInput | undefined): GraphDiff {
  const a = before?.nodes?.length ? parseGraph(before) : undefined;
  const b = after?.nodes?.length ? parseGraph(after) : undefined;
  const aNodes = new Map((a?.nodes ?? []).map((n) => [n.id, n]));
  const bNodes = new Map((b?.nodes ?? []).map((n) => [n.id, n]));
  const nodes: Record<string, Change> = {};
  const out: GraphInput = { type: 'graph', title: b?.title ?? a?.title, direction: b?.direction ?? a?.direction ?? 'RIGHT', nodes: [] as unknown as GraphInput['nodes'], edges: [], groups: [] };

  // groups: union, after's definition wins
  const groups = new Map([...(a?.groups ?? []), ...(b?.groups ?? [])].map((g) => [g.id, g]));
  out.groups = [...groups.values()];

  for (const n of b?.nodes ?? []) {
    const old = aNodes.get(n.id);
    let change: Change = 'same';
    let caption: string | undefined;
    if (!old) { change = 'added'; caption = 'added'; }
    else if (old.label !== n.label) { change = 'changed'; caption = `was: ${old.label.replace(/\n/g, ' ')}`; }
    else if (old.kind !== n.kind || old.group !== n.group) { change = 'changed'; caption = old.kind !== n.kind ? `was: ${old.kind}` : `moved from ${old.group ? groups.get(old.group)?.label ?? old.group : 'top level'}`; }
    nodes[n.id] = change;
    out.nodes.push({ ...n, highlight: false, ...(caption ? { caption } : {}) });
  }
  for (const n of a?.nodes ?? []) {
    if (bNodes.has(n.id)) continue;
    nodes[n.id] = 'removed';
    out.nodes.push({ ...n, highlight: false, caption: 'removed' });
  }

  const edges: Change[] = [];
  const aEdges = new Map<string, Array<NonNullable<GraphInput['edges']>[number]>>();
  for (const e of a?.edges ?? []) aEdges.set(edgeKey(e), [...(aEdges.get(edgeKey(e)) ?? []), e]);
  for (const e of b?.edges ?? []) {
    const olds = aEdges.get(edgeKey(e));
    const old = olds?.shift();
    let change: Change = 'same';
    let label = e.label;
    if (!old) change = 'added';
    else if ((old.label ?? '') !== (e.label ?? '') || old.style !== e.style) {
      change = 'changed';
      if ((old.label ?? '') !== (e.label ?? '')) label = `${old.label ?? '—'} → ${e.label ?? '—'}`;
    }
    edges.push(change);
    out.edges!.push({ ...e, label, highlight: false });
  }
  for (const rest of aEdges.values()) for (const e of rest) { edges.push('removed'); out.edges!.push({ ...e, highlight: false }); }

  const count = (xs: Change[]) => ({ added: xs.filter((x) => x === 'added').length, removed: xs.filter((x) => x === 'removed').length, changed: xs.filter((x) => x === 'changed').length });
  const summary = { nodes: count(Object.values(nodes)), edges: count(edges) };
  const same = !Object.values(summary.nodes).some(Boolean) && !Object.values(summary.edges).some(Boolean);
  if (!out.nodes.length) out.nodes = EMPTY.nodes;
  return { graph: out, nodes, edges, summary, same };
}

/** "+2 boxes, −1 arrow, 1 label changed" */
export function describeDiff(d: GraphDiff): string {
  const part = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const bits: string[] = [];
  if (d.summary.nodes.added) bits.push(`+${part(d.summary.nodes.added, 'box', 'boxes')}`);
  if (d.summary.nodes.removed) bits.push(`−${part(d.summary.nodes.removed, 'box', 'boxes')}`);
  if (d.summary.nodes.changed) bits.push(`${part(d.summary.nodes.changed, 'box', 'boxes')} changed`);
  if (d.summary.edges.added) bits.push(`+${part(d.summary.edges.added, 'arrow', 'arrows')}`);
  if (d.summary.edges.removed) bits.push(`−${part(d.summary.edges.removed, 'arrow', 'arrows')}`);
  if (d.summary.edges.changed) bits.push(`${part(d.summary.edges.changed, 'arrow', 'arrows')} changed`);
  return bits.join(', ') || 'no changes';
}

/** Lay out the merged graph and color it by change. */
export async function diffModel(d: GraphDiff, opts: ModelOptions = {}): Promise<DiagramModel> {
  if (!d.graph.nodes.length) throw new Error('both versions are empty');
  const model = await graphModel(d.graph, opts);
  for (const n of model.nodes) {
    const c = d.nodes[n.id] ?? 'same';
    n.hue = DIFF_HUES[c];
    n.highlight = false;
    n.dashed = c === 'removed';
  }
  model.edges.forEach((e, i) => {
    const c = d.edges[Number(e.id.slice(1))] ?? d.edges[i] ?? 'same';
    const color = c === 'same' ? '#adb5bd' : DIFF_HUES[c].solid;
    e.color = color;
    e.labelColor = c === 'same' ? THEME.muted : color;
    e.width = c === 'same' ? THEME.stroke.width : THEME.stroke.highlightWidth;
    e.highlight = c !== 'same';
    if (c === 'removed') e.dashed = true;
  });
  return model;
}
