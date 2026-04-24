/**
 * Best-effort RTF → plain Unicode for line-by-line ingestion (URLs / text).
 * Not a full RTF engine; nested tables, images, and odd encodings may lose fidelity.
 * @param {string} rtf
 * @returns {string}
 */
export function rtfToPlainText(rtf) {
  if (!rtf || typeof rtf !== 'string') return '';
  let s = rtf.replace(/\r\n/g, '\n');

  // Drop common destination groups (font/color tables, etc.)
  s = s.replace(/\{\\\*[^}]*\}/g, '');

  // Hex byte → char (ANSI / extended)
  s = s.replace(/\\'([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));

  // Unicode codepoint \uN (often followed by replacement char if skipped)
  s = s.replace(/\\u(-?\d+)\s?/gi, (_, d) => {
    let c = parseInt(d, 10);
    if (c < 0) c += 65536;
    return String.fromCharCode(c & 0xffff);
  });

  s = s.replace(/\\par[d0-9]*\s*/gi, '\n');
  s = s.replace(/\\(line|column|lbr0?)\s*/gi, '\n');
  s = s.replace(/\\tab\s*/gi, '\t');
  s = s.replace(/\\~\s*/g, '\u00a0');
  s = s.replace(/\\_\s*/g, '-');
  s = s.replace(/\\-\s*/g, '\u00ad');

  // Remaining control words + delimiters (keep text nodes)
  s = s.replace(/\\[a-z]+-?\d*\s?/gi, '');
  s = s.replace(/[{}]/g, '');

  // Literal escapes that survived
  s = s.replace(/\\([{}\\])/g, '$1');

  s = s.replace(/[ \t]+\n/g, '\n');
  s = s.replace(/\n[ \t]+/g, '\n');
  s = s.replace(/\n{3,}/g, '\n\n');
  return s.trim();
}
