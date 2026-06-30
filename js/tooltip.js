// ── Button tooltips ──────────────────────────────────────────────────────────
// Affiche une bulle explicative au-dessus d'un petit bouton icône rond (.btn-icon)
// si le curseur y reste immobile plus de 600ms. Texte pris dans aria-label, puis title.
(function () {
  const tooltipEl = document.createElement('div');
  tooltipEl.className = 'btn-tooltip';
  document.body.appendChild(tooltipEl);

  const HOVER_DELAY = 600;
  const MOVE_THRESHOLD = 2;

  let hoverTimer = null;
  let activeBtn = null;
  let lastX = 0;
  let lastY = 0;

  function tooltipText(btn) {
    return btn.dataset.tooltip || btn.getAttribute('aria-label') || btn.getAttribute('title') || '';
  }

  function showTooltip(btn) {
    const text = tooltipText(btn);
    if (!text) return;
    tooltipEl.textContent = text;
    const rect = btn.getBoundingClientRect();
    tooltipEl.style.left = `${rect.left + rect.width / 2}px`;
    tooltipEl.style.top = `${rect.top}px`;
    tooltipEl.classList.add('visible');
  }

  function hideTooltip() {
    tooltipEl.classList.remove('visible');
  }

  function clearHoverTimer() {
    clearTimeout(hoverTimer);
    hoverTimer = null;
  }

  function armHoverTimer(btn) {
    clearHoverTimer();
    hoverTimer = setTimeout(() => showTooltip(btn), HOVER_DELAY);
  }

  document.addEventListener('pointerover', (e) => {
    const btn = e.target.closest('.btn-icon');
    if (!btn || btn === activeBtn) return;
    activeBtn = btn;
    lastX = e.clientX;
    lastY = e.clientY;
    hideTooltip();
    armHoverTimer(btn);
  });

  document.addEventListener('pointerout', (e) => {
    if (!activeBtn) return;
    const to = e.relatedTarget && e.relatedTarget.closest ? e.relatedTarget.closest('.btn-icon') : null;
    if (to === activeBtn) return;
    activeBtn = null;
    clearHoverTimer();
    hideTooltip();
  });

  document.addEventListener('pointermove', (e) => {
    if (!activeBtn) return;
    if (Math.abs(e.clientX - lastX) < MOVE_THRESHOLD && Math.abs(e.clientY - lastY) < MOVE_THRESHOLD) return;
    lastX = e.clientX;
    lastY = e.clientY;
    hideTooltip();
    armHoverTimer(activeBtn);
  });

  document.addEventListener('pointerdown', () => {
    activeBtn = null;
    clearHoverTimer();
    hideTooltip();
  });

  window.addEventListener('scroll', hideTooltip, true);
})();
