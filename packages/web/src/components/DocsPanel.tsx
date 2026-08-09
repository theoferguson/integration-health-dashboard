/**
 * The Docs tab.
 *
 * Content comes from docs/GETTING-STARTED.md verbatim - the file stays the
 * single source of truth, readable on GitHub and reviewable in a diff, and the
 * app renders the same bytes. Imported at build time, so there's no fetch, no
 * loading state, and no way for the tab to disagree with the repo.
 */

import { useMemo } from 'react';
import gettingStarted from '../../../../docs/GETTING-STARTED.md?raw';
import { renderMarkdown } from './markdown';

const REPO_BLOB = 'https://github.com/theoferguson/integration-health-dashboard/blob/main';

/**
 * The doc's links are relative paths that resolve on GitHub; in the app they
 * would 404. Point them at the repo instead, so the same markdown works in both
 * places without a second copy.
 */
function resolveLink(href: string): string {
  if (href.startsWith('./')) return `${REPO_BLOB}/docs/${href.slice(2)}`;
  if (href.startsWith('../')) return `${REPO_BLOB}/${href.slice(3)}`;
  return href;
}

export function DocsPanel() {
  const html = useMemo(() => renderMarkdown(gettingStarted, resolveLink), []);

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-5 sm:p-8 max-w-3xl">
      <div dangerouslySetInnerHTML={{ __html: html }} />
      <p className="mt-8 pt-4 border-t border-gray-200 text-xs text-gray-400">
        Source:{' '}
        <a
          href={`${REPO_BLOB}/docs/GETTING-STARTED.md`}
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-gray-600"
        >
          docs/GETTING-STARTED.md
        </a>
      </p>
    </div>
  );
}
