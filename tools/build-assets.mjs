// Generates the MVP image assets (素材リスト I-01〜I-04) as SVG, then renders the PNG variants with Chromium.
//   node tools/build-assets.mjs
// The UI icon set (I-05) lives inline in index.html so it works from file:// without extra requests.
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'assets');
mkdirSync(OUT, { recursive: true });

// Brand tokens, shared with index.html (dark theme values read better on app icons and cards)
const C = { bg0: '#0c1318', bg1: '#1d2a33', ink: '#e4ebef', muted: '#93a4af', wood: '#d79a58', woodDark: '#7b4b22',
  woodHi: '#f2c48d', mint: '#3fc6a2', cobalt: '#7397ff', steel: '#c6d0d6' };
const FONT = "'Dela Gothic One','Hiragino Sans','Yu Gothic',sans-serif";

// The brachistochrone (cycloid) from start (x0,y0) dropping into a valley and rising to the goal.
function cycloid(x0, y0, r, thEnd, n = 64) {
  const pts = [];
  for (let i = 0; i <= n; i++) { const th = thEnd * i / n; pts.push([x0 + r * (th - Math.sin(th)), y0 + r * (1 - Math.cos(th))]); }
  return pts;
}
const d = pts => 'M' + pts.map(p => p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' L');
const TH = 3.6449; // span/drop = 2.2 → the curve dips below the goal, so the "detour" reads at a glance

// Shared mark: dashed straight rival, wooden cycloid lane, steel ball. Coordinates in a 1024 box.
function mark({ ball = true } = {}) {
  const r = 159.9, x0 = 182, y0 = 250, pts = cycloid(x0, y0, r, TH), end = pts[pts.length - 1];
  const bt = 2.35, bx = x0 + r * (bt - Math.sin(bt)), by = y0 + r * (1 - Math.cos(bt));
  const nx = -Math.sin(bt) / Math.hypot(Math.sin(bt), 1 - Math.cos(bt)), ny = (1 - Math.cos(bt)) / Math.hypot(Math.sin(bt), 1 - Math.cos(bt));
  const BR = 92, cx = bx + nx * (BR + 30), cy = by - ny * (BR + 30);
  return `
  <line x1="${x0}" y1="${y0}" x2="${end[0].toFixed(1)}" y2="${end[1].toFixed(1)}" stroke="${C.cobalt}" stroke-width="26" stroke-linecap="round" stroke-dasharray="2 58" opacity=".9"/>
  <path d="${d(pts.map(p => [p[0], p[1] + 18]))}" fill="none" stroke="${C.woodDark}" stroke-width="66" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="${d(pts)}" fill="none" stroke="${C.wood}" stroke-width="62" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="${d(pts.map(p => [p[0], p[1] - 20]))}" fill="none" stroke="${C.woodHi}" stroke-width="8" stroke-linecap="round" opacity=".8"/>
  <circle cx="${x0}" cy="${y0}" r="22" fill="${C.ink}"/>
  <rect x="${end[0] + 8}" y="${end[1] - 190}" width="16" height="170" rx="8" fill="${C.ink}"/>
  <path d="M${end[0] + 24} ${end[1] - 190} h70 v34 h-70z M${end[0] + 24} ${end[1] - 122} h70 v-34 h-70z" fill="${C.ink}" opacity=".9"/>
  ${ball ? `
  <g stroke="${C.mint}" stroke-width="14" stroke-linecap="round" opacity=".85">
    <line x1="${(cx - 150).toFixed(0)}" y1="${(cy - 104).toFixed(0)}" x2="${(cx - 104).toFixed(0)}" y2="${(cy - 70).toFixed(0)}"/>
    <line x1="${(cx - 178).toFixed(0)}" y1="${(cy - 40).toFixed(0)}" x2="${(cx - 122).toFixed(0)}" y2="${(cy - 12).toFixed(0)}"/>
  </g>
  <circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${BR}" fill="url(#steel)"/>
  <circle cx="${(cx + 40).toFixed(1)}" cy="${(cy + 22).toFixed(1)}" r="12" fill="#1d2a33" opacity=".55"/>
  <circle cx="${(cx - 40).toFixed(1)}" cy="${(cy - 22).toFixed(1)}" r="12" fill="#1d2a33" opacity=".35"/>` : ''}`;
}
const defs = `<defs>
  <radialGradient id="steel" cx=".36" cy=".32" r=".75"><stop offset="0" stop-color="#ffffff"/><stop offset=".3" stop-color="${C.steel}"/><stop offset=".85" stop-color="#5d6b75"/><stop offset="1" stop-color="#7b8892"/></radialGradient>
  <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.bg1}"/><stop offset="1" stop-color="${C.bg0}"/></linearGradient>
  <pattern id="grid" width="64" height="64" patternUnits="userSpaceOnUse"><path d="M64 0H0V64" fill="none" stroke="#ffffff" stroke-opacity=".05" stroke-width="2"/></pattern>
</defs>`;

// I-01 app icon (1024, full-bleed rounded square; stores mask it themselves)
const icon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">${defs}
  <rect width="1024" height="1024" rx="228" fill="url(#bg)"/><rect width="1024" height="1024" rx="228" fill="url(#grid)"/>
  <g transform="translate(-44 150)">${mark()}</g>
</svg>`;

// I-02 logo, horizontal and square. Text uses the display face; outline it in the designer pass.
const logo = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 880 200" width="880" height="200">${defs}
  <rect x="0" y="0" width="200" height="200" rx="46" fill="url(#bg)"/>
  <g transform="translate(-4 14) scale(.2)">${mark()}</g>
  <text x="232" y="132" font-family="${FONT}" font-size="86" fill="${C.bg1}" letter-spacing="3">GRAVITY <tspan fill="#22997c">RACE</tspan></text>
</svg>`;
const logoSquare = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">${defs}
  <rect width="512" height="512" rx="112" fill="url(#bg)"/>
  <g transform="translate(66 6) scale(.37)">${mark()}</g>
  <text x="256" y="408" text-anchor="middle" font-family="${FONT}" font-size="64" fill="${C.ink}" letter-spacing="2">GRAVITY</text>
  <text x="256" y="470" text-anchor="middle" font-family="${FONT}" font-size="50" fill="${C.mint}" letter-spacing="10">RACE</text>
</svg>`;

// I-03 share card base (1200×630). The left panel stays empty: the game draws time and result there.
const card = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630">${defs}
  <rect width="1200" height="630" fill="url(#bg)"/><rect width="1200" height="630" fill="url(#grid)"/>
  <g transform="translate(560 40) scale(.66)">${mark()}</g>
  <g transform="translate(64 48)">
    <rect width="76" height="76" rx="18" fill="${C.bg0}" stroke="#ffffff" stroke-opacity=".12" stroke-width="2"/>
    <g transform="translate(-2 6) scale(.076)">${mark()}</g>
    <text x="98" y="54" font-family="${FONT}" font-size="40" fill="${C.ink}" letter-spacing="2">GRAVITY <tspan fill="${C.mint}">RACE</tspan></text>
  </g>
  <rect x="64" y="160" width="520" height="360" rx="28" fill="#ffffff" fill-opacity=".04" stroke="#ffffff" stroke-opacity=".1" stroke-width="2"/>
  <text x="64" y="582" font-family="${FONT}" font-size="30" fill="${C.muted}">最速の道はどっち？ リンクから同じコースで対戦</text>
</svg>`;

// I-04 finger guide. The fingertip sits at (40,26) so the page can pin it onto a course pin.
const guide = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 170" width="120" height="170">
  <circle cx="40" cy="26" r="20" fill="none" stroke="${C.mint}" stroke-width="4" opacity=".9"/>
  <path d="M40 54 v42" stroke="${C.mint}" stroke-width="4" stroke-dasharray="2 8" stroke-linecap="round" fill="none"/>
  <path d="M30 98 l10 12 l10 -12" stroke="${C.mint}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
  <path d="M30 34 a10 10 0 0 1 20 0 v52 a10 10 0 0 1 20 -2 v4 a10 10 0 0 1 20 0 v6 a10 10 0 0 1 20 2 v34
           c0 22 -14 40 -40 40 h-12 c-16 0 -26 -8 -34 -20 l-22 -34 c-6 -9 2 -19 12 -14 l16 10z"
        fill="#ffffff" stroke="${C.bg1}" stroke-width="5" stroke-linejoin="round" transform="translate(0 0)"/>
</svg>`;

const files = { 'icon.svg': icon, 'logo.svg': logo, 'logo-square.svg': logoSquare, 'share-card.svg': card, 'finger-guide.svg': guide };
for (const [name, svg] of Object.entries(files)) writeFileSync(join(OUT, name), svg.replace(/\n\s*\n/g, '\n') + '\n');

// PNG exports. The page loads the display font first so the logo text renders with it when the network allows.
// playwright may be installed globally (resolved through NODE_PATH, which ESM imports ignore)
const { createRequire } = await import('node:module');
const { chromium } = await import('playwright').catch(() => createRequire(import.meta.url)('playwright'));
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage();
const renders = [
  ['icon.svg', 'icon-1024.png', 1024, 1024], ['icon.svg', 'icon-512.png', 512, 512], ['icon.svg', 'icon-192.png', 192, 192],
  ['icon.svg', 'apple-touch-icon.png', 180, 180], ['share-card.svg', 'share-card.png', 1200, 630]
];
for (const [src, out, w, h] of renders) {
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(`<!doctype html><html><head>
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Dela+Gothic+One&display=swap">
    <style>html,body{margin:0;background:transparent}svg{display:block;width:${w}px;height:${h}px}</style></head>
    <body>${files[src]}</body></html>`, { waitUntil: 'load' }).catch(() => {});
  await page.evaluate(() => document.fonts.ready).catch(() => {});
  await page.screenshot({ path: join(OUT, out), omitBackground: true, clip: { x: 0, y: 0, width: w, height: h } });
  console.log('wrote assets/' + out);
}
await browser.close();
