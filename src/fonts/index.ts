// Font metrics (for sizing boxes) and Pretendard embedding (for SVG/PNG).
import { readFileSync } from 'node:fs';
import { METRICS, PRETENDARD_SUBSETS } from './generated.js';

/** Faces we can measure. `mono` is the legacy estimate for Excalidraw's Cascadia (fontFamily 3). */
export type Face = 'pretendard500' | 'pretendard600' | 'nunito' | 'mono' | 'hand';

const WIDE = /[ᄀ-ᇿ⺀-鿿ꥠ-꥿가-힯豈-﫿︰-﹏＀-｠]/u;
const EMOJI = /\p{Extended_Pictographic}/u;

export function charWidth(ch: string, face: Face): number {
  if (face === 'mono') return WIDE.test(ch) || EMOJI.test(ch) ? 1.05 : 0.62;
  if (face === 'hand') return WIDE.test(ch) || EMOJI.test(ch) ? 1.05 : 0.6;
  const m = METRICS[face];
  if (WIDE.test(ch)) return m.hangul;
  if (EMOJI.test(ch)) return 1.2;
  return m.table[ch] ?? m.fallback;
}

/** Width of one line in px. */
export function lineWidth(line: string, fontSize: number, face: Face = 'mono'): number {
  let w = 0;
  for (const ch of line) w += charWidth(ch, face);
  return w * fontSize;
}

/** Map an Excalidraw fontFamily id to the face we measure it with. */
export function excalidrawFace(fontFamily: unknown): Face {
  switch (fontFamily) {
    case 3: return 'mono';
    case 1: case 5: case 8: return 'hand';
    default: return 'nunito'; // 6 Nunito; 2/9 Helvetica-like sans measure about the same
  }
}

const FONT_DIR = new URL('../../fonts/pretendard/', import.meta.url);
const cache = new Map<string, string>();
const b64 = (file: string) => {
  let v = cache.get(file);
  if (!v) { v = readFileSync(new URL(file, FONT_DIR)).toString('base64'); cache.set(file, v); }
  return v;
};

/**
 * @font-face rules for Pretendard (Medium only), embedding only the subset files that cover the characters
 * actually used (Latin-only diagrams embed a few KB; Korean adds the needed Hangul chunks).
 */
export function pretendardCss(textByWeight: Partial<Record<number, string>>): string {
  const rules: string[] = [];
  for (const [w, text] of Object.entries(textByWeight)) {
    const weight = Number(w);
    const cps = new Set([...(text ?? '')].map((c) => c.codePointAt(0)!));
    const subsets = PRETENDARD_SUBSETS[weight];
    if (!cps.size || !subsets) continue;
    for (const s of subsets) {
      if (![...cps].some((cp) => s.ranges.some(([a, b]) => cp >= a && cp <= b))) continue;
      const range = s.ranges.map(([a, b]) => (a === b ? `U+${a.toString(16)}` : `U+${a.toString(16)}-${b.toString(16)}`)).join(',');
      rules.push(`@font-face{font-family:'Pretendard';font-weight:${weight};src:url(data:font/woff2;base64,${b64(s.file)}) format('woff2');unicode-range:${range}}`);
    }
  }
  return rules.join('');
}
