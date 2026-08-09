import { describe, it, expect } from 'vitest';
import { renderMarkdown } from '../markdown';

describe('renderMarkdown', () => {
  it('renders headings, bold, and inline code', () => {
    const html = renderMarkdown('## Setup\n\nSet **SESSION_SECRET** in `.env`.');

    expect(html).toContain('<h2');
    expect(html).toContain('Setup</h2>');
    expect(html).toContain('<strong');
    expect(html).toContain('SESSION_SECRET</strong>');
    expect(html).toContain('<code');
    expect(html).toContain('.env</code>');
  });

  it('joins soft-wrapped lines into one paragraph', () => {
    const html = renderMarkdown('The quick brown\nfox jumps over\nthe lazy dog.');

    expect((html.match(/<p /g) ?? []).length).toBe(1);
    expect(html.replace(/<[^>]+>/g, '')).toBe('The quick brown fox jumps over the lazy dog.');
  });

  it('escapes HTML rather than emitting it', () => {
    const html = renderMarkdown('A <script>alert(1)</script> tag and an & ampersand.');

    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&amp;');
  });

  it('leaves markdown inside a code fence alone', () => {
    const html = renderMarkdown('```bash\n# **not bold** and `not code`\ncurl -X POST\n```');

    expect(html).toContain('<pre');
    expect(html).toContain('# **not bold** and `not code`');
    expect(html).not.toContain('<strong');
  });

  it('renders bullet lists and folds wrapped continuation lines into the item', () => {
    const html = renderMarkdown('- first item that\n  wraps onto a second line\n- second item');

    expect(html).toContain('<ul');
    expect((html.match(/<li>/g) ?? []).length).toBe(2);
    expect(html).toContain('first item that wraps onto a second line');
  });

  it('renders numbered lists', () => {
    const html = renderMarkdown('1. sign in\n2. create a project\n3. report an event');

    expect(html).toContain('<ol');
    expect((html.match(/<li>/g) ?? []).length).toBe(3);
  });

  it('renders blockquotes and rules', () => {
    const html = renderMarkdown('> ask a question\n\n---\n\nafter');

    expect(html).toContain('<blockquote');
    expect(html).toContain('ask a question');
    expect(html).toContain('<hr');
  });

  it('rewrites relative doc links and opens external ones in a new tab', () => {
    const html = renderMarkdown(
      'See [the MCP guide](./CONNECTING-MCP.md) and [the site](https://example.com).',
      (href) => (href.startsWith('./') ? `https://repo/docs/${href.slice(2)}` : href)
    );

    expect(html).toContain('href="https://repo/docs/CONNECTING-MCP.md"');
    expect(html).toContain('href="https://example.com"');
    expect((html.match(/target="_blank"/g) ?? []).length).toBe(2);
  });

  it('does not treat a bare hash inside prose as a heading', () => {
    const html = renderMarkdown('Issue #14 is fixed.');

    expect(html).toContain('<p ');
    expect(html).not.toContain('<h1');
  });
});
