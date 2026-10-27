import { spring, reducedMotion } from './spring.js';

const $$ = (s, r = document) => [...r.querySelectorAll(s)];

// scroll progress bar
export function initProgress(bar) {
  let queued = false;
  const paint = () => {
    queued = false;
    const h = document.documentElement.scrollHeight - innerHeight;
    bar.style.transform = `scaleX(${h > 0 ? Math.min(1, scrollY / h) : 0})`;
  };
  const on = () => { if (!queued) { queued = true; requestAnimationFrame(paint); } };
  addEventListener('scroll', on, { passive: true });
  addEventListener('resize', on);
  paint();
}

// spring-physics reveal with sibling stagger
export function initReveal() {
  const els = $$('[data-reveal]');
  if (reducedMotion()) { els.forEach((e) => e.classList.add('is-shown')); return; }
  const io = new IntersectionObserver(
    (entries) => {
      const batch = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top || a.boundingClientRect.left - b.boundingClientRect.left);
      batch.forEach((en, i) => {
        const el = en.target;
        io.unobserve(el);
        setTimeout(() => {
          el.classList.add('is-shown');
          spring({
            from: 0, to: 1,
            onUpdate: (t) => {
              el.style.opacity = String(Math.min(1, t * 1.4));
              el.style.transform = `translate3d(0, ${(1 - t) * 28}px, 0)`;
            },
            onDone: () => { el.style.opacity = ''; el.style.transform = ''; },
          });
        }, i * 70);
      });
    },
    { threshold: 0.12, rootMargin: '0px 0px -6% 0px' },
  );
  els.forEach((e) => io.observe(e));
}

// hero parallax: pointer + scroll, each layer eased toward its target by a spring-ish lerp
export function initParallax(hero) {
  if (reducedMotion()) return;
  const layers = $$('[data-depth]', hero).map((el) => ({ el, d: parseFloat(el.dataset.depth), x: 0, y: 0 }));
  let px = 0, py = 0, sy = 0, raf = 0;
  const loop = () => {
    let moving = false;
    for (const L of layers) {
      const tx = -px * L.d * 90;
      const ty = -py * L.d * 90 + sy * L.d * 0.35;
      L.x += (tx - L.x) * 0.08;
      L.y += (ty - L.y) * 0.08;
      if (Math.abs(tx - L.x) > 0.05 || Math.abs(ty - L.y) > 0.05) moving = true;
      L.el.style.transform = `translate3d(${L.x.toFixed(2)}px, ${L.y.toFixed(2)}px, 0)`;
    }
    raf = moving ? requestAnimationFrame(loop) : 0;
  };
  const kick = () => { if (!raf) raf = requestAnimationFrame(loop); };
  hero.addEventListener('pointermove', (e) => {
    const r = hero.getBoundingClientRect();
    px = (e.clientX - r.left) / r.width - 0.5;
    py = (e.clientY - r.top) / r.height - 0.5;
    kick();
  });
  hero.addEventListener('pointerleave', () => { px = 0; py = 0; kick(); });
  addEventListener('scroll', () => { sy = Math.min(scrollY, innerHeight); kick(); }, { passive: true });
}

// spotlight: cursor position feeds --mx/--my on any [data-spot] element (delegated)
export function initSpotlight() {
  document.addEventListener('pointermove', (e) => {
    const t = e.target instanceof Element ? e.target.closest('[data-spot]') : null;
    if (!t) return;
    const r = t.getBoundingClientRect();
    t.style.setProperty('--mx', e.clientX - r.left + 'px');
    t.style.setProperty('--my', e.clientY - r.top + 'px');
  }, { passive: true });
}

// click-to-copy for every [data-copy]; unstated records never carry the attribute
export function initCopy() {
  document.addEventListener('click', async (e) => {
    const el = e.target instanceof Element ? e.target.closest('[data-copy]') : null;
    if (!el) return;
    const text = el.dataset.copy;
    let ok = false;
    try { await navigator.clipboard.writeText(text); ok = true; }
    catch {
      const ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', '');
      ta.className = 'sr-only';
      document.body.appendChild(ta); ta.select();
      try { ok = document.execCommand('copy'); } catch { ok = false; }
      ta.remove();
    }
    el.classList.toggle('is-copied', ok);
    el.classList.toggle('is-failed', !ok);
    const live = document.getElementById('live-note');
    if (live) live.textContent = ok ? 'Address copied' : 'Copy failed';
    const lab = el.querySelector('[data-copy-label] span');
    if (lab) lab.textContent = ok ? 'Copied' : 'Failed';
    clearTimeout(el._t);
    el._t = setTimeout(() => {
      el.classList.remove('is-copied', 'is-failed');
      if (lab) lab.textContent = 'Copy';
      if (live) live.textContent = '';
    }, 1500);
  });
}
