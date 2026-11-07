// Text measurement without a browser. Deliberately conservative (slightly
// over-estimates) so that "fits" in lint really means it fits when rendered.

const WIDE_RANGES: Array<[number, number]> = [
  [0x1100, 0x11ff], // Hangul Jamo
  [0x2e80, 0x9fff], // CJK
  [0xa960, 0xa97f],
  [0xac00, 0xd7af], // Hangul syllables
  [0xf900, 0xfaff],
  [0xfe30, 0xfe4f],
  [0xff00, 0xff60], // fullwidth forms
  [0x1f300, 0x1faff], // emoji
];

function isWide(cp: number): boolean {
  for (const [a, b] of WIDE_RANGES) if (cp >= a && cp <= b) return true;
  return false;
}

export const LINE_HEIGHT = 1.25;

/** Width of one line in px for a monospace font (Excalidraw fontFamily 3). */
export function lineWidth(line: string, fontSize = 16): number {
  let w = 0;
  for (const ch of line) w += isWide(ch.codePointAt(0)!) ? fontSize * 1.05 : fontSize * 0.62;
  return w;
}

export interface TextMetrics {
  width: number;
  height: number;
  lines: string[];
}

export function measureText(text: unknown, fontSize = 16): TextMetrics {
  const lines = String(text ?? '').split('\n');
  const width = Math.max(0, ...lines.map((l) => lineWidth(l, fontSize)));
  return { width, height: lines.length * fontSize * LINE_HEIGHT, lines };
}

/** Greedy word wrap so long labels do not produce absurdly wide boxes. */
export function wrapText(text: string, maxWidth: number, fontSize = 16): string {
  const out: string[] = [];
  for (const para of String(text ?? '').split('\n')) {
    const words = para.split(/(\s+)/).filter((w) => w.length);
    let cur = '';
    for (const w of words) {
      const next = cur + w;
      if (cur && lineWidth(next.trimEnd(), fontSize) > maxWidth) {
        out.push(cur.trimEnd());
        cur = w.trimStart();
      } else cur = next;
    }
    out.push(cur.trimEnd());
  }
  return out.join('\n');
}
