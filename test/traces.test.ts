import { describe, expect, it } from 'vitest';
import { buildTrace, readSpans, traceToSequence, type SequenceInput } from '../src/index.js';
import { readText } from './helpers.js';

const msgs = (s: SequenceInput) => (s.messages ?? []).map((m) => `${m.from} -> ${m.to}: ${m.label}${m.style === 'dashed' ? ' ~' : ''}${m.highlight ? ' !' : ''}`);

describe('traces -> sequence', () => {
  it('OTLP: calls, replies with status and duration, N+1 collapsed, errors highlighted, messaging via the queue', () => {
    const { sequence, notes } = traceToSequence(readText('test/fixtures/traces/checkout.otlp.json'));
    expect(msgs(sequence)).toEqual([
      'client -> svc:web: POST /checkout !',
      'svc:web -> svc:checkout: POST /orders !',
      'svc:checkout -> db:postgresql:shop: SELECT * FROM products WHERE id = $1 ×3',
      'db:postgresql:shop -> svc:checkout: 3 calls, 15 ms ~',
      'svc:checkout -> svc:payment: payment.Charge !',
      'svc:payment -> svc:checkout: grpc 9 error · 330 ms ~ !',
      'svc:checkout -> mq:kafka:orders: orders publish ~',
      'mq:kafka:orders -> svc:email: orders process ~',
      'svc:email -> ext:api.sendgrid.com: POST',
      'ext:api.sendgrid.com -> svc:email: 202 · 90 ms ~',
      'svc:checkout -> svc:web: 502 error · 392 ms ~ !',
      'svc:web -> client: 502 error · 412 ms ~ !',
    ]);
    expect(sequence.participants.map((p) => `${p.label}:${p.kind}`)).toEqual([
      'Client:client', 'web:service', 'checkout:service', 'shop (postgresql):database', 'payment:service', 'orders:queue', 'email:service', 'api.sendgrid.com:external',
    ]);
    expect(notes.join(' ')).toMatch(/12 spans.*620 ms/);
  });

  it('internal spans on request', () => {
    const { sequence } = traceToSequence(readText('test/fixtures/traces/checkout.otlp.json'), { internal: true });
    expect(msgs(sequence)).toContain('svc:checkout -> svc:checkout: validate cart');
  });

  it('NDJSON with several traces: draws the largest, or the one asked for', () => {
    const text = readText('test/fixtures/traces/mixed.ndjson');
    expect(new Set(readSpans(text).map((s) => s.traceId)).size).toBe(2);
    expect(traceToSequence(text).notes.join(' ')).toMatch(/2 traces/);
    expect(msgs(traceToSequence(text, { traceId: 'aa'.repeat(16) }).sequence)).toEqual(['client -> svc:web: GET /health', 'svc:web -> client: 1 ms ~']);
  });

  it('Jaeger and Zipkin', () => {
    expect(msgs(traceToSequence(readText('test/fixtures/traces/login.jaeger.json')).sequence)).toEqual([
      'client -> svc:gateway: POST /login', 'svc:gateway -> svc:auth: auth.Verify',
      'svc:auth -> db:redis:redis: GET user', 'db:redis:redis -> svc:auth: 4 ms ~',
      'svc:auth -> svc:users: users.Get', 'svc:users -> svc:auth: 30 ms ~',
      'svc:auth -> svc:gateway: 60 ms ~', 'svc:gateway -> client: 90 ms ~',
    ]);
    expect(msgs(traceToSequence(JSON.parse(readText('test/fixtures/traces/search.zipkin.json'))).sequence)).toEqual([
      'client -> svc:frontend: get /search', 'svc:frontend -> svc:elasticsearch: query !',
      'svc:elasticsearch -> svc:frontend: error · 40 ms ~ !', 'svc:frontend -> client: 50 ms ~',
    ]);
  });

  it('speedwagon incident timelines: alerts and annotations over time, per service', () => {
    const { sequence, notes } = traceToSequence(readText('test/fixtures/traces/incident.timeline.json'));
    expect(msgs(sequence)).toEqual([
      'annotations -> s:checkout: 02:58 deploy checkout v2.14',
      'grafana -> s:checkout: 03:04 CheckoutLatencyHigh (Normal → Pending)',
      'grafana -> s:checkout: 03:09 CheckoutLatencyHigh (Pending → Alerting) !',
      'grafana -> s:payment: 03:11 PaymentErrors5xx !',
      'grafana -> s:checkout: 03:40 CheckoutLatencyHigh (Alerting → Normal) ~',
    ]);
    expect(notes.join(' ')).toMatch(/42 min/);
  });

  it('builds lint-clean diagrams and rejects things that are not traces', async () => {
    for (const f of ['checkout.otlp.json', 'login.jaeger.json', 'incident.timeline.json']) {
      const r = await buildTrace(readText(`test/fixtures/traces/${f}`));
      expect(r.report.issues.filter((i) => i.severity === 'error'), f).toEqual([]);
    }
    expect(() => traceToSequence({ hello: 'world' })).toThrow(/not a trace/);
  });
});
