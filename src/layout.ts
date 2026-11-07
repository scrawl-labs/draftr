// Semantic graph -> positioned scene, using ELK's layered algorithm with
// orthogonal edge routing and real compound (nested) groups.
import { createRequire } from 'node:module';
import type { ELK as ElkInstance, ELKConstructorArguments, ElkNode, ElkExtendedEdge } from 'elkjs/lib/elk-api.js';
import { measureText, wrapText } from './measure.js';
import { parseGraph, type Graph } from './schema.js';
import type { Pt, Scene } from './types.js';

// elkjs ships CommonJS; require() sidesteps default-export interop differences.
const ELK = createRequire(import.meta.url)('elkjs/lib/elk.bundled.js') as new (args?: ELKConstructorArguments) => ElkInstance;
const elk = new ELK();
export const FONT_SIZE = 16;
const LABEL_FONT = 14;
const GROUP_FONT = 16;
const MAX_LABEL_W = 220;

export function nodeSize(node: Graph['nodes'][number]): { label: string; w: number; h: number } {
  const label = wrapText(node.label, MAX_LABEL_W, FONT_SIZE);
  const t = measureText(label, FONT_SIZE);
  let w = Math.max(140, Math.ceil(t.width + 40));
  let h = Math.max(64, Math.ceil(t.height + 32));
  if (node.kind === 'user') { w = Math.ceil(w * 1.3); h = Math.ceil(h * 1.35); } // text fits the inscribed box
  if (node.kind === 'decision') { w = Math.max(160, Math.ceil(2 * (t.width + 14) + 6)); h = Math.max(96, Math.ceil(2 * (t.height + 8) + 6)); }
  return { label, w, h };
}

type ElkEdgeOut = ElkExtendedEdge & { container?: string };

export async function layoutGraph(input: unknown): Promise<Scene> {
  const g = parseGraph(input);
  const sizes = Object.fromEntries(g.nodes.map((n) => [n.id, nodeSize(n)]));
  const hasLabels = g.edges.some((e) => e.label);

  const elkGroups: Record<string, ElkNode> = Object.fromEntries(g.groups.map((gr) => {
    const t = measureText(gr.label, GROUP_FONT);
    return [gr.id, {
      id: gr.id,
      children: [],
      layoutOptions: {
        'elk.padding': `[top=${Math.ceil(t.height + 28)},left=24,bottom=24,right=24]`,
        'elk.nodeSize.constraints': 'MINIMUM_SIZE',
        'elk.nodeSize.minimum': `(${Math.ceil(t.width + 48)},40)`,
      },
    } satisfies ElkNode];
  }));

  const root: ElkNode = {
    id: '__root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': g.direction,
      'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
      'elk.edgeRouting': 'ORTHOGONAL',
      // Center edge labels get their own dummy layer, so with labels present
      // each gap is counted twice — use a tighter spacing to compensate.
      'elk.layered.spacing.nodeNodeBetweenLayers': hasLabels ? '48' : '90',
      'elk.layered.spacing.edgeNodeBetweenLayers': '24',
      'elk.spacing.nodeNode': '50',
      'elk.spacing.edgeNode': '30',
      'elk.spacing.edgeEdge': '20',
      'elk.spacing.edgeLabel': '6',
      'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
      'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
      'elk.layered.thoroughness': '30',
      'elk.edgeLabels.placement': 'CENTER',
      'elk.padding': '[top=40,left=40,bottom=40,right=40]',
    },
    children: [],
    edges: [],
  };
  for (const gr of g.groups) (gr.parent ? elkGroups[gr.parent].children! : root.children!).push(elkGroups[gr.id]);
  for (const n of g.nodes) {
    const s = sizes[n.id];
    (n.group ? elkGroups[n.group].children! : root.children!).push({ id: n.id, width: s.w, height: s.h });
  }
  g.edges.forEach((e, i) => {
    const edge: ElkExtendedEdge = { id: `e${i}`, sources: [e.from], targets: [e.to] };
    if (e.label) {
      const t = measureText(e.label, LABEL_FONT);
      edge.labels = [{ id: `e${i}_label`, text: e.label, width: Math.ceil(t.width + 8), height: Math.ceil(t.height + 4) }];
    }
    root.edges!.push(edge);
  });

  const res = await elk.layout(root);

  // ELK coordinates are relative to the parent (nodes) / the edge's container
  // (edges). Flatten everything into absolute coordinates.
  const abs: Record<string, Pt> = { __root: { x: 0, y: 0 } };
  const placed: Record<string, { x: number; y: number; w: number; h: number }> = {};
  (function walk(n: ElkNode, ox: number, oy: number) {
    for (const c of n.children ?? []) {
      const x = ox + (c.x ?? 0), y = oy + (c.y ?? 0);
      abs[c.id] = { x, y };
      placed[c.id] = { x, y, w: c.width ?? 0, h: c.height ?? 0 };
      walk(c, x, y);
    }
  })(res, 0, 0);

  const edges: ElkEdgeOut[] = [];
  (function collect(n: ElkNode) {
    for (const e of n.edges ?? []) edges.push(e as ElkEdgeOut);
    for (const c of n.children ?? []) collect(c);
  })(res);

  const depthOf = (id: string): number => {
    let d = 0;
    let cur = g.groups.find((x) => x.id === id);
    while (cur?.parent) { d++; cur = g.groups.find((x) => x.id === cur!.parent); }
    return d;
  };

  const scene: Scene = {
    title: g.title,
    width: res.width ?? 0,
    height: res.height ?? 0,
    groups: g.groups.map((gr) => ({ ...gr, ...placed[gr.id], depth: depthOf(gr.id) })),
    nodes: g.nodes.map((n) => ({ ...n, label: sizes[n.id].label, ...placed[n.id] })),
    edges: edges.map((le) => {
      const i = Number(le.id.slice(1));
      const src = g.edges[i];
      const off = abs[le.container ?? '__root'] ?? { x: 0, y: 0 };
      const sec = le.sections?.[0];
      const pts = sec ? [sec.startPoint, ...(sec.bendPoints ?? []), sec.endPoint].map((p) => ({ x: p.x + off.x, y: p.y + off.y })) : [];
      const lab = le.labels?.[0];
      return {
        id: le.id,
        ...src,
        points: dedupe(pts),
        labelBox: lab && src.label
          ? { x: (lab.x ?? 0) + off.x, y: (lab.y ?? 0) + off.y, w: lab.width ?? 0, h: lab.height ?? 0, text: src.label }
          : undefined,
      };
    }),
    fontSize: FONT_SIZE,
    labelFontSize: LABEL_FONT,
    groupFontSize: GROUP_FONT,
  };
  for (const n of scene.nodes) if (n.x == null) throw new Error(`layout failed for node ${n.id}`);
  return scene;
}

function dedupe(pts: Pt[]): Pt[] {
  return pts.filter((p, i) => i === 0 || Math.abs(p.x - pts[i - 1].x) > 0.01 || Math.abs(p.y - pts[i - 1].y) > 0.01);
}
