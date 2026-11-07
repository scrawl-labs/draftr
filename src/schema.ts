// What the model writes. No coordinates anywhere — layout is draftr's job.
import { z } from 'zod';

export const KINDS = ['service', 'database', 'queue', 'external', 'user', 'client', 'storage', 'decision', 'note'] as const;
export type Kind = (typeof KINDS)[number];

export const NodeSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  kind: z.enum(KINDS).default('service'),
  group: z.string().optional().describe('id of the group this node belongs to'),
  highlight: z.boolean().optional().describe('draw attention to this node (the point of the diagram)'),
});

export const EdgeSchema = z.object({
  from: z.string(),
  to: z.string(),
  label: z.string().optional(),
  style: z.enum(['solid', 'dashed']).default('solid').describe('dashed = async / optional / reply'),
  highlight: z.boolean().optional(),
});

export const GroupSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  parent: z.string().optional().describe('id of an enclosing group'),
});

export const GraphSchema = z.object({
  type: z.literal('graph').optional(),
  title: z.string().optional(),
  direction: z.enum(['RIGHT', 'DOWN', 'LEFT', 'UP']).default('RIGHT'),
  nodes: z.array(NodeSchema).min(1),
  edges: z.array(EdgeSchema).default([]),
  groups: z.array(GroupSchema).default([]),
});

export const ParticipantSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  kind: z.enum(KINDS).default('service'),
});

export const MessageSchema = z.object({
  from: z.string(),
  to: z.string(),
  label: z.string().default(''),
  style: z.enum(['solid', 'dashed']).default('solid').describe('dashed = reply / async'),
  highlight: z.boolean().optional(),
});

export const SequenceSchema = z.object({
  type: z.literal('sequence'),
  title: z.string().optional(),
  autonumber: z.boolean().default(false),
  participants: z.array(ParticipantSchema).min(1),
  messages: z.array(MessageSchema).default([]),
});

export type GraphInput = z.input<typeof GraphSchema>;
export type Graph = z.output<typeof GraphSchema>;
export type SequenceInput = z.input<typeof SequenceSchema>;
export type Sequence = z.output<typeof SequenceSchema>;
export type DiagramInput = GraphInput | SequenceInput;

const fail = (errs: string[], what: string) => {
  if (errs.length) throw new Error(`Invalid ${what}:\n- ` + errs.join('\n- '));
};

/** Parse + referential checks. Throws with every problem listed at once. */
export function parseGraph(input: unknown): Graph {
  const g = GraphSchema.parse(input);
  const errs: string[] = [];
  const ids = new Set<string>();
  for (const n of [...g.nodes, ...g.groups]) {
    if (ids.has(n.id)) errs.push(`duplicate id "${n.id}"`);
    ids.add(n.id);
  }
  const groupIds = new Set(g.groups.map((x) => x.id));
  const nodeIds = new Set(g.nodes.map((x) => x.id));
  for (const n of g.nodes) if (n.group && !groupIds.has(n.group)) errs.push(`node "${n.id}" references unknown group "${n.group}"`);
  for (const gr of g.groups) if (gr.parent && !groupIds.has(gr.parent)) errs.push(`group "${gr.id}" references unknown parent "${gr.parent}"`);
  for (const e of g.edges) {
    if (!nodeIds.has(e.from)) errs.push(`edge from unknown node "${e.from}"`);
    if (!nodeIds.has(e.to)) errs.push(`edge to unknown node "${e.to}"`);
  }
  const parentOf = Object.fromEntries(g.groups.map((x) => [x.id, x.parent]));
  for (const gr of g.groups) {
    const seen = new Set<string>();
    let cur: string | undefined = gr.id;
    while (cur) {
      if (seen.has(cur)) { errs.push(`group cycle at "${gr.id}"`); break; }
      seen.add(cur);
      cur = parentOf[cur];
    }
  }
  fail(errs, 'graph');
  return g;
}

export function parseSequence(input: unknown): Sequence {
  const s = SequenceSchema.parse(input);
  const errs: string[] = [];
  const ids = new Set<string>();
  for (const p of s.participants) {
    if (ids.has(p.id)) errs.push(`duplicate participant "${p.id}"`);
    ids.add(p.id);
  }
  s.messages.forEach((m, i) => {
    if (!ids.has(m.from)) errs.push(`message #${i + 1} from unknown participant "${m.from}"`);
    if (!ids.has(m.to)) errs.push(`message #${i + 1} to unknown participant "${m.to}"`);
  });
  fail(errs, 'sequence');
  return s;
}
