// Builds the landing page: site/src/index.html -> site/index.html (GitHub Pages).
// Fills in the Pretendard faces (Latin subsets, inlined), the logo, the hero illustration, icon chips
// and the package version. With --preview <file> it also writes a body-only copy for previews.
// Run after `pnpm build`: node scripts/build-site.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { markA, draftToCanvas } from './build-brand.mjs';

const root = new URL('../', import.meta.url);
const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
const { IconLibrary } = await import(new URL('dist/index.js', root).href);

const latin = (w) => readFileSync(new URL(`node_modules/pretendard/dist/web/static/woff2-dynamic-subset/Pretendard-${w}.subset.91.woff2`, root)).toString('base64');
const FONTS = [['Medium', 500], ['SemiBold', 600], ['Bold', 700], ['ExtraBold', 800]]
  .map(([n, w]) => `@font-face{font-family:'Pretendard';font-weight:${w};font-display:swap;src:url(data:font/woff2;base64,${latin(n)}) format('woff2')}`).join('\n');

const LOGO_MARK = `<svg viewBox="0 0 64 64" aria-hidden="true">${markA()}</svg>`;

// hero art in both themes; CSS shows the one that matches
const animate = (s) => s.replace('<path d="M508 196', '<path class="cursor" d="M508 196');
const HERO_ART = `<div class="art-light">${animate(draftToCanvas(false))}</div><div class="art-dark">${animate(draftToCanvas(true))}</div>
<style>
.art-dark { display: none; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) .art-light { display: none; } :root:not([data-theme="light"]) .art-dark { display: block; } }
:root[data-theme="dark"] .art-light { display: none; } :root[data-theme="dark"] .art-dark { display: block; }
</style>`;

const lib = new IconLibrary();
const ICONS = ['postgresql', 'mongodb', 'apachekafka', 'redis', 'stripe', 'kubernetes', 'docker', 'credit-card', 'mail']
  .map((name) => {
    const icon = lib.get(name);
    const color = icon.source === 'generic' ? '#3b5bdb' : undefined;
    return `<span class="chip">${icon.svg(color).replace('<svg ', '<svg aria-hidden="true" ')}${icon.name}</span>`;
  }).join('');

const src = readFileSync(new URL('site/src/index.html', root), 'utf8');
const page = src.replace('{{FONTS}}', FONTS).replaceAll('{{LOGO_MARK}}', LOGO_MARK).replace('{{HERO_ART}}', HERO_ART)
  .replace('{{ICONS}}', ICONS).replace('{{VERSION}}', pkg.version);

const split = page.indexOf('<header');
const head = page.slice(0, split), body = page.slice(split);
const url = 'https://scrawl-labs.github.io/draftr/';
const description = 'draftr turns what your AI agent knows about a system into a laid-out architecture diagram you open in Excalidraw, draw.io or tldraw and keep shaping by hand.';
const full = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="description" content="${description}">
<meta property="og:title" content="draftr: AI drafts the diagram. You keep thinking.">
<meta property="og:description" content="${description}">
<meta property="og:image" content="${url}assets/og.png">
<meta property="og:url" content="${url}">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="assets/favicon.svg" type="image/svg+xml">
<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)} body{margin:0} [hidden]{display:none!important}</style>
${head}
</head>
<body>
${body}
</body>
</html>
`;
writeFileSync(new URL('site/index.html', root), full);
const i = process.argv.indexOf('--preview');
if (i > 0) writeFileSync(process.argv[i + 1], page);
console.log(`wrote site/index.html (${(full.length / 1024).toFixed(0)} KB)`);
