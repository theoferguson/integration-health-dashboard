import { useState, useCallback, useEffect } from 'react';
import { fetchAuthState, logout as logoutRequest, type AuthState } from '../api/client';

export function useAuth() {
  const [auth, setAuth] = useState<AuthState | null>(null);

  const load = useCallback(async () => {
    try {
      setAuth(await fetchAuthState());
    } catch {
      setAuth({ loggedIn: false, login: null });
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const signOut = useCallback(async () => {
    await logoutRequest();
    await load();
  }, [load]);

  return { auth, isLoading: auth === null, signOut, refresh: load };
}
