import { useState, useEffect, useCallback } from 'react';
import {
  fetchReadTokens,
  createReadTokenRequest,
  revokeReadTokenRequest,
  type ReadTokenSummary,
  type OrgRole,
} from '../api/client';

interface ReadTokensPanelProps {
  loggedIn: boolean;
  role?: OrgRole;
}

/** "3 days ago" / "never" for the last-used column. */
function relativeTime(iso: string | null): string {
  if (!iso) return 'never used';
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/**
 * Manage the org's read tokens - the credential for /api/v1 and the MCP server.
 * Before this, minting one meant SSH-ing into the machine or calling the admin
 * API by hand (ROADMAP #11).
 *
 * Member read / admin write, matching the server's own split in
 * routes/readTokens.ts. The secret is shown exactly once, at creation.
 */
export function ReadTokensPanel({ loggedIn, role }: ReadTokensPanelProps) {
  const [tokens, setTokens] = useState<ReadTokenSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [justCreated, setJustCreated] = useState<{ name: string; secret: string } | null>(null);

  const isAdmin = role === 'admin';

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      setTokens(await fetchReadTokens());
      setError(null);
    } catch {
      setError('Failed to load read tokens');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (loggedIn) load();
  }, [loggedIn, load]);

  if (!loggedIn) return null;

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setIsCreating(true);
    setError(null);
    try {
      const { token, secret } = await createReadTokenRequest(name.trim());
      setJustCreated({ name: token.name, secret });
      setName('');
      await load();
    } catch {
      setError('Failed to create read token');
    } finally {
      setIsCreating(false);
    }
  };

  const handleRevoke = async (token: ReadTokenSummary) => {
    // Revoking breaks every agent using this token, and it can't be undone -
    // the secret is unrecoverable, so a replacement is a brand-new token.
    if (!confirm(`Revoke "${token.name}"? Anything using it will stop working immediately.`)) {
      return;
    }
    try {
      await revokeReadTokenRequest(token.id);
      await load();
    } catch {
      setError('Failed to revoke read token');
    }
  };

  const active = tokens.filter((t) => !t.revokedAt);

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <h2 className="text-base font-semibold text-gray-900">Read tokens</h2>
      <p className="text-xs text-gray-500 mt-1 mb-3">
        Org-scoped, read-only credentials for the <code>/api/v1</code> API and the MCP server.
        Separate from a project's ingest key — leaking one doesn't grant the other.
      </p>

      {isAdmin ? (
        <form onSubmit={handleCreate} className="flex gap-2">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. claude-desktop"
            className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            type="submit"
            disabled={isCreating || !name.trim()}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {isCreating ? 'Creating…' : 'Create token'}
          </button>
        </form>
      ) : (
        <p className="text-sm text-gray-500">Only admins can create or revoke read tokens.</p>
      )}

      {justCreated && (
        <div className="mt-3 bg-amber-50 border border-amber-200 rounded-lg p-4">
          <p className="text-sm font-medium text-amber-900 mb-1">
            "{justCreated.name}" created — save this token now
          </p>
          <p className="text-xs text-amber-700 mb-2">
            It's shown once and can't be retrieved again. Use it as the Bearer token for{' '}
            <code>/api/v1</code> and <code>/mcp</code>.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-xs bg-white border border-amber-200 rounded px-2 py-1.5 overflow-x-auto">
              {justCreated.secret}
            </code>
            <button
              onClick={() => navigator.clipboard.writeText(justCreated.secret)}
              className="px-3 py-1.5 text-xs font-medium text-amber-900 bg-white border border-amber-300 rounded-lg hover:bg-amber-100"
            >
              Copy
            </button>
            <button
              onClick={() => setJustCreated(null)}
              className="px-3 py-1.5 text-xs text-amber-700 hover:text-amber-900"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      <div className="mt-4 border-t border-gray-100 divide-y divide-gray-100">
        {isLoading ? (
          <div className="py-6 text-center text-gray-400 text-sm">Loading…</div>
        ) : active.length === 0 ? (
          <div className="py-6 text-center text-gray-500 text-sm">
            No read tokens yet.{isAdmin && ' Create one to connect an agent or MCP client.'}
          </div>
        ) : (
          active.map((token) => (
            <div key={token.id} className="flex items-center justify-between py-3 gap-3">
              <div className="min-w-0">
                <div className="text-sm font-medium text-gray-900 truncate">{token.name}</div>
                <div className="text-xs text-gray-400">
                  <code>{token.prefix}…</code> · {relativeTime(token.lastUsedAt)}
                </div>
              </div>
              {isAdmin && (
                <button
                  onClick={() => handleRevoke(token)}
                  className="shrink-0 px-3 py-1 text-xs text-red-600 hover:text-red-700 border border-red-200 rounded-lg hover:bg-red-50"
                >
                  Revoke
                </button>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
