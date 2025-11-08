import React from 'react';
import { getSocket } from '../socket';
import OpcoesEditorLite from './opcoesEditor';

// ✅ conforme pedido


// ---------- tipos ----------
type Maybe<T> = T | null | undefined;

type SocketLike = {
  on: (event: string, cb: (...args: any[]) => void) => void;
  off: (event: string, cb?: (...args: any[]) => void) => void;
  emit: (event: string, payload?: any) => void;
  connected?: boolean;
};

export type User = {
  cargo?: string;
  username?: string;
  token?: string;
  carrinho?: string;
};

export type Pedido = {
  id?: string | number;
  comanda?: string;
  pedido?: string;
  quantidade?: string | number;
  preco?: string | number;
  inicio?: string;
  fim?: string;
  comecar?: string;
  estado?: string;
  extra?: string;
  username?: string;
  ordem?: string | number;
  nome?: string;
  dia?: string;
  orderTiming?: string;
  endereco_entrega?: string;
  order_id?: string | number;
  remetente?: string;
  horario_para_entrega?: string;
  categoria?: string | number;
  preco_unitario?: string | number;
  opcoes?: any;
  quantidade_paga?: string | number;
  printed?: number | string;
};

type PedidosScreenProps = {
  user?: User; // 🔄 substitui o antigo UserContext
};

type PedidosScreenState = {
  // dados
  data: Pedido[];
  refreshing: boolean;

  // conectividade
  isConnected: boolean;

  // filtros
  filtroComanda: string;
  filtroItem: string;
  filtroCategoria: string | number | null;
  categoriasDisponiveis: Array<string | number>;
  filtroStatus: 'aberta' | 'fechada' | null;

  // modal
  showModal: boolean;
  editable: boolean;
  pedidoModal: Partial<Pedido>;

  // UI/fluxo
  carregandoConfirmar: boolean;
  salvandoEdicao: boolean;
};

// ---------- utils ----------
const normalize = (s: any) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

const toInt = (v: any, d = 0) => {
  const n = parseInt(String(v).replace(/[^0-9-]/g, ''), 10);
  return Number.isFinite(n) ? n : d;
};

const toFloat = (v: any, d = 0) => {
  const n = parseFloat(String(v).replace(',', '.').replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : d;
};

const isHHMM = (s: any) => /^([01]\d|2[0-3]):([0-5]\d)$/.test(String(s ?? '').trim());

// mapeia categoria para rótulo
const catLabel = (c: Maybe<string | number>) => {
  const sc = String(c ?? '');
  if (sc === '1') return 'Pegar';
  if (sc === '2') return 'Barman';
  if (sc === '3') return 'Cozinha';
  return sc || '—';
};

export default class PedidosScreen extends React.Component<PedidosScreenProps, PedidosScreenState> {
  socket: SocketLike | null = null;
  _isMounted = false;
  _guards: Record<string, boolean> = {};
  _refreshTimeout: any = null;
  _onlineHandler?: () => void;
  _offlineHandler?: () => void;

  constructor(props: PedidosScreenProps) {
    super(props);
    this.state = {
      // dados
      data: [],
      refreshing: false,

      // conectividade
      isConnected: typeof navigator !== 'undefined' ? !!navigator.onLine : true,

      // filtros
      filtroComanda: '',
      filtroItem: '',
      filtroCategoria: null,
      categoriasDisponiveis: [],
      filtroStatus: null,

      // modal
      showModal: false,
      editable: false,
      pedidoModal: {},

      // UI/fluxo
      carregandoConfirmar: false,
      salvandoEdicao: false,
    };
  }

  // ------- helpers -------
  getCarrinho() {
    const { user } = this.props || {};
    return user?.carrinho || 'SlicePizza';
  }

  // ------- guards contra cliques rápidos -------
  guard = (key: string, fn?: () => void, cooldown = 280) => {
    if (this._guards[key]) return;
    this._guards[key] = true;
    try {
      fn && fn();
    } finally {
      setTimeout(() => {
        this._guards[key] = false;
      }, cooldown);
    }
  };

  safeSetState = (
    patch:
      | Partial<PedidosScreenState>
      | ((prev: PedidosScreenState) => Partial<PedidosScreenState>),
    cb?: () => void
  ) => {
    if (!this._isMounted) return;
    if (typeof patch === 'function') {
      this.setState((prev) => ({ ...(patch as any)(prev) }), cb);
    } else {
      this.setState(patch as any, cb);
    }
  };

  // pago ⇔ ordem > 0
  isPago = (it: Maybe<Pedido>) => toInt(it?.ordem, 0) > 0;
  isComandaFechada = (it: Maybe<Pedido>) => this.isPago(it);
  isComandaAberta = (it: Maybe<Pedido>) => !this.isComandaFechada(it);

  // ---------- ciclo de vida ----------
  componentDidMount() {
    this._isMounted = true;

    // rede (web)
    this._onlineHandler = () => {
      const isConnected = true;
      if (isConnected !== this.state.isConnected) {
        this.safeSetState({ isConnected });
        if (isConnected) this.refreshData();
      }
    };
    this._offlineHandler = () => {
      const isConnected = false;
      if (isConnected !== this.state.isConnected) {
        this.safeSetState({ isConnected });
      }
    };
    window.addEventListener('online', this._onlineHandler);
    window.addEventListener('offline', this._offlineHandler);

    // socket
    this.socket = getSocket() as SocketLike | null;
    if (!this.socket) {
      window.alert('Erro: Sem socket disponível no momento.');
      return;
    }

    this.socket.on('connect', () => {
      // reconexão: re-sincroniza a lista
      this.refreshData();
    });

    this.socket.on('disconnect', () => {
      // nada assíncrono aqui
    });

    const { user } = this.props || {};
    if (user?.cargo !== 'Cozinha') {
      this.socket.on('respostaPedidos', this.handleRespostaPedidos);
    } else {
      this.socket.on('respostaPedidosCC', this.handleRespostaPedidos);
    }

    this.refreshData();
  }

  componentWillUnmount() {
    this._isMounted = false;

    window.removeEventListener('online', this._onlineHandler || (() => {}));
    window.removeEventListener('offline', this._offlineHandler || (() => {}));

    if (this.socket) {
      this.socket.off('connect');
      this.socket.off('disconnect');
      const { user } = this.props || {};
      if (user?.cargo !== 'Cozinha') {
        this.socket.off('respostaPedidos', this.handleRespostaPedidos);
      } else {
        this.socket.off('respostaPedidosCC', this.handleRespostaPedidos);
      }
    }
    if (this._refreshTimeout) {
      clearTimeout(this._refreshTimeout);
      this._refreshTimeout = null;
    }
  }

  // ---------- socket handlers ----------
  handleRespostaPedidos = (dados: any) => {
    // proteção a payload inconsistente
    if (!this._isMounted) return;

    const { user } = this.props || {};
    let arr: Pedido[] = [];
    const payload = dados?.dataPedidos;

    if (Array.isArray(payload)) {
      if (user?.cargo !== 'Cozinha') {
        arr = [...payload].reverse();
      } else {
        // garante categoria 3 comparando como string
        arr = payload.filter((p: any) => String(p?.categoria) === '3').reverse();
      }
    }

    const categorias = Array.from(
      new Set(
        arr
          .map((i) => String(i?.categoria ?? ''))
          .filter((c) => c && c !== 'null' && c !== 'undefined')
      )
    );

    if (this._refreshTimeout) {
      clearTimeout(this._refreshTimeout);
      this._refreshTimeout = null;
    }

    this.safeSetState({
      data: arr,
      categoriasDisponiveis: categorias,
      refreshing: false,
    });
  };

  refreshData = () =>
    this.guard('refresh', () => {
      if (!this._isMounted) return;

      if (!this.state.isConnected || !this.socket || !this.socket.connected) {
        this.safeSetState({ refreshing: false });
        window.alert('Sem conexão: Verifique sua internet para atualizar os pedidos.');
        return;
      }

      const { user } = this.props || {};
      this.safeSetState({ refreshing: true }, () => {
        try {
          const carrinho = this.getCarrinho();
          if (user?.cargo !== 'Cozinha') {
            this.socket!.emit('getPedidos', { emitir: false, carrinho });
          } else {
            this.socket!.emit('getPedidosCC', { emitir: true, carrinho });
          }
          // fallback para não travar o spinner
          if (this._refreshTimeout) clearTimeout(this._refreshTimeout);
          this._refreshTimeout = setTimeout(() => {
            this.safeSetState({ refreshing: false });
          }, 10000);
        } catch {
          this.safeSetState({ refreshing: false });
          window.alert('Erro: Falha ao solicitar atualização.');
        }
      });
    });

  // ---------- filtros ----------
  getFilteredData = () => {
    const { data, filtroComanda, filtroItem, filtroCategoria, filtroStatus } = this.state;

    const nCom = normalize(filtroComanda);
    const nItem = normalize(filtroItem);

    return (data || []).filter((it) => {
      const okComanda = nCom ? normalize(it?.comanda).includes(nCom) : true;
      const okItem = nItem ? normalize(it?.pedido).includes(nItem) : true;
      const okCat = filtroCategoria ? String(it?.categoria) === String(filtroCategoria) : true;

      let okStatus = true;
      if (filtroStatus === 'aberta') okStatus = this.isComandaAberta(it);
      if (filtroStatus === 'fechada') okStatus = this.isComandaFechada(it);

      return okComanda && okItem && okCat && okStatus;
    });
  };

  limparFiltros = () =>
    this.guard('limparFiltros', () => {
      this.safeSetState({
        filtroComanda: '',
        filtroItem: '',
        filtroCategoria: null,
        filtroStatus: null,
      });
    });

  // ---------- modal ----------
  abrirModal = (item: Pedido) =>
    this.guard('abrirModal', () => {
      const safe: Pedido = {
        id: item?.id ?? null,
        comanda: item?.comanda ?? '',
        pedido: item?.pedido ?? '',
        quantidade: String(item?.quantidade ?? ''),
        preco: String(item?.preco ?? ''),
        inicio: item?.inicio ?? '',
        fim: item?.fim ?? '',
        comecar: item?.comecar ?? '',
        estado: item?.estado ?? '',
        extra: item?.extra ?? '',
        username: item?.username ?? '',
        ordem: item?.ordem ?? '',
        nome: item?.nome ?? '',
        dia: item?.dia ?? '',
        orderTiming: item?.orderTiming ?? '',
        endereco_entrega: item?.endereco_entrega ?? '',
        order_id: item?.order_id ?? '',
        remetente: item?.remetente ?? '',
        horario_para_entrega: item?.horario_para_entrega ?? '',
        categoria: item?.categoria ?? '',
        preco_unitario: String(item?.preco_unitario ?? ''),
        opcoes: item?.opcoes ?? '',
        quantidade_paga: String(item?.quantidade_paga ?? '0'),
        printed: (item?.printed as any) ?? 0,
      };
      this.safeSetState({ pedidoModal: safe, showModal: true, editable: false });
    });

  fecharModal = () =>
    this.guard('fecharModal', () => {
      this.safeSetState({ showModal: false, editable: false, pedidoModal: {} });
    });

  entrarEdicao = () => this.guard('entrarEdicao', () => this.safeSetState({ editable: true }));
  sairEdicao = () => this.guard('sairEdicao', () => this.safeSetState({ editable: false }));

  onChangeCampo = (campo: keyof Pedido, valor: any) => {
    // sem guard: alterações devem ser responsivas
    this.safeSetState((prev) => {
      const novo: any = { ...prev.pedidoModal, [campo]: valor };

      if (campo === 'quantidade') {
        const q = Math.max(0, toInt(valor, 0));
        const pu = toFloat(novo.preco_unitario, 0);
        novo.preco = String((pu * q).toFixed(2));

        const qpAntigo = toInt((prev.pedidoModal as any).quantidade_paga, 0);
        novo.quantidade_paga = String(Math.min(q, Math.max(0, qpAntigo)));
      }

      if (campo === 'preco_unitario') {
        const pu = toFloat(valor, 0);
        const q = Math.max(0, toInt(novo.quantidade, 0));
        novo.preco = String((pu * q).toFixed(2));
      }

      return { pedidoModal: novo };
    });
  };

  salvarEdicao = () =>
    this.guard('salvarEdicao', () => {
      if (this.state.salvandoEdicao) return;

      const { user } = this.props || {};
      const p = this.state.pedidoModal as Pedido;

      // validações
      const q = toInt(p.quantidade, NaN);
      if (!Number.isFinite(q)) {
        window.alert('Erro: Quantidade inválida (somente números).');
        return;
      }
      const qp = toInt(p.quantidade_paga, NaN);
      if (!Number.isFinite(qp)) {
        window.alert('Erro: Quantidade paga inválida (somente números).');
        return;
      }
      if (qp > q) {
        window.alert('Erro: Quantidade paga não pode ser maior que a quantidade.');
        return;
      }
      const pu = toFloat(p.preco_unitario, NaN);
      if (!Number.isFinite(pu)) {
        window.alert('Erro: Preço unitário inválido.');
        return;
      }
      const preco = toFloat(p.preco, NaN);
      if (!Number.isFinite(preco)) {
        window.alert('Erro: Preço inválido.');
        return;
      }
      const h = String(p.horario_para_entrega || '').trim();
      if (h && !isHHMM(h)) {
        window.alert('Erro: Horário para entrega deve estar no formato HH:MM.');
        return;
      }

      if (!this.state.isConnected || !this.socket || !this.socket.connected) {
        window.alert('Sem conexão: Não é possível salvar agora. Tente novamente quando voltar a internet.');
        return;
      }

      const payload = {
        id: p.id,
        comanda: p.comanda,
        preco: String(preco),
        quantidade: String(q),
        quantidade_paga: String(qp),
        preco_unitario: String(pu),
        opcoes: p.opcoes ?? '',
        extra: p.extra ?? '',
        horario_para_entrega: h,
      };

      this.safeSetState({ salvandoEdicao: true }, () => {
        try {
          this.socket!.emit('atualizar_pedidos', {
            pedidoAlterado: payload,
            usuario: user?.username,
            token: user?.token,
            carrinho: this.getCarrinho(),
          });
          this.safeSetState({ editable: false, showModal: false, pedidoModal: {} });
        } catch {
          window.alert('Erro: Não foi possível salvar a edição agora.');
        } finally {
          this.safeSetState({ salvandoEdicao: false });
        }
      });
    });

  confirmarPedido = (item: Pedido) =>
    this.guard('confirmarPedido', async () => {
      const { user } = this.props || {};
      if (!item?.id) return;

      if (!this.state.isConnected || !this.socket || !this.socket.connected) {
        window.alert('Sem conexão: Não é possível confirmar agora.');
        return;
      }

      try {
        this.safeSetState({ carregandoConfirmar: true });
        // Emita o evento de confirmação
        this.socket!.emit('confirmar_pedido', {
          id: item.id,
          comanda: item.comanda,
          usuario: user?.username,
          token: user?.token,
          carrinho: this.getCarrinho(),
        });

        // feedback otimista (printed = 1)
        this.safeSetState((prev) => ({
          data: (prev.data || []).map((p) =>
            String(p.id) === String(item.id) ? { ...p, printed: 1 } : p
          ),
        }));
      } catch {
        window.alert('Erro: Não foi possível confirmar o pedido.');
      } finally {
        this.safeSetState({ carregandoConfirmar: false });
      }
    });

  confirmarExclusao = (item: Pedido) =>
    this.guard('confirmarExclusao', () => {
      const ok = window.confirm(
        `Excluir o pedido "${item?.pedido}" da comanda "${item?.comanda}"? Essa ação não pode ser desfeita.`
      );
      if (ok) this.excluirPedido(item);
    });

  excluirPedido = (item: Pedido) =>
    this.guard('excluirPedido', () => {
      const { user } = this.props || {};
      if (!item?.id) return;

      if (!this.state.isConnected || !this.socket || !this.socket.connected) {
        window.alert('Sem conexão: Não é possível excluir agora.');
        return;
      }

      try {
        this.socket!.emit('excluir_pedido', {
          id: item.id,
          comanda: item.comanda,
          usuario: user?.username,
          token: user?.token,
          carrinho: this.getCarrinho(),
        });

        // feedback otimista
        this.safeSetState((prev) => ({
          showModal: false,
          editable: false,
          pedidoModal: {},
          data: (prev.data || []).filter((p) => String(p.id) !== String(item.id)),
        }));
      } catch {
        window.alert('Erro: Não foi possível excluir agora.');
      }
    });

  // ---------- render ----------
  renderHeaderFiltros() {
    const {
      filtroComanda,
      filtroItem,
      filtroCategoria,
      categoriasDisponiveis,
      filtroStatus,
    } = this.state;

    return (
      <div style={styles.filtersContainer}>
        <div style={styles.filtersRow}>
          <input
            placeholder="Filtrar por comanda"
            value={filtroComanda}
            onChange={(e) => this.safeSetState({ filtroComanda: e.target.value })}
            style={styles.filterInput as React.CSSProperties}
            spellCheck={false}
          />
          <input
            placeholder="Filtrar por item"
            value={filtroItem}
            onChange={(e) => this.safeSetState({ filtroItem: e.target.value })}
            style={styles.filterInput as React.CSSProperties}
            spellCheck={false}
          />
        </div>

        <div style={{ ...styles.hScroll, marginTop: 8 }}>
          <button
            style={{ ...styles.catChip, ...(!filtroCategoria ? styles.catChipActive : {}) }}
            onClick={() => this.safeSetState({ filtroCategoria: null })}
          >
            <span style={{ ...styles.catChipText, ...(!filtroCategoria ? styles.catChipTextActive : {}) }}>
              Todas
            </span>
          </button>

          {categoriasDisponiveis.map((c) => {
            const isActive = String(filtroCategoria) === String(c);
            return (
              <button
                key={String(c)}
                style={{ ...styles.catChip, ...(isActive ? styles.catChipActive : {}) }}
                onClick={() => this.safeSetState({ filtroCategoria: c })}
              >
                <span style={{ ...styles.catChipText, ...(isActive ? styles.catChipTextActive : {}) }}>
                  {catLabel(c)}
                </span>
              </button>
            );
          })}
        </div>

        {/* Filtro por status da comanda */}
        <div style={{ ...styles.hScroll, marginTop: 8 }}>
          <button
            style={{ ...styles.catChip, ...(!filtroStatus ? styles.catChipActive : {}) }}
            onClick={() => this.safeSetState({ filtroStatus: null })}
          >
            <span style={{ ...styles.catChipText, ...(!filtroStatus ? styles.catChipTextActive : {}) }}>
              Todas
            </span>
          </button>

          <button
            style={{ ...styles.catChip, ...(filtroStatus === 'aberta' ? styles.catChipActive : {}) }}
            onClick={() => this.safeSetState({ filtroStatus: 'aberta' })}
          >
            <span style={{ ...styles.catChipText, ...(filtroStatus === 'aberta' ? styles.catChipTextActive : {}) }}>
              Abertas
            </span>
          </button>

          <button
            style={{ ...styles.catChip, ...(filtroStatus === 'fechada' ? styles.catChipActive : {}) }}
            onClick={() => this.safeSetState({ filtroStatus: 'fechada' })}
          >
            <span style={{ ...styles.catChipText, ...(filtroStatus === 'fechada' ? styles.catChipTextActive : {}) }}>
              Fechadas
            </span>
          </button>
        </div>

        <div style={styles.filtersActions}>
          <button style={{ ...styles.btn, ...styles.btnGray }} onClick={this.limparFiltros}>
            <span style={styles.btnText}>Limpar filtros</span>
          </button>
          <button style={{ ...styles.btn, ...styles.btnPrimary }} onClick={this.refreshData}>
            <span style={styles.btnText}>Atualizar</span>
          </button>
        </div>

        {String(filtroCategoria) === '1' && (
          <div style={styles.note}>
            Dica: no filtro Categoria 1, o botão “Confirmar” aparece apenas quando{' '}
            <span style={{ fontWeight: 800 as any }}>printed = 0</span>.
          </div>
        )}
      </div>
    );
  }

  renderItemRow = (item: Pedido) => {
    const { filtroCategoria } = this.state;
    const { user } = this.props || {};
    const printed = toInt(item?.printed || 0, 0);
    const showConfirm = String(filtroCategoria) === '1' && printed === 0;

    const isPaid = this.isPago(item); // ordem > 0
    const podeExcluir = user?.cargo === 'ADM' || user?.cargo === 'Cozinha';

    return (
      <div key={String(item?.id ?? `${item?.comanda || 'x'}:${item?.inicio || 'y'}`)} style={{ ...styles.card, ...(isPaid ? styles.cardPaid : {}) }}>
        {/* excluir (fora da área do modal) */}
        {podeExcluir && (
          <button
            style={styles.cardDeleteBtn}
            onClick={() => this.confirmarExclusao(item)}
            title="Excluir"
          >
            <span style={styles.cardDeleteIcon as React.CSSProperties}>×</span>
          </button>
        )}

        {/* faixa topo quando pago */}
        {isPaid && <div style={styles.cardPaidStrip} />}

        {/* abre modal */}
        <div onClick={() => this.abrirModal(item)} style={{ cursor: 'pointer' }}>
          <div style={styles.cardTitle}>
            {item?.quantidade}× {item?.pedido} {item?.extra ? `(${item.extra})` : ''}
          </div>

          <div style={styles.cardMeta as React.CSSProperties}>
            Comanda: <span style={styles.cardMetaStrong}> {item?.comanda}</span> • Status:{' '}
            <span style={isPaid ? styles.statusPaid : styles.statusPending}>
              {isPaid ? 'Fechada' : 'Aberta'}
            </span>
          </div>
          <div style={styles.cardMeta as React.CSSProperties}>
            Hora: {item?.inicio || '—'} • Estado: {item?.estado !== 'Pronto' ? item?.estado : 'Feito'}
          </div>
          <div style={styles.cardMeta as React.CSSProperties}>
            Categoria: {catLabel(item?.categoria)} • Impresso: {printed === 0 ? 'Não' : 'Sim'}
          </div>
          {!!item?.preco && (
            <div style={styles.cardMeta as React.CSSProperties}>
              Preço: {item?.preco} {item?.preco_unitario ? ` • PU: ${item.preco_unitario}` : ''}
            </div>
          )}
        </div>

        <div style={styles.cardActionsRow}>
          {showConfirm && (
            <button
              style={{ ...styles.btn, ...styles.btnConfirm }}
              onClick={() => this.confirmarPedido(item)}
              disabled={this.state.carregandoConfirmar}
            >
              <span style={styles.btnText}>{this.state.carregandoConfirmar ? '...' : 'Confirmar'}</span>
            </button>
          )}
        </div>
      </div>
    );
  };

  renderModal() {
    const { showModal, editable, pedidoModal } = this.state;
    if (!showModal) return null;

    const field = (
      label: string,
      value: any,
      editableNow?: boolean,
      onChange?: (v: string) => void,
      inputProps?: React.InputHTMLAttributes<HTMLInputElement>
    ) => (
      <div style={styles.modalRow}>
        <div style={styles.modalLabel as React.CSSProperties}>{label}</div>
        <input
          style={{
            ...styles.modalInput,
            ...(editableNow ? {} : styles.modalInputReadonly),
          }}
          value={String(value ?? '')}
          readOnly={!editableNow}
          onChange={(e) => onChange?.(e.target.value)}
          {...inputProps}
        />
      </div>
    );

    return (
      <div style={styles.modalOverlay} onClick={(e) => e.target === e.currentTarget && this.fecharModal()}>
        <div style={styles.modalContent}>
          {/* header */}
          <div style={styles.modalHeader}>
            <div style={styles.modalTitle as React.CSSProperties}>Detalhes do Pedido</div>
            <button onClick={this.fecharModal} style={styles.modalCloseBtn} title="Fechar">
              <span style={styles.modalCloseIcon as React.CSSProperties}>×</span>
            </button>
          </div>

          {/* conteúdo */}
          <div style={{ maxHeight: 560, overflowY: 'auto' }}>
            {/* somente leitura */}
            {field('ID', pedidoModal.id, false)}
            {field('Pedido', pedidoModal.pedido, false)}
            {field('Usuário', pedidoModal.username, false)}
            {field('Nome', pedidoModal.nome, false)}
            {field('Estado', pedidoModal.estado, false)}
            {field('Início', pedidoModal.inicio, false)}
            {field('Fim', pedidoModal.fim, false)}
            {field('Começar', pedidoModal.comecar, false)}
            {field('Dia', pedidoModal.dia, false)}
            {field('Ordem', pedidoModal.ordem, false)}
            {field('OrderTiming', pedidoModal.orderTiming, false)}
            {field('Endereço Entrega', pedidoModal.endereco_entrega, false)}
            {field('Order ID', pedidoModal.order_id, false)}
            {field('Remetente', pedidoModal.remetente, false)}
            {field('Categoria', pedidoModal.categoria, false)}
            {field('Printed', pedidoModal.printed, false)}

            {/* editáveis */}
            {field('Comanda', pedidoModal.comanda, editable, (v) => this.onChangeCampo('comanda', v))}
            {field(
              'Quantidade',
              pedidoModal.quantidade,
              editable,
              (v) => this.onChangeCampo('quantidade', v),
              { inputMode: 'numeric' }
            )}
            {field(
              'Quantidade Paga',
              pedidoModal.quantidade_paga,
              editable,
              (v) => this.onChangeCampo('quantidade_paga', v),
              { inputMode: 'numeric' }
            )}
            {field(
              'Preço Unitário',
              pedidoModal.preco_unitario,
              editable,
              (v) => this.onChangeCampo('preco_unitario', v),
              { inputMode: 'decimal' }
            )}
            {field(
              'Preço',
              pedidoModal.preco,
              editable,
              (v) => this.onChangeCampo('preco', v),
              { inputMode: 'decimal' }
            )}

            <div style={{ marginTop: 8 }}>
              <OpcoesEditorLite
                key={String((pedidoModal as any)?.id ?? 'novo')}
                value={pedidoModal.opcoes}
                editable={editable}
                onChange={(json: any) => {
                  // Se vier objeto/array, limpe chaves terminadas com '?'
                  const stripKeys = (o: any): any => {
                    if (Array.isArray(o)) return o.map(stripKeys);
                    if (o && typeof o === 'object') {
                      const out: any = {};
                      for (const [k, v] of Object.entries(o)) {
                        const nk = k.endsWith('?') ? k.slice(0, -1) : k;
                        out[nk] = stripKeys(v);
                      }
                      return out;
                    }
                    return o;
                  };
                  const safe = typeof json === 'string' ? json.replace(/\?/g, '') : stripKeys(json);
                  this.onChangeCampo('opcoes', safe);
                }}
              />
            </div>

            {field(
              'Horário p/ Entrega (HH:MM)',
              pedidoModal.horario_para_entrega,
              editable,
              (v) => this.onChangeCampo('horario_para_entrega', v),
              { inputMode: 'numeric', placeholder: 'HH:MM' }
            )}
          </div>

          <div style={styles.modalActions}>
            {editable ? (
              <>
                <button style={{ ...styles.btn, ...styles.btnOutline }} onClick={this.sairEdicao}>
                  <span style={styles.btnOutlineText}>Cancelar</span>
                </button>
                <button style={{ ...styles.btn, ...styles.btnPrimary }} onClick={this.salvarEdicao}>
                  <span style={styles.btnText}>Salvar</span>
                </button>
              </>
            ) : (
              <button style={{ ...styles.btn, ...styles.btnPrimary }} onClick={this.entrarEdicao}>
                <span style={styles.btnText}>Editar</span>
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  render() {
    const { refreshing } = this.state;
    const data = this.getFilteredData();

    return (
      <div style={styles.container}>
        {this.renderHeaderFiltros()}

        {/* Lista */}
        <div style={{ paddingBottom: 16 }}>
          {refreshing ? (
            <div style={{ padding: '16px 12px', color: '#6b7280' }}>Carregando...</div>
          ) : null}

          {data.length === 0 ? (
            <div style={{ padding: '24px 0', textAlign: 'center', color: '#6b7280' }}>
              Sem pedidos para exibir.
            </div>
          ) : (
            data.map((it) => this.renderItemRow(it))
          )}
        </div>

        {this.renderModal()}
      </div>
    );
  }
}

// ---------- "styles" em CSS-in-JS (mantendo cores originais) ----------
const styles: Record<string, React.CSSProperties> = {
  container: { minHeight: '100%', backgroundColor: '#fff' },

  // filtros
  filtersContainer: {
    padding: '12px 12px 8px 12px',
    backgroundColor: '#f8fafc',
  },
  filtersRow: { display: 'flex', flexDirection: 'row', gap: 8 },
  filterInput: {
    flex: 1,
    height: 42,
    border: '1px solid #e5e7eb',
    borderRadius: 10,
    padding: '0 10px',
    backgroundColor: '#fff',
    outline: 'none',
  },
  filtersActions: { display: 'flex', flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },

  // botões
  btn: {
    padding: '10px 14px',
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 120,
    border: 'none',
    cursor: 'pointer',
    display: 'inline-flex',
  },
  btnPrimary: { backgroundColor: '#17315c' },
  btnConfirm: { backgroundColor: '#059669', marginTop: 8, alignSelf: 'flex-start' },
  btnGray: { backgroundColor: '#374151' },
  btnText: { color: '#fff', fontWeight: 800 },
  btnOutline: { backgroundColor: '#fff', border: '1px solid #9ca3af' },
  btnOutlineText: { color: '#111827', fontWeight: 800 as any },
  note: { marginTop: 8, color: '#6b7280', fontSize: 12 },

  // chips categorias
  hScroll: {
    display: 'flex',
    overflowX: 'auto',
    paddingBottom: 2,
    gap: 8,
  },
  catChip: {
    padding: '8px 12px',
    borderRadius: 999,
    border: '1px solid #d1d5db',
    backgroundColor: '#fff',
    whiteSpace: 'nowrap',
    cursor: 'pointer',
  },
  catChipActive: { backgroundColor: '#17315c', borderColor: '#17315c', color: '#fff' },
  catChipText: { color: '#374151', fontWeight: 700 as any },
  catChipTextActive: { color: '#fff', fontWeight: 800 as any },

  // cards
  card: {
    margin: '10px 12px 0 12px',
    padding: 14,
    borderRadius: 12,
    backgroundColor: '#f9fafb',
    border: '1px solid #e5e7eb',
    position: 'relative',
  },
  // indicação de pago
  cardPaid: {
    borderColor: 'red',
  },
  cardPaidStrip: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    height: 6,
    backgroundColor: 'red',
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
  },
  statusPaid: { color: 'red', fontWeight: 800 as any },
  statusPending: { color: 'green', fontWeight: 800 as any },

  // botão excluir no card
  cardDeleteBtn: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 28,
    height: 28,
    borderRadius: 14,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fee2e2',
    border: 'none',
    cursor: 'pointer',
    zIndex: 5,
  },
  cardDeleteIcon: {
    fontSize: 18,
    fontWeight: 800 as any,
    color: '#b91c1c',
    marginTop: -2,
    lineHeight: 1,
  },

  cardTitle: { fontSize: 16, fontWeight: 800 as any, color: '#111827' },
  cardMeta: { marginTop: 4, color: '#374151' },
  cardMetaStrong: { fontWeight: 800 as any, color: '#111827' },

  // modal
  modalOverlay: {
    position: 'fixed',
    inset: 0,
    backgroundColor: 'rgba(0,0,0,0.45)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '0 12px',
    zIndex: 1000,
  },
  modalContent: {
    width: '100%',
    maxWidth: 520,
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    boxShadow: '0 10px 30px rgba(0,0,0,0.2)',
  },
  modalHeader: {
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  modalTitle: { fontSize: 18, fontWeight: 800 as any, color: '#111827' },
  modalCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f3f4f6',
    border: 'none',
    cursor: 'pointer',
  },
  modalCloseIcon: {
    fontSize: 20,
    fontWeight: 800 as any,
    color: '#111827',
    marginTop: -2,
    lineHeight: 1,
  },
  modalRow: { marginTop: 8 },
  modalLabel: { fontWeight: 700 as any, color: '#374151', marginBottom: 4 },
  modalInput: {
    border: '1px solid #e5e7eb',
    borderRadius: 10,
    padding: '10px 10px',
    backgroundColor: '#fff',
    width: '100%',
    outline: 'none',
  },
  modalInputReadonly: { backgroundColor: '#f3f4f6' },
  modalActions: {
    display: 'flex',
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    marginTop: 12,
    gap: 10,
  },

  cardActionsRow: {
    display: 'flex',
    gap: 8,
    marginTop: 8,
    alignSelf: 'flex-start',
  },
};
