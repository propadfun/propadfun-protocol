// Gates: run after `npm run build`. Exit code 0 only if every gate passes.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');
const DIST = path.join(ROOT, 'dist');
const imp = (p) => import(pathToFileURL(path.join(SRC, p)).href);
const read = (p) => fs.readFileSync(p, 'utf8');
const walk = (d, out = []) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (['node_modules', '.git'].includes(e.name)) continue;
    const f = path.join(d, e.name);
    e.isDirectory() ? walk(f, out) : out.push(f);
  }
  return out;
};

const results = [];
const gate = (name, fn) => results.push({ name, fn });
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m || 'not equal'}: got ${JSON.stringify(a)} want ${JSON.stringify(b)}`); };
const ok = (c, m) => { if (!c) throw new Error(m || 'assertion failed'); };

if (!fs.existsSync(path.join(DIST, 'index.html'))) { console.error('dist/index.html missing: run npm run build first'); process.exit(1); }

const views = await imp('js/views.js');
const market = await imp('js/market.js');
const reg = JSON.parse(read(path.join(DIST, 'register.json')));
const html = read(path.join(DIST, 'index.html'));
const distFiles = walk(DIST);
const textFiles = distFiles.filter((f) => /\.(html|js|css|svg|webmanifest)$/.test(f));
const srcFiles = walk(SRC);

// state-independent mutation anchors: always read the current record, then force a state
const TEST_ADDR = 'So11111111111111111111111111111111111111112';
const TEST_URL = { x: 'https://x.com/propadtest', github: 'https://github.com/propadtest' };
const strip = (r) => { const { value, url, handle, address, href, ...rest } = r; return rest; };
const asAbsent = (r) => ({ ...strip(r), state: 'absent' });
const asUnconfirmed = (r) => ({ ...strip(r), state: 'unconfirmed' });
const asStated = (r, extra) => ({ ...strip(r), state: 'stated', ...extra });

const visible = (h) => h.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<svg[\s\S]*?<\/svg>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

/* ---------- 1-2 register pattern ---------- */
gate('register: every record has a valid state', () => {
  for (const [k, r] of Object.entries(reg)) ok(views.STATES.includes(r.state), `${k} state ${r.state}`);
});
gate('register: inert records carry no value, url, handle or address', () => {
  for (const [k, r] of Object.entries(reg)) if (r.state !== 'stated') for (const f of ['value', 'url', 'href', 'handle', 'address', 'rpc']) ok(!(f in r), `${k} is ${r.state} but has ${f}`);
});
gate('register: stated records carry what they claim (chain, market)', () => {
  eq(reg.chain.state, 'stated'); eq(reg.chain.value, 'Solana'); eq(reg.chain.rpc, 'https://solana-rpc.publicnode.com');
  eq(reg.market.state, 'stated'); ok(/^https:\/\/api\.dexscreener\.com\/token-boosts\/top\/v1$/.test(reg.market.url));
});

/* ---------- 3-8 gate branches, both live ---------- */
gate('branch inert: CA slot has no copy handler, no button, no value (all inert states)', () => {
  for (const f of [asAbsent, asUnconfirmed]) {
    const h = views.renderCa(f(reg.ca));
    ok(!/data-copy/.test(h) && !/<button/.test(h) && !/href=/.test(h), 'inert CA is interactive');
    ok(/pending/.test(h) && /is-inert/.test(h));
    ok(!new RegExp(TEST_ADDR).test(h));
  }
});
gate('branch inert: social icons render, no href, no anchor, both present (all inert states)', () => {
  for (const f of [asAbsent, asUnconfirmed]) for (const k of ['x', 'github']) {
    const h = views.renderSocial(f(reg[k]), k);
    ok(!/href=/.test(h) && !/<a[\s>]/.test(h), `${k} inert has link`);
    ok(/<svg/.test(h) && /is-inert/.test(h) && /pending/.test(h));
  }
});
gate('branch stated: CA shows the full address with click-to-copy', () => {
  const h = views.renderCa(asStated(reg.ca, { value: TEST_ADDR }));
  ok(h.includes(`data-copy="${TEST_ADDR}"`) && h.includes(`>${TEST_ADDR}<`) && /<button/.test(h) && /data-copy-label/.test(h));
});
gate('branch stated: social href is the stored URL, handle derived not stored', () => {
  for (const k of ['x', 'github']) {
    const rec = asStated(reg[k], { url: TEST_URL[k] });
    ok(!('handle' in rec));
    const h = views.renderSocial(rec, k);
    ok(h.includes(`href="${TEST_URL[k]}"`) && /@propadtest/.test(h) && /noopener/.test(h));
  }
  eq(views.deriveHandle('https://x.com/abc/status/1'), '@abc');
});
gate('mutation: absent -> stated -> absent round trip is lossless for every slot', () => {
  for (const k of ['ca', 'x', 'github']) {
    const render = (r) => (k === 'ca' ? views.renderCa(r) : views.renderSocial(r, k));
    const base = render(asAbsent(reg[k]));
    const live = render(asStated(reg[k], k === 'ca' ? { value: TEST_ADDR } : { url: TEST_URL[k] }));
    ok(base !== live, `${k} did not change`);
    eq(render(asAbsent(asStated(reg[k], { value: TEST_ADDR, url: TEST_URL.x }))), base, `${k} round trip`);
  }
});
gate('dist: prerendered slots equal what views produce from dist/register.json', () => {
  ok(html.includes(views.renderCa(reg.ca)), 'CA slot differs');
  ok(html.includes(views.renderSocial(reg.x, 'x') + views.renderSocial(reg.github, 'github')), 'social slot differs');
  ok(html.includes(views.renderBoard(reg)), 'board differs');
  for (const [k, r] of Object.entries(reg)) if (r.state !== 'stated' && ['x', 'github'].includes(k)) ok(!new RegExp(`data-record="${k}"[^>]*href=`).test(html), `${k} has href`);
});
gate('layout: CA slot precedes main content; socials sit in the top bar, icon only', () => {
  ok(html.indexOf('id="ca-slot"') > 0 && html.indexOf('id="ca-slot"') < html.indexOf('<main'));
  const bar = html.match(/<nav class="socials"[\s\S]*?<\/nav>/)[0];
  eq(visible(bar), '', 'social bar has text');
  eq((bar.match(/<svg/g) || []).length, 2, 'two icons');
});

/* ---------- 9 address scanner ---------- */
const scanAddresses = (text, registry) => {
  const stated = new Set(Object.values(registry).filter((r) => r.state === 'stated' && typeof r.value === 'string').map((r) => r.value.toLowerCase()));
  const hits = [...(text.match(/\b0x[0-9a-fA-F]{40}\b/g) || []), ...(text.match(/\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g) || [])];
  return hits.filter((h) => !stated.has(h.toLowerCase()));
};
gate('address scanner: matches by registry, never blanket-rejects 0x hex', () => {
  const hex = '0x' + 'ab12'.repeat(10);
  ok(scanAddresses(`see ${hex}`, reg).length === 1, 'unstated 0x not flagged');
  ok(scanAddresses(`see ${hex}`, { ca: { state: 'stated', value: hex } }).length === 0, 'stated 0x wrongly flagged');
  ok(scanAddresses(`see ${TEST_ADDR}`, reg).length === 1, 'unstated base58 not flagged');
  ok(scanAddresses(`see ${TEST_ADDR}`, { ca: { state: 'stated', value: TEST_ADDR } }).length === 0, 'stated base58 wrongly flagged');
});
gate('address scanner: shipped site holds no address that is not in the register (CA exempt)', () => {
  const bad = [];
  for (const f of textFiles) bad.push(...scanAddresses(read(f), reg).map((h) => `${path.relative(DIST, f)}: ${h}`));
  eq(bad.length, 0, 'stray addresses: ' + bad.join(', '));
  ok(!/address-scan|scanAddresses/.test(html), 'scanner leaked into page');
});

/* ---------- 10-11 no dates ---------- */
const DATE_PATTERNS = [
  /\b\d{4}-\d{2}-\d{2}\b/, /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/, /\b\d{1,2}:\d{2}(:\d{2})?\b/,
  /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}\b/i,
  /\b\d{1,2}\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/i,
  /\b(19|20)\d{2}\b/,
];
const DATE_WORDS = /\b(as of|checked|updated|last updated|ago|timestamp)\b/i;
gate('no dates: shipped page, scripts, styles, manifest and icons hold none', () => {
  for (const f of textFiles) {
    const t = read(f).replace(/\/\*\s*@px[^*]*\*\//g, '').replace(/xmlns="[^"]*"/g, '');
    for (const re of DATE_PATTERNS) ok(!re.test(t), `${path.relative(DIST, f)} matches ${re}`);
  }
  ok(!DATE_WORDS.test(html), 'date wording in page');
});
gate('no dates: every renderer, in every state, is date-free (incl. aria-label and title)', () => {
  const out = [];
  for (const f of [asAbsent, asUnconfirmed, (r) => asStated(r, { value: TEST_ADDR, url: TEST_URL.x })]) {
    out.push(views.renderCa(f(reg.ca)), views.renderSocial(f(reg.x), 'x'), views.renderSocial(f(reg.github), 'github'), views.renderBoardItem(f(reg.ca)));
  }
  const t = out.join('\n');
  for (const re of DATE_PATTERNS) ok(!re.test(t), `renderer matches ${re}`);
  ok(!DATE_WORDS.test(t));
  for (const k of ['checked', 'note']) ok(!t.includes(String(reg.ca[k] || '\u0000')), `register ${k} leaked`);
});
gate('no dates: source uses no clock or date API', () => {
  for (const f of srcFiles.filter((f) => f.endsWith('.js'))) ok(!/new Date|Date\.now|toLocale(Date|Time)String|getFullYear|toISOString/.test(read(f)), path.relative(SRC, f));
});
gate('no dates: dates live in register.json as data only', () => {
  ok(Object.values(reg).every((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.checked)));
});

/* ---------- 12-13 palette ---------- */
const tokensCss = read(path.join(SRC, 'tokens.css'));
const palette = [...tokensCss.matchAll(/(--[\w-]+):\s*(#[0-9a-fA-F]{6});\s*\/\*\s*@px (.+?) (\d+),(\d+)\s*\*\//g)].map((m) => ({ name: m[1], hex: m[2].toLowerCase(), file: m[3], x: +m[4], y: +m[5] }));
gate('palette: literals live in tokens.css only (source tree)', () => {
  for (const f of srcFiles) {
    if (f.endsWith('tokens.css') || /\.(png|jpg)$/.test(f)) continue;
    ok(!/#[0-9a-fA-F]{3,8}\b(?![\w-])/.test(read(f).replace(/&#\d+;/g, '').replace(/href="#[\w-]+"/g, '').replace(/url\(#[\w-]+\)/g, '')), `hex literal in ${path.relative(SRC, f)}`);
  }
  ok(!/\b(rgb|rgba|hsl|hsla)\(/.test(read(path.join(SRC, 'styles.css'))), 'rgb()/hsl() literal in styles.css');
});
gate('palette: every hex shipped in dist is a token', () => {
  const set = new Set(palette.map((p) => p.hex));
  for (const f of textFiles) for (const m of read(f).matchAll(/#[0-9a-fA-F]{6}\b/g)) ok(set.has(m[0].toLowerCase()) || /href="#|id="#/.test(m[0]), `${path.relative(DIST, f)} has ${m[0]}`);
});
gate('palette: each token equals the real pixel it names (provenance)', async () => {
  ok(palette.length === 11, 'expected 11 tokens, found ' + palette.length);
  for (const p of palette) {
    const { data, info } = await sharp(path.join(ROOT, p.file)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const o = (p.y * info.width + p.x) * 3;
    const want = [1, 3, 5].map((i) => parseInt(p.hex.slice(i, i + 2), 16));
    const d = Math.max(...want.map((w, i) => Math.abs(w - data[o + i])));
    ok(d <= 4, `${p.name} ${p.hex} vs pixel ${[...data.slice(o, o + 3)]} in ${p.file}`);
  }
});

/* ---------- 14-15 logo + favicon ---------- */
gate('logo: file in dist, valid RGBA PNG, referenced by relative path in index.html', async () => {
  const f = path.join(DIST, 'assets', 'logo.png');
  const b = fs.readFileSync(f);
  eq(b.subarray(1, 4).toString(), 'PNG');
  eq(b.readUInt32BE(16), 640); eq(b[25], 6, 'colour type');
  ok(b.length > 20000, 'suspiciously small');
  for (const ref of ['assets/logo.png', 'assets/logo-128.png']) ok(html.includes(`src="${ref}"`) && fs.existsSync(path.join(DIST, ref)), ref);
  ok(!/src="\/(assets|js|css)/.test(html) && !/href="\/(assets|css)/.test(html), 'absolute path in index.html');
});
gate('logo: premultiplied resize left no dark fringe on semi-transparent edge pixels', async () => {
  const { data } = await sharp(path.join(DIST, 'assets', 'logo.png')).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let n = 0, sum = 0;
  for (let i = 0; i < data.length; i += 4) if (data[i + 3] > 20 && data[i + 3] < 235) { n++; sum += data[i] + data[i + 1] + data[i + 2]; }
  ok(n > 100, 'no edge pixels sampled');
  ok(sum / n / 3 > 70, 'edge luminance ' + (sum / n / 3).toFixed(1));
});
gate('favicon: svg 32x32, no comments, no double hyphen, fills are tokens', () => {
  const s = read(path.join(DIST, 'favicon.svg'));
  ok(/width="32"/.test(s) && /height="32"/.test(s) && /viewBox="0 0 32 32"/.test(s));
  ok(!/<!--/.test(s) && !/--/.test(s), 'comment or double hyphen');
  const set = new Set(palette.map((p) => p.hex));
  for (const m of s.matchAll(/fill="(#[0-9a-f]{6})"/g)) ok(set.has(m[1]), m[1]);
  ok(/rel="icon" href="favicon.svg"/.test(html));
});

/* ---------- 16 hygiene ---------- */
gate('repo hygiene: no agent config, no attribution anywhere in the repo', () => {
  const bad = new RegExp(['cl' + 'aude', 'anth' + 'ropic', 'gener' + 'ated by', '\\bA' + 'I\\b', 'ch' + 'atgpt', 'op' + 'enai'].join('|'), 'i');
  ok(!fs.existsSync(path.join(ROOT, 'CLA' + 'UDE.md')) && !fs.existsSync(path.join(ROOT, '.cl' + 'aude')), 'agent config present');
  for (const f of walk(ROOT)) {
    const rel = path.relative(ROOT, f);
    if (/^(brand|reference|node_modules)[\\/]/.test(rel) || /package-lock\.json$/.test(rel) || /\.(png|jpe?g|jpeg)$/i.test(rel)) continue;
    ok(!bad.test(read(f)), `forbidden text in ${rel}`);
    ok(!bad.test(rel), `forbidden name ${rel}`);
  }
});
gate('repo content: README, whitepaper, MIT licence exist at root and stay out of dist', () => {
  for (const f of ['README.md', 'docs/whitepaper.md', 'LICENSE']) ok(fs.existsSync(path.join(ROOT, f)), f + ' missing');
  ok(/MIT License/.test(read(path.join(ROOT, 'LICENSE'))) && /Copyright \(c\) 2026 Propad/.test(read(path.join(ROOT, 'LICENSE'))));
  for (const f of ['README.md', 'LICENSE', 'whitepaper.md', 'docs']) ok(!fs.existsSync(path.join(DIST, f)), f + ' in dist');
});

/* ---------- 17 copy originality ---------- */
const REF = `Raypad Open app A launchpad the way it should be. No dev buys, copycat checks on every launch, and trading fees that buy back and burn your coin.
Open the app Launch a token Skip to content Raypad home Raypad Launch on Raydium. Launch on Raydium. Fees buy back and burn. Every Raypad mint ends in ray.
Live Solana launches on Raydium LaunchLab with public buyback receipts. Raypad launch on Raydium. Fees buy back and burn. Every mint ends in ray.
Independent of Raydium, not financial advice. Explore. Disclaimer.`;
const STOP = new Set('a an the and or of to in on for is it as at by be no not that this with your you our we are from its but if so do does can will'.split(' '));
const words = (t) => t.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
const grams = (w) => new Set(w.slice(0, -1).map((x, i) => x + ' ' + w[i + 1]));
gate('copy: zero reference words (content words) and zero shared 2-grams', () => {
  const literals = srcFiles.filter((f) => f.endsWith('.js')).map((f) => [...read(f).matchAll(/(['"`])((?:\\.|(?!\1).){6,})\1/g)].map((m) => m[2]).filter((s) => /\s/.test(s) && !/[<>{}$=;]/.test(s) && !/^https?:/.test(s)).join('. ')).join('. ');
  const mine = words(visible(html.replace(/<(meta)[^>]*>/g, '')) + ' ' + (html.match(/<title>(.*?)<\/title>/)[1]) + ' ' + (html.match(/name="description" content="([^"]*)"/)[1]) + ' ' + literals);
  const refW = words(REF), refContent = new Set(refW.filter((w) => !STOP.has(w) && w !== 'solana' && w !== 'propad'));
  const shared = [...new Set(mine.filter((w) => refContent.has(w)))];
  eq(shared.length, 0, 'shared words: ' + shared.join(', '));
  const rg = grams(refW), mg = grams(mine);
  const g2 = [...mg].filter((g) => rg.has(g) && !/propad|raypad/.test(g));
  eq(g2.length, 0, 'shared 2-grams: ' + g2.join('; '));
});

/* ---------- 18-21 market engine ---------- */
const mkBoosts = () => [
  ...Array.from({ length: 14 }, (_, i) => ({ chainId: 'solana', tokenAddress: 'A' + i })),
  { chainId: 'solana', tokenAddress: 'A0' }, { chainId: 'robinhood', tokenAddress: 'Z9' },
];
const mkPair = (i, vol, extra = {}) => ({ baseToken: { address: 'A' + i, name: 'N' + i, symbol: 'S' + i }, priceUsd: String(1 + i), priceChange: { h24: i - 5 }, volume: { h24: vol }, liquidity: { usd: 100 * (i + 1) }, info: i % 2 ? { imageUrl: 'https://img.test/' + i } : undefined, ...extra });
const mkFetch = (log, { fail = 0, pairsFn } = {}) => {
  let calls = 0;
  return async (url) => {
    log.push(url); calls++;
    if (calls <= fail) throw new Error('boom');
    const json = url.includes('token-boosts') ? mkBoosts() : (pairsFn ? pairsFn(url) : Array.from({ length: 14 }, (_, i) => mkPair(i, 1000 + i * 10)).concat([mkPair(3, 5)]));
    return { ok: true, json: async () => json };
  };
};
const record = () => ({ ...reg.market });
gate('market: solana only, deduped, chunked <=30, top 10 by 24h volume, summed per asset', async () => {
  const log = [], out = [];
  const m = market.createMarket({ record: record(), fetchImpl: mkFetch(log), onData: (r) => out.push(r), setTimer: () => 0, clearTimer: () => {}, sleep: async () => {} });
  await m.start();
  ok(log[0] === reg.market.url && log[1].startsWith('https://api.dexscreener.com/tokens/v1/solana/'), 'urls');
  ok(!log[1].includes('Z9'), 'non-solana address requested');
  eq(log[1].split('/').pop().split(',').length, 14, 'address list deduped');
  const rows = out[0];
  eq(rows.length, 10);
  ok(rows.every((r, i) => i === 0 || rows[i - 1].volume >= r.volume), 'not sorted by volume');
  eq(rows[0].address, 'A13');
  const a3 = market.aggregate(Array.from({ length: 2 }, () => mkPair(3, 7)), ['A3'])[0];
  eq(a3.volume, 14, 'volume summed');
  eq(market.pickAddresses(Array.from({ length: 65 }, (_, i) => ({ chainId: 'solana', tokenAddress: 'T' + i }))).length, 65);
});
gate('market: 65 addresses fetch in three chunks of at most 30', async () => {
  const urls = [];
  const rec = record();
  const f = async (url) => { urls.push(url); return { ok: true, json: async () => (url.includes('boosts') ? Array.from({ length: 65 }, (_, i) => ({ chainId: 'solana', tokenAddress: 'T' + i })) : [mkPair(0, 1, { baseToken: { address: 'T0', name: 'n', symbol: 's' } })]) }; };
  await market.loadOnce(rec, f);
  const pairCalls = urls.filter((u) => !u.includes('boosts'));
  eq(pairCalls.length, 3);
  ok(pairCalls.every((u) => u.split('/').pop().split(',').length <= 30));
});
gate('market: exponential backoff, last good data kept on failure, dash state reported', async () => {
  eq(market.backoffDelay(0, () => 0), 1000); eq(market.backoffDelay(1, () => 0), 2000); eq(market.backoffDelay(3, () => 0), 8000); eq(market.backoffDelay(9, () => 0), 30000);
  const sleeps = [], status = [], data = [];
  let fail = 0;
  const log = [];
  const base = mkFetch(log);
  const f = async (u) => { if (fail) throw new Error('down'); return base(u); };
  const m = market.createMarket({ record: record(), fetchImpl: f, rand: () => 0, sleep: async (ms) => sleeps.push(ms), onStatus: (s, x) => status.push([s, x]), onData: (r) => data.push(r), setTimer: () => 0, clearTimer: () => {} });
  fail = 1; await m.start();
  eq(JSON.stringify(sleeps), '[1000,2000,4000,8000]', 'backoff sequence');
  eq(status.at(-1)[0], 'error'); eq(status.at(-1)[1].hasData, false); eq(data.length, 0);
  fail = 0; await m.visibility(false);
  eq(data.length, 1); eq(status.at(-1)[0], 'live');
  fail = 1; sleeps.length = 0; await m.visibility(false);
  eq(status.at(-1)[0], 'error'); eq(status.at(-1)[1].hasData, true, 'last good data not kept');
  eq(m.last, data[0]);
});
gate('market: polls every 60 s, pauses while hidden, fetches immediately when visible', async () => {
  const timers = []; let hidden = false, cleared = 0, fetches = 0;
  const base = mkFetch([]);
  const m = market.createMarket({ record: record(), fetchImpl: async (u) => { if (u.includes('boosts')) fetches++; return base(u); }, isHidden: () => hidden, setTimer: (fn, ms) => { timers.push(ms); return timers.length; }, clearTimer: () => { cleared++; }, sleep: async () => {} });
  await m.start();
  eq(timers.at(-1), 60000, 'poll interval'); eq(fetches, 1);
  hidden = true; m.visibility(true); const before = timers.length;
  await new Promise((r) => setTimeout(r, 5));
  eq(timers.length, before, 'timer set while hidden'); eq(fetches, 1, 'fetched while hidden');
  hidden = false; await m.visibility(false);
  eq(fetches, 2, 'no immediate fetch on visible');
  const idle = market.createMarket({ record: record(), fetchImpl: async () => { throw new Error('must not fetch'); } });
  ok(idle.last === null);
});
gate('market: follows only its own record; contract-address state has zero effect', () => {
  for (const f of ['market.js', 'market-ui.js']) {
    const t = read(path.join(SRC, 'js', f));
    ok(!/reg(ister)?\.ca\b|\.ca\b|['"]ca['"]|contract/i.test(t), f + ' mentions the CA record');
  }
  const main = read(path.join(SRC, 'js', 'main.js'));
  ok(/isStated\(reg\.market\)/.test(main) && /mountMarket\(document\.body, reg\.market\)/.test(main), 'market not keyed on its own record');
  const fetchArgs = market.createMarket.toString();
  ok(!/\bca\b/.test(fetchArgs));
});
gate('market ui: letter-tile fallback, skeleton, stagger, count-up, flash, copy-per-address', () => {
  const ui = read(path.join(SRC, 'js', 'market-ui.js')), css = read(path.join(SRC, 'styles.css'));
  ok(/tile-letter/.test(ui) && /r\.imageUrl \?/.test(ui) && /addEventListener\('error'/.test(ui) && /e\.target\.remove\(\)/.test(ui), 'tile fallback');
  ok(/countTo\(/.test(ui) && /flash\(/.test(ui) && /data-copy="\$\{esc\(r\.address\)\}"/.test(ui), 'count/flash/copy');
  ok(/row skeleton/.test(html) && /@keyframes shimmer/.test(css) && /animation-delay: calc\(var\(--i, 0\) \* 30ms\)/.test(css) && /is-leaving/.test(ui), 'skeleton -> stagger');
  ok(/class="tick-set"/.test(ui) && /ticker-track/.test(css), 'ticker from live data');
  eq((html.match(/class="row skeleton"/g) || []).length, 10);
});

/* ---------- 22-26 motion, reduced motion, mobile ---------- */
gate('reduced motion: CSS and JS both fall back to instant, zero motion', () => {
  const css = read(path.join(SRC, 'styles.css'));
  const block = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
  for (const needle of ['animation-duration: 1ms', 'transition-duration: 1ms', '.ticker-track', '.mesh i', '.dot::after', '.curve-path', '[data-reveal]', '[data-depth]', 'animation-iteration-count: 1']) ok(block.includes(needle), needle);
  const sp = read(path.join(SRC, 'js', 'spring.js')), mo = read(path.join(SRC, 'js', 'motion.js'));
  ok(/prefers-reduced-motion: reduce/.test(sp) && /reducedMotion\(\)/.test(mo) && /if \(reducedMotion\(\)\) return;/.test(mo));
  ok(/'rm'/.test(html));
});
gate('motion features present: spring solver, parallax, spotlight, progress bar, pulsing pill, reveal stagger', () => {
  const sp = read(path.join(SRC, 'js', 'spring.js')), mo = read(path.join(SRC, 'js', 'motion.js')), css = read(path.join(SRC, 'styles.css'));
  ok(/stiffness/.test(sp) && /damping/.test(sp));
  ok(/initParallax/.test(mo) && /pointermove/.test(mo) && /scrollY/.test(mo) && /initSpotlight/.test(mo) && /initProgress/.test(mo) && /i \* 70/.test(mo));
  ok(/\.progress/.test(css) && /@keyframes ping/.test(css) && /\[data-spot\]::before/.test(css) && /@keyframes mesh-drift/.test(css));
  ok(/class="progress"/.test(html) && /data-depth/.test(html) && /id="status-pill"/.test(html));
});
gate('reference parity: measured easing, durations and metrics carried over; logo float/spin and coin icon removed', () => {
  const css = read(path.join(SRC, 'styles.css'));
  for (const n of ['cubic-bezier(.16, 1, .3, 1)', '.6s var(--ease)', '1.4s linear infinite', '90s linear infinite', '1.8s var(--ease-draw)', 'max-width: 1200px', 'radius: 12px'.replace('radius', 'border-radius')]) ok(css.includes(n), n);
  ok(!/landing-float|landing-spin/.test(css) && !/hero-art[^{]*\{[^}]*animation/.test(css) && !/data-depth/.test(html.match(/<div class="hero-art[\s\S]*?<\/div>/)[0]), 'hero logo animated');
  ok(!/coin/i.test(visible(html)));
});
gate('mobile: no ch units, tap targets >= 44px declared, no fixed widths over 360', () => {
  const css = read(path.join(SRC, 'styles.css'));
  ok(!/\d\s?ch\b/.test(css), 'ch unit used');
  for (const sel of ['.social', '.copy-btn', '.tab', '.ca-action', '.brand', '.chip', '.net']) {
    const m = css.match(new RegExp(sel.replace('.', '\\.') + '\\s*\\{[^}]*\\}'));
    ok(m && /(min-)?height: 44px|width: 44px/.test(m[0]), sel + ' lacks 44px');
  }
  ok(/\.btn \{[^}]*height: 48px/.test(css));
});
gate('links: no external script, font or tracker; same-origin modules only', () => {
  ok(!/<script[^>]+src="https?:/.test(html) && !/<link[^>]+href="https?:\/\/(?!propad\.fun)/.test(html));
  ok(!/@import|fonts\.googleapis/.test(read(path.join(SRC, 'styles.css'))));
});

/* ---------- run ---------- */
let pass = 0;
for (const g of results) {
  try { await g.fn(); pass++; console.log('  pass  ' + g.name); }
  catch (e) { console.log('  FAIL  ' + g.name + '\n        ' + e.message); }
}
const failed = results.length - pass;
console.log(`\ngates: ${pass}/${results.length} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
