// Damped spring solver. x'' = -k (x - target) - c x'; semi-implicit Euler on a fixed 1/240 s step.
// stiffness 170 / damping 19 gives a damping ratio near 0.73: one soft overshoot, quick settle.
const STEP = 1 / 240;

export function reducedMotion() {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function spring({ from = 0, to = 1, stiffness = 170, damping = 19, mass = 1, onUpdate, onDone }) {
  if (reducedMotion()) {
    onUpdate(to);
    onDone && onDone();
    return () => {};
  }
  let x = from, v = 0, last = performance.now(), raf = 0, acc = 0, dead = false;
  const tick = (now) => {
    if (dead) return;
    acc += Math.min(0.064, (now - last) / 1000);
    last = now;
    while (acc >= STEP) {
      const a = (-stiffness * (x - to) - damping * v) / mass;
      v += a * STEP;
      x += v * STEP;
      acc -= STEP;
    }
    if (Math.abs(x - to) < 0.0005 && Math.abs(v) < 0.005) {
      onUpdate(to);
      onDone && onDone();
      return;
    }
    onUpdate(x);
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return () => { dead = true; cancelAnimationFrame(raf); };
}

// exponential ease-out count between two numbers; fmt turns the number into text
export function countTo(el, from, to, fmt, ms = 650) {
  if (el._cancel) el._cancel();
  if (reducedMotion() || !Number.isFinite(from) || !Number.isFinite(to) || from === to) {
    el.textContent = fmt(to);
    return;
  }
  const t0 = performance.now();
  let raf = 0, dead = false;
  const tick = (now) => {
    if (dead) return;
    const p = Math.min(1, (now - t0) / ms);
    const e = p === 1 ? 1 : 1 - Math.pow(2, -10 * p);
    el.textContent = fmt(from + (to - from) * e);
    if (p < 1) raf = requestAnimationFrame(tick);
  };
  el._cancel = () => { dead = true; cancelAnimationFrame(raf); };
  raf = requestAnimationFrame(tick);
}
