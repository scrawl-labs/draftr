import { describe, expect, it } from 'vitest';
import { build, FORMAT_NAMES, lint } from '../src/index.js';
import { pointsForLabel } from '../src/excalidraw.js';
import { placeLabels, type DEdge } from '../src/model.js';
import { measureText } from '../src/measure.js';
import { readJson } from './helpers.js';

/** Where Excalidraw itself puts an arrow's bound label (see LinearElementEditor.getBoundTextElementPosition). */
function excalidrawLabelPoint(pts: Array<{ x: number; y: number }>) {
  if (pts.length % 2 === 1) return pts[Math.floor(pts.length / 2)];
  const i = pts.length / 2 - 1;
  return { x: (pts[i].x + pts[i + 1].x) / 2, y: (pts[i].y + pts[i + 1].y) / 2 };
}

describe('tone theme: excalidraw output', () => {
  it('uses Nunito, captions, embedded icons and native arrow labels', async () => {
    const { excalidraw, report } = await build(readJson('examples/checkout.json'));
    expect(report.issues).toEqual([]);
    const texts = excalidraw.elements.filter((e) => e.type === 'text');
    expect(new Set(texts.map((t) => t.fontFamily))).toEqual(new Set([6]));
    expect(texts.find((t) => t.id === 'node:db:caption')?.text).toBe('Database');
    const label = excalidraw.elements.find((e) => e.id === 'edge:e5:label')!;
    expect(label.containerId).toBe('edge:e5');
    const arrow = excalidraw.elements.find((e) => e.id === 'edge:e5')!;
    expect(arrow.boundElements).toContainEqual({ type: 'text', id: 'edge:e5:label' });
  });

  it('places every bound label exactly where Excalidraw will draw it', async () => {
    const { excalidraw, model } = await build(readJson('examples/checkout.json'));
    for (const e of model.edges.filter((x) => x.label)) {
      const arrow = excalidraw.elements.find((x) => x.id === `edge:${e.id}`)!;
      const pts = arrow.points!.map(([x, y]) => ({ x: arrow.x + x, y: arrow.y + y }));
      const p = excalidrawLabelPoint(pts);
      expect(p.x).toBeCloseTo(e.labelAt!.x, 3);
      expect(p.y).toBeCloseTo(e.labelAt!.y, 3);
    }
  });

  it('pointsForLabel keeps the shape and balances the points', () => {
    const pts = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 80 }, { x: 300, y: 80 }];
    for (const at of [{ x: 30, y: 0 }, { x: 100, y: 40 }, { x: 250, y: 80 }]) {
      const out = pointsForLabel(pts, at);
      expect(out.length % 2).toBe(0);
      const p = excalidrawLabelPoint(out);
      expect(p.x).toBeCloseTo(at.x, 6);
      expect(p.y).toBeCloseTo(at.y, 6);
      expect(out[0]).toEqual(pts[0]);
      expect(out.at(-1)).toEqual(pts.at(-1));
    }
  });

  it('moves a label that would sit on another label', () => {
    const shared = [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 200 }];
    const edges = ['a', 'b'].map((id) => ({ id, role: 'edge', points: shared, color: '#000', width: 1, dashed: false, arrow: true, highlight: false, label: 'calls', labelAt: { x: 100, y: 0 } })) as DEdge[];
    placeLabels(edges, []);
    expect(edges[0].labelAt).toEqual({ x: 100, y: 0 });
    expect(edges[1].labelAt).not.toEqual({ x: 100, y: 0 });
  });
});

describe('tone theme: svg output', () => {
  it('embeds only the Pretendard subsets a diagram needs', async () => {
    const latin = (await build(readJson('examples/checkout.json'))).svg;
    const korean = (await build({ nodes: [{ id: 'a', label: '결제 서비스' }, { id: 'b', label: '주문 서비스' }], edges: [{ from: 'b', to: 'a', label: '결제 요청' }] })).svg;
    const faces = (s: string) => (s.match(/@font-face/g) ?? []).length;
    expect(faces(latin)).toBeGreaterThan(0);
    expect(faces(korean)).toBeGreaterThan(faces(latin)); // Hangul chunks on top of Latin
    expect(latin).toContain("font-family:'Pretendard'");
    expect(latin).not.toMatch(/https?:\/\/(?!www\.w3\.org)/); // nothing fetched from the network
    expect(latin.length).toBeLessThan(60_000);
  });

  it('draws highlighted nodes as solid boxes with white text', async () => {
    const { svg } = await build({ nodes: [{ id: 'a', label: 'API', highlight: true }] });
    expect(svg).toContain('fill="#3b5bdb"');
    expect(svg).toMatch(/fill="#ffffff"[^>]*>API</);
  });
});

describe('formats', () => {
  it('defaults to excalidraw and rejects unknown formats', async () => {
    expect(FORMAT_NAMES).toContain('excalidraw');
    const res = await build({ nodes: [{ id: 'a', label: 'A' }] });
    expect(res.file).toMatchObject({ format: 'excalidraw', ext: '.excalidraw' });
    expect(JSON.parse(res.file.content).type).toBe('excalidraw');
    await expect(build({ nodes: [{ id: 'a', label: 'A' }] }, { format: 'visio' as never })).rejects.toThrow(/unknown format "visio"/);
  });
});

describe('font metrics', () => {
  it('measures proportional fonts, wide Hangul and the legacy mono estimate', () => {
    const p = measureText('Order Service', 15, 'pretendard500').width;
    const n = measureText('Order Service', 16, 'nunito').width;
    const m = measureText('Order Service', 16, 'mono').width;
    expect(p).toBeGreaterThan(80); expect(p).toBeLessThan(120);
    expect(n).toBeGreaterThan(80); expect(n).toBeLessThan(130);
    expect(m).toBeGreaterThan(n);
    expect(measureText('결제', 15, 'pretendard500').width).toBeGreaterThan(measureText('ab', 15, 'pretendard500').width);
  });

  it('lints Nunito text with Nunito metrics', async () => {
    const { excalidraw } = await build({ nodes: [{ id: 'a', label: 'A fairly long service name that wraps' }] });
    expect(lint(excalidraw).issues).toEqual([]);
  });
});
