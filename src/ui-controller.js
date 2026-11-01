import { decode, extractTimestampClaims } from './jwt-decoder.js';
import { highlight }                       from './json-formatter.js';

// ─── Raw-text store ───────────────────────────────────────────────────────────
// Keeps the plain JSON string for each output block so Copy knows what to
// put on the clipboard without having to strip HTML from innerHTML.
const rawTextStore = new Map();

// ─── DOM helpers ─────────────────────────────────────────────────────────────

/** @param {string} id @returns {HTMLElement} */
function el(id) { return document.getElementById(id); }

// ─── Rendering ───────────────────────────────────────────────────────────────

/**
 * Writes syntax-highlighted JSON into a <pre> element and caches the raw text.
 *
 * The cached text is the serialisation `highlight` already produced, so the
 * copied string and the rendered string cannot drift apart.
 *
 * @param {HTMLPreElement} pre
 * @param {object}         data
 */
export function renderJson(pre, data) {
  const { html, raw } = highlight(data);

  pre.innerHTML = html;
  rawTextStore.set(pre.id, raw);
}

/**
 * Writes the signature string (plain, no highlighting) into a <pre> element.
 *
 * @param {HTMLPreElement} pre
 * @param {string}         signature
 */
function renderSignature(pre, signature) {
  pre.textContent = signature;
  rawTextStore.set(pre.id, signature);
}

const CLAIM_BADGES = {
  expired: '<span class="claim-badge claim-badge--expired">Expired</span>',
  valid:   '<span class="claim-badge claim-badge--valid">Valid</span>',
};

/**
 * Builds the claims panel markup for already-extracted claims. Both the label
 * and the badge come from fixed tables, so no claim value reaches the markup.
 *
 * @param {Array<{ field: string, label: string, date: Date, status: string | null }>} claims
 * @returns {string} HTML
 */
export function claimsPanelHtml(claims) {
  return claims
    .map(({ field, label, date, status }) => `<div class="claim-row">
        <span class="claim-field" title="${field}">${label}</span>
        <span class="claim-date">${date.toUTCString()}</span>
        ${CLAIM_BADGES[status] ?? ''}
      </div>`)
    .join('');
}

/**
 * Populates the claims panel with human-readable timestamp information for
 * the well-known JWT claims iat, exp, and nbf.
 * The panel is emptied (and hidden via CSS :empty) when there are no claims.
 *
 * @param {HTMLDivElement} panel
 * @param {object}         payload
 */
function renderClaimsPanel(panel, payload) {
  const claims = extractTimestampClaims(payload);

  panel.innerHTML = claims.length === 0 ? '' : claimsPanelHtml(claims);
}

// ─── Event handlers ───────────────────────────────────────────────────────────

/**
 * Reacts to changes in the JWT input field.
 * On success: renders decoded sections and hides the error.
 * On failure: shows the error message and hides decoded sections.
 *
 * @param {HTMLTextAreaElement} input
 * @param {Record<string, HTMLElement>} els
 */
function handleInput(input, els) {
  const token = input.value.trim();

  if (!token) {
    els.clearBtn.hidden    = true;
    els.outputPanel.hidden = true;
    els.errorMsg.hidden    = true;
    return;
  }

  els.clearBtn.hidden = false;

  try {
    const { header, payload, signature } = decode(token);

    renderJson(els.headerOutput, header);
    renderJson(els.payloadOutput, payload);
    renderSignature(els.signatureOutput, signature);
    renderClaimsPanel(els.claimsPanel, payload);

    els.errorMsg.hidden    = true;
    els.outputPanel.hidden = false;
  } catch (err) {
    els.errorMsg.textContent = err.message;
    els.errorMsg.hidden      = false;
    els.outputPanel.hidden   = true;
  }
}

// Label-reset timers, keyed by button so a second click cancels the pending
// restore instead of stampeding the label back to "Copy" mid-write.
const labelResets = new WeakMap();

/**
 * Resolves the copy button an event should act on. Delegation must survive a
 * button that contains a child node (an icon, an inline `<svg>`), so the
 * nearest matching ancestor is the answer, not the click target itself.
 *
 * @param {EventTarget} target
 * @returns {HTMLButtonElement | null}
 */
export function copyButtonFrom(target) {
  return target?.closest?.('.copy-btn') ?? null;
}

/**
 * Copies the raw text for the target block to the clipboard.
 * Provides brief visual feedback on the button ("Copied!" / "Error").
 *
 * The pending restore is cancelled on entry, not after the write settles: a
 * second click during a slow write must not have the first click's timer flip
 * the label back to "Copy" while that write is still in flight.
 *
 * @param {HTMLButtonElement} btn
 */
export async function handleCopy(btn) {
  clearTimeout(labelResets.get(btn));
  const text = rawTextStore.get(btn.dataset.copyTarget) ?? '';

  try {
    await navigator.clipboard.writeText(text);
    btn.textContent = 'Copied!';
    btn.classList.add('is-copied');
  } catch {
    btn.textContent = 'Error';
  } finally {
    labelResets.set(btn, setTimeout(() => {
      btn.textContent = 'Copy';
      btn.classList.remove('is-copied');
    }, 1500));
  }
}

// ─── Initialisation ───────────────────────────────────────────────────────────

/**
 * Wires up all event listeners. Call once after DOMContentLoaded.
 */
export function init() {
  const jwtInput       = el('jwt-input');
  const clearBtn       = el('clear-btn');
  const outputPanel    = el('output-panel');
  const errorMsg       = el('error-msg');
  const headerOutput   = el('header-output');
  const payloadOutput  = el('payload-output');
  const signatureOutput = el('signature-output');
  const claimsPanel    = el('claims-panel');

  const els = {
    clearBtn,
    outputPanel,
    errorMsg,
    headerOutput,
    payloadOutput,
    signatureOutput,
    claimsPanel,
  };

  // Decode on every keystroke / paste
  jwtInput.addEventListener('input', () => handleInput(jwtInput, els));

  // Clear button resets everything
  clearBtn.addEventListener('click', () => {
    jwtInput.value         = '';
    clearBtn.hidden        = true;
    outputPanel.hidden     = true;
    errorMsg.hidden        = true;
    jwtInput.focus();
  });

  // Copy buttons — handled via event delegation on the document
  document.addEventListener('click', (e) => {
    const btn = copyButtonFrom(e.target);
    if (btn) handleCopy(btn);
  });
}
