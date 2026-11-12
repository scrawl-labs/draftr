import { describe, expect, it } from 'vitest';
import { buildMermaid, parseMermaid, type GraphInput, type SequenceInput } from '../src/index.js';
import { readText } from './helpers.js';

describe('mermaid', () => {
  it('parses flowchart shapes, chains, &, subgraphs and both label syntaxes', () => {
    const g = parseMermaid(`
      flowchart LR
        a((User)) -->|clicks| b([Web])
        b -- REST --> c[API] --> d[(DB)]
        subgraph workers [Workers]
          w1[Mailer] & w2[Indexer]
        end
        c -.-> w1 & w2
        c ==> e{Valid?}
        style c fill:#f9f
    `) as GraphInput;
    expect(g.direction).toBe('RIGHT');
    const kind = Object.fromEntries(g.nodes.map((n) => [n.id, n.kind]));
    expect(kind).toMatchObject({ a: 'user', b: 'client', c: 'service', d: 'database', e: 'decision' });
    expect(g.nodes.find((n) => n.id === 'w1')!.group).toBe('workers');
    const edge = (f: string, t: string) => g.edges!.find((e) => e.from === f && e.to === t);
    expect(edge('a', 'b')!.label).toBe('clicks');
    expect(edge('b', 'c')!.label).toBe('REST');
    expect(edge('c', 'd')).toBeTruthy();
    expect(edge('c', 'w2')!.style).toBe('dashed');
    expect(edge('c', 'e')!.highlight).toBe(true);
  });

  it('parses sequence diagrams', () => {
    const s = parseMermaid(`
      sequenceDiagram
        actor U as User
        participant S as Server
        U->>S: hello
        S-->>U: hi back
    `) as SequenceInput;
    expect(s.type).toBe('sequence');
    expect(s.participants).toEqual([{ id: 'U', label: 'User', kind: 'user' }, { id: 'S', label: 'Server', kind: 'service' }]);
    expect(s.messages![1]).toMatchObject({ from: 'S', to: 'U', label: 'hi back', style: 'dashed' });
  });

  it('builds the pipeline example lint-clean', async () => {
    const { report } = await buildMermaid(readText('examples/pipeline.mmd'));
    expect(report.issues).toEqual([]);
  });

  it('refuses diagram types it does not support', () => {
    expect(() => parseMermaid('pie title Pets\n "Dogs" : 386')).toThrow(/Unsupported Mermaid/);
  });
});

describe('mermaid @{ } metadata', () => {
  it('reads icon, label and shape from flowchart node metadata', () => {
    const g = parseMermaid(`
      flowchart LR
        web@{ icon: "logos:react", label: "Web app" } --> api@{ shape: rect, label: "API" }
        api --> db@{ shape: cyl, label: "Orders", icon: "logos:postgresql" }
        api -.-> bus@{ icon: "logos:kafka", shape: h-cyl }
        api --> mail@{ icon: "fa:envelope", label: "Mailer" }
        api --> x@{ icon: "acme:unknown-thing", label: "Mystery" }
        q[Queue]
        q@{ icon: "aws:sqs" }
    `) as GraphInput;
    const n = Object.fromEntries(g.nodes.map((x) => [x.id, x]));
    expect(n.web).toMatchObject({ label: 'Web app', icon: 'react' });
    expect(n.api).toMatchObject({ label: 'API', kind: 'service' });
    expect(n.db).toMatchObject({ label: 'Orders', kind: 'database', icon: 'postgresql' });
    expect(n.bus).toMatchObject({ kind: 'queue', icon: 'kafka' });
    expect(n.mail.icon).toBe('mail');
    expect(n.x.icon).toBeUndefined(); // unknown pack icon -> picked from the label as usual
    expect(n.q).toMatchObject({ label: 'Queue' });
    expect(g.edges).toHaveLength(5);
  });

  it('drops icons when icons are off', () => {
    const g = parseMermaid('flowchart LR\n a@{ icon: "logos:kafka" } --> b', { icons: false }) as GraphInput;
    expect(g.nodes[0].icon).toBeUndefined();
  });

  it('reads participant types in sequence diagrams', () => {
    const s = parseMermaid(`
      sequenceDiagram
        actor U as Shopper
        participant DB@{ "type": "database" } as Orders
        participant Q@{ "type": "queue", "icon": "logos:kafka" }
        U->>DB: insert
        DB-->>Q: publish
    `) as SequenceInput;
    const p = Object.fromEntries(s.participants.map((x) => [x.id, x]));
    expect(p.DB).toMatchObject({ label: 'Orders', kind: 'database' });
    expect(p.Q).toMatchObject({ kind: 'queue', icon: 'kafka' });
    expect(s.messages).toHaveLength(2);
  });

  it('builds a diagram with the icons drawn', async () => {
    const r = await buildMermaid('flowchart LR\n a@{ icon: "logos:stripe", label: "Payments" } --> b[(DB)]');
    expect(r.model.nodes.find((x) => x.id === 'a')!.icon?.name).toBe('stripe');
    expect(r.report.ok).toBe(true);
  });
});
