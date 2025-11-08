import React, { useEffect, useMemo, useRef, useState, useCallback, Suspense } from "react";
import { getSocket, setSocketAuth } from "../socket.ts"; // ajuste o caminho

import type { ComandaInitialParams } from "./ComandaScreen.tsx";
const ComandaWebLazy = React.lazy(() => import("./ComandaScreen.tsx"));


type ComandaRow = { comanda: string; ordem?: number };
type RespostaComandasPayload = {
  dados_comandaAberta?: ComandaRow[];
  dados_comandaFechada?: ComandaRow[];
};

type ToastVariant = "success" | "warning" | "error" | "info";

interface ComandasProps {
  username?: string;
  tokenUser?: string;
  carrinho?: string;
  /** Se o pai quiser interceptar a abertura */
  onOpenComanda?: (data: {
    fcomanda: string;
    ordem?: number;
    payloadPreco?: {
      dados?: any;
      preco_a_pagar?: number;
      preco_total?: number;
      preco_pago?: number;
      desconto?: number;
      nomes?: string[];
    };
  }) => void;
}

const normalize = (s: unknown) =>
  String(s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

const Comandas: React.FC<ComandasProps> = ({
  username = "pc",
  tokenUser = "seutoken",
  carrinho = "SlicePizza",
  onOpenComanda,
}) => {
  // ---------------- estado ----------------
  const [search, setSearch] = useState("");
  const [isConnected, setIsConnected] = useState<boolean>(
    typeof navigator !== "undefined" ? navigator.onLine : true
  );

  const [openAll, setOpenAll] = useState<ComandaRow[]>([]);
  const [closedAll, setClosedAll] = useState<ComandaRow[]>([]);
  const [openFiltered, setOpenFiltered] = useState<ComandaRow[]>([]);
  const [closedFiltered, setClosedFiltered] = useState<ComandaRow[]>([]);

  const [refreshing, setRefreshing] = useState(false);
  const [submitMsg, setSubmitMsg] = useState("");
  const [openingKey, setOpeningKey] = useState<string | null>(null);
  const [rowBusy, setRowBusy] = useState<Set<string>>(new Set());

  // toast
  const [toastOpen, setToastOpen] = useState(false);
  const [toastMsg, setToastMsg] = useState("Tudo certo!");
  const [toastVariant, setToastVariant] = useState<ToastVariant>("success");
  const hideToastTimer = useRef<number | null>(null);

  // socket
  const socketRef = useRef<ReturnType<typeof getSocket> | null>(null);
  const pendingPrecoHandlerRef = useRef<((data: any) => void) | null>(null);
  const precoTimeoutRef = useRef<number | null>(null);

  // mounted
  const mountedRef = useRef(false);

  // === NOVO: estado para abrir a tela ComandaWeb ===
  const [openedInitial, setOpenedInitial] = useState<ComandaInitialParams | null>(null);
  const closeComandaWeb = () => setOpenedInitial(null);

  // ---------------- toast helpers ----------------
  const showToast = useCallback((msg: string, variant: ToastVariant = "success") => {
    setToastMsg(msg);
    setToastVariant(variant);
    setToastOpen(true);
    if (hideToastTimer.current) window.clearTimeout(hideToastTimer.current);
    hideToastTimer.current = window.setTimeout(() => setToastOpen(false), 2200);
  }, []);

  useEffect(() => {
    return () => {
      if (hideToastTimer.current) window.clearTimeout(hideToastTimer.current);
    };
  }, []);

  // ---------------- online/offline ----------------
  useEffect(() => {
    const onOnline = () => {
      setIsConnected(true);
      showToast("Internet restaurada.", "success");
    };
    const onOffline = () => {
      setIsConnected(false);
      showToast("Sem internet no dispositivo.", "error");
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    if (!navigator.onLine) showToast("Sem internet no dispositivo.", "warning");
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [showToast]);

  // ---------------- socket: mount / handlers ----------------
  useEffect(() => {
    mountedRef.current = true;
    setSocketAuth({ carrinho, username });
    const socket = getSocket();
    socketRef.current = socket;

    const handleRespostaComandas = (dados: RespostaComandasPayload) => {
      const ab = dados?.dados_comandaAberta ?? [];
      const fe = dados?.dados_comandaFechada ?? [];
      if (!mountedRef.current) return;
      setOpenAll(ab);
      setClosedAll(fe);
      // respeita filtro atual
      setOpenFiltered(applyFilter(ab, search));
      setClosedFiltered(applyFilter(fe, search));
      setRefreshing(false);
      setSubmitMsg("");
    };

    const onConnect = () => showToast("Conectado novamente!", "success");
    const onDisconnect = () => showToast("Sem conexão com o servidor.", "error");
    const onError = (e: any) =>
      showToast(e?.message || String(e) || "Erro do servidor.", "error");
    const onConnectError = (e: any) =>
      showToast(e?.message || String(e) || "Falha ao conectar.", "error");

    socket.on("respostaComandas", handleRespostaComandas);
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("error", onError);
    socket.on("connect_error", onConnectError);

    // primeira carga
    socket.emit("getComandas", { emitir: false, carrinho });

    return () => {
      mountedRef.current = false;
      socket.off("respostaComandas", handleRespostaComandas);
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("error", onError);
      socket.off("connect_error", onConnectError);

      // limpar handler 'preco' se restou
      if (pendingPrecoHandlerRef.current) {
        socket.off("preco", pendingPrecoHandlerRef.current);
        pendingPrecoHandlerRef.current = null;
      }
      if (precoTimeoutRef.current) {
        window.clearTimeout(precoTimeoutRef.current);
        precoTimeoutRef.current = null;
      }
    };
  }, [carrinho, username, showToast]);


  



  const onChangeSearch = (v: string) => {
    setSearch(v);
    
  };

  // ---------------- ações ----------------
  const refreshData = () => {
    if (!isConnected || !socketRef.current?.connected) {
      setSubmitMsg("Sem conexão.");
      setRefreshing(false);
      return;
    }
    setRefreshing(true);
    setSubmitMsg("");
    socketRef.current!.emit("getComandas", { emitir: false, carrinho });
    // fallback pra não travar
    window.setTimeout(() => setRefreshing(false), 8000);
  };

  const markRowBusy = (key: string) => {
    setRowBusy((prev) => {
      const next = new Set(prev);
      next.add(key);
      return next;
    });
    setOpeningKey(key);
  };
  const releaseRowBusy = (key: string) => {
    setRowBusy((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
    setOpeningKey((k) => (k === key ? null : k));
  };

  const openComanda = (item: ComandaRow, ordem?: number) => {
    const key = String(item?.comanda || "").trim();
    if (!key) return;
    if (rowBusy.has(key)) return;

    if (!isConnected || !socketRef.current?.connected) {
      setSubmitMsg("Sem conexão.");
      return;
    }

    const socket = socketRef.current!;
    markRowBusy(key);

    // remove handler pendente (se existir)
    if (pendingPrecoHandlerRef.current) {
      socket.off("preco", pendingPrecoHandlerRef.current);
      pendingPrecoHandlerRef.current = null;
    }

    // handler "once" p/ resposta de preço/dados
    const precoHandler = (data: any) => {
      if (precoTimeoutRef.current) {
        window.clearTimeout(precoTimeoutRef.current);
        precoTimeoutRef.current = null;
      }
      releaseRowBusy(key);

      // Se o pai quiser interceptar
      if (onOpenComanda) {
        try {
          onOpenComanda({
            fcomanda: key,
            ordem,
            payloadPreco: {
              dados: data?.dados,
              preco_a_pagar: data?.preco_a_pagar,
              preco_total: data?.preco_total,
              preco_pago: data?.preco_pago,
              desconto: data?.desconto,
              nomes: data?.nomes,
            },
          });
        } catch {
          // fallback: abrir localmente
          /* continua abaixo convertendo para ComandaWeb */
        }
      }

      // === ABRIR ComandaWeb localmente (conversão de payload) ===
      const initial: ComandaInitialParams = {
        data: Array.isArray(data?.dados) ? data.dados : [],
        fcomanda: key,
        preco: Number(data?.preco_a_pagar || 0),
        preco_total: Number(data?.preco_total || 0),
        preco_pago: Number(data?.preco_pago || 0),
        username,
        nomes: Array.isArray(data?.nomes) ? data.nomes : [],
        ordem: Number.isFinite(ordem as any) ? Number(ordem) : 0,
        desconto: Number(data?.desconto || 0),
      };
      setOpenedInitial(initial);

      if (pendingPrecoHandlerRef.current) {
        socket.off("preco", pendingPrecoHandlerRef.current);
        pendingPrecoHandlerRef.current = null;
      }
    };

    pendingPrecoHandlerRef.current = precoHandler;
    socket.on("preco", precoHandler);

    // timeout de segurança
    precoTimeoutRef.current = window.setTimeout(() => {
      releaseRowBusy(key);
      setSubmitMsg("Sem resposta do servidor.");
      if (pendingPrecoHandlerRef.current) {
        socket.off("preco", pendingPrecoHandlerRef.current);
        pendingPrecoHandlerRef.current = null;
      }
    }, 9000);

    // solicitar dados da comanda
    try {
      socket.emit("get_cardapio", { fcomanda: key, ordem, carrinho, username, token_user: tokenUser });
    } catch {
      releaseRowBusy(key);
      setSubmitMsg("Erro ao solicitar dados da comanda.");
    }
  };

  // ---------------- RENDER: se abrir comanda, troca a tela ----------------
  if (openedInitial) {
    const onEmit = (event: string, payload: any) => {
      const sock = socketRef.current;
      if (!sock) return;
      try {
        sock.emit(event, payload);
      } catch (_) {}
    };

    return (
      <div style={{ position: "relative", minHeight: "100vh" }}>
        {/* Botão Voltar */}
        <button
          onClick={closeComandaWeb}
          style={{
            position: "fixed",
            top: 12,
            left: 12,
            zIndex: 1010,
            height: 40,
            padding: "0 14px",
            borderRadius: 10,
            border: "1px solid #CBD5E1",
            background: "#F8FAFC",
            color: "#0f172a",
            fontWeight: 800,
            cursor: "pointer",
            boxShadow: "0 6px 18px rgba(2,6,23,0.06)",
          }}
          title="Voltar para lista"
        >
          ← Voltar
        </button>

        
        <Suspense fallback={<div style={{padding:16,fontWeight:800}}>Carregando comanda...</div>}>
         <ComandaWebLazy
          initial={openedInitial}
          username={username}
          token={tokenUser}
          carrinho={carrinho}
          onEmit={onEmit}
        />
      </Suspense>
      </div>
    );
  }

  // ---------------- render LISTA ----------------
  return (
    <div style={styles.page}>
      {/* Toast */}
      <div
        style={{
          position: "fixed",
          top: 16,
          right: 16,
          zIndex: 1000,
          transition: "transform 180ms ease, opacity 180ms ease",
          transform: toastOpen ? "translateY(0)" : "translateY(-12px)",
          opacity: toastOpen ? 1 : 0,
          pointerEvents: "none",
        }}
      >
        {toastOpen && (
          <div
            style={{
              backgroundColor:
                toastVariant === "error"
                  ? "#ef4444"
                  : toastVariant === "warning"
                  ? "#f59e0b"
                  : toastVariant === "info"
                  ? "#3b82f6"
                  : "#16a34a",
              color: "#fff",
              padding: "10px 14px",
              borderRadius: 8,
              display: "flex",
              alignItems: "center",
              gap: 8,
              boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
            }}
          >
            <span
              style={{
                width: 12,
                height: 12,
                borderRadius: 6,
                background: "rgba(255,255,255,0.9)",
                display: "inline-block",
              }}
            />
            <strong>{toastMsg}</strong>
          </div>
        )}
      </div>

      <div style={styles.container}>
        {/* Header */}
        <div style={styles.header}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={styles.brand}>Comandas</div>
            <span
              style={{
                fontSize: 12,
                padding: "4px 8px",
                borderRadius: 999,
                background: isConnected ? "#DCFCE7" : "#FEE2E2",
                color: isConnected ? "#166534" : "#991B1B",
                border: `1px solid ${isConnected ? "#86EFAC" : "#FCA5A5"}`,
                fontWeight: 700,
              }}
            >
              {isConnected ? "Online" : "Offline"}
            </span>
          </div>
          <div style={{ fontSize: 12, color: "#64748B" }}>
            {username ? `Usuário: ${username}` : "\u00A0"}
          </div>
        </div>

        {/* Search + ações */}
        <div style={styles.toolbar}>
          <input
            placeholder="Pesquisar comanda..."
            value={search}
            onChange={(e) => onChangeSearch(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            style={styles.input}
          />
          <button onClick={refreshData} style={styles.secondaryBtn}>
            {refreshing ? "Atualizando..." : "Atualizar"}
          </button>
        </div>

        {!!submitMsg && (
          <div style={styles.feedbackWrap}>
            <span style={styles.feedback}>{submitMsg}</span>
          </div>
        )}

        {/* Listas */}
        <div style={styles.section}>
          <div style={styles.sectionTitle}>Comandas Abertas</div>
          {openFiltered.length > 0 ? (
            <div style={styles.list}>
              {openFiltered.map((item, idx) => {
                const key = String(item?.comanda || "");
                const busy = rowBusy.has(key);
                return (
                  <button
                    key={`open-${key}-${idx}`}
                    onClick={() => !busy && openComanda(item, 0)}
                    style={{
                      ...styles.rowBtn,
                      ...(busy ? styles.rowBtnDisabled : {}),
                      background: "#00BFFF",
                      border: "1px solid #0284c7",
                    }}
                    disabled={busy}
                  >
                    <div style={styles.rowBetween}>
                      <span style={styles.rowText}>Comanda: {key}</span>
                      {openingKey === key ? <Spinner /> : null}
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <div style={styles.emptyText}>Nenhuma comanda aberta.</div>
          )}
        </div>

        <div style={styles.section}>
          <div style={styles.sectionTitle}>Comandas Fechadas</div>
          {closedFiltered.length > 0 ? (
            <div style={styles.list}>
              {closedFiltered.map((item, idx) => {
                const key = String(item?.comanda || "");
                const busy = rowBusy.has(key);
                const ordem = item?.ordem ?? 0;
                return (
                  <button
                    key={`closed-${key}-${idx}`}
                    onClick={() => !busy && openComanda(item, ordem)}
                    style={{
                      ...styles.rowBtn,
                      ...(busy ? styles.rowBtnDisabled : {}),
                      background: "#D32F2F",
                      border: "1px solid #b91c1c",
                    }}
                    disabled={busy}
                  >
                    <div style={styles.rowBetween}>
                      <span style={styles.rowText}>Comanda: {key}</span>
                      {openingKey === key ? <Spinner /> : null}
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <div style={styles.emptyText}>Nenhuma comanda fechada.</div>
          )}
        </div>
      </div>
    </div>
  );
};

// ---------- helpers ----------
function applyFilter(base: ComandaRow[], q: string) {
  const t = normalize(q);
  if (!t) return base;
  return base.filter((it) => normalize(it?.comanda).startsWith(t));
}

function Spinner() {
  return (
    <span
      style={{
        width: 16,
        height: 16,
        display: "inline-block",
        borderRadius: "50%",
        border: "2px solid rgba(255,255,255,.6)",
        borderTopColor: "#fff",
        animation: "novai-spin 0.8s linear infinite",
      }}
    />
  );
}

// ---------- estilos ----------
const styles: Record<string, React.CSSProperties> = {
  page: {
    background: "#F1F5F9",
    minHeight: "100vh",
    padding: "32px 24px",
  },
  container: {
    maxWidth: 900,
    margin: "0 auto",
    background: "#FFFFFF",
    borderRadius: 16,
    padding: 20,
    border: "1px solid #E2E8F0",
    boxShadow: "0 10px 30px rgba(2,6,23,0.06)",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  brand: {
    fontWeight: 900,
    fontSize: 22,
    color: "#0f172a",
    letterSpacing: 0.2,
  },

  toolbar: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginBottom: 16,
  },
  input: {
    height: 44,
    border: "1px solid #CBD5E1",
    borderRadius: 10,
    padding: "0 12px",
    outline: "none",
    width: "100%",
    background: "#FFFFFF",
    color: "#0f172a",
    boxShadow: "0 1px 2px rgba(2,6,23,0.04)",
    boxSizing: "border-box",
  },
  secondaryBtn: {
    height: 44,
    padding: "0 14px",
    borderRadius: 10,
    border: "1px solid #CBD5E1",
    background: "#F8FAFC",
    color: "#0f172a",
    fontWeight: 700,
    cursor: "pointer",
    whiteSpace: "nowrap",
    flex: "0 0 auto",
  },

  feedbackWrap: { marginTop: 4, marginBottom: 8 },
  feedback: { color: "#374151", fontSize: 13 },

  section: { marginTop: 14 },
  sectionTitle: { fontWeight: 800, fontSize: 16, color: "#0f172a", marginBottom: 10 },

  list: { display: "flex", flexDirection: "column", gap: 10 },

  rowBtn: {
    padding: 12,
    borderRadius: 10,
    color: "#fff",
    cursor: "pointer",
    textAlign: "left" as const,
    transition: "transform .06s ease",
  },
  rowBtnDisabled: { opacity: 0.65, cursor: "not-allowed" },
  rowBetween: { display: "flex", alignItems: "center", justifyContent: "space-between" },
  rowText: { fontSize: 15, fontWeight: 700 },

  emptyText: { color: "#64748B", fontSize: 14, background: "#F8FAFC", padding: 12, borderRadius: 10 },
};

/* Animação do spinner em JS-in-CSS:
   Adicione este bloco no seu CSS global caso queira melhorar a suavidade:
   @keyframes novai-spin { to { transform: rotate(360deg); } }
*/
// Fallback simples para o inline spinner:
(function ensureSpinKeyframes() {
  if (typeof document === "undefined") return;
  const id = "novai-spin-keyframes";
  if (document.getElementById(id)) return;
  const style = document.createElement("style");
  style.id = id;
  style.innerHTML = `
@keyframes novai-spin { 
  0% { transform: rotate(0); } 
  100% { transform: rotate(360deg); } 
}`;
  document.head.appendChild(style);
})();

export default Comandas;
