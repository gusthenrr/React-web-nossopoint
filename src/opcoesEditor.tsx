import React, { useEffect, useMemo, useRef, useState } from "react";

/* ---------- URL pedida ---------- */
const url = ""; // defina aqui sua URL base se necessário

/* ---------- utils de tipo/conversão ---------- */
const toBool = (v: any) => v === true || v === 1 || v === "1";
const toInt = (v: any) => (v ? 1 : 0);
const toNum = (v: any) => {
  const n = Number(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};

/* ---------- teclado numérico conforme plataforma (web) ---------- */
const isIOS = typeof navigator !== "undefined" && /iPad|iPhone|iPod/i.test(navigator.userAgent);
const DEC_KB: "numeric" | "decimal" = isIOS ? "decimal" : "numeric";

/* ---------- geração de UIDs estáveis p/ chaves ---------- */
const uid = (() => {
  let c = 1;
  return () => c++;
})();

type Option = {
  __uid: number;
  nome: string;
  valor_extra: number;
  esgotado: boolean;
};

type Group = {
  __uid: number;
  nome: string;
  ids: string;
  max_selected: number;
  obrigatorio: boolean;
  options: Option[];
};

const withUids = (groups: any): Group[] => {
  if (!Array.isArray(groups)) return [];
  return groups.map((g: any) => ({
    __uid: g.__uid ?? uid(),
    nome: String(g?.nome ?? ""),
    ids: String(g?.ids ?? ""),
    max_selected: Number.isFinite(+g?.max_selected) ? +g.max_selected : 1,
    obrigatorio: toBool(g?.obrigatorio),
    options: (Array.isArray(g?.options) ? g.options : []).map((o: any) => ({
      __uid: o.__uid ?? uid(),
      nome: String(o?.nome ?? ""),
      valor_extra: toNum(o?.valor_extra),
      esgotado: toBool(o?.esgotado),
    })),
  }));
};

/* ---------- parsing/normalização/serialização canônica ---------- */
function parseOpcoes(value: any): any[] {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try {
    return JSON.parse(value);
  } catch {
    try {
      return JSON.parse(String(value).replace(/'/g, '"'));
    } catch {
      return [];
    }
  }
}

function normalizeOpcoes(arr: any): Group[] {
  return withUids(
    (Array.isArray(arr) ? arr : []).map((g: any) => ({
      nome: String(g?.nome ?? ""),
      ids: String(g?.ids ?? ""),
      max_selected: Number.isFinite(+g?.max_selected) ? +g.max_selected : 1,
      obrigatorio: toBool(g?.obrigatorio),
      options: (Array.isArray(g?.options) ? g.options : []).map((o: any) => ({
        nome: String(o?.nome ?? ""),
        valor_extra: toNum(o?.valor_extra),
        esgotado: toBool(o?.esgotado),
      })),
    }))
  );
}

function serializeOpcoes(arr: Group[]): string {
  const out = (Array.isArray(arr) ? arr : []).map((g) => ({
    nome: g.nome ?? "",
    ids: g.ids ?? "",
    max_selected: Number.isFinite(+g.max_selected) ? +g.max_selected : 1,
    obrigatorio: toInt(g.obrigatorio),
    options: (g.options || []).map((o) => ({
      nome: o.nome ?? "",
      valor_extra: toNum(o.valor_extra),
      esgotado: toInt(o.esgotado),
    })),
  }));
  return JSON.stringify(out);
}

function canonicalize(jsonish: any) {
  return serializeOpcoes(normalizeOpcoes(parseOpcoes(jsonish)));
}

/* ---------- guard p/ cliques rápidos ---------- */
function usePressGuard(cooldownMs = 250) {
  const lockedRef = useRef(false);
  return (fn?: () => void) => () => {
    if (lockedRef.current) return;
    lockedRef.current = true;
    try {
      fn && fn();
    } finally {
      setTimeout(() => {
        lockedRef.current = false;
      }, cooldownMs);
    }
  };
}

/* ===================== COMPONENTE ===================== */
export default function OpcoesEditorLite({
  value,
  onChange,
  editable = true,
}: {
  value: any;
  onChange?: (v: string) => void;
  editable?: boolean;
}) {
  // estado principal
  const [opcoes, setOpcoes] = useState<Group[]>(() =>
    normalizeOpcoes(parseOpcoes(value))
  );
  // memo do último JSON canônico visto
  const lastCanonicalRef = useRef<string>(canonicalize(value));
  // guard global de cliques
  const safePress = usePressGuard(260);

  /* --- sincroniza vinda do pai (apenas se mudar canonicamente) --- */
  useEffect(() => {
    const nextCanonical = canonicalize(value);
    if (nextCanonical !== lastCanonicalRef.current) {
      lastCanonicalRef.current = nextCanonical;
      setOpcoes(normalizeOpcoes(parseOpcoes(value)));
    }
  }, [value]);

  /* --- propaga para o pai (anti-loop, sem debounce/throttle) --- */
  const serialized = useMemo(() => serializeOpcoes(opcoes), [opcoes]);

  useEffect(() => {
    if (typeof onChange !== "function") return;
    if (serialized !== lastCanonicalRef.current) {
      lastCanonicalRef.current = serialized;
      try {
        onChange(serialized);
      } catch {
        // não deixa o editor quebrar se o pai lançar erro
      }
    }
  }, [serialized, onChange]);

  /* ------------------ handlers ------------------ */
  const setGroupName = (idx: number, nome: string) => {
    setOpcoes((prev) => {
      const next = [...prev];
      if (!next[idx]) return prev;
      next[idx] = { ...next[idx], nome };
      return next;
    });
  };

  const setOptionField = (gIdx: number, oIdx: number, patch: Partial<Option>) => {
    setOpcoes((prev) => {
      const next = [...prev];
      if (!next[gIdx]) return prev;
      const opts = [...(next[gIdx].options || [])];
      if (!opts[oIdx]) return prev;
      opts[oIdx] = { ...opts[oIdx], ...patch };
      next[gIdx] = { ...next[gIdx], options: opts };
      return next;
    });
  };

  const addGroup = safePress(() => {
    if (!editable) return;
    setOpcoes((prev) => [
      ...prev,
      {
        __uid: uid(),
        nome: "",
        ids: "",
        max_selected: 1,
        obrigatorio: false,
        options: [{ __uid: uid(), nome: "", valor_extra: 0, esgotado: false }],
      },
    ]);
  });

  const removeGroup = (idx: number) =>
    safePress(() => {
      if (!editable) return;
      setOpcoes((prev) => prev.filter((_, i) => i !== idx));
    })();

  const addOption = (gIdx: number) =>
    safePress(() => {
      if (!editable) return;
      setOpcoes((prev) => {
        const next = [...prev];
        if (!next[gIdx]) return prev;
        next[gIdx] = {
          ...next[gIdx],
          options: [
            ...(next[gIdx].options || []),
            { __uid: uid(), nome: "", valor_extra: 0, esgotado: false },
          ],
        };
        return next;
      });
    })();

  const removeOption = (gIdx: number, oIdx: number) =>
    safePress(() => {
      if (!editable) return;
      setOpcoes((prev) => {
        const next = [...prev];
        if (!next[gIdx]) return prev;
        next[gIdx] = {
          ...next[gIdx],
          options: (next[gIdx].options || []).filter((_, i) => i !== oIdx),
        };
        return next;
      });
    })();

  /* ------------------ UI ------------------ */
  const ph = "#94A3B8"; // placeholder (nota: cor do placeholder pode variar no web)

  return (
    <div style={styles.wrapper}>
      <div style={styles.headerRow}>
        <div style={styles.title}>Opções do Pedido</div>
        {editable && (
          <button
            style={{ ...styles.addBtn, ...(!editable ? styles.btnDisabled : {}) }}
            onClick={addGroup}
            disabled={!editable}
            title="+ Grupo"
          >
            <span style={styles.addBtnText}>+ Grupo</span>
          </button>
        )}
      </div>

      {opcoes.length === 0 && (
        <div style={styles.hint}>
          Nenhum grupo. {editable ? "Clique em “+ Grupo” para adicionar." : ""}
        </div>
      )}

      {opcoes.map((g, gIdx) => (
        <div key={g.__uid ?? `g-${gIdx}`} style={styles.groupCard}>
          <div style={styles.groupHeader}>
            <div style={styles.groupTitleWrap}>
              <div style={styles.groupAccent} />
              <div style={styles.groupTitle}>
                {g.nome || `Grupo ${gIdx + 1}`}
              </div>
            </div>
            {editable && (
              <button
                onClick={() => removeGroup(gIdx)}
                style={{ ...styles.dangerBtn, ...(!editable ? styles.btnDisabled : {}) }}
                disabled={!editable}
                title="Remover grupo"
              >
                <span style={styles.dangerBtnText}>Remover grupo</span>
              </button>
            )}
          </div>

          {/* Nome do grupo */}
          <div style={styles.row}>
            <div style={styles.label}>Nome do grupo</div>
            <input
              style={{ ...styles.input, ...(!editable ? styles.readonly : {}) }}
              readOnly={!editable}
              placeholder="Ex.: Tamanho"
              // placeholder color não é suportado inline; browsers podem usar o default
              value={g.nome}
              onChange={(e) => setGroupName(gIdx, e.target.value)}
              spellCheck={false}
            />
          </div>

          {/* Opções: nome + valor_extra */}
          <div style={styles.optionsHeader}>
            <div style={styles.subtitle}>Opções</div>
            {editable && (
              <button
                onClick={() => addOption(gIdx)}
                style={{ ...styles.addSmallBtn, ...(!editable ? styles.btnDisabled : {}) }}
                disabled={!editable}
                title="+ Opção"
              >
                <span style={styles.addSmallBtnText}>+ Opção</span>
              </button>
            )}
          </div>

          {(g.options || []).map((o, oIdx) => (
            <div key={o.__uid ?? `g-${gIdx}-o-${oIdx}`} style={styles.optionRow}>
              <div style={{ flex: 1 }}>
                <div style={styles.label}>Nome</div>
                <input
                  style={{ ...styles.input, ...(!editable ? styles.readonly : {}) }}
                  readOnly={!editable}
                  placeholder="Ex.: 300g"
                  value={o.nome}
                  onChange={(e) => setOptionField(gIdx, oIdx, { nome: e.target.value })}
                  spellCheck={false}
                />
              </div>

              <div style={{ width: 130, marginLeft: 10 }}>
                <div style={styles.label}>Valor extra</div>
                <input
                  style={{ ...styles.input, ...(!editable ? styles.readonly : {}) }}
                  readOnly={!editable}
                  inputMode={DEC_KB}
                  placeholder="0,00"
                  value={String(typeof o.valor_extra === "number" ? o.valor_extra : toNum(o.valor_extra))}
                  onChange={(e) => setOptionField(gIdx, oIdx, { valor_extra: toNum(e.target.value) })}
                />
              </div>

              {editable && (
                <button
                  onClick={() => removeOption(gIdx, oIdx)}
                  style={styles.removeOptBtn}
                  title="Remover opção"
                >
                  <span style={styles.removeOptBtnText}>Remover</span>
                </button>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/* ===================== STYLES (mantendo as cores) ===================== */
const styles: Record<string, React.CSSProperties> = {
  // palette clara
  wrapper: { display: "flex", flexDirection: "column", gap: 14 },
  title: { fontWeight: 800, fontSize: 18, color: "#0F172A" }, // azul-preto
  hint: { color: "#334155", opacity: 0.8, marginTop: 6 },
  headerRow: {
    display: "flex",
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },

  // Cards claros
  groupCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    padding: 14,
    border: "1px solid #E2E8F0", // slate-200
    display: "flex",
    flexDirection: "column",
    gap: 10,
    boxShadow: "0 3px 12px rgba(0,0,0,0.06)",
  },
  groupHeader: {
    display: "flex",
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  groupTitleWrap: { display: "flex", flexDirection: "row", alignItems: "center" },
  groupAccent: {
    width: 6,
    height: 20,
    borderRadius: 3,
    backgroundColor: "#2563EB",
    marginRight: 8,
  }, // azul
  groupTitle: { fontWeight: 700, fontSize: 16, color: "#0F172A" },

  // Botões
  addBtn: {
    backgroundColor: "#2563EB",
    padding: "10px 14px",
    borderRadius: 10,
    border: "none",
    cursor: "pointer",
  },
  addBtnText: { color: "#fff", fontWeight: 800, letterSpacing: "0.2px" },
  btnDisabled: { opacity: 0.5, pointerEvents: "none" },
  addSmallBtn: {
    backgroundColor: "#2563EB",
    padding: "8px 12px",
    borderRadius: 10,
    border: "none",
    cursor: "pointer",
  },
  addSmallBtnText: { color: "#fff", fontWeight: 800 },
  dangerBtn: {
    padding: "8px 12px",
    borderRadius: 10,
    backgroundColor: "#B91C1C",
    border: "none",
    cursor: "pointer",
  },
  dangerBtnText: { color: "#fff", fontWeight: 800 },
  removeOptBtn: {
    alignSelf: "flex-start",
    marginTop: 6,
    backgroundColor: "#FEE2E2",
    padding: "8px 12px",
    borderRadius: 10,
    border: "1px solid #FCA5A5",
    cursor: "pointer",
  },
  removeOptBtnText: { color: "#7F1D1D", fontWeight: 700 },

  // Inputs claros
  row: { display: "flex", flexDirection: "row", gap: 10 },
  label: { color: "#334155", marginBottom: 6, fontSize: 12, fontWeight: 700 },
  input: {
    flex: 1,
    backgroundColor: "#FFFFFF",
    border: "1px solid #D0D7E2", // cinza-azulado claro
    borderRadius: 10,
    padding: "10px 12px",
    color: "#0F172A",
    outline: "none",
  },
  readonly: { opacity: 0.6 },

  optionsHeader: {
    marginTop: 2,
    display: "flex",
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  subtitle: { fontWeight: 800, fontSize: 14, color: "#0F172A" },

  // Linha da opção clara
  optionRow: {
    marginTop: 10,
    backgroundColor: "#F8FAFC", // slate-50
    borderRadius: 12,
    border: "1px solid #E2E8F0",
    padding: 12,
    display: "flex",
    flexDirection: "row",
    gap: 8,
    alignItems: "flex-start",
  },
};
