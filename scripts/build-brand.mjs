// Generates the draftr brand assets:
//   .github/assets/brand/{logo-mark,logo,logo-dark,favicon}.svg   vector logos (wordmark font embedded)
//   .github/assets/brand/{banner,banner-dark}.png                 1280x640 README / social preview
// Run: node scripts/build-brand.mjs   (needs devDependency pretendard and playwright)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = new URL('../', import.meta.url);
const out = new URL('.github/assets/brand/', root);
mkdirSync(out, { recursive: true });

// Pretendard Latin subset (chunk 91 covers basic Latin and punctuation) per weight
const latin = (w) => readFileSync(new URL(`node_modules/pretendard/dist/web/static/woff2-dynamic-subset/Pretendard-${w}.subset.91.woff2`, root)).toString('base64');
const face = (name, w) => `@font-face{font-family:'Pretendard';font-weight:${w};src:url(data:font/woff2;base64,${latin(name)}) format('woff2')}`;
const FACES = face('Medium', 500) + face('SemiBold', 600) + face('Bold', 700) + face('ExtraBold', 800);

export const C = {
  ink: '#1d2433', inkDark: '#eef0f6', blue: '#3b5bdb', blueLine: '#9db0ee', blueLineDark: '#7f93e8', blueFill: '#eef2fd',
  orange: '#e8590c', orangeFill: '#fff3e6', orangeLine: '#f2b47a', green: '#2b8a3e', greenFill: '#ebf7f0', greenLine: '#93cfaa', muted: '#6b7280',
};

/** Mark A, "Draft → Edit": a dashed draft box flows into a solid box. 64x64. */
export function markA({ dark = false, bold = false } = {}) {
  const sw = bold ? 4 : 2.75;
  const dash = bold ? '7 5' : '5.5 4';
  return `<rect x="5" y="6" width="30" height="24" rx="6" fill="none" stroke="${dark ? C.blueLineDark : C.blueLine}" stroke-width="${sw}" stroke-dasharray="${dash}"/>`
    + `<path d="M20 31 V44.5 H29" fill="none" stroke="${dark ? C.inkDark : C.ink}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"/>`
    + `<path d="M26 39 L31.5 44.5 L26 50" fill="none" stroke="${dark ? C.inkDark : C.ink}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"/>`
    + `<rect x="33" y="32" width="27" height="25" rx="6.5" fill="${C.blue}"/>`;
}

const svg = (w, h, body, extra = '') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"${extra}>${body}</svg>\n`;

// favicon: thicker strokes, so the dashed draft survives 16px
writeFileSync(new URL('favicon.svg', out), svg(64, 64, markA({ bold: true })));
writeFileSync(new URL('logo-mark.svg', out), svg(64, 64, markA()));
const wordmark = (dark) => svg(250, 64,
  `<defs><style>${face('ExtraBold', 800)}</style></defs><g>${markA({ dark })}</g>`
  + `<text x="78" y="49" font-family="Pretendard, 'Segoe UI', Helvetica, Arial, sans-serif" font-weight="800" font-size="48" letter-spacing="-1.9" fill="${dark ? C.inkDark : C.ink}">draftr</text>`);
writeFileSync(new URL('logo.svg', out), wordmark(false));
writeFileSync(new URL('logo-dark.svg', out), wordmark(true));

// ---------- banner ----------
const box = (x, y, w, h, label, cap, k, { solid = false, dashed = false, dark = false } = {}) => {
  const hue = { blue: [C.blueFill, C.blueLine, C.blue], orange: [C.orangeFill, C.orangeLine, C.orange], green: [C.greenFill, C.greenLine, C.green] }[k];
  const fillDark = { blue: '#1c2650', orange: '#3d2412', green: '#15331f' }[k];
  const fill = solid ? hue[2] : dashed ? (dark ? '#12151c' : '#ffffff') : dark ? fillDark : hue[0];
  const ink = solid ? '#ffffff' : dashed ? (dark ? '#6f7686' : '#9aa1ad') : dark ? C.inkDark : C.ink;
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="${fill}" stroke="${solid ? hue[2] : hue[1]}" stroke-width="1.5"${dashed ? ' stroke-dasharray="6 5"' : ''}/>`
    + `<text x="${x + 16}" y="${y + h / 2 - 1}" font-family="Pretendard" font-weight="600" font-size="15" fill="${ink}">${label}</text>`
    + `<text x="${x + 16}" y="${y + h / 2 + 16}" font-family="Pretendard" font-weight="500" font-size="12" fill="${solid ? 'rgba(255,255,255,.8)' : dark ? '#7d8494' : '#9aa1ad'}">${cap}</text>`;
};

/** The "AI draft → your canvas" illustration, shared by the banner and the landing page. */
export function draftToCanvas(dark = false) {
  const ink = dark ? C.inkDark : C.ink, line = dark ? '#8b93a3' : '#5b6472';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 560 400" width="560" height="400" role="img" aria-label="An AI draft of three dashed boxes becomes an editable diagram on your canvas">`
    + `<text x="0" y="22" font-family="Pretendard" font-weight="600" font-size="12.5" letter-spacing="1.2" fill="${dark ? '#7d8494' : '#9aa1ad'}">AI DRAFT</text>`
    + box(0, 40, 160, 56, 'Web app', 'Client', 'green', { dashed: true, dark })
    + box(0, 130, 160, 56, 'API', 'Service', 'blue', { dashed: true, dark })
    + box(0, 220, 160, 56, 'Postgres', 'Database', 'orange', { dashed: true, dark })
    + `<path d="M190 158 H250" stroke="${ink}" stroke-width="2.5" stroke-linecap="round"/><path d="M244 151 L252 158 L244 165" fill="none" stroke="${ink}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`
    + `<text x="290" y="22" font-family="Pretendard" font-weight="600" font-size="12.5" letter-spacing="1.2" fill="${dark ? '#8fa3f0' : C.blue}">YOUR CANVAS</text>`
    + `<rect x="280" y="34" width="276" height="300" rx="16" fill="${dark ? '#12151c' : '#ffffff'}" stroke="${dark ? '#272c37' : '#e3e6ea'}"/>`
    + box(300, 56, 150, 56, 'Web app', 'Client', 'green', { dark })
    + box(380, 150, 156, 56, 'API', 'Service', 'blue', { solid: true, dark })
    + box(300, 250, 150, 56, 'Postgres', 'Database', 'orange', { dark })
    + `<path d="M375 112 V178 H380" fill="none" stroke="${line}" stroke-width="1.5"/><path d="M458 206 V278 H450" fill="none" stroke="${line}" stroke-width="1.5"/>`
    + `<path d="M508 196 L531 206 L521 209.5 L527 220 L522.5 222.5 L516.5 212 L509.5 218 Z" fill="${ink}" stroke="${dark ? '#12151c' : '#ffffff'}" stroke-width="2" stroke-linejoin="round"/>`
    + `<text x="280" y="372" font-family="Pretendard" font-weight="500" font-size="15" fill="${dark ? '#8b93a3' : C.muted}">Excalidraw · draw.io · tldraw</text>`
    + `</svg>`;
}

async function banner(dark) {
  const { chromium } = require('playwright');
  const b = await chromium.launch(process.env.DRAFTR_CHROMIUM ? { executablePath: process.env.DRAFTR_CHROMIUM } : {});
  const p = await b.newPage({ viewport: { width: 1280, height: 640 }, deviceScaleFactor: 2 });
  const bg = dark ? '#0d1016' : '#fbfbfc', dots = dark ? '#1f2430' : '#e6e8ec', ink = dark ? C.inkDark : C.ink;
  await p.setContent(`<!doctype html><html><head><style>${FACES}body{margin:0}</style></head><body>
  <div style="width:1280px;height:640px;background:${bg};display:flex;align-items:center;gap:56px;padding:0 72px;box-sizing:border-box;position:relative;overflow:hidden;font-family:Pretendard">
    <div style="position:absolute;inset:0;background-image:radial-gradient(${dots} 1px,transparent 1px);background-size:22px 22px"></div>
    <div style="position:relative;flex:1">
      <div style="display:flex;align-items:center;gap:16px">${svg(64, 64, markA({ dark }), ' width="64" height="64"')}<span style="font:800 64px/1 Pretendard;letter-spacing:-0.04em;color:${ink}">draftr</span></div>
      <div style="margin-top:28px;font:700 40px/1.2 Pretendard;letter-spacing:-0.02em;color:${ink}">AI drafts the diagram.<br><span style="color:${dark ? '#8fa3f0' : C.blue}">You keep thinking.</span></div>
      <div style="margin-top:20px;font:500 18px/1.5 Pretendard;color:${dark ? '#8b93a3' : C.muted};max-width:440px">Auto-laid-out architecture diagrams you open and edit by hand. CLI and MCP server.</div>
    </div>
    <div style="position:relative">${draftToCanvas(dark)}</div>
  </div></body></html>`);
  await p.evaluate(() => document.fonts.ready);
  writeFileSync(new URL(dark ? 'banner-dark.png' : 'banner.png', out), await p.screenshot());
  await b.close();
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  await banner(false);
  await banner(true);
  console.log('wrote .github/assets/brand/*');
}
