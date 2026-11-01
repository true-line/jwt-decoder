/**
 * Regex that tokenises a JSON string produced by JSON.stringify.
 *
 * It matches (in order of alternation):
 *   1. A quoted string optionally followed by whitespace + colon → key or string value
 *   2. JSON keywords: true | false | null
 *   3. JSON numbers (integer, decimal, exponential)
 *
 * This regex is intentionally applied to the raw JSON string (before HTML
 * escaping) so that match indices stay correct. HTML escaping is applied
 * individually to each matched and unmatched slice.
 */
const TOKEN_PATTERN =
  /"(?:\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"(?:\s*:)?|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;

/**
 * Escapes the three HTML special characters that can appear in raw JSON:
 * & < >
 * (Quotes inside a <pre> content context do not need escaping.)
 *
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Maps a matched JSON token to its CSS class name.
 *
 * Key detection: JSON.stringify always emits keys as `"keyName":` (with
 * optional whitespace before the colon), so we check whether the token's
 * trimmed tail ends with ':'.
 *
 * @param {string} token
 * @returns {string}
 */
function tokenClass(token) {
  if (token.startsWith('"')) {
    return token.trimEnd().endsWith(':') ? 'json-key' : 'json-string';
  }
  if (token === 'true' || token === 'false') return 'json-boolean';
  if (token === 'null')                      return 'json-null';
  return 'json-number';
}

/**
 * Converts a JSON-serialisable value into highlighted HTML plus the exact
 * serialisation that HTML was built from.
 *
 * Strategy:
 *   - Serialise the value with JSON.stringify for consistent pretty-printing.
 *   - Walk the string with String.prototype.matchAll, wrapping each token in a
 *     <span>. matchAll clones the pattern, so the module-level regex never
 *     carries scan state between calls.
 *   - HTML-escape every slice (matched and unmatched) to prevent XSS.
 *
 * `raw` is returned so callers that need the plain text (the clipboard) use the
 * same serialisation the DOM shows instead of producing a second, drifting copy.
 *
 * @param {unknown} value - Any JSON-serialisable value
 * @returns {{ html: string, raw: string }}
 */
export function highlight(value) {
  const raw = JSON.stringify(value, null, 2);

  let html   = '';
  let cursor = 0;

  for (const match of raw.matchAll(TOKEN_PATTERN)) {
    const token = match[0];

    // Structural characters between tokens (braces, brackets, commas, whitespace)
    html += escapeHtml(raw.slice(cursor, match.index));
    html += `<span class="${tokenClass(token)}">${escapeHtml(token)}</span>`;

    cursor = match.index + token.length;
  }

  // Any trailing structural characters after the last token
  html += escapeHtml(raw.slice(cursor));

  return { html, raw };
}
