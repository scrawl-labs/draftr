// Traces -> sequence diagrams. Reads OpenTelemetry (OTLP JSON, including collector file-exporter
// NDJSON and Tempo's `batches`), Jaeger and Zipkin traces, and speedwagon's incident timelines.
//
// A trace becomes the call sequence between services: a client span whose server span lives in another
// service is a request, its end is the reply (with status and duration); calls to databases, queues and
// third parties come from the client span's attributes. Repeated identical calls collapse into "×N",
// which is how an N+1 query shows up.
import type { Kind, SequenceInput } from './schema.js';

export interface TraceOptions {
  /** Which trace to draw when the file holds several (default: the one with most spans). */
  traceId?: string;
  /** Also draw work inside one service (internal spans) as self-messages. */
  internal?: boolean;
  /** Stop after this many messages (default 80). */
  maxMessages?: number;
}

export interface TraceResult { sequence: SequenceInput; notes: string[] }

type SpanKind = 'server' | 'client' | 'producer' | 'consumer' | 'internal';
export interface Span {
  traceId: string; id: string; parent?: string;
  service: string; name: string; kind: SpanKind;
  /** milliseconds */
  start: number; end: number;
  error: boolean;
  attrs: Record<string, string>;
  /** Zipkin: the other side of a client span, when known. */
  remote?: string;
}

// ---------- reading the formats ----------

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const KINDS: Record<string, SpanKind> = {
  '1': 'internal', '2': 'server', '3': 'client', '4': 'producer', '5': 'consumer',
  SPAN_KIND_INTERNAL: 'internal', SPAN_KIND_SERVER: 'server', SPAN_KIND_CLIENT: 'client', SPAN_KIND_PRODUCER: 'producer', SPAN_KIND_CONSUMER: 'consumer',
  internal: 'internal', server: 'server', client: 'client', producer: 'producer', consumer: 'consumer',
  INTERNAL: 'internal', SERVER: 'server', CLIENT: 'client', PRODUCER: 'producer', CONSUMER: 'consumer',
};

const otlpValue = (v: Json): string => {
  if (!v || typeof v !== 'object') return String(v ?? '');
  for (const k of ['stringValue', 'intValue', 'doubleValue', 'boolValue']) if (k in v) return String(v[k]);
  if (v.arrayValue) return (v.arrayValue.values ?? []).map(otlpValue).join(',');
  return '';
};
const otlpAttrs = (list: Json): Record<string, string> => Object.fromEntries((list ?? []).map((a: Json) => [a.key, otlpValue(a.value)]));
const nanosToMs = (n: Json) => Number(BigInt(String(n ?? 0)) / 1000n) / 1000;
const hexId = (s: Json) => {
  if (!s) return '';
  const str = String(s);
  // OTLP/JSON uses hex; some exporters write base64
  if (/^[0-9a-f]+$/i.test(str)) return str.toLowerCase();
  try { return Buffer.from(str, 'base64').toString('hex'); } catch { return str; }
};

function fromOtlp(docs: Json[]): Span[] {
  const out: Span[] = [];
  for (const doc of docs) {
    for (const rs of doc.resourceSpans ?? doc.batches ?? []) {
      const res = otlpAttrs(rs.resource?.attributes);
      const service = res['service.name'] ?? 'unknown';
      for (const ss of rs.scopeSpans ?? rs.instrumentationLibrarySpans ?? []) {
        for (const s of ss.spans ?? []) {
          const attrs = otlpAttrs(s.attributes);
          out.push({
            traceId: hexId(s.traceId), id: hexId(s.spanId), parent: hexId(s.parentSpanId) || undefined,
            service, name: s.name ?? '', kind: KINDS[String(s.kind ?? 1)] ?? 'internal',
            start: nanosToMs(s.startTimeUnixNano), end: nanosToMs(s.endTimeUnixNano),
            error: s.status?.code === 2 || s.status?.code === 'STATUS_CODE_ERROR', attrs,
          });
        }
      }
    }
  }
  return out;
}

function fromJaeger(doc: Json): Span[] {
  const out: Span[] = [];
  for (const t of doc.data ?? [doc]) {
    for (const s of t.spans ?? []) {
      const tags: Record<string, string> = Object.fromEntries((s.tags ?? []).map((x: Json) => [x.key, String(x.value)]));
      const parent = (s.references ?? []).find((r: Json) => r.refType === 'CHILD_OF' || r.refType === 'FOLLOWS_FROM')?.spanID ?? s.parentSpanID;
      out.push({
        traceId: String(s.traceID), id: String(s.spanID), parent: parent && parent !== '0' ? String(parent) : undefined,
        service: t.processes?.[s.processID]?.serviceName ?? s.process?.serviceName ?? 'unknown', name: s.operationName ?? '',
        kind: KINDS[tags['span.kind'] ?? 'internal'] ?? 'internal', start: Number(s.startTime) / 1000, end: (Number(s.startTime) + Number(s.duration)) / 1000,
        error: tags.error === 'true' || tags['otel.status_code'] === 'ERROR', attrs: tags,
      });
    }
  }
  return out;
}

function fromZipkin(list: Json[]): Span[] {
  return list.map((s) => ({
    traceId: String(s.traceId), id: String(s.id), parent: s.parentId ? String(s.parentId) : undefined,
    service: s.localEndpoint?.serviceName ?? 'unknown', name: s.name ?? '', kind: KINDS[s.kind ?? 'internal'] ?? 'internal',
    start: Number(s.timestamp ?? 0) / 1000, end: (Number(s.timestamp ?? 0) + Number(s.duration ?? 0)) / 1000,
    error: !!s.tags?.error, attrs: Object.fromEntries(Object.entries(s.tags ?? {}).map(([k, v]) => [k, String(v)])),
    remote: s.remoteEndpoint?.serviceName,
  }));
}

/** Spans from any supported trace format (an object, an array, or NDJSON text). */
export function readSpans(input: unknown): Span[] {
  let docs: Json[];
  if (typeof input === 'string') {
    try { docs = [JSON.parse(input)]; } catch { docs = input.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l)); }
  } else docs = [input];
  if (docs.length === 1 && Array.isArray(docs[0])) {
    const a = docs[0];
    if (a.length && a[0].traceId && a[0].id) return fromZipkin(a);
    docs = a;
  }
  if (docs.some((d) => d?.resourceSpans || d?.batches)) return fromOtlp(docs);
  if (docs.some((d) => d?.data?.[0]?.spans || (d?.spans && d?.processes))) return docs.flatMap(fromJaeger);
  throw new Error('not a trace: expected OTLP JSON (resourceSpans), Jaeger (data[].spans), Zipkin v2 (array of spans) or a speedwagon timeline');
}

// ---------- spans -> sequence ----------

const fmtMs = (ms: number) => (ms < 1 ? `${ms.toFixed(1)} ms` : ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`);
const short = (s: string, n = 44) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

/** Where a leaf client/producer span goes: a database, a queue, or a named remote service. */
function peerOf(s: Span): { id: string; label: string; kind: Kind } | undefined {
  const a = s.attrs;
  if (a['db.system'] || a['db.system.name']) {
    const sys = a['db.system'] ?? a['db.system.name'];
    const name = a['db.namespace'] ?? a['db.name'] ?? sys;
    return { id: `db:${sys}:${name}`, label: name === sys ? sys : `${name} (${sys})`, kind: 'database' };
  }
  if (a['messaging.system']) {
    const dest = a['messaging.destination.name'] ?? a['messaging.destination'] ?? a['messaging.system'];
    return { id: `mq:${a['messaging.system']}:${dest}`, label: dest, kind: 'queue' };
  }
  const svc = a['peer.service'] ?? s.remote;
  if (svc) return { id: `svc:${svc}`, label: svc, kind: 'service' };
  const host = a['server.address'] ?? a['net.peer.name'] ?? a['http.host'] ?? (a['http.url'] || a['url.full'] ? safeHost(a['http.url'] ?? a['url.full']) : undefined);
  if (host) return { id: `ext:${host}`, label: host, kind: 'external' };
  return undefined;
}
const safeHost = (u: string) => { try { return new URL(u).host; } catch { return undefined; } };

function callLabel(s: Span): string {
  const a = s.attrs;
  const stmt = a['db.query.text'] ?? a['db.statement'];
  if (stmt) return short(stmt.replace(/\s+/g, ' ').trim(), 40);
  return short(s.name);
}

function replyLabel(spans: Span[]): string {
  const s = spans[0];
  const grpc = s.attrs['rpc.grpc.status_code'];
  const code = s.attrs['http.response.status_code'] ?? s.attrs['http.status_code'] ?? (grpc ? `grpc ${grpc}` : undefined);
  const total = spans.reduce((t, x) => t + (x.end - x.start), 0);
  const status = spans.some((x) => x.error) ? (code ? `${code} error` : 'error') : code ?? '';
  return [status, spans.length > 1 ? `${spans.length} calls, ${fmtMs(total)}` : fmtMs(total)].filter(Boolean).join(' · ');
}

interface Call { to: { id: string; label: string; kind: Kind }; label: string; async: boolean; spans: Span[]; inner: Item[] }
type Item = { call: Call } | { self: { label: string; error: boolean } };

export function traceToSequence(input: unknown, opts: TraceOptions = {}): TraceResult {
  const timeline = asTimeline(input);
  if (timeline) return timelineToSequence(timeline, opts);
  const all = readSpans(input);
  if (!all.length) throw new Error('the trace has no spans');
  const byTrace = new Map<string, Span[]>();
  for (const s of all) byTrace.set(s.traceId, [...(byTrace.get(s.traceId) ?? []), s]);
  const traceId = opts.traceId ?? [...byTrace].sort((a, b) => b[1].length - a[1].length)[0][0];
  const spans = byTrace.get(traceId);
  if (!spans) throw new Error(`no trace "${opts.traceId}" (have: ${[...byTrace.keys()].join(', ')})`);

  const byId = new Map(spans.map((s) => [s.id, s]));
  const kids = new Map<string, Span[]>();
  for (const s of spans) if (s.parent && byId.has(s.parent)) kids.set(s.parent, [...(kids.get(s.parent) ?? []), s]);
  for (const k of kids.values()) k.sort((a, b) => a.start - b.start);
  const roots = spans.filter((s) => !s.parent || !byId.has(s.parent)).sort((a, b) => a.start - b.start);
  const svc = (name: string) => ({ id: `svc:${name}`, label: name, kind: 'service' as Kind });

  // items done inside span s (which runs in s.service)
  const within = (s: Span): Item[] => {
    const items: Item[] = [];
    for (const c of kids.get(s.id) ?? []) {
      if (c.service !== s.service) { items.push({ call: { to: svc(c.service), label: short(c.name), async: c.kind === 'consumer' || c.kind === 'producer', spans: [c], inner: within(c) } }); continue; }
      if (c.kind === 'client' || c.kind === 'producer') {
        const remote = (kids.get(c.id) ?? []).filter((g) => g.service !== c.service);
        // a message through a broker: service -> queue, then queue -> each consumer
        const broker = c.kind === 'producer' ? peerOf(c) : undefined;
        if (remote.length && broker?.kind === 'queue') {
          const deliveries: Item[] = remote.map((g) => ({ call: { to: svc(g.service), label: short(g.name), async: true, spans: [g], inner: within(g) } }));
          items.push({ call: { to: broker, label: callLabel(c), async: true, spans: [c], inner: deliveries } });
          continue;
        }
        if (remote.length) {
          for (const g of remote) items.push({ call: { to: svc(g.service), label: short(g.name), async: c.kind === 'producer' || g.kind === 'consumer', spans: [g], inner: within(g) } });
          continue;
        }
        const peer = peerOf(c);
        if (peer) { items.push({ call: { to: peer, label: callLabel(c), async: c.kind === 'producer', spans: [c], inner: [] } }); continue; }
      }
      if (opts.internal && c.kind === 'internal') items.push({ self: { label: short(c.name), error: c.error } });
      items.push(...within(c));
    }
    // N identical calls in a row (no nested work) -> one call "×N"
    const merged: Item[] = [];
    for (const it of items) {
      const prev = merged[merged.length - 1];
      if (prev && 'call' in prev && 'call' in it && !prev.call.inner.length && !it.call.inner.length
        && prev.call.to.id === it.call.to.id && prev.call.label.replace(/ ×\d+$/, '') === it.call.label && prev.call.async === it.call.async) {
        prev.call.spans.push(...it.call.spans);
        prev.call.label = `${it.call.label} ×${prev.call.spans.length}`;
      } else merged.push(it);
    }
    return merged;
  };

  const participants = new Map<string, { id: string; label: string; kind: Kind }>();
  const messages: NonNullable<SequenceInput['messages']> = [];
  const max = opts.maxMessages ?? 80;
  let truncated = false;
  const pid = (p: { id: string; label: string; kind: Kind }) => {
    const id = p.id.replace(/[^A-Za-z0-9_\-:.]/g, '_');
    if (!participants.has(id)) participants.set(id, { id, label: p.label, kind: p.kind });
    return id;
  };
  const emit = (from: string, items: Item[]) => {
    for (const it of items) {
      if (messages.length >= max) { truncated = true; return; }
      if ('self' in it) { messages.push({ from, to: from, label: it.self.label, ...(it.self.error ? { highlight: true } : {}) }); continue; }
      const c = it.call, to = pid(c.to), err = c.spans.some((s) => s.error);
      messages.push({ from, to, label: c.label, style: c.async ? 'dashed' : 'solid', ...(err ? { highlight: true } : {}) });
      emit(to, c.inner);
      if (!c.async && messages.length < max) messages.push({ from: to, to: from, label: replyLabel(c.spans), style: 'dashed', ...(err ? { highlight: true } : {}) });
    }
  };
  const client = { id: 'client', label: 'Client', kind: 'client' as Kind };
  for (const r of roots) {
    const caller = pid(client);
    emit(caller, [{ call: { to: svc(r.service), label: short(r.name), async: r.kind === 'consumer', spans: [r], inner: within(r) } }]);
  }
  // nobody calls "Client" if the root was a consumer: drop it when unused
  const used = new Set(messages.flatMap((m) => [m.from, m.to]));
  const plist = [...participants.values()].filter((p) => used.has(p.id));

  const root = roots[0];
  const dur = Math.max(...spans.map((s) => s.end)) - Math.min(...spans.map((s) => s.start));
  const notes = [`trace ${traceId.slice(0, 16)}: ${spans.length} spans, ${plist.length} participants, ${fmtMs(dur)}`];
  if (byTrace.size > 1) notes.push(`${byTrace.size} traces in the file; drew the largest (pick another with traceId)`);
  if (truncated) notes.push(`stopped at ${max} messages`);
  const errors = spans.filter((s) => s.error).length;
  if (errors) notes.push(`${errors} span${errors > 1 ? 's' : ''} with errors (highlighted)`);
  return { sequence: { type: 'sequence', title: `${short(root.name, 60)} (${fmtMs(dur)})`, participants: plist, messages }, notes };
}

// ---------- speedwagon incident timelines ----------

interface TimelineEvent { time: string; type: string; severity: string; title: string; detail?: string | null; dashboard?: string | null; tags?: string[] }

function asTimeline(input: unknown): TimelineEvent[] | undefined {
  let d: Json = input;
  if (typeof d === 'string') { try { d = JSON.parse(d); } catch { return undefined; } }
  const list = Array.isArray(d?.timeline) ? d.timeline : undefined;
  return list && list.every((e: Json) => e && typeof e.time === 'string' && typeof e.title === 'string') ? list : undefined;
}

/** What an event is about: a service/app/job label if the alert has one, else its dashboard. */
function subjectOf(e: TimelineEvent): string {
  const tag = (k: string) => e.tags?.find((t) => t.startsWith(`${k}=`))?.slice(k.length + 1);
  return tag('service') ?? tag('app') ?? tag('job') ?? tag('deployment') ?? tag('namespace') ?? (e.dashboard ? `dashboard ${e.dashboard}` : 'system');
}

export function timelineToSequence(events: TimelineEvent[], opts: TraceOptions = {}): TraceResult {
  if (!events.length) throw new Error('the timeline has no events');
  const max = opts.maxMessages ?? 80;
  const sorted = [...events].sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
  const t0 = Date.parse(sorted[0].time);
  const hhmm = (t: string) => new Date(t).toISOString().slice(11, 16);
  const participants = new Map<string, { id: string; label: string; kind: Kind }>();
  const add = (id: string, label: string, kind: Kind) => { if (!participants.has(id)) participants.set(id, { id, label, kind }); return id; };
  const alerting = 'grafana';
  const messages: NonNullable<SequenceInput['messages']> = [];
  let last = '';
  for (const e of sorted) {
    const from = e.type === 'annotation' ? add('annotations', 'Annotations', 'note') : add(alerting, 'Grafana alerting', 'external');
    const subj = subjectOf(e);
    const to = add(`s:${subj.replace(/[^A-Za-z0-9_\-:.]/g, '_')}`, subj, 'service');
    const detail = e.detail && e.type === 'alert_state_change' ? ` (${e.detail})` : '';
    const label = `${hhmm(e.time)} ${short(e.title, 40)}${detail}`;
    const key = `${from}|${to}|${e.title}|${e.severity}`;
    if (key === last) continue; // the same alert re-reported
    last = key;
    messages.push({ from, to, label, style: e.severity === 'resolved' ? 'dashed' : 'solid', ...(e.severity === 'critical' ? { highlight: true } : {}) });
    if (messages.length >= max) break;
  }
  const span = Date.parse(sorted[sorted.length - 1].time) - t0;
  const crit = sorted.filter((e) => e.severity === 'critical').length;
  const mins = Math.round(span / 60_000);
  const notes = [`${events.length} timeline events over ${mins < 120 ? `${mins} min` : `${(mins / 60).toFixed(1)} h`}, ${messages.length} drawn`];
  if (crit) notes.push(`${crit} critical (highlighted)`);
  const day = sorted[0].time.slice(0, 10);
  return { sequence: { type: 'sequence', title: `Incident timeline ${day} (UTC)`, participants: [...participants.values()], messages }, notes };
}
