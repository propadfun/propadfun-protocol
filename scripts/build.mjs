// Build: src/ -> dist/. Everything the site needs is copied or generated here, nothing is assumed.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');
const DIST = path.join(ROOT, 'dist');
const LOGO_SRC = path.join(ROOT, 'brand', 'LOGO PROPAD PNG...png'); // RGBA, transparent cut-out

const read = (p) => fs.readFileSync(p, 'utf8');
const put = (rel, data) => {
  const to = path.join(DIST, rel);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.writeFileSync(to, data);
};
const copyDir = (from, to) => {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const a = path.join(from, e.name), b = path.join(to, e.name);
    e.isDirectory() ? copyDir(a, b) : fs.copyFileSync(a, b);
  }
};

// palette comes from the tokens file, never retyped here
const tokens = {};
for (const m of read(path.join(SRC, 'tokens.css')).matchAll(/(--[\w-]+):\s*(#[0-9a-fA-F]{6})/g)) tokens[m[1].slice(2)] = m[2].toLowerCase();
const rgb = (h) => ({ r: parseInt(h.slice(1, 3), 16), g: parseInt(h.slice(3, 5), 16), b: parseInt(h.slice(5, 7), 16) });

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });

// ---- logo: alpha bbox -> square crop -> premultiplied-safe resize -------------------------
// The cut-out holds pure-black RGB under alpha 0. libvips premultiplies before resampling,
// so those texels carry no weight and no dark fringe reaches the edge.
const { data: px, info } = await sharp(LOGO_SRC).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
let x0 = info.width, y0 = info.height, x1 = 0, y1 = 0;
for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
  if (px[(y * info.width + x) * 4 + 3] > 8) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
}
const side = Math.round(Math.max(x1 - x0 + 1, y1 - y0 + 1) * 1.1);
const cx = Math.round((x0 + x1) / 2), cy = Math.round((y0 + y1) / 2);
const left = Math.max(0, Math.min(info.width - side, cx - (side >> 1)));
const top = Math.max(0, Math.min(info.height - side, cy - (side >> 1)));
const crop = await sharp(LOGO_SRC).ensureAlpha().extract({ left, top, width: side, height: side }).toBuffer();
const logo = (n) => sharp(crop).resize(n, n, { kernel: 'lanczos3' }).png({ compressionLevel: 9 }).toBuffer();

put('assets/logo.png', await logo(640));
put('assets/logo-128.png', await logo(128));

const night = rgb(tokens.night);
const flat = async (n, inner) => sharp({ create: { width: n, height: n, channels: 4, background: { ...night, alpha: 1 } } })
  .composite([{ input: await logo(inner), gravity: 'centre' }]).png().toBuffer();
put('assets/apple-touch-icon.png', await flat(180, 140));
put('assets/og.png', await sharp({ create: { width: 1200, height: 630, channels: 4, background: { ...night, alpha: 1 } } })
  .composite([{ input: await logo(520), gravity: 'centre' }]).png().toBuffer());

// ---- favicon: 32x32 grid sampled from the real pixels, snapped to palette tokens ----------
const g = await sharp(crop).resize(32, 32, { kernel: 'lanczos3' }).raw().toBuffer();
const cand = ['cyan', 'blue', 'violet', 'magenta', 'lilac'].map((k) => ({ k, h: tokens[k], ...rgb(tokens[k]) }));
const nearest = (o) => cand.reduce((a, c) => {
  const d = (g[o] - c.r) ** 2 + (g[o + 1] - c.g) ** 2 + (g[o + 2] - c.b) ** 2;
  return d < a.d ? { c, d } : a;
}, { c: null, d: Infinity }).c;
const runs = new Map();
for (let y = 0; y < 32; y++) {
  let x = 0;
  while (x < 32) {
    const o = (y * 32 + x) * 4;
    if (g[o + 3] < 128) { x++; continue; }
    const best = nearest(o);
    let n = 1;
    while (x + n < 32) {
      const o2 = (y * 32 + x + n) * 4;
      if (g[o2 + 3] < 128 || nearest(o2).k !== best.k) break;
      n++;
    }
    if (!runs.has(best.h)) runs.set(best.h, []);
    runs.get(best.h).push(`<rect x="${x}" y="${y}" width="${n}" height="1"/>`);
    x += n;
  }
}
const groups = [...runs].map(([h, r]) => `<g fill="${h}">${r.join('')}</g>`).join('');
put('favicon.svg', `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" shape-rendering="crispEdges">${groups}</svg>\n`);

// ---- site files ---------------------------------------------------------------------------
copyDir(path.join(SRC, 'js'), path.join(DIST, 'js'));
fs.mkdirSync(path.join(DIST, 'css'), { recursive: true });
fs.copyFileSync(path.join(SRC, 'tokens.css'), path.join(DIST, 'css', 'tokens.css'));
fs.copyFileSync(path.join(SRC, 'styles.css'), path.join(DIST, 'css', 'styles.css'));
fs.copyFileSync(path.join(SRC, 'register.json'), path.join(DIST, 'register.json'));
put('_headers', '/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n/assets/*\n  Cache-Control: public, max-age=31536000, immutable\n');
put('manifest.webmanifest', JSON.stringify({
  name: 'Propad', short_name: 'Propad', start_url: './', display: 'standalone',
  theme_color: tokens.night, background_color: tokens.night,
  icons: [{ src: 'assets/logo.png', sizes: '640x640', type: 'image/png', purpose: 'any' }],
}, null, 2) + '\n');

// ---- prerender register-driven slots with the same views the browser uses -----------------
const views = await import(pathToFileURL(path.join(SRC, 'js', 'views.js')).href);
const reg = JSON.parse(read(path.join(SRC, 'register.json')));
const skRow = '<li class="row skeleton" aria-hidden="true"><span class="sk w2"></span><span class="c-asset"><span class="sk tile-sk"></span><span class="sk w1"></span></span><span class="sk w1 c-price"></span><span class="c-meta"><span class="sk w1"></span><span class="sk w2"></span></span><span class="c-act"></span></li>';
const val = (r) => (views.isStated(r) && r.value ? views.esc(r.value) : 'pending');
const html = read(path.join(SRC, 'index.html'))
  .replace('<!--slot:social-->', views.renderSocial(reg.x, 'x') + views.renderSocial(reg.github, 'github'))
  .replace('<!--slot:ca-->', views.renderCa(reg.ca))
  .replace('<!--slot:board-->', views.renderBoard(reg))
  .replace('<!--slot:skeleton-->', skRow.repeat(10))
  .replaceAll('%%CHAIN%%', val(reg.chain))
  .replaceAll('%%MARKET%%', val(reg.market))
  .replace('%%THEME%%', tokens.night);
put('index.html', html);

// ---- verify the logo made it, with the path the page uses ---------------------------------
for (const f of ['assets/logo.png', 'assets/logo-128.png', 'favicon.svg', 'index.html']) {
  if (!fs.existsSync(path.join(DIST, f))) throw new Error('missing in dist: ' + f);
}
for (const ref of ['assets/logo.png', 'assets/logo-128.png']) {
  if (!html.includes(`src="${ref}"`)) throw new Error('index.html does not reference ' + ref);
}
console.log('build ok -> dist/ (' + fs.readdirSync(DIST).join(', ') + ')');
