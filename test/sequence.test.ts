import { describe, expect, it } from 'vitest';
import { build, buildMermaid, parseSequence } from '../src/index.js';
import { measureText } from '../src/measure.js';
import { readText } from './helpers.js';

describe('sequence diagrams', () => {
  it('builds the login example lint-clean, with autonumbered labels', async () => {
    const { report, excalidraw } = await buildMermaid(readText('examples/login.mmd'));
    expect(report.issues).toEqual([]);
    const labels = excalidraw.elements.filter((e) => e.customData?.role === 'message-label').map((e) => e.text);
    expect(labels[0]).toBe('1. submit email + password');
    expect(labels).toHaveLength(8);
  });

  it('spaces columns so every label fits between its lifelines', async () => {
    const long = 'a really quite long message label that needs room';
    const { excalidraw } = await build({
      type: 'sequence',
      participants: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }],
      messages: [{ from: 'a', to: 'c', label: long }, { from: 'b', to: 'b', label: 'self call' }],
    });
    const life = (id: string) => excalidraw.elements.find((e) => e.id === `lifeline:${id}`)!.x;
    expect(life('c') - life('a')).toBeGreaterThan(measureText(long, 13, 'nunito').width);
    const self = excalidraw.elements.find((e) => e.id === 'msg:1')!;
    expect(self.points).toHaveLength(4);
  });

  it('validates participant references', () => {
    expect(() => parseSequence({ type: 'sequence', participants: [{ id: 'a', label: 'A' }], messages: [{ from: 'a', to: 'x' }] }))
      .toThrow(/unknown participant "x"/);
  });
});
