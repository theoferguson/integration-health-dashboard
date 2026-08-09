import { useState, useEffect, useCallback } from 'react';
import {
  fetchProjects,
  createProjectRequest,
  deleteProjectRequest,
  regenerateInvite,
  joinOrgRequest,
  type ProjectSummary,
  type CreatedProject,
  type OrgRole,
} from '../api/client';
import { SignInButton } from './SignInModal';

interface ProjectsPanelProps {
  loggedIn: boolean;
  role?: OrgRole;
  org: { id: string; name: string; inviteCode?: string } | null;
  /** Called after the user joins a different org, so the parent can reload auth/org state. */
  onOrgChange: () => void;
}

export function ProjectsPanel({ loggedIn, role, org, onOrgChange }: ProjectsPanelProps) {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [justCreated, setJustCreated] = useState<CreatedProject | null>(null);
  const [inviteCode, setInviteCode] = useState<string | undefined>(org?.inviteCode);
  const [joinCode, setJoinCode] = useState('');
  const [joinError, setJoinError] = useState<string | null>(null);

  const isAdmin = role === 'admin';

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      setProjects(await fetchProjects());
      setError(null);
    } catch {
      setError('Failed to load projects');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (loggedIn) load();
  }, [loggedIn, load]);

  // Keep the shown invite code in sync when the active org changes.
  useEffect(() => {
    setInviteCode(org?.inviteCode);
  }, [org?.inviteCode]);

  if (!loggedIn) {
    return (
      <div className="text-center py-12 bg-white rounded-lg border border-gray-200">
        <p className="text-gray-600 mb-4">Sign in to create and manage projects.</p>
        <SignInButton className="inline-block px-4 py-2 text-sm font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-800" />
      </div>
    );
  }

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setIsCreating(true);
    setError(null);
    try {
      const project = await createProjectRequest(name.trim());
      setJustCreated(project);
      setName('');
      await load();
    } catch {
      setError('Failed to create project');
    } finally {
      setIsCreating(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteProjectRequest(id);
      await load();
    } catch {
      setError('Failed to delete project');
    }
  };

  const handleRegenerate = async () => {
    try {
      setInviteCode(await regenerateInvite());
    } catch {
      setError('Failed to regenerate invite code');
    }
  };

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!joinCode.trim()) return;
    setJoinError(null);
    try {
      await joinOrgRequest(joinCode.trim());
      setJoinCode('');
      onOrgChange();
      await load();
    } catch {
      setJoinError('Invalid invite code');
    }
  };

  return (
    <div className="space-y-6">
      {/* Org header */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <div className="text-xs text-gray-400 uppercase tracking-wide">Organization</div>
            <div className="text-base font-semibold text-gray-900">{org?.name ?? '—'}</div>
          </div>
          <span
            className={`px-2.5 py-1 text-xs font-medium rounded-full ${
              isAdmin ? 'bg-blue-50 text-blue-700' : 'bg-gray-100 text-gray-600'
            }`}
          >
            {role ?? 'member'}
          </span>
        </div>

        {isAdmin && (
          <div className="mt-4 pt-4 border-t border-gray-100">
            <div className="text-sm font-medium text-gray-900 mb-1">Invite code</div>
            <p className="text-xs text-gray-500 mb-2">
              Share this with teammates. They sign in, then paste it below to join your
              org as a viewer.
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs bg-gray-50 border border-gray-200 rounded px-2 py-1.5 overflow-x-auto">
                {inviteCode ?? '—'}
              </code>
              <button
                onClick={() => inviteCode && navigator.clipboard.writeText(inviteCode)}
                className="px-3 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Copy
              </button>
              <button
                onClick={handleRegenerate}
                className="px-3 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Regenerate
              </button>
            </div>
          </div>
        )}

        {/* Join a different org (available to everyone) */}
        <form onSubmit={handleJoin} className="mt-4 pt-4 border-t border-gray-100">
          <div className="text-sm font-medium text-gray-900 mb-2">Join another org</div>
          <div className="flex gap-2">
            <input
              type="text"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value)}
              placeholder="Paste an invite code"
              className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              type="submit"
              disabled={!joinCode.trim()}
              className="px-4 py-2 text-sm font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-800 disabled:opacity-50"
            >
              Join
            </button>
          </div>
          {joinError && <p className="mt-2 text-xs text-red-600">{joinError}</p>}
        </form>
      </div>

      {/* Create a project (admin only) */}
      {isAdmin ? (
        <form onSubmit={handleCreate} className="bg-white rounded-lg border border-gray-200 p-4">
          <h2 className="text-base font-semibold text-gray-900 mb-3">Create a project</h2>
          <div className="flex gap-2">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. integrations-host-app"
              className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              type="submit"
              disabled={isCreating || !name.trim()}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {isCreating ? 'Creating…' : 'Create'}
            </button>
          </div>
        </form>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 p-4 text-sm text-gray-500">
          You have viewer access to this org. Only admins can create or delete projects.
        </div>
      )}

      {justCreated && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
          <p className="text-sm font-medium text-amber-900 mb-1">
            "{justCreated.name}" created - save this API key now
          </p>
          <p className="text-xs text-amber-700 mb-2">
            It's shown once and can't be retrieved again. Use it as the Bearer token for POST /api/ingest.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-xs bg-white border border-amber-200 rounded px-2 py-1.5 overflow-x-auto">
              {justCreated.apiKey}
            </code>
            <button
              onClick={() => navigator.clipboard.writeText(justCreated.apiKey)}
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

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 text-sm">{error}</div>
      )}

      <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-200">
        {isLoading ? (
          <div className="p-8 text-center text-gray-400 text-sm">Loading…</div>
        ) : projects.length === 0 ? (
          <div className="p-8 text-center text-gray-500 text-sm">No projects yet.</div>
        ) : (
          projects.map((project) => (
            <div key={project.id} className="flex items-center justify-between p-3 sm:p-4">
              <div>
                <div className="text-sm font-medium text-gray-900">{project.name}</div>
                <div className="text-xs text-gray-400">
                  Created {new Date(project.createdAt).toLocaleDateString()}
                </div>
              </div>
              {isAdmin && (
                <button
                  onClick={() => handleDelete(project.id)}
                  className="px-3 py-1 text-xs text-red-600 hover:text-red-700 border border-red-200 rounded-lg hover:bg-red-50"
                >
                  Delete
                </button>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
