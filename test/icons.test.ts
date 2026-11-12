import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { build, extractGraph, IconLibrary, lint, toSvg } from '../src/index.js';
import { readJson } from './helpers.js';

const lib = new IconLibrary();
const pick = (label: string, kind?: string) => lib.forNode({ label, kind })?.name;

describe('icon matching', () => {
  it.each([
    ['PostgreSQL', 'database', 'postgresql'],
    ['orders DB (Postgres)', 'database', 'postgresql'],
    ['pg', 'database', 'postgresql'],
    ['Kafka', 'queue', 'apachekafka'],
    ['Redis cache', 'service', 'redis'],
    ['k8s cluster', 'service', 'kubernetes'],
    ['Google Cloud Storage', 'storage', 'googlecloudstorage'],
    ['Next.js frontend', 'client', 'nextdotjs'],
    ['Stripe', 'external', 'stripe'],
  ])('brand: %s -> %s', (label, kind, want) => expect(pick(label, kind)).toBe(want));

  it.each([
    ['Order Service', 'service', 'shopping-cart'],
    ['Payment Service', 'service', 'credit-card'],
    ['Email worker', 'service', 'mail'],
    ['API Gateway', 'service', 'route'],
    ['Shopper', 'user', 'user'],
  ])('generic: %s -> %s', (label, kind, want) => expect(pick(label, kind)).toBe(want));

  it.each([
    ['결제 서비스', 'service', 'credit-card'],
    ['결제서비스', 'service', 'credit-card'],
    ['주문 서비스', 'service', 'shopping-cart'],
    ['이메일 워커', 'service', 'mail'],
    ['재고 워커', 'service', 'package'],
    ['웹훅 수신기', 'service', 'webhook'],
    ['구매자', 'user', 'user'],
    ['Postgres 주문 DB', 'database', 'postgresql'],
    ['주문 이벤트', 'queue', 'layers'],
  ])('korean: %s -> %s', (label, kind, want) => expect(pick(label, kind)).toBe(want));

  it('falls back to the kind, and prefers the kind for queues and databases', () => {
    expect(pick('order.created', 'queue')).toBe('layers');
    expect(pick('orders', 'database')).toBe('database');
    expect(pick('Something unusual', 'service')).toBe('server');
    expect(pick('Somewhere', 'external')).toBe('globe');
  });

  it('only matches very common words when they are the whole label', () => {
    expect(pick('Go service', 'service')).not.toBe('go');
    expect(pick('Go', 'service')).toBe('go');
    expect(pick('Render farm', 'service')).not.toBe('render');
  });

  it('honours explicit icons, icon: false, and explains unknown names', () => {
    expect(lib.forNode({ label: 'Thing', icon: 'kafka' })?.name).toBe('apachekafka');
    expect(lib.forNode({ label: 'PostgreSQL', icon: false })).toBeUndefined();
    expect(() => lib.forNode({ label: 'x', icon: 'postgress' })).toThrow(/did you mean: postgresql/);
  });

  it('searches names, titles, aliases and kinds', () => {
    expect(lib.search('pg')[0].name).toBe('postgresql');
    expect(lib.search('queue').map((i) => i.name)).toContain('layers');
    expect(lib.search('pay').map((i) => i.name)).toEqual(expect.arrayContaining(['paypal', 'credit-card']));
  });

  it('renders brand icons in brand color and generic icons in the color asked for', () => {
    expect(lib.get('postgresql')!.svg()).toContain('fill="#4169E1"');
    expect(lib.get('server')!.svg('#123456')).toContain('stroke="#123456"');
  });
});

describe('custom icon folders', () => {
  const dir = mkdtempSync(join(tmpdir(), 'draftr-icons-'));
  writeFileSync(join(dir, 'acme-billing.svg'), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#ff5a5f"/></svg>');
  writeFileSync(join(dir, 'postgresql.svg'), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" fill="#000"/></svg>');
  const mine = new IconLibrary({ dirs: [dir] });

  it('matches labels to file names loosely and wins over built-ins', () => {
    expect(mine.forNode({ label: 'Acme Billing' })?.source).toBe('custom');
    expect(mine.get('postgresql')?.source).toBe('custom');
    expect(mine.get('postgresql')!.svg('#fff')).toContain('fill="#000"'); // custom icons keep their colors
  });

  it('matches Korean file names', () => {
    const ko = mkdtempSync(join(tmpdir(), 'draftr-icons-ko-'));
    writeFileSync(join(ko, '정산-시스템.svg'), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"/>');
    expect(new IconLibrary({ dirs: [ko] }).forNode({ label: '정산 시스템' })?.name).toBe('정산-시스템');
  });

  it('rejects missing folders', () => {
    expect(() => new IconLibrary({ dirs: [join(dir, 'nope')] })).toThrow(/icon folder not found/);
  });

  it('is used by build()', async () => {
    const { excalidraw } = await build({ nodes: [{ id: 'a', label: 'Acme Billing' }] }, { icons: { dirs: [dir] } });
    const img = excalidraw.elements.find((e) => e.type === 'image')!;
    expect(img.customData).toMatchObject({ icon: 'acme-billing', source: 'custom' });
  });
});

describe('icons in diagrams', () => {
  it('adds an image element per node, backed by an embedded SVG file', async () => {
    const { excalidraw, svg, report } = await build(readJson('examples/checkout.json'));
    expect(report.issues).toEqual([]);
    const images = excalidraw.elements.filter((e) => e.type === 'image');
    expect(images.length).toBe(10);
    for (const img of images) {
      const file = excalidraw.files![String(img.fileId)];
      expect(file.mimeType).toBe('image/svg+xml');
      expect(Buffer.from(file.dataURL.split(',')[1], 'base64').toString()).toMatch(/^<svg/);
    }
    // icon, shape and label move together in Excalidraw
    const shape = excalidraw.elements.find((e) => e.id === 'node:db')!;
    const icon = excalidraw.elements.find((e) => e.id === 'node:db:icon')!;
    expect(icon.groupIds).toEqual(shape.groupIds);
    expect(icon.customData?.icon).toBe('mongodb');
    expect(svg).toContain('<image ');
  });

  it('can be turned off', async () => {
    const { excalidraw } = await build(readJson('examples/checkout.json'), { icons: false });
    expect(excalidraw.elements.some((e) => e.type === 'image')).toBe(false);
    expect(Object.keys(excalidraw.files ?? {})).toEqual([]);
  });

  it('puts icons on sequence participants', async () => {
    const { excalidraw, report } = await build({
      type: 'sequence',
      participants: [{ id: 'u', label: 'User', kind: 'user' }, { id: 'db', label: 'Postgres', kind: 'database' }],
      messages: [{ from: 'u', to: 'db', label: 'query' }],
    });
    expect(report.issues).toEqual([]);
    expect(excalidraw.elements.filter((e) => e.type === 'image').map((e) => e.customData?.icon)).toEqual(['user', 'postgresql']);
  });

  it('survives tidy round trips and renders offline', async () => {
    const { excalidraw } = await build({ nodes: [{ id: 'a', label: 'Thing', icon: 'kafka' }, { id: 'b', label: 'Other' }], edges: [{ from: 'a', to: 'b' }] });
    const g = extractGraph(excalidraw);
    expect(g.nodes.find((n) => n.label === 'Thing')?.icon).toBe('apachekafka');
    expect(lint(excalidraw).ok).toBe(true);
    expect(toSvg(excalidraw)).toContain('data:image/svg+xml;base64,');
  });
});
