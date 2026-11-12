import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { root } from './helpers.js';

const server = join(root, 'dist/mcp.js');

function session() {
  const p = spawn(process.execPath, [server], { stdio: ['pipe', 'pipe', 'inherit'] });
  let buf = '';
  const waiting = new Map<number, (v: unknown) => void>();
  p.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      const msg = JSON.parse(line);
      waiting.get(msg.id)?.(msg);
    }
  });
  let id = 0;
  const call = (method: string, params?: unknown) => new Promise<any>((res) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    const n = ++id; waiting.set(n, res);
    p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: n, method, params }) + '\n');
  });
  const init = async () => {
    await call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } });
    p.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  };
  return { call, init, close: () => p.kill() };
}

describe.skipIf(!existsSync(server))('mcp server (run `pnpm build` first)', () => {
  it('lists its tools', async () => {
    const s = session();
    await s.init();
    const res = await s.call('tools/list');
    s.close();
    expect(res.result.tools.map((t: { name: string }) => t.name).sort())
      .toEqual(['build_diagram', 'build_from_mermaid', 'build_from_trace', 'build_sequence', 'lint_diagram', 'render_diagram', 'search_icons', 'tidy_diagram']);
  });

  it('builds a diagram end to end', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'draftr-'));
    const s = session();
    await s.init();
    const res = await s.call('tools/call', {
      name: 'build_diagram',
      arguments: {
        out: join(dir, 'arch'), preview: false,
        graph: { nodes: [{ id: 'a', label: 'Client' }, { id: 'b', label: 'API', highlight: true }, { id: 'c', label: 'Postgres', kind: 'database' }], edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }] },
      },
    });
    s.close();
    expect(res.result.isError).toBeFalsy();
    expect(res.result.content[0].text).toMatch(/OK score 100\/100/);
    expect(JSON.parse(readFileSync(join(dir, 'arch.excalidraw'), 'utf8')).type).toBe('excalidraw');
    expect(existsSync(join(dir, 'arch.svg'))).toBe(true);
  });

  it('returns tool errors instead of crashing', async () => {
    const s = session();
    await s.init();
    const res = await s.call('tools/call', { name: 'lint_diagram', arguments: { path: '/definitely/not/here.excalidraw' } });
    s.close();
    expect(res.result.isError).toBe(true);
  });
});
