import { useState, useCallback, useEffect } from 'react';
import {
  fetchAuthState,
  fetchOrg,
  logout as logoutRequest,
  type AuthState,
  type OrgState,
} from '../api/client';

const NO_ORG: OrgState = { org: null };

export function useAuth() {
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [org, setOrg] = useState<OrgState>(NO_ORG);

  const load = useCallback(async () => {
    try {
      const authState = await fetchAuthState();
      setAuth(authState);
      // Org details only exist for a signed-in user.
      setOrg(authState.loggedIn ? await fetchOrg() : NO_ORG);
    } catch {
      setAuth({ loggedIn: false, login: null });
      setOrg(NO_ORG);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const signOut = useCallback(async () => {
    await logoutRequest();
    await load();
  }, [load]);

  return {
    auth,
    org: org.org,
    role: org.role,
    isLoading: auth === null,
    signOut,
    refresh: load,
  };
}
