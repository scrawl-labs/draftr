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
