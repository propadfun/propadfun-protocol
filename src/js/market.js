// Market engine. Driven only by the market register record it is handed.
// No DOM, no other register records: every environment dependency is injected.
const POLL_MS = 60000;
const MAX_RETRIES = 4;
const BASE_DELAY = 1000;
const MAX_DELAY = 30000;
const CHUNK = 30;
const TOP_N = 10;

export const backoffDelay = (attempt, rand = Math.random) =>
  Math.min(MAX_DELAY, BASE_DELAY * 2 ** attempt) + Math.floor(rand() * 250);

const num = (v) => {
  const n = typeof v === 'string' ? parseFloat(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};

export function pickAddresses(boosts, chainId = 'solana') {
  const seen = new Set();
  for (const b of Array.isArray(boosts) ? boosts : []) {
    if (b && b.chainId === chainId && typeof b.tokenAddress === 'string' && b.tokenAddress) seen.add(b.tokenAddress);
  }
  return [...seen];
}

export const safeImage = (u) => (typeof u === 'string' && /^https:\/\//i.test(u) ? u : null);

// pairs -> one row per base asset: volume and liquidity summed, price/change from the deepest pair
export function aggregate(pairs, addresses, limit = TOP_N) {
  const wanted = new Set(addresses);
  const by = new Map();
  for (const p of Array.isArray(pairs) ? pairs : []) {
    const addr = p?.baseToken?.address;
    if (!addr || !wanted.has(addr)) continue;
    const liq = num(p.liquidity?.usd) ?? 0;
    const vol = num(p.volume?.h24) ?? 0;
    let row = by.get(addr);
    if (!row) {
      row = { address: addr, name: '', symbol: '', imageUrl: null, price: null, change: null, volume: 0, liquidity: 0, lead: -1 };
      by.set(addr, row);
    }
    row.volume += vol;
    row.liquidity += liq;
    const img = safeImage(p.info?.imageUrl);
    if (img && !row.imageUrl) row.imageUrl = img;
    if (liq > row.lead) {
      row.lead = liq;
      row.name = p.baseToken.name || row.name;
      row.symbol = p.baseToken.symbol || row.symbol;
      row.price = num(p.priceUsd);
      row.change = num(p.priceChange?.h24);
    }
  }
  return [...by.values()]
    .map(({ lead, ...r }) => r)
    .sort((a, b) => b.volume - a.volume)
    .slice(0, limit);
}

async function getJson(fetchImpl, url, signal) {
  const res = await fetchImpl(url, { signal, headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error('http ' + res.status);
  return res.json();
}

export async function loadOnce(record, fetchImpl, signal) {
  const boosts = await getJson(fetchImpl, record.url, signal);
  const addrs = pickAddresses(boosts, record.chainId || 'solana');
  if (!addrs.length) throw new Error('no entries');
  const pairs = [];
  for (let i = 0; i < addrs.length; i += CHUNK) {
    const part = await getJson(fetchImpl, record.pairsUrl.replace('{addresses}', addrs.slice(i, i + CHUNK).join(',')), signal);
    if (Array.isArray(part)) pairs.push(...part);
  }
  const rows = aggregate(pairs, addrs);
  if (!rows.length) throw new Error('no pairs');
  return rows;
}

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function createMarket({
  record,
  fetchImpl = (...a) => fetch(...a),
  sleep = defaultSleep,
  rand = Math.random,
  isHidden = () => false,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (t) => clearTimeout(t),
  onStatus = () => {},
  onData = () => {},
}) {
  let timer = null, abort = null, gen = 0, last = null, started = false;

  const schedule = () => {
    if (!started || isHidden()) return;
    clearTimer(timer);
    timer = setTimer(cycle, POLL_MS);
  };

  async function cycle() {
    clearTimer(timer);
    if (abort) abort.abort();
    abort = typeof AbortController === 'function' ? new AbortController() : { signal: undefined, abort() {} };
    const mine = ++gen;
    onStatus(last ? 'refreshing' : 'loading');
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const rows = await loadOnce(record, fetchImpl, abort.signal);
        if (mine !== gen) return;
        last = rows;
        onData(rows);
        onStatus('live');
        return schedule();
      } catch (e) {
        if (mine !== gen) return;
        if (attempt === MAX_RETRIES) break;
        const d = backoffDelay(attempt, rand);
        onStatus('retrying', { attempt: attempt + 1, delay: d, hasData: !!last });
        await sleep(d);
        if (mine !== gen) return;
      }
    }
    onStatus('error', { hasData: !!last });
    schedule();
  }

  return {
    start() { started = true; if (!isHidden()) return cycle(); },
    stop() { started = false; gen++; clearTimer(timer); if (abort) abort.abort(); },
    // tab hidden: stop everything; tab visible: fetch immediately
    visibility(hidden) {
      if (!started) return;
      if (hidden) { gen++; clearTimer(timer); if (abort) abort.abort(); }
      else return cycle();
    },
    get last() { return last; },
  };
}
