(() => {
  'use strict';
  const group = document.querySelector('.products');
  if (!group) return;
  const cards = [...group.querySelectorAll('.product')];
  const storageKey = `zlink-product-selection:${group.id}`;
  function choose(card) {
    if (!card) return;
    cards.forEach(item => {
      const active = item === card;
      item.classList.toggle('featured', active);
      const toggle = item.querySelector('.product-select');
      if (toggle) {
        toggle.setAttribute('aria-pressed', String(active));
        toggle.classList.toggle('secondary', !active);
      }
      const link = item.querySelector('.button');
      if (link) {
        link.classList.toggle('primary', active);
        link.classList.toggle('outline', !active);
      }
    });
    try { sessionStorage.setItem(storageKey, card.id); } catch {}
  }
  function fromHash() {
    const hash = location.hash.slice(1);
    return cards.find(card => card.id === hash || card.id === `service-${hash}`);
  }
  let saved;
  try { saved = cards.find(card => card.id === sessionStorage.getItem(storageKey)); } catch {}
  choose(fromHash() || saved || cards[0]);
  cards.forEach(card => card.addEventListener('click', () => choose(card)));
  addEventListener('hashchange', () => { const card = fromHash(); if (card) choose(card); });
})();
