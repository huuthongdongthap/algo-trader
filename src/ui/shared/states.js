/* CashClaw — Loading / Empty / Error state renderers
 * Inject skeleton, empty, or error UI into any container element.
 */

/**
 * Render skeleton loading placeholders into a container.
 * @param {HTMLElement} container - Target element
 * @param {{ rows?: number }} options - Number of skeleton rows (default 3)
 */
export function renderLoading(container, options = {}) {
  const rows = options.rows || 3;
  container.innerHTML = '';

  for (let i = 0; i < rows; i++) {
    const row = document.createElement('div');
    row.style.marginBottom = 'var(--space-4)';

    const heading = document.createElement('div');
    heading.className = 'cc-skeleton cc-skeleton--heading';
    heading.style.width = `${30 + Math.random() * 30}%`;
    row.appendChild(heading);

    const text = document.createElement('div');
    text.className = 'cc-skeleton cc-skeleton--text';
    text.style.width = `${50 + Math.random() * 40}%`;
    row.appendChild(text);

    container.appendChild(row);
  }
}

/**
 * Render an empty state with optional icon, headline, body, and CTA.
 * @param {HTMLElement} container - Target element
 * @param {{ icon?: string, headline?: string, body?: string, ctaText?: string, ctaAction?: function }} config
 */
export function renderEmpty(container, config = {}) {
  container.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.className = 'cc-empty';

  if (config.icon) {
    const iconEl = document.createElement('div');
    iconEl.className = 'cc-empty-icon';
    // Sanitize: only accept SVG elements or plain text, never raw HTML strings
    if (config.icon instanceof Element) {
      iconEl.appendChild(config.icon);
    } else {
      iconEl.textContent = config.icon;
    }
    wrapper.appendChild(iconEl);
  }

  if (config.headline) {
    const h = document.createElement('div');
    h.className = 'cc-empty-headline';
    h.textContent = config.headline;
    wrapper.appendChild(h);
  }

  if (config.body) {
    const b = document.createElement('div');
    b.className = 'cc-empty-body';
    b.textContent = config.body;
    wrapper.appendChild(b);
  }

  if (config.ctaText && config.ctaAction) {
    const btn = document.createElement('button');
    btn.className = 'cc-button cc-button--primary';
    btn.textContent = config.ctaText;
    btn.addEventListener('click', config.ctaAction);
    wrapper.appendChild(btn);
  }

  container.appendChild(wrapper);
}

/**
 * Render an error state with message and retry button.
 * @param {HTMLElement} container - Target element
 * @param {{ message?: string, onRetry?: function }} config
 */
export function renderError(container, config = {}) {
  container.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.className = 'cc-error';

  const icon = document.createElement('div');
  icon.className = 'cc-error-icon';
  icon.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`;
  wrapper.appendChild(icon);

  const msg = document.createElement('div');
  msg.className = 'cc-error-message';
  msg.textContent = config.message || 'Something went wrong';
  wrapper.appendChild(msg);

  if (config.onRetry) {
    const btn = document.createElement('button');
    btn.className = 'cc-button cc-button--secondary';
    btn.textContent = 'Retry';
    btn.addEventListener('click', config.onRetry);
    wrapper.appendChild(btn);
  }

  container.appendChild(wrapper);
}
