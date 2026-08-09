/**
 * A markdown-to-HTML renderer for exactly the subset the docs/ files use.
 *
 * Not a general markdown implementation, and not trying to be. The alternative
 * was a ~30kb parser dependency in a web package that otherwise has three, to
 * render two documents this repo writes itself. If a doc starts needing a
 * feature that isn't here it will render as literal text - visibly wrong rather
 * than silently wrong - and that's the moment to reach for a real parser.
 *
 * Supported: h1-h3, paragraphs, fenced code, inline code, bold, links, bullet
 * and numbered lists (with wrapped continuation lines), blockquotes, and rules.
 *
 * Everything is HTML-escaped before any markup is inserted, so a doc can never
 * inject markup no matter what it contains.
 */

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const CLASSES = {
  h1: 'text-2xl font-bold text-gray-900 mt-8 mb-3 first:mt-0',
  h2: 'text-lg font-semibold text-gray-900 mt-8 mb-3 pb-2 border-b border-gray-200',
  h3: 'text-base font-semibold text-gray-900 mt-6 mb-2',
  p: 'text-sm text-gray-700 leading-relaxed mb-3',
  ul: 'list-disc pl-5 mb-3 space-y-1.5 text-sm text-gray-700',
  ol: 'list-decimal pl-5 mb-3 space-y-1.5 text-sm text-gray-700',
  pre: 'bg-gray-900 text-gray-100 rounded-lg p-3 mb-3 overflow-x-auto text-xs leading-relaxed',
  code: 'bg-gray-100 text-gray-800 rounded px-1 py-0.5 text-[0.85em] font-mono',
  quote: 'border-l-4 border-blue-300 bg-blue-50 pl-3 py-2 mb-3 text-sm text-gray-700 italic',
  a: 'text-blue-600 underline hover:text-blue-800',
};

/**
 * Inline formatting. Code spans resolve first so their contents aren't then
 * treated as bold or link syntax.
 */
function inline(text: string, resolveLink: (href: string) => string): string {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, `<code class="${CLASSES.code}">$1</code>`)
    .replace(/\*\*([^*]+)\*\*/g, '<strong class="font-semibold text-gray-900">$1</strong>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label: string, href: string) => {
      const url = resolveLink(href);
      const external = /^https?:/.test(url);
      const attrs = external ? ' target="_blank" rel="noopener noreferrer"' : '';
      return `<a href="${url}" class="${CLASSES.a}"${attrs}>${label}</a>`;
    });
}

const BULLET = /^[-*] +(.*)$/;
const NUMBERED = /^\d+\. +(.*)$/;
const HEADING = /^(#{1,3}) +(.*)$/;

export function renderMarkdown(
  markdown: string,
  resolveLink: (href: string) => string = (href) => href
): string {
  const lines = markdown.split('\n');
  const out: string[] = [];
  let i = 0;

  const fmt = (text: string) => inline(text, resolveLink);

  /**
   * Consume a run of list items. A wrapped line (indented, not a new item)
   * continues the item above it, which is how the source docs are hard-wrapped.
   */
  const takeList = (pattern: RegExp, tag: 'ul' | 'ol'): void => {
    const items: string[] = [];
    while (i < lines.length) {
      const match = lines[i].match(pattern);
      if (match) {
        items.push(match[1]);
        i++;
      } else if (items.length > 0 && /^\s+\S/.test(lines[i])) {
        items[items.length - 1] += ' ' + lines[i].trim();
        i++;
      } else {
        break;
      }
    }
    out.push(
      `<${tag} class="${CLASSES[tag]}">${items.map((t) => `<li>${fmt(t)}</li>`).join('')}</${tag}>`
    );
  };

  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith('```')) {
      const body: string[] = [];
      i++; // opening fence
      while (i < lines.length && !lines[i].startsWith('```')) body.push(lines[i++]);
      i++; // closing fence
      out.push(`<pre class="${CLASSES.pre}"><code>${escapeHtml(body.join('\n'))}</code></pre>`);
      continue;
    }

    const heading = line.match(HEADING);
    if (heading) {
      const tag = (['h1', 'h2', 'h3'] as const)[heading[1].length - 1];
      out.push(`<${tag} class="${CLASSES[tag]}">${fmt(heading[2])}</${tag}>`);
      i++;
      continue;
    }

    if (/^---+\s*$/.test(line)) {
      out.push('<hr class="my-6 border-gray-200">');
      i++;
      continue;
    }

    if (BULLET.test(line)) {
      takeList(BULLET, 'ul');
      continue;
    }

    if (NUMBERED.test(line)) {
      takeList(NUMBERED, 'ol');
      continue;
    }

    if (line.startsWith('> ')) {
      const quoted: string[] = [];
      while (i < lines.length && lines[i].startsWith('> ')) quoted.push(lines[i++].slice(2));
      out.push(`<blockquote class="${CLASSES.quote}">${fmt(quoted.join(' '))}</blockquote>`);
      continue;
    }

    if (line.trim() === '') {
      i++;
      continue;
    }

    // Paragraph: soft-wrapped lines until a blank line or the next block.
    const paragraph: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !lines[i].startsWith('```') &&
      !HEADING.test(lines[i]) &&
      !BULLET.test(lines[i]) &&
      !NUMBERED.test(lines[i]) &&
      !/^---+\s*$/.test(lines[i])
    ) {
      paragraph.push(lines[i++].trim());
    }
    out.push(`<p class="${CLASSES.p}">${fmt(paragraph.join(' '))}</p>`);
  }

  return out.join('\n');
}
