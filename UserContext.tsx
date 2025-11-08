// UserContext.tsx
import React, {
  createContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
  useContext,
  PropsWithChildren,
} from 'react';
// ❯❯❯ Integração opcional com socket (ajuste o caminho):
// import { setSocketAuth } from './socket';

/* ==============================
   Tipos
   ============================== */
export interface AppUser {
  username?: string;
  cargo?: string;
  carrinho?: string;
  token?: string;        // padrão
  token_user?: string;   // compatibilidade
  expiresAt?: number | null; // timestamp em ms
  roles?: string[];
  meta?: Record<string, unknown>;
}

export interface UserContextValue {
  user: AppUser;
  setUser: React.Dispatch<React.SetStateAction<AppUser>>;
  isLoggedIn: boolean;
  setIsLoggedIn: React.Dispatch<React.SetStateAction<boolean>>;
  loading: boolean;
  setLoading: React.Dispatch<React.SetStateAction<boolean>>;
  isOnline: boolean;
  signIn: (args: {
    username: string;
    token?: string;
    token_user?: string;
    cargo?: string;
    carrinho?: string;
    expiresAt?: number | null;
    roles?: string[];
    meta?: Record<string, unknown>;
  }) => Promise<void>;
  signOut: () => Promise<void>;
  updateUser: (patch: Partial<AppUser>) => Promise<void>;
  guardClick: (key: string, fn: () => void | Promise<void>, cooldownMs?: number) => void;
  getCarrinho: () => string;
}

/* ==============================
   Constantes de storage
   ============================== */
const STORAGE = {
  USER: '@app/user',                // JSON { username, cargo, carrinho, token, token_user, expiresAt }
  LEGACY_USERNAME: 'username',      // legado
  LEGACY_TOKEN: 'userToken',        // legado
  LEGACY_SENHA_EXP: 'senhaExpiration', // legado (ms)
};

/* ==============================
   Helpers de localStorage (seguros)
   ============================== */
const hasWindow = typeof window !== 'undefined';

const safeLocalStorage = {
  getItem(key: string): string | null {
    try {
      if (!hasWindow) return null;
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem(key: string, val: string) {
    try {
      if (!hasWindow) return;
      window.localStorage.setItem(key, val);
    } catch {
      // noop
    }
  },
  removeItem(key: string) {
    try {
      if (!hasWindow) return;
      window.localStorage.removeItem(key);
    } catch {
      // noop
    }
  },
};

async function getJSON<T>(key: string, fallback: T): Promise<T> {
  const raw = safeLocalStorage.getItem(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function setJSON<T>(key: string, value: T): Promise<void> {
  safeLocalStorage.setItem(key, JSON.stringify(value));
}

async function removeKey(key: string): Promise<void> {
  safeLocalStorage.removeItem(key);
}

/* ==============================
   Anti “double click” global
   ============================== */
function useClickGuards() {
  const guardsRef = useRef<Record<string, boolean>>({});
  const guard = useCallback(
    (key: string, fn: () => void | Promise<void>, cooldownMs = 300) => {
      if (guardsRef.current[key]) return;
      guardsRef.current[key] = true;
      Promise.resolve()
        .then(() => fn && fn())
        .finally(() => {
          window.setTimeout(() => {
            guardsRef.current[key] = false;
          }, cooldownMs);
        });
    },
    []
  );
  return guard;
}

/* ==============================
   Defaults
   ============================== */
const defaultUser: AppUser = {
  username: '',
  cargo: '',
  carrinho: '',
  token: '',
  token_user: undefined,
  expiresAt: null,
};

export const UserContext = createContext<UserContextValue | undefined>(undefined);

/* ==============================
   Provider
   ============================== */
export const UserProvider: React.FC<PropsWithChildren> = ({ children }) => {
  const [user, setUser] = useState<AppUser>(defaultUser);
  const [isLoggedIn, setIsLoggedIn] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [isOnline, setIsOnline] = useState<boolean>(hasWindow ? navigator.onLine : true);

  const guardClick = useClickGuards();
  const isMountedRef = useRef<boolean>(false);
  const logoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ===== Token efetivo (token || token_user)
  const authToken = useMemo(
    () => user.token ?? user.token_user ?? '',
    [user.token, user.token_user]
  );

  // ===== Auto-logout
  const clearLogoutTimer = useCallback(() => {
    if (logoutTimerRef.current) {
      clearTimeout(logoutTimerRef.current);
      logoutTimerRef.current = null;
    }
  }, []);

  const scheduleAutoLogout = useCallback((expiresAtMs?: number | null) => {
    clearLogoutTimer();
    if (!expiresAtMs || Number.isNaN(Number(expiresAtMs))) return;
    const delta = Number(expiresAtMs) - Date.now();
    if (delta <= 0) return;
    logoutTimerRef.current = setTimeout(() => {
      void signOut();
    }, delta);
  }, [clearLogoutTimer]);

  const effectiveIsLoggedIn = useMemo(() => {
    const hasToken = !!authToken;
    const notExpired = !user?.expiresAt || Number(user.expiresAt) > Date.now();
    return hasToken && notExpired;
  }, [authToken, user?.expiresAt]);

  // ===== Online/offline (browser)
  useEffect(() => {
    if (!hasWindow) return;
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    setIsOnline(navigator.onLine);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  // ===== Restaurar sessão (com migração legado)
  useEffect(() => {
    isMountedRef.current = true;

    (async () => {
      try {
        setLoading(true);

        // 1) novo formato
        const savedUser = await getJSON<AppUser | null>(STORAGE.USER, null);
        if (savedUser && (savedUser.token || savedUser.token_user)) {
          if (!isMountedRef.current) return;
          setUser({
            username: savedUser.username ?? '',
            cargo: savedUser.cargo ?? '',
            carrinho: savedUser.carrinho ?? '',
            token: savedUser.token ?? undefined,
            token_user: savedUser.token_user ?? undefined,
            expiresAt: savedUser.expiresAt ?? null,
            roles: savedUser.roles,
            meta: savedUser.meta,
          });
          setIsLoggedIn(true);
          scheduleAutoLogout(savedUser.expiresAt ?? null);
          // ❯❯❯ Integração socket (opcional):
          // try { setSocketAuth?.({ username: savedUser.username, carrinho: savedUser.carrinho }); } catch {}
          return;
        }

        // 2) legado
        const legacyUsername = safeLocalStorage.getItem(STORAGE.LEGACY_USERNAME) ?? '';
        const legacyToken = safeLocalStorage.getItem(STORAGE.LEGACY_TOKEN) ?? '';
        const legacyExpRaw = safeLocalStorage.getItem(STORAGE.LEGACY_SENHA_EXP);

        const expMs = legacyExpRaw ? parseInt(legacyExpRaw, 10) : null;
        const notExpired = expMs ? expMs > Date.now() : true;

        if (legacyUsername && legacyToken && notExpired) {
          const legacy: AppUser = {
            username: legacyUsername,
            token: legacyToken,
            expiresAt: expMs ?? null,
          };
          if (!isMountedRef.current) return;
          setUser((prev) => ({ ...prev, ...legacy }));
          setIsLoggedIn(true);
          scheduleAutoLogout(legacy.expiresAt ?? null);
          await setJSON(STORAGE.USER, { ...defaultUser, ...legacy });
          // try { setSocketAuth?.({ username: legacy.username, carrinho: legacy.carrinho }); } catch {}
        } else {
          if (!isMountedRef.current) return;
          setUser(defaultUser);
          setIsLoggedIn(false);
        }
      } finally {
        if (!isMountedRef.current) return;
        setLoading(false);
      }
    })();

    return () => {
      isMountedRef.current = false;
      clearLogoutTimer();
    };
  }, [scheduleAutoLogout, clearLogoutTimer]);

  // ===== Persistência e coerência
  useEffect(() => {
    if (isLoggedIn !== effectiveIsLoggedIn) setIsLoggedIn(effectiveIsLoggedIn);
    scheduleAutoLogout(user?.expiresAt ?? null);
    void setJSON(STORAGE.USER, user);
    // ❯❯❯ Integração socket (opcional):
    // try { setSocketAuth?.({ username: user?.username, carrinho: user?.carrinho }); } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // ===== APIs públicas
  const signIn: UserContextValue['signIn'] = useCallback(
    async ({ username, token, token_user, cargo = '', carrinho = '', expiresAt = null, roles, meta }) => {
      const finalToken = token ?? token_user;
      if (!username || !finalToken) {
        throw new Error('Credenciais inválidas para signIn.');
      }
      const next: AppUser = {
        username,
        cargo,
        carrinho,
        token: token,                // mantém ambos se vierem
        token_user: token_user,
        expiresAt: expiresAt ? Number(expiresAt) : null,
        roles,
        meta,
      };
      setUser(next);
      setIsLoggedIn(true);
      scheduleAutoLogout(next.expiresAt ?? null);
      await setJSON(STORAGE.USER, next);
      // try { setSocketAuth?.({ username: next.username, carrinho: next.carrinho }); } catch {}
    },
    [scheduleAutoLogout]
  );

  const signOut: UserContextValue['signOut'] = useCallback(async () => {
    clearLogoutTimer();
    setUser(defaultUser);
    setIsLoggedIn(false);
    await removeKey(STORAGE.USER);
  }, [clearLogoutTimer]);

  const updateUser: UserContextValue['updateUser'] = useCallback(async (patch) => {
    setUser((prev) => ({ ...prev, ...(patch || {}) }));
  }, []);

  const getCarrinho = useCallback(() => String(user?.carrinho || ''), [user?.carrinho]);

  const value = useMemo<UserContextValue>(
    () => ({
      user,
      setUser,          // compat
      isLoggedIn,
      setIsLoggedIn,    // compat
      loading,
      setLoading,       // compat
      isOnline,
      signIn,
      signOut,
      updateUser,
      guardClick,
      getCarrinho,
    }),
    [user, isLoggedIn, loading, isOnline, signIn, signOut, updateUser, guardClick, getCarrinho]
  );

  return <UserContext.Provider value={value}>{children}</UserContext.Provider>;
};

/* ==============================
   Hook de conveniência
   ============================== */
export function useUser(): UserContextValue {
  const ctx = useContext(UserContext);
  if (!ctx) throw new Error('useUser deve ser usado dentro de <UserProvider>.');
  return ctx;
}
