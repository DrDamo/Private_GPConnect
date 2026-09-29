import sanitizeHtml from 'sanitize-html'

// GP-supplied HTML is sanitised on the server before it reaches a browser,
// even though it is also shown in a sandboxed iframe (defence in depth). Only
// the structural markup GP Connect HTML uses is kept: headings, paragraphs,
// tables and lists, with id/class (e.g. table ids, class="date-column").

const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ['div', 'h1', 'h2', 'h3', 'h4', 'p', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'ul', 'ol', 'li', 'b', 'i', 'strong', 'em', 'br', 'span'],
  allowedAttributes: { '*': ['class', 'id', 'colspan', 'rowspan'] },
  disallowedTagsMode: 'discard',
}

export const sanitiseGpHtml = (html: string) => sanitizeHtml(html, OPTIONS)
