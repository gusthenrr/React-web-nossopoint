// Login.tsx
import React, { useState, useEffect, useContext, useRef } from 'react';
import { UserContext } from '../UserContext';
 // opcional: se não usar, remova esta linha


const TTL_HOURS = 14;
const FETCH_TIMEOUT_MS = 12000;

type TokenCtx = { expoPushToken?: string; webPushToken?: string };

function withTimeout<T>(
  ms: number,
  fn: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), ms);
  return fn(controller.signal)
    .finally(() => window.clearTimeout(timer))
    .catch((e) => {
      if (controller.signal.aborted) throw new Error('timeout');
      throw e;
    });
}

const styles: Record<string, React.CSSProperties> = {
  center: { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  container: {
    width: '100%',
    maxWidth: 420,
    margin: '0 auto',
    background: '#fff',
    border: '1px solid #E2E8F0',
    borderRadius: 12,
    padding: 20,
    boxShadow: '0 12px 24px rgba(2,6,23,0.08)',
    textAlign: 'center',
  },
  title: { fontSize: 24, marginBottom: 16, fontWeight: 800, color: '#111827' },
  input: {
    height: 44,
    width: '100%',
    border: '1px solid #cbd5e1',
    padding: '0 14px',
    borderRadius: 8,
    marginBottom: 12,
    background: '#fff',
    outline: 'none',
    boxSizing: 'border-box',
  },
  button: {
    height: 44,
    width: '100%',
    borderRadius: 10,
    border: '1px solid #17315c',
    background: '#17315c',
    color: '#fff',
    fontWeight: 800,
    cursor: 'pointer',
  },
  buttonDisabled: { opacity: 0.7, cursor: 'not-allowed' },
  hint: { marginTop: 10, color: '#64748B', fontSize: 13 },
  spinnerWrap: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 },
  spinner: {
    width: 24,
    height: 24,
    borderRadius: '50%',
    border: '3px solid #e5e7eb',
    borderTopColor: '#17315c',
    animation: 'spin 0.9s linear infinite',
  },
};

// pequena keyframes inline (opcional): adicione no seu CSS global:
// @keyframes spin { to { transform: rotate(360deg); } }

const STORAGE = {
  USERNAME: 'username',
  SENHA: 'usersenha',
  SENHA_EXP: 'senhaExpiration',
};

export default function Login(): JSX.Element | null {
  const { setUser, isLoggedIn, setIsLoggedIn, loading, setLoading } = useContext(UserContext)!;

  // opcional: substitua por seu contexto de push web (ou remova)

  const [username, setUsername] = useState('');
  const [senha, setSenha] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const safeSetLoading = (v: boolean) => mountedRef.current && setLoading?.(v);
  const safeSetSubmitting = (v: boolean) => mountedRef.current && setSubmitting(v);

  const generateToken = () => Math.random().toString(36).substring(2, 7).toUpperCase();

  // --------- Auto login (se houver credenciais válidas) ---------
  useEffect(() => {
    (async () => {
      safeSetLoading(true);
      try {
        const savedUsername = localStorage.getItem(STORAGE.USERNAME) || '';
        const savedSenha = localStorage.getItem(STORAGE.SENHA) || '';
        const expRaw = localStorage.getItem(STORAGE.SENHA_EXP);
        const exp = Number(expRaw || 0);
        const notExpired = Number.isFinite(exp) && Date.now() < exp;

        if (savedUsername && savedSenha && notExpired) {
          setUsername(savedUsername);
          setSenha(savedSenha);
          await attemptLogin(savedUsername, savedSenha, { silent: true });
        } else {
          // limpa restos vencidos
          localStorage.removeItem(STORAGE.SENHA);
          localStorage.removeItem(STORAGE.SENHA_EXP);
          setIsLoggedIn(false);
        }
      } catch {
        setIsLoggedIn(false);
      } finally {
        safeSetLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --------- Fluxo principal ---------
  async function attemptLogin(userRaw: string, passRaw: string, opts: { silent?: boolean } = {}) {
    const { silent = false } = opts;
    const user = String(userRaw || '').trim();
    const pass = String(passRaw || '').trim();

    if (!user || !pass) {
      if (!silent) window.alert('Informe usuário e senha.');
      return false;
    }

    if (submitting) return false;

    if (!navigator.onLine) {
      if (!silent) window.alert('Sem internet. Verifique sua conexão.');
      return false;
    }

    safeSetSubmitting(true);
    safeSetLoading(true);

    try {
      const res = await withTimeout(FETCH_TIMEOUT_MS, (signal) =>
        fetch(`${API_URL}/verificar_username`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal,
          body: JSON.stringify({ username: user, senha: pass }),
        })
      );

      if (!res || !res.ok) {
        if (!silent) window.alert('Falha ao conectar ao servidor.');
        return false;
      }

      let data: any;
      try {
        data = await (res as Response).json();
      } catch {
        if (!silent) window.alert('Resposta inválida do servidor.');
        return false;
      }

      // backend esperado: { data: true/false, cargo: '...', carrinho: '...' }
      if (data?.data) {
        await persistSession(user, pass, data?.cargo, data?.carrinho);
        setUser?.({
          username: user,
          cargo: data?.cargo,
          carrinho: data?.carrinho || '',
          token: pushToken, // mantém compat com seu app
        });
        setIsLoggedIn?.(true);
        return true;
      }

      if (!silent) window.alert('Usuário ou senha inválidos.');
      return false;
    } catch (err: any) {
      if (!silent) {
        const msg =
          err?.message === 'timeout'
            ? 'Tempo de resposta excedido. Tente novamente.'
            : 'Erro de conexão com o servidor.';
        window.alert(msg);
      }
      return false;
    } finally {
      safeSetSubmitting(false);
      safeSetLoading(false);
    }
  }

  // salva sessão e envia token/cargo (best-effort)
  async function persistSession(user: string, pass: string, cargo?: string, carrinho?: string) {
    const expirationTime = Date.now() + TTL_HOURS * 60 * 60 * 1000;
    const guardar_token = generateToken();

    try {
      localStorage.setItem(STORAGE.TOKEN, guardar_token);
      localStorage.setItem(STORAGE.USERNAME, user);
      localStorage.setItem(STORAGE.SENHA, pass);
      localStorage.setItem(STORAGE.SENHA_EXP, String(expirationTime));
    } catch {
      // não bloqueia o fluxo
    }

    try {
      await withTimeout(FETCH_TIMEOUT_MS, (signal) =>
        fetch(`${API_URL}/salvarTokenCargo`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal,
          body: JSON.stringify({
            username: user,
            cargo,
            carrinho,
            token: pushToken,
          }),
        })
      );
    } catch {
      // best-effort: ignora erro
    }
  }

  // --------- Render ---------
  if (loading) {
    return (
      <div style={styles.center}>
        <div style={styles.container}>
          <div style={styles.spinnerWrap}>
            <div style={styles.spinner} />
            <div>Carregando...</div>
          </div>
        </div>
      </div>
    );
  }

  if (!isLoggedIn) {
    return (
      <div style={styles.center}>
        <div style={styles.container}>
          <div style={styles.title}>Login</div>

          <input
            style={styles.input}
            placeholder="Usuário"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
          />

          <input
            style={styles.input}
            placeholder="Senha"
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            autoComplete="current-password"
            type="password"
            onKeyDown={(e) => {
              if (e.key === 'Enter') attemptLogin(username, senha);
            }}
          />

          <button
            style={{ ...styles.button, ...(submitting ? styles.buttonDisabled : {}) }}
            onClick={() => attemptLogin(username, senha)}
            disabled={submitting}
          >
            {submitting ? 'Entrando...' : 'Entrar'}
          </button>

          {submitting && <div style={styles.hint}>Verificando credenciais…</div>}
        </div>
      </div>
    );
  }

  // Quando logado, esta tela não precisa renderizar nada (sua navegação cuida do fluxo)
  return null;
}
