// Text measurement without a browser, from real glyph metrics where we have them.
import { lineWidth as faceLineWidth, type Face } from './fonts/index.js';

export type { Face } from './fonts/index.js';
export const LINE_HEIGHT = 1.25;

export function lineWidth(line: string, fontSize = 16, face: Face = 'mono'): number {
  return faceLineWidth(line, fontSize, face);
}

export interface TextMetrics { width: number; height: number; lines: string[] }

export function measureText(text: unknown, fontSize = 16, face: Face = 'mono'): TextMetrics {
  const lines = String(text ?? '').split('\n');
  const width = Math.max(0, ...lines.map((l) => faceLineWidth(l, fontSize, face)));
  return { width, height: lines.length * fontSize * LINE_HEIGHT, lines };
}

/** Greedy word wrap so long labels do not produce absurdly wide boxes. */
export function wrapText(text: string, maxWidth: number, fontSize = 16, face: Face = 'mono'): string {
  const out: string[] = [];
  for (const para of String(text ?? '').split('\n')) {
    const words = para.split(/(\s+)/).filter((w) => w.length);
    let cur = '';
    for (const w of words) {
      const next = cur + w;
      if (cur && faceLineWidth(next.trimEnd(), fontSize, face) > maxWidth) {
        out.push(cur.trimEnd());
        cur = w.trimStart();
      } else cur = next;
    }
    out.push(cur.trimEnd());
  }
  return out.join('\n');
}
