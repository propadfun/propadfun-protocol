import { renderCa, renderSocial, renderBoard, isStated } from './views.js';
import { initProgress, initReveal, initParallax, initSpotlight, initCopy } from './motion.js';
import { mountMarket } from './market-ui.js';

const $ = (s) => document.querySelector(s);

async function loadRegister() {
  const res = await fetch('register.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error('register');
  return res.json();
}

function paintRecords(reg) {
  $('#ca-slot').innerHTML = renderCa(reg.ca);
  $('#social').innerHTML = renderSocial(reg.x, 'x') + renderSocial(reg.github, 'github');
  $('#board').innerHTML = renderBoard(reg);
}

initProgress($('#progress'));
initSpotlight();
initCopy();
initParallax($('#hero'));
initReveal();

loadRegister()
  .then((reg) => {
    paintRecords(reg);
    // the market follows its own record and nothing else
    if (isStated(reg.market)) mountMarket(document.body, reg.market);
    else $('#market').dataset.state = 'inert';
  })
  .catch(() => { /* prerendered records stay as built */ });
