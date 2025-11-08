import React from 'react';
import { getSocket } from '../socket';

// =====================
// Tipagens auxiliares
// =====================
// (ajuste os tipos reais conforme sua API)
type Pagamento = any;
type ItemComanda = any;
type NomeItem = any;
const API_URL = 'https://flask-backend-server-yxom.onrender.com';

export interface ComandaInitialParams {
  data: ItemComanda[];
  fcomanda: string | number;
  preco: number;
  preco_total: number;
  preco_pago: number;
  username: string;
  nomes: NomeItem[];
  ordem: number;
  desconto: number;
}

interface ComandaScreenProps {
  /** Parâmetros iniciais vindos da tela de lista (web). */
  initial: ComandaInitialParams;
  /** Credenciais/opções passadas pela tela de lista (web). */
  username?: string;
  token?: string;
  carrinho?: string;
  /** Opcional: caso queira despachar via socket externo. */
  onEmit?: (event: string, payload: any) => void;
}

interface ComandaScreenState {
  // dados
  username: string;
  data: ItemComanda[];
  dataGeral: ItemComanda[];
  fcomanda: string | number;
  preco: number;
  preco_total: number;
  preco_pago: number;
  ordem: number;
  nomes: NomeItem[];
  desconto: number;

  // edição
  guardarValores: ItemComanda[];
  showBotoes: boolean;
  itensAlterados: ItemComanda[];

  // filtros
  showLinha1e2: boolean;
  show_mais: boolean;

  // brinde
  Brinde: string;
  showBrindeModal: boolean;
  brindeFiltrado: string[];
  brindeFiltradoBase: string[];

  // alterar valor (desconto/caixinha legado)
  showAlterarValor: boolean;
  alterarValorCategoria: string;
  alterarValor: string;

  // pagamento unificado
  opcoesMetodoPag: string[];
  payMode: boolean;
  paySelections: Record<string, number>;
  pagandoLoading: boolean;
  showPayModal: boolean;
  metodoPagSelecionado: string | null;
  aplicarDez: boolean;
  caixinhaValor: string;
  ondePaguei: '' | 'itens' | 'parcial' | 'tudo';
  valor_pago: string;

  // histórico de pagamentos
  showPagamentosModal: boolean;
  pagamentos: Pagamento[];
  pagamentosLoading: boolean;

  // transferir comanda
  showTransferModal: boolean;
  transferDestino: string;
  transferLoading: boolean;

  // robustez
  isConnected: boolean;
  submitMsg: string;
  ordemBusy: boolean;
  undoBusy: boolean;
}

// =====================
// Utilitários Web
// =====================

// Combina estilos (equivalente ao array do RN)
const s = (...objs: React.CSSProperties[]): React.CSSProperties =>
  Object.assign({}, ...objs);

// Spinner simples
const ActivityIndicator: React.FC<{ size?: 'small' | 'large' }> = () => (
  <div style={styles.spinner} aria-label="Carregando" />
);

// Modal simples (overlay)
const Modal: React.FC<{
  visible: boolean;
  onRequestClose?: () => void;
  children: React.ReactNode;
  transparent?: boolean;
  animationType?: 'fade' | 'none';
}> = ({ visible, onRequestClose, children }) => {
  if (!visible) return null;
  return (
    <div
      style={styles.modalBackdrop}
      onClick={onRequestClose}
      role="dialog"
      aria-modal="true"
    >
      <div style={styles.modalCenter} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
};

// Wrapper para Alert com API semelhante
type AlertBtn = { text: string; style?: 'cancel' | 'destructive' | string; onPress?: () => void; };
const Alert = {
  alert(title: string, message?: string, buttons?: AlertBtn[]) {
    if (!buttons || buttons.length === 0) {
      window.alert(`${title}${message ? '\n\n' + message : ''}`);
      return;
    }
    if (buttons.length === 1) {
      window.alert(`${title}${message ? '\n\n' + message : ''}`);
      buttons[0].onPress?.();
      return;
    }
    // Para 2+ botões: usa confirm. Assume destructivo como confirmação.
    const destructive = buttons.find(b => b.style === 'destructive') || buttons[1];
    const cancel = buttons.find(b => b.style === 'cancel') || buttons[0];
    const ok = window.confirm(`${title}${message ? '\n\n' + message : ''}`);
    (ok ? destructive : cancel)?.onPress?.();
  }
};

// Altura da janela (para calcular posicionamento do "sheet")
const H = typeof window !== 'undefined' ? window.innerHeight : 800;
const SHEET_BOTTOM = Math.max(180, Math.floor(H * 0.42)); // sobe mais o sheet

class ComandaScreen extends React.Component<ComandaScreenProps, ComandaScreenState> {
  private socket: any = null;
  private _isMounted = false;
  private _timeouts = new Set<number>();
  private _onlineHandler?: () => void;
  private _offlineHandler?: () => void;

  constructor(props: ComandaScreenProps) {
    super(props);

    // WEB-ONLY: usamos apenas props.initial
    const params = (props.initial ?? {}) as Partial<ComandaInitialParams>;

    const {
      data = [],
      fcomanda = '',
      preco = 0,
      preco_total = 0,
      preco_pago = 0,
      username,
      nomes = [],
      ordem = 0,
      desconto = 0,
    } = params;

    this.state = {
      // dados
      username: String(username ?? props.username ?? ''),
      data: Array.isArray(data) ? data : [],
      dataGeral: Array.isArray(data) ? data : [],
      fcomanda,
      preco: Number(preco) || 0,
      preco_total: Number(preco_total) || 0,
      preco_pago: Number(preco_pago) || 0,
      ordem: Number(ordem) || 0,
      nomes: Array.isArray(nomes) ? nomes : [],
      desconto: Number(desconto) || 0,

      // edição
      guardarValores: [],
      showBotoes: false,
      itensAlterados: [],

      // filtros
      showLinha1e2: true,
      show_mais: false,

      // brinde
      Brinde: '',
      showBrindeModal: false,
      brindeFiltrado: [],
      brindeFiltradoBase: [],

      // alterar valor (desconto/caixinha legado)
      showAlterarValor: false,
      alterarValorCategoria: '',
      alterarValor: '',

      // pagamento unificado
      opcoesMetodoPag: ['credito', 'debito', 'dinheiro', 'pix'],
      payMode: false,
      paySelections: {},
      pagandoLoading: false,
      showPayModal: false,
      metodoPagSelecionado: null,
      aplicarDez: false,
      caixinhaValor: '',
      ondePaguei: '',
      valor_pago: '',

      // histórico de pagamentos
      showPagamentosModal: false,
      pagamentos: [],
      pagamentosLoading: false,

      // transferir comanda
      showTransferModal: false,
      transferDestino: '',
      transferLoading: false,

      // robustez
      isConnected: typeof navigator !== 'undefined' ? !!navigator.onLine : true,
      submitMsg: '',
      ordemBusy: false,
      undoBusy: false,
    };
  }

  // ---------- helpers ----------
  getCarrinho() {
    return this.props.carrinho || '';
  }

  safeSetState = (updater: any, cb?: () => void) => { if (this._isMounted) this.setState(updater, cb); };
  addTimeout = (fn: () => void, ms: number) => {
    const id = window.setTimeout(() => { this._timeouts.delete(id); fn(); }, ms);
    this._timeouts.add(id);
    return id;
  };
  clearAllTimeouts = () => { for (const id of this._timeouts) window.clearTimeout(id); this._timeouts.clear(); };

  normalize = (s: any) =>
    String(s || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();

  parseMoney = (v: any) => {
    const n = parseFloat(String(v ?? '').replace(',', '.'));
    return Number.isFinite(n) ? n : 0;
  };

  fmtBRL = (v: any) => {
    const n = parseFloat(String(v ?? '').replace(',', '.'));
    return `R$ ${Number.isFinite(n) ? n.toFixed(2) : '0.00'}`;
  };

  isServerReady = () => {
    if (!this.state.isConnected) {
      this.safeSetState({ submitMsg: 'Sem internet.' });
      return false;
    }
    if (!this.socket || !this.socket.connected) {
      this.safeSetState({ submitMsg: 'Sem conexão com o servidor.' });
      return false;
    }
    return true;
  };

  // aceita apenas números e UM ponto. Converte ',' -> '.'
  sanitizeDecimalInput = (raw: any) => {
    const s = String(raw ?? '').replace(/,/g, '.');
    let out = '', sawDot = false;
    for (const ch of s) {
      if (ch >= '0' && ch <= '9') { out += ch; continue; }
      if (ch === '.' && !sawDot) { out += ch; sawDot = true; }
    }
    return out;
  };

  // valor base exibido no modal: itens/parcial/tudo
  getModalBase = () => {
    const { ondePaguei, valor_pago, preco } = this.state;
    switch (ondePaguei) {
      case 'itens':
        return this.calcSelectedSubtotal();
      case 'parcial':
        return this.parseMoney(valor_pago);
      case 'tudo':
        return this.parseMoney(preco);
      default:
        return 0;
    }
  };

  // --- helpers de item
  keyForItem = (it: any, idx: number) => `${it?.id ?? ''}|${it?.pedido ?? ''}|${it?.extra ?? ''}|${idx}`;
  getInt = (v: any, d = 0) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; };
  getRestante = (it: any) => Math.max(0, this.getInt(it?.quantidade) - this.getInt(it?.quantidade_paga));
  getUnitPrice = (it: any) => {
    const q = parseFloat(it?.quantidade || '0');
    const p = parseFloat(String(it?.preco || '0').replace(',', '.'));
    if (!Number.isFinite(q) || q <= 0) return 0;
    return p / q;
  };

  // soma o subtotal selecionado (sem 10%)
  calcSelectedSubtotal = () => {
    const { data, paySelections } = this.state;
    let total = 0;
    for (let i = 0; i < data.length; i++) {
      const it = data[i];
      const key = this.keyForItem(it, i);
      const sel = this.getInt(paySelections[key], 0);
      if (sel > 0) total += sel * this.getUnitPrice(it);
    }
    return total;
  };

  // Lê e normaliza o campo opcoes (string JSON, array ou objeto)
  parseOpcoes = (raw: any) => {
    try {
      const j = typeof raw === 'string' ? JSON.parse(raw) : raw;
      let groups = Array.isArray(j) ? j : (j?.groups || j?.opcoes || j?.options || []);
      if (!Array.isArray(groups)) groups = [];
      return groups.map((g: any) => {
        let opts = g?.options ?? g?.opcoes ?? [];
        if (!Array.isArray(opts)) opts = [];
        return { options: opts };
      });
    } catch {
      return [];
    }
  };

  hasExtrasComValor = (it: any) => {
    const groups = this.parseOpcoes(it?.opcoes);
    for (const g of groups) {
      for (const o of (g.options || [])) {
        if (Number(o?.valor_extra || 0) > 0) return true;
      }
    }
    return false;
  };
  extrasLabel = (it: any) => {
    const groups = this.parseOpcoes(it?.opcoes);
    const list: string[] = [];
    for (const g of groups) {
      for (const o of (g.options || [])) {
        const v = Number(o?.valor_extra || 0);
        if (v > 0) list.push(`${o.nome} (+R$ ${v.toFixed(2).replace('.', ',')})`);
      }
    }
    return list.join(', ');
  };

  // ---------- lifecycle ----------
  async componentDidMount() {
    this._isMounted = true;

    // rede: events online/offline
    this._onlineHandler = () => this.safeSetState({ isConnected: true });
    this._offlineHandler = () => this.safeSetState({ isConnected: false });
    window.addEventListener('online', this._onlineHandler);
    window.addEventListener('offline', this._offlineHandler);
    this.safeSetState({ isConnected: typeof navigator !== 'undefined' ? !!navigator.onLine : true });

    // socket
    this.socket = getSocket();
    if (this.socket) {
      this.socket.on('preco', this.handlePreco);
      this.socket.on('comanda_deleted', this.handleComandaDeleted);
      this.socket.on('error', this.handleSocketError);
    }
  }

  componentWillUnmount() {
    this._isMounted = false;
    this.clearAllTimeouts();

    window.removeEventListener('online', this._onlineHandler || (() => {}));
    window.removeEventListener('offline', this._offlineHandler || (() => {}));

    if (this.socket) {
      this.socket.off('preco', this.handlePreco);
      this.socket.off('comanda_deleted', this.handleComandaDeleted);
      this.socket.off('error', this.handleSocketError);
    }
  }

  // --------- socket handlers ---------
  handlePreco = (data: any) => {
    if (!data) return;
    if (data.comanda === this.state.fcomanda) {
      const next: Partial<ComandaScreenState> = {
        data: data.dados ?? [],
        dataGeral: data.dados ?? [],
        preco: Number(data.preco_a_pagar ?? 0),
        preco_pago: Number(data.preco_pago ?? 0),
        preco_total: Number(data.preco_total ?? 0),
        desconto: Number(data.desconto ?? 0),
      };
      if (data.nomes) (next as any).nomes = data.nomes;
      this.safeSetState(next);
    }
  };
  handleComandaDeleted = ({ fcomanda }: any) => {
    if (fcomanda === this.state.fcomanda) {
      this.safeSetState({ data: [], dataGeral: [], nomes: [], preco: 0, preco_total: 0, preco_pago: 0 });
    }
  };
  handleSocketError = ({ message }: any) => console.error('Erro do servidor:', message);

  // --------- edição ---------
  aparecerBotoes = () => {
    const copia = JSON.parse(JSON.stringify(this.state.data || []));
    this.safeSetState({ guardarValores: copia, showBotoes: true, show_mais: false });
  };
  cancelar = () => {
    this.safeSetState({ data: this.state.guardarValores, itensAlterados: [], showBotoes: false });
  };
  confirmar = () => {
    if (!this.isServerReady()) return;
    const { itensAlterados, fcomanda } = this.state;
    this.socket.emit('atualizar_comanda', {
      itensAlterados,
      comanda: fcomanda,
      username: this.props.username ?? this.state.username,
      token: this.props.token,
      carrinho: this.getCarrinho(),
    });
    this.safeSetState({ showBotoes: false, itensAlterados: [] });
  };

  apagarPedidos = (index: number) => {
    const arr = [...this.state.data];
    const it = { ...arr[index] };
    const q = Math.max(0, this.getInt(it.quantidade));
    if (q <= 0) return;
    const pu = this.getUnitPrice(it);
    it.preco = (this.parseMoney(it.preco) - pu).toFixed(2);
    it.quantidade = String(q - 1);
    arr[index] = it;
    this.safeSetState({ data: arr });
    this.atualizarItensAlterados(it);
  };
  adicionarPedidos = (index: number) => {
    const arr = [...this.state.data];
    const it = { ...arr[index] };
    const q = Math.max(0, this.getInt(it.quantidade));
    const pu = this.getUnitPrice(it);
    it.preco = (this.parseMoney(it.preco) + pu).toFixed(2);
    it.quantidade = String(q + 1);
    arr[index] = it;
    this.safeSetState({ data: arr });
    this.atualizarItensAlterados(it);
  };
  atualizarItensAlterados = (itemAtualizado: any) => {
    this.safeSetState((prev: ComandaScreenState) => {
      const unit = this.parseMoney(itemAtualizado.preco) / Math.max(1, this.getInt(itemAtualizado.quantidade, 1));
      const nova = [...prev.itensAlterados];
      const idx = nova.findIndex(
        (i: any) => i.pedido === itemAtualizado.pedido &&
          (this.parseMoney(i.preco) / Math.max(1, this.getInt(i.quantidade, 1))) === unit
      );
      if (idx >= 0) nova[idx] = itemAtualizado; else nova.push(itemAtualizado);
      return { itensAlterados: nova } as any;
    });
  };

  // --------- brindes ---------
  changeBrinde = (rawInput: string) => {
    const base = Array.isArray(this.state.brindeFiltradoBase) ? this.state.brindeFiltradoBase : [];
    const raw = String(rawInput ?? '');
    const qNorm = this.normalize(raw);
    const words = qNorm.trim().split(/\s+/).filter(Boolean);

    if (words.length === 0) {
      this.safeSetState({ brindeFiltrado: [], Brinde: raw });
      return;
    }

    const starts: string[] = [], allWords: string[] = [], includes: string[] = [];
    for (const it of base) {
      const nameNorm = this.normalize(it);
      if (!nameNorm) continue;

      if (words.some(w => nameNorm.startsWith(w))) { starts.push(it); continue; }
      if (words.length > 1 && words.every(w => nameNorm.includes(w))) { allWords.push(it); continue; }
      if (words.some(w => nameNorm.includes(w))) includes.push(it);
    }

    const seen = new Set<string>(), resultado: string[] = [];
    for (const bucket of [starts, allWords, includes]) {
      for (const it of bucket) { if (!seen.has(it)) { seen.add(it); resultado.push(it); } }
    }

    this.safeSetState({ brindeFiltrado: resultado, Brinde: raw });
  };

  confirmarBrinde = () => {
    if (!this.isServerReady()) return;
    const { fcomanda, Brinde, username } = this.state;
    if (!Brinde.trim()) {
      Alert.alert('Atenção', 'Digite o brinde.');
      return;
    }
    const horario = new Date().toTimeString().slice(0, 5);
    this.socket.emit('insert_order', {
      comanda: fcomanda,
      pedidosSelecionados: [Brinde],
      quantidadeSelecionada: [1],
      preco: true,
      username,
      horario,
      extraSelecionados: [''],
      carrinho: this.getCarrinho(),
    });
    this.safeSetState({ Brinde: '' });
  };

  // --------- ordem / filtros ---------
  atualizarOrdem = (sinal: '+' | '-', ordem: number) => {
    if (sinal === '-' && this.state.ordem > 0) {
      this.setState({ ordem: ordem - 1 });
      fetch(`${API_URL}/pegar_pedidos`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ comanda: this.state.fcomanda, ordem: ordem - 1, carrinho: this.getCarrinho() }),
        })
        .then(r => r.json())
        .then(data => {
          if (data?.data) this.setState({
            data: data.data,
            dataGeral: data.data,
            preco: Number(data.preco) || 0
          });
        })
        .catch(console.error);
    }
    else if (sinal === '+') {
      this.setState({ ordem: ordem + 1 });
      fetch(`${API_URL}/pegar_pedidos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comanda: this.state.fcomanda, ordem: ordem + 1, carrinho: this.getCarrinho() }),
      })
        .then(r => r.json())
        .then(data => {
          if (data?.data) this.setState({
            data: data.data,
            dataGeral: data.data,
            preco: Number(data.preco) || 0
          });
        })
        .catch(console.error);
    }
  };

  desfazerPagamento = () => {
    if (this.state.undoBusy) return;
    if (!this.isServerReady()) return;
    this.safeSetState({ undoBusy: true, submitMsg: '' });
    this.socket.emit('desfazer_pagamento', {
      comanda: this.state.fcomanda,
      preco: this.state.preco,
      ordem: this.state.ordem,
      carrinho: this.getCarrinho(),
    });
    // libera após pequeno intervalo; backend enviará 'preco' com estado atualizado
    this.addTimeout(() => this.safeSetState({ ordem: 0, undoBusy: false }), 1200);
  };

  dataComnpleto = () => this.safeSetState({ data: this.state.dataGeral });
  filtrarPorNome = (nome: string) => this.safeSetState({ data: this.state.dataGeral.filter((i: any) => i.nome === nome) });

  confirmarValor = () => {
    if (!this.isServerReady()) return;
    const { alterarValor, alterarValorCategoria, fcomanda } = this.state;
    this.socket.emit('alterarValor', {
      valor: alterarValor,
      categoria: alterarValorCategoria,
      comanda: fcomanda,
      carrinho: this.getCarrinho(),
    });
    this.safeSetState({ showAlterarValor: false, alterarValor: '', alterarValorCategoria: '' });
  };

  // --------- Pagamentos: carregar / excluir ---------
  openPagamentos = async () => {
    if (!this.state.isConnected) { Alert.alert('Sem internet', 'Conecte-se para ver pagamentos.'); return; }
    this.safeSetState({ showPagamentosModal: true, pagamentosLoading: true });

    try {
      const resp = await fetch(`${API_URL}/pegar_pagamentos_comanda`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comanda: this.state.fcomanda, carrinho: this.getCarrinho() }),
      });
      const json = await resp.json();
      const pagamentos = Array.isArray(json) ? json : (json?.pagamentos || json?.data || []);
      this.safeSetState({ pagamentos, pagamentosLoading: false });
    } catch {
      this.safeSetState({ pagamentosLoading: false });
      Alert.alert('Erro', 'Não foi possível carregar os pagamentos.');
    }
  };
  closePagamentosModal = () => this.safeSetState({ showPagamentosModal: false, pagamentos: [] });

  excluirPagamento = (pagamento: Pagamento) => {
    const id = pagamento?.id ?? pagamento?.id_pagamento ?? pagamento?.pagamento_id;
    if (!id) return;
    Alert.alert(
      'Excluir pagamento',
      'Tem certeza que deseja excluir este pagamento?',
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Excluir', style: 'destructive', onPress: () => this._doExcluirPagamento(id) },
      ],
    );
  };
  _doExcluirPagamento = async (pagamentoId: string | number) => {
    if (!this.state.isConnected) { Alert.alert('Sem internet', 'Conecte-se para excluir.'); return; }
    try {
      const resp = await fetch(`${API_URL}/excluir_pagamento`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comanda: this.state.fcomanda, pagamento_id: pagamentoId, carrinho: this.getCarrinho() }),
      });
      if (!resp.ok) throw new Error('HTTP');
      this.safeSetState((prev: ComandaScreenState) => ({
        pagamentos: prev.pagamentos.filter((p: any) => {
          const idP = p?.id ?? p?.id_pagamento ?? p?.pagamento_id;
          return idP !== pagamentoId;
        }),
      }));
      const carrinho = this.getCarrinho();
      this.socket?.emit('faturamento', { emitir: true, carrinho });
    } catch {
      Alert.alert('Erro', 'Não foi possível excluir o pagamento.');
    }
  };

  // === TRANSFERIR COMANDA: handlers ===
  abrirTransferModal = () => this.safeSetState({ showTransferModal: true, transferDestino: '' });
  fecharTransferModal = () => this.safeSetState({ showTransferModal: false, transferDestino: '' });

  solicitarTransferencia = () => {
    const { transferDestino, fcomanda } = this.state;
    const destino = String(transferDestino || '').trim();
    if (!destino) return Alert.alert('Atenção', 'Informe a comanda de destino.');
    if (destino === String(fcomanda)) return Alert.alert('Atenção', 'Destino deve ser diferente.');
    Alert.alert(
      'Transferir comanda',
      `Transferir a comanda "${fcomanda}" para "${destino}"?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Transferir', style: 'destructive', onPress: this._executarTransferencia },
      ]
    );
  };

  _executarTransferencia = async () => {
    if (!this.state.isConnected) { Alert.alert('Sem internet', 'Conecte-se para transferir.'); return; }
    const { fcomanda, transferDestino } = this.state;
    try {
      this.safeSetState({ transferLoading: true });

      const resp = await fetch(`${API_URL}/transferir_comanda`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          comanda_origem: fcomanda,
          comanda_destino: transferDestino,
          carrinho: this.getCarrinho(),
        }),
      });

      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      await resp.json().catch(() => null);

      const nova = String(transferDestino);
      this.safeSetState({ fcomanda: nova, ordem: 0, showTransferModal: false, transferDestino: '' });
      const carrinho = this.getCarrinho();
      this.socket?.emit('faturamento', { emitir: true, carrinho });

      fetch(`${API_URL}/pegar_pedidos`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comanda: nova, ordem: 0, carrinho: this.getCarrinho() }),
      })
        .then(r => r.json())
        .then(data => {
          if (!this._isMounted) return;
          if (data?.data) {
            this.safeSetState({
              data: data.data,
              dataGeral: data.data,
              preco: Number(data.preco) || this.state.preco,
              preco_total: Number(data.preco_total ?? this.state.preco_total) || 0,
              preco_pago: Number(data.preco_pago ?? this.state.preco_pago) || 0,
            });
          }
        })
        .catch(() => { /* silencioso */ });

      Alert.alert('Sucesso', 'Comanda transferida com sucesso.');
    } catch (e) {
      Alert.alert('Erro', 'Não foi possível transferir a comanda.');
    } finally {
      this.safeSetState({ transferLoading: false });
    }
  };

  selecionarOpcao = (item: string) => {
    this.safeSetState({ show_mais: false });

    if (item === 'Editar') {
      if (this.state.payMode) this.safeSetState({ payMode: false, paySelections: {} });
      this.aparecerBotoes();
      return;
    }
    if (item === 'desconto') {
      this.safeSetState({ alterarValorCategoria: item, showAlterarValor: true });
      return;
    }
    if (item === 'Brinde') {
      if (!this.state.brindeFiltradoBase || this.state.brindeFiltradoBase.length === 0) {
        this.socket?.once('respostaCardapio', (data: any) => {
          if (data?.dataCardapio) {
            this.safeSetState({ brindeFiltradoBase: data.dataCardapio.map((i: any) => i.item) });
          }
        });
        const carrinho = this.getCarrinho();
        this.socket?.emit('getCardapio', { emitir: false, carrinho });
      }
      this.safeSetState({ showBrindeModal: true, Brinde: '', brindeFiltrado: [] });
      return;
    }
    if (item === 'Pagamentos') { this.openPagamentos(); return; }
    if (item === 'Transferir comanda') { this.abrirTransferModal(); return; }
  };

  mostrarOpcoes = () => this.safeSetState({ show_mais: true, showAlterarValor: false });

  // --- entrar/sair do modo de pagamento
  enterPayMode = () => this.safeSetState({ payMode: true, paySelections: {}, showBotoes: false, showLinha1e2: false });
  exitPayMode = () => this.safeSetState({ payMode: false, paySelections: {}, showLinha1e2: true });

  // --- selecionar qtd p/ item
  incPay = (idx: number) => {
    const it = this.state.data[idx];
    const restante = this.getRestante(it);
    if (restante <= 0) return;
    const key = this.keyForItem(it, idx);
    const atual = this.state.paySelections[key] || 0;
    if (atual < restante) {
      this.safeSetState({ paySelections: { ...this.state.paySelections, [key]: atual + 1 } });
    }
  };
  decPay = (idx: number) => {
    const it = this.state.data[idx];
    const key = this.keyForItem(it, idx);
    const atual = this.state.paySelections[key] || 0;
    if (atual > 0) {
      const novo: Record<string, number> = { ...this.state.paySelections, [key]: atual - 1 };
      if (novo[key] === 0) delete novo[key];
      this.safeSetState({ paySelections: novo });
    }
  };

  alertaConfirmPayItems = () => {
    const subtotal = this.calcSelectedSubtotal();
    if (subtotal <= 0) {
      Alert.alert('Atenção', 'Selecione ao menos 1 unidade para pagar.');
      return;
    }
    this.safeSetState({
      showPayModal: true,
      ondePaguei: 'itens',
      metodoPagSelecionado: null,
      aplicarDez: false,
      caixinhaValor: '',
    });
  };

  fecharPayModal = () => {
    if (this.state.pagandoLoading) return;
    this.safeSetState({
      showPayModal: false,
      metodoPagSelecionado: null,
      aplicarDez: false,
      caixinhaValor: '',
    });
  };

  confirmarPagamentoComEscolhas = () => {
    const { metodoPagSelecionado, ondePaguei } = this.state;
    if (!this.isServerReady()) return;
    if (!metodoPagSelecionado) {
      Alert.alert('Atenção', 'Selecione um método de pagamento.');
      return;
    }
    if (ondePaguei === 'itens') this.confirmPayItems();
    else if (ondePaguei === 'parcial') this.confirmarParcialUnified();
    else if (ondePaguei === 'tudo') this.confirmarTudoPagoUnified();
  };

  confirmarParcialUnified = () => {
    const {
      valor_pago, fcomanda, preco,
      metodoPagSelecionado, caixinhaValor, aplicarDez
    } = this.state;

    const valorNum = this.parseMoney(valor_pago);
    const max = this.parseMoney(preco);
    if (!valorNum || valorNum <= 0 || valorNum > max) {
      Alert.alert('Atenção', 'Insira um valor válido para pagamento parcial.');
      return;
    }

    const base = valorNum;
    const dez_por_cento = aplicarDez ? base * 0.10 : null;

    try {
      this.safeSetState({ pagandoLoading: true });
      const carrinho = this.getCarrinho();
      this.socket.emit('faturamento', { emitir: true, carrinho });
      this.socket.emit('pagar_parcial', {
        valor_pago: valorNum,
        fcomanda,
        caixinha: this.parseMoney(caixinhaValor) || null,
        dez_por_cento: dez_por_cento,
        forma_de_pagamento: metodoPagSelecionado,
        carrinho,
      });

      // feedback imediato; backend enviará 'preco'
      this.safeSetState((prev: ComandaScreenState) => ({
        preco: Math.max(0, this.parseMoney(prev.preco) - valorNum),
        valor_pago: '',
        showPayModal: false,
        metodoPagSelecionado: null,
        aplicarDez: false,
        caixinhaValor: '',
      }));
    } catch {
      Alert.alert('Erro', 'Não foi possível pagar parcialmente agora.');
    } finally {
      this.safeSetState({ pagandoLoading: false });
    }
  };

  confirmarTudoPagoUnified = () => {
    const { fcomanda, preco, metodoPagSelecionado, caixinhaValor, aplicarDez } = this.state;
    const base = this.parseMoney(preco);
    if (!(base > 0)) { Alert.alert('Atenção', 'Não há valor para pagar.'); return; }

    const dez_por_cento = aplicarDez ? base * 0.10 : null;

    try {
      this.safeSetState({ pagandoLoading: true });
      this.socket.emit('delete_comanda', {
        fcomanda,
        valor_pago: base,
        caixinha: this.parseMoney(caixinhaValor) || null,
        dez_por_cento: dez_por_cento,
        forma_de_pagamento: metodoPagSelecionado,
        carrinho: this.getCarrinho(),
      });

      this.safeSetState({
        showPayModal: false,
        metodoPagSelecionado: null,
        aplicarDez: false,
        caixinhaValor: '',
        valor_pago: '',
      });
    } catch {
      Alert.alert('Erro', 'Não foi possível finalizar agora.');
    } finally {
      this.safeSetState({ pagandoLoading: false });
    }
  };

  // --- pagar itens selecionados
  confirmPayItems = () => {
    if (!this.isServerReady()) return;
    const { paySelections, data, fcomanda, aplicarDez, metodoPagSelecionado, caixinhaValor } = this.state;
    const keys = Object.keys(paySelections);
    if (keys.length === 0) {
      Alert.alert('Atenção', 'Selecione ao menos 1 unidade para pagar.');
      return;
    }

    const itens: any[] = [];
    for (let i = 0; i < data.length; i++) {
      const it = data[i];
      const key = this.keyForItem(it, i);
      const qtd = this.getInt(paySelections[key], 0);
      if (qtd > 0) {
        itens.push({
          index: i,
          id: it?.id ?? null,
          pedido: it?.pedido ?? '',
          extra: it?.extra ?? '',
          quantidade: qtd,
        });
      }
    }
    if (itens.length === 0) {
      Alert.alert('Atenção', 'Nada selecionado para pagar.');
      return;
    }

    try {
      this.safeSetState({ pagandoLoading: true });

      const carrinho = this.getCarrinho();
      this.socket.emit('pagar_itens', {
        comanda: fcomanda,
        itens,
        forma_de_pagamento: metodoPagSelecionado,
        aplicarDez,
        caixinha: this.parseMoney(caixinhaValor) || null,
        carrinho,
      });

      this.safeSetState({
        payMode: false,
        paySelections: {},
        showPayModal: false,
        metodoPagSelecionado: null,
        showLinha1e2: true,
        aplicarDez: false,
        caixinhaValor: '',
      });
    } catch {
      Alert.alert('Erro', 'Não foi possível pagar os itens agora.');
    } finally {
      this.safeSetState({ pagandoLoading: false });
    }
  };

  // --------- modais ---------
  renderPagamentosModal() {
    const { showPagamentosModal, pagamentos, pagamentosLoading } = this.state;
    if (!showPagamentosModal) return null;

    const money = (v: any) => `R$ ${this.parseMoney(v).toFixed(2)}`;

    return (
      <Modal
        visible={showPagamentosModal}
        onRequestClose={this.closePagamentosModal}
      >
        <div style={styles.bigModal}>
          <div style={styles.bigModalTitle}>Pagamentos da Comanda</div>

          {pagamentosLoading ? (
            <div style={styles.centerBox}>
              <ActivityIndicator />
              <div style={{ marginTop: 8, color: '#374151' }}>Carregando...</div>
            </div>
          ) : pagamentos.length === 0 ? (
            <div style={styles.centerBox}>
              <div style={{ color: '#6b7280' }}>Nenhum pagamento encontrado.</div>
            </div>
          ) : (
            <div style={{ maxHeight: 360, overflowY: 'auto' }}>
              {pagamentos.map((p: any, idx: number) => {
                const id = p?.id ?? p?.id_pagamento ?? p?.pagamento_id;
                const valor = p?.valor ?? p?.valor_pago ?? p?.total ?? 0;
                const forma = p?.forma_de_pagamento ?? p?.metodo ?? p?.forma ?? '—';
                const caixinha = p?.caixinha ?? 0;
                const quando = p?.data ?? p?.criado_em ?? p?.horario ?? '';

                return (
                  <div key={`${id ?? idx}`} style={styles.paymentItem}>
                    <div style={styles.paymentMainRow}>
                      <div style={styles.paymentLeft}>
                        <div style={styles.paymentValue}>{money(valor)}</div>
                        {!!caixinha && <div style={styles.paymentMeta}>Caixinha: {money(caixinha)}</div>}
                        <div style={styles.paymentMeta}>Forma: {String(forma).toUpperCase()}</div>
                        {!!quando && <div style={styles.paymentMeta}>Quando: {quando}</div>}
                        {!!id && <div style={styles.paymentMetaMuted}>ID: {id}</div>}
                      </div>
                      {!!id && (
                        <button style={styles.paymentDeleteBtn} onClick={() => this.excluirPagamento(p)}>
                          <span style={styles.paymentDeleteText as any}>Excluir</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div style={s(styles.miniActions, { marginTop: 16 })}>
            <button style={s(styles.miniBtn, styles.miniBtnPrimary)} onClick={this.closePagamentosModal}>
              <span style={styles.miniBtnPrimaryText as any}>Fechar</span>
            </button>
          </div>
        </div>
      </Modal>
    );
  }

  renderOpcoesModal() {
    const { show_mais } = this.state;
    const opcoes = ['Editar', 'desconto', 'Brinde', 'Pagamentos', 'Transferir comanda'];
    if (!show_mais) return null;
    return (
      <div style={styles.sheetWrap}>
        <div style={styles.sheetBackdrop} onClick={() => this.safeSetState({ show_mais: false })} />
        <div style={s(styles.sheetContainer, { bottom: SHEET_BOTTOM })}>
          <div style={styles.sheetHandle} />
          <div style={styles.sheetTitle}>Opções</div>

          {opcoes.map((label, idx) => (
            <button
              key={idx}
              style={s(styles.sheetItem, { background: 'transparent', border: 'none', width: '100%' })}
              onClick={() => this.selecionarOpcao(label)}
            >
              <div style={styles.sheetItemText}>{label}</div>
            </button>
          ))}

          <button
            style={s(styles.sheetCancel as any, { border: 'none', width: '100%' })}
            onClick={() => this.safeSetState({ show_mais: false })}
          >
            <div style={styles.sheetCancelText}>Fechar</div>
          </button>
        </div>
      </div>
    );
  }

  renderAlterarValorModal() {
    const { showAlterarValor, alterarValor, alterarValorCategoria } = this.state;
    if (!showAlterarValor) return null;
    return (
      <Modal visible={showAlterarValor} onRequestClose={() => this.safeSetState({ showAlterarValor: false })}>
        <div style={styles.miniModal}>
          <div style={styles.miniModalTitle}>
            {alterarValorCategoria === 'caixinha' ? 'Caixinha' : 'Desconto'}
          </div>
          <input
            placeholder="Valor"
            onChange={(e) => this.safeSetState({ alterarValor: this.sanitizeDecimalInput(e.target.value) })}
            value={alterarValor}
            style={styles.miniInput}
            inputMode="decimal"
          />
          <div style={styles.miniActions}>
            <button
              style={s(styles.miniBtn, styles.miniBtnGhost)}
              onClick={() => this.safeSetState({ showAlterarValor: false, alterarValor: '' })}
            >
              <span style={styles.miniBtnGhostText as any}>Cancelar</span>
            </button>
            <button style={s(styles.miniBtn, styles.miniBtnPrimary)} onClick={this.confirmarValor}>
              <span style={styles.miniBtnPrimaryText as any}>OK</span>
            </button>
          </div>
        </div>
      </Modal>
    );
  }

  renderBrindeModal() {
    const { showBrindeModal, Brinde, brindeFiltrado = [] } = this.state;
    if (!showBrindeModal) return null;
    return (
      <Modal visible={showBrindeModal} onRequestClose={() => this.safeSetState({ showBrindeModal: false })}>
        <div style={styles.miniModal}>
          <div style={styles.miniModalTitle}>Brinde</div>
          <input
            placeholder="Buscar brinde"
            onChange={(e) => this.changeBrinde(e.target.value)}
            value={Brinde}
            style={styles.miniInput}
            autoComplete="off"
            spellCheck={false}
          />
          {brindeFiltrado.length > 0 && (
            <div style={styles.sugestoesBox}>
              {brindeFiltrado.slice(0, 5).map((sug, i) => (
                <button
                  key={`${sug}-${i}`}
                  style={s(styles.sugestaoItem as any, { background: 'white', border: 'none', textAlign: 'left', width: '100%' })}
                  onClick={() => this.safeSetState({ Brinde: sug, brindeFiltrado: [] })}
                >
                  <div style={styles.sugestaoText}>{sug}</div>
                </button>
              ))}
            </div>
          )}
          <div style={styles.miniActions}>
            <button
              style={s(styles.miniBtn, styles.miniBtnGhost)}
              onClick={() => this.safeSetState({ showBrindeModal: false, Brinde: '', brindeFiltrado: [] })}
            >
              <span style={styles.miniBtnGhostText as any}>Cancelar</span>
            </button>
            <button
              style={s(styles.miniBtn, styles.miniBtnPrimary)}
              onClick={() => { this.confirmarBrinde(); this.safeSetState({ showBrindeModal: false, brindeFiltrado: [] }); }}
            >
              <span style={styles.miniBtnPrimaryText as any}>OK</span>
            </button>
          </div>
        </div>
      </Modal>
    );
  }

  // === TRANSFERIR COMANDA: modal ===
  renderTransferModal() {
    const { showTransferModal, transferDestino, fcomanda, transferLoading } = this.state;
    if (!showTransferModal) return null;

    return (
      <Modal visible={showTransferModal} onRequestClose={this.fecharTransferModal}>
        <div style={styles.miniModal}>
          <div style={styles.miniModalTitle}>Transferir comanda</div>

          <div style={styles.transferRow}>
            <div style={styles.transferBox}>
              <div style={styles.transferLabel}>Atual</div>
              <div style={styles.transferValue}>{String(fcomanda)}</div>
            </div>

            <div style={styles.transferArrow}>→</div>

            <div style={s(styles.transferBox, { flex: 1 })}>
              <div style={styles.transferLabel}>Destino</div>
              <input
                style={s(styles.miniInput, { marginTop: 6 })}
                placeholder="Número ou nome da comanda"
                value={transferDestino}
                onChange={(e) => this.safeSetState({ transferDestino: e.target.value })}
              />
            </div>
          </div>

          <div style={styles.miniActions}>
            <button
              style={s(styles.miniBtn, styles.miniBtnGhost)}
              onClick={this.fecharTransferModal}
              disabled={transferLoading}
            >
              <span style={styles.miniBtnGhostText as any}>Cancelar</span>
            </button>

            <button
              style={s(styles.miniBtn, styles.miniBtnPrimary)}
              onClick={this.solicitarTransferencia}
              disabled={transferLoading}
            >
              {transferLoading ? (
                <ActivityIndicator />
              ) : (
                <span style={styles.miniBtnPrimaryText as any}>Transferir comanda</span>
              )}
            </button>
          </div>
        </div>
      </Modal>
    );
  }

  // --------- UI: nomes / tabela / resumo ---------
  renderNomesRow() {
    const { nomes, ordem } = this.state;
    if (!Array.isArray(nomes) || nomes.length === 0 || ordem !== 0) return null;
    return (
      <div style={styles.nomeRow}>
        <button style={s(styles.chipBtn, styles.chipNeutral)} onClick={this.dataComnpleto}><span style={styles.chipText as any}>Geral</span></button>
        {nomes.map((n: any, i: number) => (
          <div key={i} style={styles.nomeButtonWrapper}>
            <button style={s(styles.chipBtn, styles.chipNeutral)} onClick={() => this.filtrarPorNome(n.nome)}>
              <span style={styles.chipText as any}>{n.nome}</span>
            </button>
          </div>
        ))}
        <button style={s(styles.chipBtn, styles.chipWarn)} onClick={() => this.filtrarPorNome('-1')}><span style={styles.chipText as any}>Sem Nome</span></button>
      </div>
    );
  }

  renderTabelaPedidos() {
    const { data, showBotoes, payMode, paySelections } = this.state;
    if (!data || data.length === 0) return null;

    const naoPagos: any[] = [];
    const pagos: any[] = [];

    for (let i = 0; i < data.length; i++) {
      const it = data[i];
      const qtd = this.getInt(it?.quantidade);
      const qtdPaga = this.getInt(it?.quantidade_paga);
      const restante = Math.max(0, qtd - qtdPaga);

      if (!qtd) continue;
      if (qtdPaga > 0) pagos.push({ it, index: i, qtdPaga });
      if (restante > 0) naoPagos.push({ it, index: i, restante });
    }

    const RowNaoPago: React.FC<{ it: any; index: number; restante: number }> = ({ it, index, restante }) => {
      const key = this.keyForItem(it, index);
      const sel = paySelections[key] || 0;

      return (
        <div key={`np-${index}`} style={styles.tableRow}>
          <div style={{ flex: 2 }}>
            <div style={styles.itemText as any}>
              {it.pedido}
            </div>
            {this.hasExtrasComValor(it) && (
              <div style={styles.itemExtrasText as any}>
                Opções: {this.extrasLabel(it)}
              </div>
            )}
          </div>

          <div style={s(styles.itemText as any, { flex: 0.8, textAlign: 'center' as const })}>{restante}</div>
          <div style={s(styles.itemText as any, { flex: 0.9, textAlign: 'right' as const })}>{it.preco}</div>

          {showBotoes && (
            <div style={styles.editControls}>
              <button style={s(styles.miniSquare, styles.danger)} onClick={() => this.apagarPedidos(index)}>
                <span style={styles.miniSquareText as any}>-</span>
              </button>
              <button style={s(styles.miniSquare, styles.primary)} onClick={() => this.adicionarPedidos(index)}>
                <span style={styles.miniSquareText as any}>+</span>
              </button>
            </div>
          )}

          {payMode && (
            <div style={styles.payControls}>
              <button style={s(styles.payBtn, styles.payMinus)} onClick={() => this.decPay(index)}>
                <span style={styles.payBtnText as any}>-</span>
              </button>
              <div style={styles.payQtyText}>{sel || 0}</div>
              <button style={s(styles.payBtn, styles.payPlus)} onClick={() => this.incPay(index)}>
                <span style={styles.payBtnText as any}>+</span>
              </button>
            </div>
          )}
        </div>
      );
    };

    const RowPago: React.FC<{ it: any; index: number; qtdPaga: number }> = ({ it, index, qtdPaga }) => (
      <div key={`pg-${index}`} style={styles.tableRow}>
        <div style={{ flex: 2 }}>
          <div style={styles.itemText as any}>
            {it.pedido} {it.extra}
          </div>
          {this.hasExtrasComValor(it) && (
            <div style={styles.itemExtrasText as any}>
              Opções: {this.extrasLabel(it)}
            </div>
          )}
        </div>

        <div style={s(styles.itemText as any, { flex: 0.8, textAlign: 'center' as const })}>{qtdPaga}</div>
        <div style={s(styles.itemText as any, { flex: 0.9, textAlign: 'right' as const, color: '#059669' })}>
          Pago
        </div>
      </div>
    );

    return (
      <div>
        {pagos.length > 0 && (
          <>
            <div style={s(styles.sectionTitle as any, { marginTop: 12 })}>Pagos</div>
            {pagos.map(({ it, index, qtdPaga }) => (
              <RowPago key={`pg-${index}`} it={it} index={index} qtdPaga={qtdPaga} />
            ))}
          </>
        )}

        {naoPagos.length > 0 && (
          <>
            <div style={styles.sectionTitle as any}>Não pagos</div>
            {naoPagos.map(({ it, index, restante }) => (
              <RowNaoPago key={`np-${index}`} it={it} index={index} restante={restante} />
            ))}
          </>
        )}
      </div>
    );
  }

  // abre o modal de pagamento e define o contexto
  abrirModalPagamento = (tipo: 'tudo' | 'parcial' | 'itens') => {
    this.safeSetState({
      showPayModal: true,
      ondePaguei: tipo, // 'tudo' | 'parcial' | 'itens'
      metodoPagSelecionado: null,
      aplicarDez: false,
      caixinhaValor: '',
    });
  };

  // resumo + botões de ação
  renderResumoPagamento() {
    const {
      ordem, preco_pago, preco, preco_total, valor_pago,
      showLinha1e2, data, undoBusy
    } = this.state;

    const blocoResumo =
      ordem !== 0 ? (
        <div style={{ marginTop: 10 }}>
          {ordem === 1 && data && data.length > 0 ? (
            <button
              style={s(styles.chipBtn, styles.chipDanger)}
              onClick={this.desfazerPagamento}
              disabled={undoBusy}
            >
              <span style={styles.chipText as any}>{undoBusy ? 'Processando...' : 'Desfazer Último Pagamento'}</span>
            </button>
          ) : (
            <div style={{ color: '#6b7280' }}>Não é possível desfazer o pagamento</div>
          )}
        </div>
      ) : (
        <div>
          <div style={styles.summaryBox}>
            <div style={styles.paymentRow}>
              <div style={styles.paymentBlock}>
                <div style={styles.totalText as any}>Restante</div>
                <div style={styles.totalValue as any}>{Number(preco || 0).toFixed(2)}</div>
              </div>
              <div style={styles.paymentBlock}>
                <div style={styles.totalText as any}>Pago</div>
                <div style={styles.totalValue as any}>{Number(preco_pago || 0).toFixed(2)}</div>
              </div>
              <div style={styles.paymentBlock}>
                <div style={styles.totalText as any}>Total</div>
                <div style={styles.totalValue as any}>{Number(preco_total || 0).toFixed(2)}</div>
              </div>

              {!!this.state.desconto && this.state.desconto !== 0 && (
                <div style={styles.paymentBlock}>
                  <div style={styles.totalText as any}>Desconto</div>
                  <div style={styles.totalValue as any}>{Number(this.state.desconto).toFixed(2)}</div>
                </div>
              )}
            </div>

            {showLinha1e2 && (
              <>
                <div style={styles.parcialRow}>
                  <input
                    placeholder="Quanto?"
                    onChange={(e) => this.safeSetState({ valor_pago: this.sanitizeDecimalInput(e.target.value) })}
                    value={valor_pago}
                    style={styles.input}
                    inputMode="decimal"
                  />
                  <button
                    style={s(styles.chipBtn, styles.primary, { minWidth: 140 })}
                    onClick={() => this.abrirModalPagamento('parcial')}
                  >
                    <span style={styles.chipText as any}>Pagar Parcial</span>
                  </button>
                </div>

                <div style={s(styles.buttonRow, { marginTop: 20 })}>
                  <button
                    style={s(styles.chipBtn, styles.primary, { minWidth: 160 })}
                    onClick={() => this.abrirModalPagamento('tudo')}
                  >
                    <span style={styles.chipText as any}>Pagar Restante</span>
                  </button>

                  <button
                    style={s(styles.chipBtn, styles.primary, { minWidth: 160 })}
                    onClick={this.enterPayMode}
                  >
                    <span style={styles.chipText as any}>Pagar Itens</span>
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      );

    return (
      <div>
        {blocoResumo}
      </div>
    );
  }

  // --------- render ---------
  render() {
    const { fcomanda, showBotoes, payMode, show_mais, isConnected, submitMsg } = this.state;

    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#fff' }}>
        <div style={styles.container}>
          {!isConnected && (
            <div style={styles.offlineBanner}>
              <span style={styles.offlineText as any}>Sem internet</span>
            </div>
          )}

          {/* HEADER */}
          <div style={styles.headerRow}>
            <div
              style={s(styles.title as any, {
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis'
              })}
              title={`Comanda ${fcomanda}`}
            >
              Comanda {fcomanda}
            </div>

            <div style={styles.headerControls}>
              {payMode ? (
                <div style={styles.inlineActions}>
                  <button style={s(styles.chipBtn, styles.chipDanger)} onClick={this.exitPayMode}>
                    <span style={styles.chipText as any}>Cancelar</span>
                  </button>
                  <button
                    style={s(styles.chipBtn, styles.primary)}
                    onClick={this.alertaConfirmPayItems}
                    disabled={this.state.pagandoLoading}
                  >
                    <span style={styles.chipText as any}>
                      {this.state.pagandoLoading ? 'Enviando...' : 'Confirmar Pagamento'}
                    </span>
                  </button>
                </div>
              ) : (
                <>
                  {!showBotoes ? (
                    <>
                      {/* Navegação de ordem */}
                      {!this.state.payMode && !this.state.showBotoes && (
                        <div style={s(styles.navGroup, { alignSelf: 'center', marginTop: 8 })}>
                          <button
                            style={styles.navBtn as any}
                            onClick={() => this.atualizarOrdem('+', this.state.ordem)}
                          >
                            <span style={styles.navBtnText as any}>{'<'}</span>
                          </button>

                          <div style={styles.ordemText}>{this.state.ordem}</div>

                          <button
                            style={styles.navBtn as any}
                            onClick={() => this.atualizarOrdem('-', this.state.ordem)}
                          >
                            <span style={styles.navBtnText as any}>{'>'}</span>
                          </button>
                        </div>
                      )}
                      {this.renderOpcoesModal()}
                      {!show_mais && this.state.ordem === 0 && (
                        <button style={styles.fab as any} onClick={this.mostrarOpcoes} aria-label="Mais opções">
                          <span style={styles.fabPlus as any}>...</span>
                        </button>
                      )}
                    </>
                  ) : (
                    <div style={styles.inlineActions}>
                      <button style={s(styles.chipBtn, styles.chipDanger)} onClick={this.cancelar}>
                        <span style={styles.chipText as any}>Cancelar</span>
                      </button>
                      <button style={s(styles.chipBtn, styles.primary)} onClick={this.confirmar}>
                        <span style={styles.chipText as any}>Confirmar</span>
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {this.renderNomesRow()}

          {/* Cabeçalho da tabela */}
          <div style={styles.tableHeader}>
            <div style={s(styles.headerText as any, { textAlign: 'left' as const, paddingLeft: 8 })}>Pedido</div>
            <div style={styles.headerText as any}>Quantidade</div>
            <div style={s(styles.headerText as any, { textAlign: 'right' as const, paddingRight: 8 })}>Valor</div>
          </div>

          {this.renderTabelaPedidos()}
          {this.renderResumoPagamento()}

          {!!submitMsg && (
            <div style={{ textAlign: 'center', color: '#374151', marginTop: 8 }}>{submitMsg}</div>
          )}
        </div>

        {this.renderAlterarValorModal()}
        {this.renderBrindeModal()}
        {this.renderPagamentosModal()}
        {this.renderTransferModal()}

        {/* Modal unificado de pagamento */}
        <Modal
          visible={this.state.showPayModal}
          onRequestClose={this.fecharPayModal}
        >
          <div style={styles.bigModal}>
            <div style={styles.bigModalTitle}>Confirmar pagamento</div>

            {/* Pílulas de método de pagamento */}
            <div style={styles.methodPillsRow}>
              {this.state.opcoesMetodoPag.map((m) => {
                const isSel = this.state.metodoPagSelecionado === m;
                return (
                  <button
                    key={m}
                    onClick={() => this.safeSetState({ metodoPagSelecionado: m })}
                    style={s(
                      styles.methodPill,
                      isSel ? styles.methodPillSelected : {}
                    )}
                  >
                    <span style={s(styles.methodPillText as any, isSel ? styles.methodPillTextSelected : {})}>
                      {m.toUpperCase()}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Totais dinâmicos */}
            {(() => {
              const base = this.getModalBase();
              const comDez = this.state.aplicarDez ? base * 1.1 : base;
              const cx = this.parseMoney(this.state.caixinhaValor);
              const caixinha = cx > 0 ? cx : 0;
              const totalFinal = comDez + caixinha;

              return (
                <>
                  <div style={styles.miniTotalRow}>
                    <div style={styles.miniTotalLabel as any}>Subtotal selecionado</div>
                    <div style={styles.miniTotalValue as any}>R$ {base.toFixed(2)}</div>
                  </div>
                  {this.state.aplicarDez && (
                    <div style={styles.miniTotalRow}>
                      <div style={styles.miniTotalLabel as any}>10%</div>
                      <div style={styles.miniTotalValue as any}>R$ {(comDez - base).toFixed(2)}</div>
                    </div>
                  )}
                  {caixinha !== 0 && (
                    <div style={styles.miniTotalRow}>
                      <div style={styles.miniTotalLabel as any}>Caixinha</div>
                      <div style={styles.miniTotalValue as any}>R$ {caixinha.toFixed(2)}</div>
                    </div>
                  )}
                  <div style={s(styles.miniTotalRow, { marginTop: 12 })}>
                    <div style={s(styles.miniTotalLabel as any, { fontSize: 16 })}>Total final</div>
                    <div style={s(styles.miniTotalValue as any, { fontSize: 24 })}>R$ {totalFinal.toFixed(2)}</div>
                  </div>
                </>
              );
            })()}

            {/* Toggle 10% */}
            <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-start' }}>
              <button
                onClick={() => this.safeSetState({ aplicarDez: !this.state.aplicarDez })}
                style={s(styles.miniBtn, this.state.aplicarDez ? styles.miniBtnPrimary : styles.miniBtnGhost)}
              >
                <span style={this.state.aplicarDez ? (styles.miniBtnPrimaryText as any) : (styles.miniBtnGhostText as any)}>
                  {this.state.aplicarDez ? 'Tirar 10%' : 'Adicionar 10%'}
                </span>
              </button>
            </div>

            {/* Caixinha */}
            <div style={s(styles.miniTotalLabel as any, { marginTop: 16 })}>Caixinha (opcional)</div>
            <input
              placeholder="0,00"
              onChange={(e) => this.safeSetState({ caixinhaValor: this.sanitizeDecimalInput(e.target.value) })}
              value={this.state.caixinhaValor}
              style={s(styles.miniInput, { marginBottom: 16 })}
              inputMode="decimal"
            />

            {/* Ações */}
            <div style={styles.miniActions}>
              <button
                style={s(styles.miniBtn, styles.miniBtnGhost)}
                onClick={this.fecharPayModal}
                disabled={this.state.pagandoLoading}
              >
                <span style={styles.miniBtnGhostText as any}>Cancelar</span>
              </button>

              <button
                style={s(styles.miniBtn, styles.miniBtnPrimary)}
                onClick={this.confirmarPagamentoComEscolhas}
                disabled={this.state.pagandoLoading}
              >
                <span style={styles.miniBtnPrimaryText as any}>
                  {this.state.pagandoLoading ? 'Enviando...' : 'Confirmar'}
                </span>
              </button>
            </div>
          </div>
        </Modal>
      </div>
    );
  }
}

// ====== estilos (desktop) ======
const styles: Record<string, React.CSSProperties> = {
  // layout base
  container: { width: '100%', maxWidth: 980, margin: '0 auto', backgroundColor: '#fff', padding: '12px 16px 24px 16px' },
  title: { flexGrow: 1, marginRight: 12, fontSize: 20, fontWeight: 700 as any, color: '#111827' },
  headerRow: { display: 'flex', alignItems: 'center', padding: '10px 12px' },
  headerControls: { display: 'flex', alignItems: 'center', marginLeft: 8 },
  navGroup: { display: 'flex', alignItems: 'center' },
  navBtn: {
    width: 36, height: 36, borderRadius: 8, backgroundColor: '#2f6fdf',
    alignItems: 'center', justifyContent: 'center', display: 'flex', boxShadow: '0 1px 2px rgba(0,0,0,0.18)', margin: '0 4px', border: 'none', cursor: 'pointer'
  },
  navBtnText: { color: '#fff', fontSize: 16, fontWeight: 700 as any },
  ordemText: { width: 26, textAlign: 'center' as const, fontWeight: 700 as any, color: '#1f2d3d' },
  inlineActions: { display: 'flex', alignItems: 'center', flexWrap: 'nowrap' },

  // chips/botões
  chipBtn: { padding: '8px 12px', borderRadius: 10, alignItems: 'center', justifyContent: 'center', display: 'inline-flex', margin: '0 4px', border: 'none', cursor: 'pointer' },
  chipText: { color: '#fff', fontWeight: 700 as any } as any,
  chipNeutral: { backgroundColor: '#6b7280' },
  chipWarn: { backgroundColor: '#f59e0b' },
  chipDanger: { backgroundColor: '#ef4444' },
  primary: { backgroundColor: '#17315c' },

  // tabela
  tableHeader: {
    display: 'flex', justifyContent: 'space-between', padding: '10px 0',
    borderBottom: '1px solid #ddd', marginBottom: 8, backgroundColor: '#f7f7f7'
  },
  headerText: { flex: 1, fontSize: 16, fontWeight: 700 as any, textAlign: 'center' as const, color:'#000' },
  tableRow: { display: 'flex', alignItems: 'center', padding: '12px 8px', borderBottom: '2px solid #eee' },
  itemText: { fontSize: 15, color: '#1f2d3d' },
  itemExtrasText: { fontSize: 12.5, color: '#6b7280', marginTop: 2 },
  editControls: { display: 'flex', marginLeft: 10 },
  miniSquare: {
    width: 36, height: 36, borderRadius: 8, alignItems: 'center', justifyContent: 'center', display: 'flex',
    boxShadow: '0 1px 2px rgba(0,0,0,0.18)', margin: '0 4px', border: 'none', cursor: 'pointer'
  },
  miniSquareText: { color: '#fff', fontWeight: 800 as any, fontSize: 16 } as any,
  danger: { backgroundColor: '#ef4444' },

  // resumo / pagamento
  summaryBox: { marginTop: 14, padding: 14, backgroundColor: '#f3f4f6', borderRadius: 12 },
  paymentRow: { display: 'flex', justifyContent: 'space-between' },
  paymentBlock: { alignItems: 'center', display: 'flex', flexDirection: 'column', flex: 1 },
  totalText: { fontSize: 12, fontWeight: 700 as any, color: '#6b7280' } as any,
  totalValue: { fontSize: 22, margin: '6px 0', color: '#111827' } as any,
  parcialRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 },
  input: {
    height: 42, border: '1px solid #d1d5db', padding: '0 10px', borderRadius: 8,
    flex: 1, backgroundColor: '#fff', marginRight: 8
  },
  buttonRow: { display: 'flex', justifyContent: 'space-between', gap: 12 },

  // FAB
  fab: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: '#17315c',
    alignItems: 'center', justifyContent: 'center', display: 'inline-flex', marginLeft: 6, boxShadow: '0 2px 4px rgba(0,0,0,0.2)', border: 'none', cursor: 'pointer'
  },
  fabPlus: { color: '#fff', fontSize: 24, fontWeight: 'bold', lineHeight: '26px' },

  // bottom sheet (opções)
  sheetWrap: { position: 'fixed', inset: 0, zIndex: 50 } as any,
  sheetBackdrop: { position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.35)' } as any,
  sheetContainer: {
    position: 'fixed',
    left: 12, right: 12,
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: '8px 16px 16px 16px',
    boxShadow: '0 -6px 16px rgba(0,0,0,0.15)'
  },
  sheetHandle: { alignSelf: 'center', width: 42, height: 4, borderRadius: 2, backgroundColor: '#d8dbe2', marginBottom: 8 },
  sheetTitle: { fontSize: 16, fontWeight: 700 as any, color: '#2b3a4a', marginBottom: 8, textAlign: 'center' },
  sheetItem: { padding: '12px 8px', borderRadius: 8, cursor: 'pointer' },
  sheetItemText: { fontSize: 16, color: '#1f2d3d', textAlign: 'center' as const },
  sheetCancel: { marginTop: 8, padding: '12px 0', borderRadius: 10, backgroundColor: '#f3f4f6', cursor: 'pointer' } as any,
  sheetCancelText: { textAlign: 'center' as const, fontSize: 15, color: '#374151', fontWeight: 600 as any },

  // mini-modais base
  modalBackdrop: { position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60 } as any,
  modalCenter: { width: '90%', maxWidth: 520, padding: 0, backgroundColor: 'transparent' },
  miniModal: {
    width: 300,
    padding: 20,
    backgroundColor: 'white',
    borderRadius: 12,
    boxShadow: '0 6px 18px rgba(0,0,0,0.3)',
    margin: '0 auto'
  },
  miniModalTitle: { fontSize: 17, fontWeight: 700 as any, color: '#1f2d3d', marginBottom: 10, textAlign: 'center' },
  miniInput: {
    height: 42, border: '1px solid #d1d5db', borderRadius: 8, padding: '0 10px', backgroundColor: '#fbfbfb', fontSize: 16,
    width: '100%'
  },
  miniActions: { display: 'flex', justifyContent: 'space-between', marginTop: 14, gap: 10 },
  miniBtn: { padding: '12px 18px', borderRadius: 8, alignItems: 'center', justifyContent: 'center', display: 'inline-flex', marginTop: 6, border: 'none', cursor: 'pointer' },
  miniBtnGhost: { backgroundColor: '#f3f4f6' },
  miniBtnGhostText: { color: '#374151', fontWeight: 700 as any } as any,
  miniBtnPrimary: { backgroundColor: '#17315c' },
  miniBtnPrimaryText: { color: '#fff', fontWeight: 700 as any } as any,

  // sugestões do brinde
  sugestoesBox: { maxHeight: 180, marginTop: 10, border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' },
  sugestaoItem: { padding: '10px 12px', borderBottom: '1px solid #f0f0f0' } as any,
  sugestaoText: { fontSize: 15.5, color: '#222' },

  // nomes
  nomeRow: { display: 'flex', margin: '10px 0', flexWrap: 'wrap', gap: 8 },
  nomeButtonWrapper: { margin: '0 5px 6px 5px' },
  sectionTitle: { fontSize: 13, fontWeight: 700 as any, color: '#6b7280', marginBottom: 6, marginTop: 4 } as any,

  // controles do modo pagar por item
  payControls: { display: 'flex', alignItems: 'center', marginLeft: 8, gap: 6 },
  payBtn: { width: 32, height: 32, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none', cursor: 'pointer' },
  payMinus: { backgroundColor: '#ef4444' },
  payPlus: { backgroundColor: '#17315c' },
  payBtnText: { color: '#fff', fontWeight: 800 as any, fontSize: 16 } as any,
  payQtyText: { minWidth: 18, textAlign: 'center' as const, fontWeight: 700 as any, color: '#111827' },

  // pílulas de método + totais do modal
  methodPillsRow: { display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 4, marginBottom: 6 },
  methodPill: { padding: '8px 12px', borderRadius: 999, border: '1px solid #d1d5db', backgroundColor: '#fff', marginRight: 8, marginBottom: 8, cursor: 'pointer' },
  methodPillSelected: { backgroundColor: '#17315c', borderColor: '#17315c', color: '#fff' },
  methodPillText: { color: '#374151', fontWeight: 700 as any } as any,
  methodPillTextSelected: { color: '#fff', fontWeight: 800 as any } as any,

  miniTotalLabel: { fontSize: 14, color: '#374151', fontWeight: 700 as any } as any,
  miniTotalValue: { fontSize: 20, color: '#111827', fontWeight: 800 as any } as any,

  bigModal: {
    width: '100%',
    maxWidth: 420,
    padding: 22,
    backgroundColor: 'white',
    borderRadius: 14,
    boxShadow: '0 8px 20px rgba(0,0,0,0.25)',
    margin: '0 auto'
  },
  bigModalTitle: {
    fontSize: 19,
    fontWeight: 700 as any,
    color: '#1f2d3d',
    marginBottom: 14,
    textAlign: 'center' as const,
  },
  miniTotalRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 },
  centerBox: { alignItems: 'center', justifyContent: 'center', padding: '24px 0', display: 'flex', flexDirection: 'column' },

  paymentItem: { padding: '12px 0', borderBottom: '1px solid #eee' },
  paymentMainRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  paymentLeft: { paddingRight: 12, minWidth: 0 },
  paymentValue: { fontSize: 18, fontWeight: 800 as any, color: '#111827' },
  paymentMeta: { marginTop: 2, color: '#374151', fontWeight: 600 as any },
  paymentMetaMuted: { marginTop: 2, color: '#9CA3AF', fontSize: 12 },
  paymentDeleteBtn: { padding: '8px 12px', borderRadius: 8, backgroundColor: '#ef4444', border: 'none', cursor: 'pointer' },
  paymentDeleteText: { color: '#fff', fontWeight: 800 as any } as any,

  // transfer comanda
  transferRow: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 },
  transferBox: { flexBasis: 110 },
  transferLabel: { fontSize: 12, fontWeight: 700 as any, color: '#6b7280' },
  transferValue: {
    marginTop: 6, padding: '10px', borderRadius: 8,
    border: '1px solid #d1d5db', backgroundColor: '#fbfbfb', fontSize: 16, color: '#111827'
  },
  transferArrow: { fontSize: 22, fontWeight: 900 as any, color: '#111827', padding: '0 6px' },

  // offline
  offlineBanner: {
    backgroundColor: '#ef4444',
    padding: '6px 10px',
    borderRadius: 8,
    marginBottom: 10,
    alignSelf: 'flex-start'
  },
  offlineText: { color: '#fff', fontWeight: 700 as any } as any,

  // spinner
  spinner: {
    width: 20, height: 20, borderRadius: '50%', border: '3px solid #e5e7eb',
    borderTopColor: '#17315c', animation: 'spin 1s linear infinite'
  } as React.CSSProperties
};

// Animação do spinner (injetar CSS global)
if (typeof document !== 'undefined') {
  const style = document.createElement('style');
  style.innerHTML = `
@keyframes spin { to { transform: rotate(360deg); } }
`;
  document.head.appendChild(style);
}

export default ComandaScreen;
