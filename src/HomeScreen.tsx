import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getSocket, setSocketAuth } from '../socket.ts'; // ajuste o caminho

// ==================== Tipos ====================
type Option = { nome: string; valor_extra: number; esgotado?: boolean };
type OptionGroup = {
  nome: string;
  ids?: string;
  options: Option[];
  max_selected: number;
  obrigatorio?: boolean;
};
type MenuItem = {
  id: string | number;
  item: string;
  preco: number | string;
  opcoes?: string | OptionGroup[];
};
type ComandaItem = { id?: string | number; comanda: string };

type ToastVariant = 'success' | 'warning' | 'error' | 'info';

interface HomeDesktopProps {
  username?: string;
  tokenUser?: string;
  carrinho?: string;
}

// ==================== Helpers ====================
const brl = (n: number | string | undefined) => {
  const v = Number(n ?? 0);
  const s = (isNaN(v) ? 0 : v).toFixed(2);
  return `R$ ${s.replace('.', ',')}`;
};

const normalize = (s: unknown) =>
  String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

// ==================== Componente ====================
const HomeDesktop: React.FC<HomeDesktopProps> = ({ username = 'pc', tokenUser = 'seuToken', carrinho = 'nossopoint' }) => {
  // ---------- estado principal ----------
  const [comand, setComand] = useState('');
  const [pedido, setPedido] = useState('');
  const [extra, setExtra] = useState('');
  const [nome, setNome] = useState('');
  const [quantidade, setQuantidade] = useState(1);
  const API_URL = 'https://flask-backend-server-yxom.onrender.com';

  // dados vindos do servidor
  const [dataFixo, setDataFixo] = useState<MenuItem[]>([]);
  const [pedidoFiltrado, setPedidoFiltrado] = useState<MenuItem[]>([]);
  const [comandaGeral, setComandaGeral] = useState<ComandaItem[]>([]);
  const [comandaFiltrada, setComandaFiltrada] = useState<ComandaItem[]>([]);

  // carrinho
  const [pedidosSelecionados, setPedidosSelecionados] = useState<string[]>([]);
  const [quantidadeSelecionada, setQuantidadeSelecionada] = useState<number[]>([]);
  const [extraSelecionados, setExtraSelecionados] = useState<string[]>([]);
  const [nomeSelecionado, setNomeSelecionado] = useState<string[]>([]);
  const [selectedUnitPrices, setSelectedUnitPrices] = useState<number[]>([]);
  const [opcoesSelecionadasPorItem, setOpcoesSelecionadasPorItem] = useState<any[][]>([]);

  // seleção atual (do item em edição)
  const [groups, setGroups] = useState<OptionGroup[]>([]);
  const [selecionadosByGroup, setSelecionadosByGroup] = useState<string[][]>([]);

  // UI flags
  const [showPedido, setShowPedido] = useState(false);
  const [showComandaPedido, setShowComandaPedido] = useState(false);
  const [showQuantidade, setShowQuantidade] = useState(false);
  const [showPedidoSelecionado, setShowPedidoSelecionado] = useState(false);

  // rede/estado
  const [isConnected, setIsConnected] = useState<boolean>(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [isCheckingQty, setIsCheckingQty] = useState(false);
  const [isSending, setIsSending] = useState(false);

  // estoque warnings (mantidos para eventual uso)
  const [quantidadeRestanteMensagem, setQuantidadeRestanteMensagem] = useState<number | null>(null);
  const [pedidoRestanteMensagem, setPedidoRestanteMensagem] = useState<string | null>(null);

  // toast
  const [toastOpen, setToastOpen] = useState(false);
  const [toastMsg, setToastMsg] = useState('Tudo certo!');
  const [toastVariant, setToastVariant] = useState<ToastVariant>('success');
  const hideToastTimer = useRef<number | null>(null);

  // socket ref
  const socketRef = useRef<ReturnType<typeof getSocket> | null>(null);

  // ---------- totals ----------
  const subtotal = useMemo(() => {
    let sum = 0;
    for (let i = 0; i < pedidosSelecionados.length; i++) {
      const unit = Number(selectedUnitPrices[i] || 0);
      const qtd = Number(quantidadeSelecionada[i] || 0);
      sum += unit * qtd;
    }
    return sum;
  }, [pedidosSelecionados, selectedUnitPrices, quantidadeSelecionada]);

  // ---------- toast ----------
  const showToast = useCallback((msg: string, variant: ToastVariant = 'success') => {
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

  // ---------- rede (online/offline) ----------
  useEffect(() => {
    const onOnline = () => {
      setIsConnected(true);
      showToast('Internet restaurada.', 'success');
    };
    const onOffline = () => {
      setIsConnected(false);
      showToast('Sem internet no dispositivo.', 'error');
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    if (!navigator.onLine) showToast('Sem internet no dispositivo.', 'warning');
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [showToast]);

  // ---------- socket ----------
  useEffect(() => {
    setSocketAuth({ carrinho, username });
    const socket = getSocket();
    socketRef.current = socket;

    const handleRespostaCardapio = (data: any) => {
      if (data?.dataCardapio) {
        setPedidoFiltrado(data.dataCardapio);
        setDataFixo(data.dataCardapio);
      }
    };
    const handleRespostaComandas = (data: any) => {
      if (data?.dados_comandaAberta) {
        setComandaFiltrada(data.dados_comandaAberta);
        setComandaGeral(data.dados_comandaAberta);
      }
    };
    const handleAlertaRestantes = (data: any) => {
      if (!data) return;
      setQuantidadeRestanteMensagem(Number(data.quantidade ?? 0));
      setPedidoRestanteMensagem(String(data.item ?? ''));
    };
    const handleQuantidadeInsuficiente = (data: any) => {
      if (data?.erro) {
        showToast(
          `Servidor sinalizou estoque insuficiente (resta ${String(data?.quantidade ?? 0)}). Envio permitido.`,
          'warning'
        );
      }
    };

    const onConnect = () => showToast('Conectado novamente!', 'success');
    const onDisconnect = () => showToast('Sem conexão com o servidor.', 'error');
    const onError = (e: any) => showToast(e?.message || String(e) || 'Erro do servidor.', 'error');
    const onConnectError = (e: any) => showToast(e?.message || String(e) || 'Falha ao conectar.', 'error');

    socket.on('respostaCardapio', handleRespostaCardapio);
    socket.on('respostaComandas', handleRespostaComandas);
    socket.on('alerta_restantes', handleAlertaRestantes);
    socket.on('quantidade_insuficiente', handleQuantidadeInsuficiente);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('error', onError);
    socket.on('connect_error', onConnectError);

    // primeira carga
    socket.emit('getCardapio', { emitir: false, carrinho });
    socket.emit('getComandas', { emitir: false, carrinho });

    return () => {
      socket.off('respostaCardapio', handleRespostaCardapio);
      socket.off('respostaComandas', handleRespostaComandas);
      socket.off('alerta_restantes', handleAlertaRestantes);
      socket.off('quantidade_insuficiente', handleQuantidadeInsuficiente);
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('error', onError);
      socket.off('connect_error', onConnectError);
    };
  }, [carrinho, showToast, username]);

  // ---------- funções core ----------
  const getAvailableOptions = useCallback((g: OptionGroup) => (g?.options || []).filter((o) => !o?.esgotado), []);
  const getEffectiveMaxSel = useCallback(
    (g: OptionGroup) => {
      const av = getAvailableOptions(g).length;
      if (av <= 0) return 0;
      const raw = Number(g?.max_selected || 1) || 1;
      return Math.max(1, Math.min(raw, av));
    },
    [getAvailableOptions]
  );

  const getCurrentTime = () => {
    const d = new Date();
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  };

  const normalizeGroups = useCallback((raw: unknown): OptionGroup[] => {
    let groups: any[] = [];
    try {
      groups = typeof raw === 'string' ? JSON.parse(raw) : (raw as any[]);
    } catch {
      groups = [];
    }
    if (!Array.isArray(groups)) groups = [];
    return groups.map((g) => {
      const nome = g?.nome ?? g?.Nome ?? 'Opções';
      const ids = g?.ids ?? '';
      const max_selected = Number(g?.max_selected ?? 1) || 1;
      const obrigatorio = !!(g?.obrigatorio || g?.Obrigatorio);
      let options = g?.options ?? g?.opcoes ?? [];
      if (!Array.isArray(options)) options = [];
      options = options.map((o: any) => {
        if (typeof o === 'string') return { nome: o, valor_extra: 0, esgotado: false };
        return { nome: o?.nome ?? String(o ?? ''), valor_extra: Number(o?.valor_extra ?? 0) || 0, esgotado: !!o?.esgotado };
      });
      return { nome, ids, options, max_selected, obrigatorio };
    });
  }, []);

  const validateRequiredGroups = useCallback(() => {
    for (let i = 0; i < (groups || []).length; i++) {
      const g = groups[i];
      if (!g) continue;
      const available = getAvailableOptions(g);
      if (available.length === 0) continue;
      if (g.obrigatorio) {
        const selectedNames = new Set(selecionadosByGroup[i] || []);
        const hasAny = available.some((o) => selectedNames.has(o.nome));
        if (!hasAny) return { ok: false, msg: `Selecione ao menos 1 opção em "${g.nome}".` };
      }
    }
    return { ok: true };
  }, [groups, selecionadosByGroup, getAvailableOptions]);

  const buildSelectionFromState = useCallback(() => {
    if (!groups || !groups.length) return [];
    return groups
      .map((g, idx) => {
        const escolhidos = new Set(selecionadosByGroup[idx] || []);
        const resultOpts = (g.options || [])
          .filter((o) => !o.esgotado && escolhidos.has(o.nome))
          .map((o) => ({ nome: o.nome, valor_extra: Number(o.valor_extra) || 0 }));
        return { nome: g.nome, ids: g.ids ?? '', options: resultOpts, max_selected: Number(g.max_selected || 1) };
      })
      .filter((g) => g.options.length > 0);
  }, [groups, selecionadosByGroup]);

  const computeExtrasFromSelection = useCallback(() => {
    const selection = buildSelectionFromState();
    let sum = 0;
    for (const g of selection) for (const o of g.options || []) sum += Number(o.valor_extra || 0);
    return sum;
  }, [buildSelectionFromState]);

  const getItemBasePrice = useCallback(
    (itemName: string) => {
      const base = Array.isArray(dataFixo) ? dataFixo : [];
      const found = base.find((it) => String(it.item || '').toLowerCase() === String(itemName || '').toLowerCase());
      const preco = found ? Number(found.preco || 0) : 0;
      return isNaN(preco) ? 0 : preco;
    },
    [dataFixo]
  );

  const summarizeSelection = (selGroups: any[] = []) =>
    selGroups
      .map((g: any) => {
        const itens = (g.options || []).map((o: any) => (o.valor_extra ? `${o.nome} (+${brl(o.valor_extra)})` : o.nome));
        return `${g.nome}: ${itens.join(', ') || '—'}`;
      })
      .join(' • ');

  // ---------- busca / inputs ----------
  // SUBSTITUA sua processarPedido por esta versão:
const processarPedido = useCallback(
  (rawPedido: string) => {
    const base = Array.isArray(dataFixo) ? dataFixo : [];
    const raw = String(rawPedido || '');

    if (!raw.trim()) {
      setPedidoFiltrado([]);
      setShowPedido(false);
      return;
    }

    // busca por id: ".123"
    if (raw[0] === '.' && raw.trim().length > 1) {
      const id = raw.slice(1).trim();
      const result = base.filter((it) => String((it as any)?.id) === id);
      setPedidoFiltrado(result);
      setShowPedido(true);
      return;
    }

    // normaliza tudo (minúsculo + sem acento)
    const qNorm = normalize(raw);
    const words = qNorm.split(/\s+/).filter(Boolean);

    const starts: MenuItem[] = [];
    const allWords: MenuItem[] = [];
    const includes: MenuItem[] = [];

    for (const it of base) {
      const nameNorm = normalize(it?.item);
      if (!nameNorm) continue;

      // começa com alguma palavra
      if (words.some((w) => nameNorm.startsWith(w))) {
        starts.push(it);
        continue;
      }

      // contém TODAS as palavras
      if (words.length > 1 && words.every((w) => nameNorm.includes(w))) {
        allWords.push(it);
        continue;
      }

      // contém ALGUMA das palavras
      if (words.some((w) => nameNorm.includes(w))) {
        includes.push(it);
      }
    }

    // remove duplicatas preservando a ordem (starts > allWords > includes)
    const seen = new Set<string>();
    const result: MenuItem[] = [];
    for (const bucket of [starts, allWords, includes]) {
      for (const it of bucket) {
        const key = String((it as any)?.id ?? it.item);
        if (!seen.has(key)) {
          seen.add(key);
          result.push(it);
        }
      }
    }

    setPedidoFiltrado(result);
    setShowPedido(true);
  },
  [dataFixo]
);

// SUBSTITUA sua changePedido por esta versão:
const changePedido = (value: string) => {
  const v = value.toLowerCase();     // força minúsculo enquanto digita
  setPedido(v);
  processarPedido(v);                // <<--- filtra a cada digitação
  setGroups([]);
  setSelecionadosByGroup([]);
  setShowQuantidade(false);
  setShowPedido(!!v.trim());
};


  const changeComanda = (value: string) => {
    const base = Array.isArray(comandaGeral) ? comandaGeral : [];
    const raw = String(value ?? '');
    const qNorm = normalize(raw);
    const words = qNorm.trim().split(/\s+/).filter(Boolean);

    if (words.length === 0) {
      setComandaFiltrada(base);
      setComand(raw);
      setShowComandaPedido(false);
      return;
    }

    const starts: ComandaItem[] = [];
    const allWords: ComandaItem[] = [];
    const includes: ComandaItem[] = [];

    for (let i = 0; i < base.length; i++) {
      const it = base[i];
      const nameNorm = normalize(it?.comanda);
      if (!nameNorm) continue;

      let matched = false;
      for (const w of words) {
        if (nameNorm.startsWith(w)) {
          starts.push(it);
          matched = true;
          break;
        }
      }
      if (matched) continue;

      if (words.length > 1 && words.every((w) => nameNorm.includes(w))) {
        allWords.push(it);
        continue;
      }

      for (const w of words) {
        if (nameNorm.includes(w)) {
          includes.push(it);
          break;
        }
      }
    }

    const seen = new Set<string>();
    const result: ComandaItem[] = [];
    for (const bucket of [starts, allWords, includes]) {
      for (const it of bucket) {
        const key = String(it?.id ?? it?.comanda);
        if (!seen.has(key)) {
          seen.add(key);
          result.push(it);
        }
      }
    }
    setComandaFiltrada(result);
    setComand(raw);
    setShowComandaPedido(true);
  };

  const selecionarPedido = (label: string, id?: string | number) => {
    const pedidoSelecionado = String(label || '').trim();
    const row =
      (dataFixo || []).find((r) => String((r as any).id) === String(id)) ||
      (dataFixo || []).find((r) => String(r.item || '').trim().toLowerCase() === pedidoSelecionado.toLowerCase());
    const grps = normalizeGroups(row?.opcoes);
    setPedido(pedidoSelecionado);
    setPedidoFiltrado([]);
    setShowQuantidade(true);
    setGroups(grps);
    setSelecionadosByGroup(grps.map(() => []));
  };

  const selecionarComandaPedido = (c: string) => {
    setComand(c);
    setComandaFiltrada([]);
    setShowComandaPedido(false);
  };

  const aumentarQuantidade = () => setQuantidade((q) => q + 1);
  const diminuirQuantidade = () => setQuantidade((q) => Math.max(q - 1, 1));
  const mudarQuantidade = (v: string) => {
    const n = parseInt(v, 10);
    setQuantidade(Number.isFinite(n) && n > 0 ? n : 1);
  };

  const toggleOption = (groupIndex: number, optionName: string) => {
  let toastMsg: string | null = null;

  setSelecionadosByGroup((prev) => {
    const g = groups[groupIndex];
    if (!g) return prev;

    const opt = (g.options || []).find((o) => o.nome === optionName);
    if (!opt || opt.esgotado) {
      toastMsg = 'Opção esgotada';
      return prev;
    }

    const effectiveMax = getEffectiveMaxSel(g); // já considera esgotados
    const next = [...prev];

    const availableNames = new Set(getAvailableOptions(g).map((o) => o.nome));
    const current = new Set<string>((next[groupIndex] || []).filter((n) => availableNames.has(n)));

    // já estava selecionada? então alterna (desmarca)
    if (current.has(optionName)) {
      next[groupIndex] = [...current].filter((n) => n !== optionName);
      return next;
    }

    // ----- comportamento "rádio" quando max = 1 -----
    if (effectiveMax <= 1) {
      next[groupIndex] = [optionName]; // substitui qualquer seleção anterior
      return next;
    }

    // ----- multi-seleção (max > 1) -----
    if ([...current].length >= effectiveMax) {
      toastMsg = `Máximo de ${effectiveMax} em "${g.nome}".`;
      return prev;
    }

    next[groupIndex] = [...current, optionName];
    return next;
  });

  if (toastMsg) showToast(toastMsg, 'warning');
};


  const verificarExistenciaPedidos = (p: string) => {
    if (!!p) {
      const found = (dataFixo || []).some((item) => String(item.item || '').toLowerCase() === String(p || '').toLowerCase());
      return found;
    }
    return true;
  };

  const adicionarPedido = async () => {
    if (isCheckingQty) return;

    const pedidoTrim = String(pedido || '').trim();
    if (!showQuantidade || !pedidoTrim) {
      showToast('Selecione um item da lista.', 'warning');
      return;
    }

    const { ok, msg } = validateRequiredGroups();
    if (!ok) {
      showToast(msg || 'Seleção incompleta.', 'warning');
      return;
    }

    if (!navigator.onLine) {
      showToast('Sem internet. Tente novamente.', 'error');
      return;
    }
    if (!socketRef.current) {
      showToast('Sem conexão com o servidor.', 'error');
      return;
    }

    setIsCheckingQty(true);
    try {
      const resp = await fetch(`${API_URL}/verificar_quantidade`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item: pedidoTrim, quantidade, carrinho }),
      });
      let data: any;
      try {
        data = await resp.json();
      } catch {
        data = { erro: true, mensagem: 'Resposta inválida do servidor.' };
      }

      const extrasSum = computeExtrasFromSelection();
      const basePrice = getItemBasePrice(pedidoTrim);
      const unitPrice = basePrice + extrasSum;

      const quantidadeR = Number(data?.quantidade ?? -200);
      if (data?.erro) {
        showToast(`Estoque atual: ${isNaN(quantidadeR) ? 0 : quantidadeR}. Vamos adicionar mesmo assim.`, 'warning');
      }
      if (quantidadeR !== -200) {
        if (quantidadeR <= 0) {
          window.alert('ATENÇÃO: estoque atual é 0 — item será adicionado mesmo assim.');
        } else {
          const novaQ = quantidadeR - quantidade;
          if (novaQ <= 0) {
            window.alert('ATENÇÃO: estoque zerou para este item.');
          } else {
            window.alert(`ATENÇÃO: restam apenas ${String(novaQ)}\nRecomenda-se repor estoque!`);
          }
        }
      }

      const selection = buildSelectionFromState();

      setPedidosSelecionados((prev) => [...prev, pedidoTrim]);
      setQuantidadeSelecionada((prev) => [...prev, quantidade]);
      setExtraSelecionados((prev) => [...prev, extra ? extra : '']);
      setNomeSelecionado((prev) => [...prev, nome ? nome : '']);
      setSelectedUnitPrices((prev) => [...prev, unitPrice]);
      setOpcoesSelecionadasPorItem((prev) => [...prev, selection]);

      setQuantidade(1);
      setShowQuantidade(false);
      setPedido('');
      setExtra('');
      setNome('');
      setShowPedidoSelecionado(true);
      setShowPedido(false);
      setGroups([]);
      setSelecionadosByGroup([]);
    } catch (e) {
      console.error('Erro ao adicionar pedido:', e);
      showToast('Falha ao verificar estoque.', 'error');
    } finally {
      setIsCheckingQty(false);
    }
  };

  const adicionarPedidoSelecionado = (index: number) => {
    setQuantidadeSelecionada((prev) => prev.map((q, i) => (i === index ? q + 1 : q)));
  };
  const removerPedidoSelecionado = (index: number) => {
    setQuantidadeSelecionada((prev) => prev.map((q, i) => (i === index ? Math.max(q - 1, 0) : q)));
  };

  const removeFromCart = (index: number) => {
    setPedidosSelecionados((prev) => prev.filter((_, i) => i !== index));
    setQuantidadeSelecionada((prev) => prev.filter((_, i) => i !== index));
    setExtraSelecionados((prev) => prev.filter((_, i) => i !== index));
    setNomeSelecionado((prev) => prev.filter((_, i) => i !== index));
    setSelectedUnitPrices((prev) => prev.filter((_, i) => i !== index));
    setOpcoesSelecionadasPorItem((prev) => prev.filter((_, i) => i !== index));
    setShowPedidoSelecionado((prev) => {
      const nextCount = pedidosSelecionados.length - 1;
      return nextCount > 0 ? prev : false;
    });
  };

  const confirmRemoveFromCart = (index: number) => {
    const ok = window.confirm('Remover este item do carrinho?');
    if (ok) removeFromCart(index);
  };

  const sendData = async () => {
    if (isSending) return;

    if (!navigator.onLine) {
      showToast('Sem internet. Tente novamente.', 'error');
      return;
    }
    if (!socketRef.current || !socketRef.current.connected) {
      showToast('Sem conexão com o servidor. Aguarde reconexão.', 'error');
      return;
    }

    const pedidoTrim = String(pedido || '').trim();
    if (!verificarExistenciaPedidos(pedidoTrim)) {
      window.alert('Pedido inexistente');
      return;
    }

    const comandTrim = String(comand || '').trim();
    if (!comandTrim) {
      window.alert('Digite a comanda');
      return;
    }

    setIsSending(true);
    try {
      const currentTime = getCurrentTime();
      const socket = socketRef.current!;

      if (pedidosSelecionados.length && quantidadeSelecionada.length) {
        const indicesValidos: number[] = [];
        quantidadeSelecionada.forEach((q, i) => {
          if (q > 0) indicesValidos.push(i);
        });

        if (indicesValidos.length === 0) {
          showToast('Carrinho vazio.', 'warning');
          return;
        }

        const NovosPedidos = indicesValidos.map((i) => pedidosSelecionados[i]);
        const NovasQuantidades = indicesValidos.map((i) => quantidadeSelecionada[i]);
        const NovosExtras = indicesValidos.map((i) => extraSelecionados[i] || '');
        const NovosNomes = indicesValidos.map((i) => nomeSelecionado[i] || '');
        const NovasSelecoes = indicesValidos.map((i) => opcoesSelecionadasPorItem[i] || []);

        socket.emit('insert_order', {
          comanda: comandTrim,
          pedidosSelecionados: NovosPedidos,
          quantidadeSelecionada: NovasQuantidades,
          extraSelecionados: NovosExtras,
          nomeSelecionado: NovosNomes,
          horario: currentTime,
          username,
          opcoesSelecionadas: NovasSelecoes,
          token_user: tokenUser,
          carrinho,
        });

        showToast('Enviado ✅', 'success');

        setComand('');
        setPedido('');
        setExtra('');
        setNome('');
        setPedidosSelecionados([]);
        setQuantidadeSelecionada([]);
        setExtraSelecionados([]);
        setNomeSelecionado([]);
        setOpcoesSelecionadasPorItem([]);
        setSelectedUnitPrices([]);
        setShowPedidoSelecionado(false);
        setShowPedido(false);
        setShowComandaPedido(false);
        setComandaFiltrada([]);
        setQuantidade(1);
        setShowQuantidade(false);
        setGroups([]);
        setSelecionadosByGroup([]);
        return;
      }

      if (comandTrim && pedidoTrim && quantidade) {
        if ((groups || []).length) {
          const { ok, msg } = validateRequiredGroups();
          if (!ok) {
            showToast(msg || 'Seleção incompleta.', 'warning');
            return;
          }
        }

        socket.emit('insert_order', {
          comanda: comandTrim,
          pedidosSelecionados: [pedidoTrim],
          quantidadeSelecionada: [quantidade],
          extraSelecionados: [extra],
          nomeSelecionado: [nome],
          horario: currentTime,
          comanda_filtrada: [],
          comanda_filtrada_abrir: [],
          username,
          opcoesSelecionadas: [buildSelectionFromState()],
          token_user: tokenUser,
          carrinho,
        });

        showToast('Enviado ✅', 'success');

        setComand('');
        setPedido('');
        setQuantidade(1);
        setExtra('');
        setNome('');
        setShowComandaPedido(false);
        setShowPedidoSelecionado(false);
        setShowPedido(false);
        setShowQuantidade(false);
        setGroups([]);
        setSelecionadosByGroup([]);
        setOpcoesSelecionadasPorItem([]);
        setSelectedUnitPrices([]);
        return;
      }

      showToast('Preencha os campos antes de enviar.', 'warning');
    } catch (e) {
      console.error('Erro ao enviar pedido:', e);
      showToast('Falha ao enviar pedido.', 'error');
    } finally {
      setIsSending(false);
    }
  };

  // ---------- UI helpers ----------
  const canAdd = !!showQuantidade && !!pedido && !isCheckingQty;
  const canSendCart =
    pedidosSelecionados.length > 0 &&
    quantidadeSelecionada.length > 0 &&
    !isSending &&
    isConnected &&
    !!socketRef.current?.connected;

  // ---------- Render ----------
  return (
    <div style={styles.page}>
      {/* Toast */}
      <div
        style={{
          position: 'fixed',
          top: 16,
          right: 16,
          zIndex: 1000,
          transition: 'transform 180ms ease, opacity 180ms ease',
          transform: toastOpen ? 'translateY(0)' : 'translateY(-12px)',
          opacity: toastOpen ? 1 : 0,
          pointerEvents: 'none',
        }}
      >
        {toastOpen && (
          <div
            style={{
              backgroundColor:
                toastVariant === 'error'
                  ? '#ef4444'
                  : toastVariant === 'warning'
                  ? '#f59e0b'
                  : toastVariant === 'info'
                  ? '#3b82f6'
                  : '#16a34a',
              color: '#fff',
              padding: '10px 14px',
              borderRadius: 8,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
            }}
          >
            <span
              style={{
                width: 12,
                height: 12,
                borderRadius: 6,
                background: 'rgba(255,255,255,0.9)',
                display: 'inline-block',
              }}
            />
            <strong>{toastMsg}</strong>
          </div>
        )}
      </div>

      <div style={styles.container}>
        {/* Header */}
        <div style={styles.header}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={styles.brand}>Inicio</div>
          </div>
          <div style={{ fontSize: 12, color: '#64748B' }}>
            {username ? `Usuário: ${username}` : '\u00A0'}
          </div>
        </div>

        {/* Grade principal */}
        <div style={styles.mainGrid}>
          {/* Coluna esquerda: formulário */}
          <div style={styles.leftCol}>
            {/* Linha de inputs */}
            <div style={styles.inputRow}>
              <div style={styles.inputWrap}>
                <input
                  placeholder="Comanda"
                  value={comand}
                  onChange={(e) => changeComanda(e.target.value)}
                  onFocus={() => setShowComandaPedido(!!(comand && comand.trim()))}
                  onBlur={() => setTimeout(() => setShowComandaPedido(false), 0)}
                  autoComplete="off"
                  spellCheck={false}
                  style={styles.input}
                />
                {showComandaPedido && (comandaFiltrada || []).length > 0 && (
                  <div style={styles.dropdown}>
                    {(comandaFiltrada || []).map((item, i) => (
                      <button
                        key={`${String(item?.comanda || '')}-${i}`}
                        style={styles.dropdownItem}
                        onMouseDown={() => selecionarComandaPedido(item.comanda)}
                      >
                        {item.comanda}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div style={styles.inputWrapWide}>
                <input
                  placeholder="Digite o pedido"
                  value={pedido}
                  onChange={(e) => changePedido(e.target.value)}
                  onFocus={() => setShowPedido(!!(pedido && pedido.trim()))}
                  onBlur={() => setTimeout(() => setShowPedido(false), 0)}
                  autoComplete="off"
                  spellCheck={false}
                  style={styles.input}
                />
                {showPedido && (pedidoFiltrado || []).slice(0, 6).length > 0 && (
                  <div style={styles.dropdown}>
                    {(pedidoFiltrado || []).slice(0, 6).map((it, idx) => (
                      <button
                        key={`${String((it as any)?.id || it?.item || idx)}`}
                        style={styles.dropdownItem}
                        onMouseDown={() => selecionarPedido(it.item, (it as any).id)}
                      >
                        {it.item}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {showQuantidade && (
                <div style={styles.qtyRow}>
                  <button onClick={diminuirQuantidade} style={styles.iconBtn} aria-label="Diminuir">
                    −
                  </button>
                  <input
                    value={String(quantidade)}
                    onChange={(e) => mudarQuantidade(e.target.value)}
                    type="number"
                    min={1}
                    style={styles.qtyInput}
                  />
                  <button onClick={aumentarQuantidade} style={styles.iconBtn} aria-label="Aumentar">
                    +
                  </button>
                </div>
              )}
            </div>

            {/* Grupos de opções */}
            {Array.isArray(groups) &&
              groups.map((group, gIdx) => {
                const selecionados = new Set(selecionadosByGroup[gIdx] || []);
                const available = (group.options || []).filter((o) => !o.esgotado);
                const maxSel = getEffectiveMaxSel(group);
                const selCount = [...selecionados].filter((n) => available.some((o) => o.nome === n)).length;

                return (
                  <div key={gIdx} style={styles.section}>
                    <div style={styles.groupHeader}>
                      <div style={styles.groupTitle}>
                        {group.nome}
                        {group.obrigatorio ? ' *' : ''}
                      </div>
                      <div style={styles.groupCounter}>{maxSel ? `${selCount}/${maxSel}` : '0/0'}</div>
                    </div>

                    <div style={styles.chipsRow}>
                      {(group.options || []).map((opt, oIdx) => {
                        const isSelected = selecionados.has(opt.nome);
                        const isDisabled = !!opt.esgotado;
                        const label = opt.valor_extra ? `${opt.nome} (+${brl(opt.valor_extra)})` : opt.nome;
                        return (
                          <button
                            key={oIdx}
                            type="button"
                            onClick={() => !isDisabled && toggleOption(gIdx, opt.nome)}
                            style={{
                              ...styles.chip,
                              ...(isSelected ? styles.chipSelected : {}),
                              ...(isDisabled ? styles.chipDisabled : {}),
                            }}
                            title={isDisabled ? `${label} (esgotado)` : label}
                          >
                            <span
                              style={{
                                ...styles.chipDot,
                                ...(isSelected ? styles.chipDotSelected : {}),
                                ...(isDisabled ? styles.chipDotDisabled : {}),
                              }}
                            />
                            <span
                              style={{
                                ...styles.chipText,
                                ...(isSelected ? styles.chipTextSelected : {}),
                                ...(isDisabled ? styles.chipTextDisabled : {}),
                              }}
                            >
                              {isDisabled ? `${label} (esgotado)` : label}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}

            {/* Campos extras */}
            <div style={styles.section}>
              <input
                placeholder="Extra (opcional)"
                value={extra}
                onChange={(e) => setExtra(e.target.value)}
                style={styles.input}
              />
              <input
                placeholder="Nome (opcional)"
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                style={{ ...styles.input, marginTop: 10 }}
              />
            </div>

            {/* Ação de adicionar */}
            <div style={{ ...styles.actions, justifyContent: 'flex-start' }}>
              <button onClick={adicionarPedido} disabled={!canAdd} style={styles.primaryBtn}>
                {isCheckingQty ? 'Verificando...' : 'Adicionar'}
              </button>
            </div>
          </div>

          {/* Coluna direita: carrinho */}
          <div style={styles.rightCol}>
            <div style={styles.cartPanel}>
              <div style={styles.cartHeader}>
                <div style={{ fontWeight: 800, fontSize: 16, color: '#0f172a' }}>Carrinho</div>
                <div style={{ fontSize: 12, color: '#64748B' }}>
                  {pedidosSelecionados.length} item{pedidosSelecionados.length === 1 ? '' : 's'}
                </div>
              </div>

              <div style={styles.cartItems}>
                {pedidosSelecionados.length === 0 && (
                  <div style={styles.emptyCart}>
                    Seu carrinho está vazio. Adicione itens à esquerda.
                  </div>
                )}

                {pedidosSelecionados.map((it, idx) => {
                  const qtd = quantidadeSelecionada[idx] || 1;
                  const unit = selectedUnitPrices[idx] || 0;
                  const resumo = summarizeSelection(opcoesSelecionadasPorItem[idx] || []);
                  const extraTxt = extraSelecionados[idx] || '';

                  return (
                    <div key={`${it}-${idx}`} style={styles.card}>
                      <div style={styles.cardHeader}>
                        <div style={styles.cardTitle}>{it}</div>
                        <div style={styles.cardHeaderRight}>
                          <div style={styles.cardSubtitle}>unit: {brl(unit)}</div>
                          <button onClick={() => confirmRemoveFromCart(idx)} style={styles.removeBtn}>
                            Remover
                          </button>
                        </div>
                      </div>

                      <div style={{ marginTop: 4 }}>
                        {!!resumo && <div style={styles.cardLine}>Opções: {resumo}</div>}
                        {!!extraTxt && <div style={styles.cardLine}>Extra: {extraTxt}</div>}
                      </div>

                      <div style={styles.cardFooter}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <button onClick={() => removerPedidoSelecionado(idx)} style={styles.iconBtn}>
                            −
                          </button>
                          <div style={{ minWidth: 16, textAlign: 'center', color:'#000' }}>{qtd}</div>
                          <button onClick={() => adicionarPedidoSelecionado(idx)} style={styles.iconBtn}>
                            +
                          </button>
                        </div>
                        <div style={styles.cardTotal}>{brl(unit * qtd)}</div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Summary / CTA */}
              <div style={styles.cartSummary}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <div style={{ color: '#475569' }}>Subtotal</div>
                  <div style={{ fontWeight: 800, color: '#0f172a' }}>{brl(subtotal)}</div>
                </div>
                <button onClick={sendData} disabled={!canSendCart} style={styles.checkoutBtn}>
                  {isSending ? 'Enviando...' : 'Enviar pedido'}
                </button>
              </div>
            </div>
          </div>
        </div>
        {/* /grade principal */}
      </div>
    </div>
  );
};

// ==================== Estilos (desktop) ====================
const styles: Record<string, React.CSSProperties> = {
  page: {
    background: '#F1F5F9', // slate-100
    minHeight: '100vh',
    padding: '32px 24px',
  },
  container: {
    maxWidth: 1280,
    margin: '0 auto',
    background: '#FFFFFF',
    borderRadius: 16,
    padding: 24,
    boxShadow: '0 10px 30px rgba(2,6,23,0.06)',
    border: '1px solid #E2E8F0',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 18,
  },
  brand: {
    fontWeight: 900,
    fontSize: 22,
    color: '#0f172a',
    letterSpacing: 0.2,
  },

  // grade principal
  mainGrid: {
    display: 'grid',
    gridTemplateColumns: 'minmax(720px, 1fr) 420px',
    gap: 24,
    alignItems: 'start',
  },
  leftCol: {
    background: '#FFFFFF',
    border: '1px solid #E2E8F0',
    borderRadius: 14,
    padding: 16,
    overflow: 'visible', // garante que nada seja cortado
  },
  rightCol: {
    position: 'sticky',
    top: 16,
    alignSelf: 'start',
  },

  // inputs
  inputRow: {
    display: 'flex',
    alignItems: 'stretch',
    gap: 10,
    marginBottom: 12,
    flexWrap: 'wrap', // evita sobreposição; quebra linha se faltar espaço
  },
  inputWrap: {
    position: 'relative',
    flex: 1,
    minWidth: 220, // dá simetria e evita encolher demais
  },
  inputWrapWide: {
    position: 'relative',
    flex: 2,
    minWidth: 320,
    zIndex: 0, // abaixo do qtyRow quando necessário
  },
  input: {
    height: 44,
    border: '1px solid #CBD5E1', // slate-300
    borderRadius: 10,
    padding: '0 12px',
    outline: 'none',
    width: '100%',
    background: '#FFFFFF',
    color: '#0f172a',
    boxShadow: '0 1px 2px rgba(2,6,23,0.04)',
    boxSizing: 'border-box',
  },
  dropdown: {
    position: 'absolute',
    top: 48,
    left: 0,
    right: 0,
    background: '#fff',
    border: '1px solid #E2E8F0',
    borderRadius: 10,
    boxShadow: '0 12px 24px rgba(2,6,23,0.12)',
    overflowY: 'auto',
    maxHeight: 240,
    zIndex: 50, // acima de tudo na linha
  },
  dropdownItem: {
    width: '100%',
    textAlign: 'left',
    padding: '10px 14px',
    border: 'none',
    background: '#fff',
    cursor: 'pointer',
    fontSize: 14,
    color: '#0f172a',
  },

  // quantidade
  qtyRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flex: '0 0 auto',     // não encolhe nem estica
    position: 'relative',
    zIndex: 10,           // fica acima dos inputs ao lado
  },
  qtyInput: {
    height: 44,
    width: 68,
    border: '1px solid #CBD5E1',
    borderRadius: 10,
    textAlign: 'center',
    outline: 'none',
    color: '#0f172a',
    background: '#FFFFFF',
    boxSizing: 'border-box',
  },
  iconBtn: {
    height: 44,
    minWidth: 44,
    borderRadius: 10,
    border: '1px solid #CBD5E1',
    background: '#F8FAFC',
    cursor: 'pointer',
    color:'#000'
  },

  // seção/grupos
  section: {
    marginTop: 14,
    paddingTop: 6,
    borderTop: '1px dashed #E2E8F0',
  },
  groupHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
    marginTop: 6,
  },
  groupTitle: {
    fontSize: 16,
    fontWeight: 800,
    color: '#0f172a',
  },
  groupCounter: {
    fontSize: 12,
    color: '#64748B',
  },
  chipsRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    padding: '8px 12px',
    borderRadius: 999,
    border: '1px solid #E2E8F0',
    background: '#F8FAFC',
    cursor: 'pointer',
    maxWidth: '100%',
  },
  chipSelected: {
    borderColor: '#16A34A',
    background: '#ECFDF5',
    fontWeight: 600,
  },
  chipDisabled: {
    opacity: 0.6,
    background: '#F1F5F9',
    cursor: 'not-allowed',
    textDecoration: 'line-through',
  },
  chipText: {
    fontSize: 14,
    color: '#0f172a',
    whiteSpace: 'nowrap' as const,
  },
  chipTextSelected: {
    fontWeight: 700,
  },
  chipTextDisabled: {
    color: '#64748B',
    textDecoration: 'line-through',
  },
  chipDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    background: '#CBD5E1',
  },
  chipDotSelected: {
    background: '#16A34A',
  },
  chipDotDisabled: {
    background: '#E2E8F0',
  },

  // ações
  actions: {
    display: 'flex',
    gap: 10,
    margin: '14px 0 6px',
  },
  primaryBtn: {
    height: 44,
    padding: '0 14px',
    borderRadius: 10,
    border: '1px solid #16A34A',
    background: '#16A34A',
    color: '#fff',
    fontWeight: 800,
    cursor: 'pointer',
  },
  secondaryBtn: {
    height: 44,
    padding: '0 14px',
    borderRadius: 10,
    border: '1px solid #CBD5E1',
    background: '#F8FAFC',
    color: '#0f172a',
    fontWeight: 700,
    cursor: 'pointer',
  },

  // carrinho (painel)
  cartPanel: {
    background: '#FFFFFF',
    border: '1px solid #E2E8F0',
    borderRadius: 14,
    padding: 16,
    boxShadow: '0 8px 24px rgba(2,6,23,0.06)',
  },
  cartHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  cartItems: {
    maxHeight: 520,
    overflowY: 'auto',
    paddingRight: 6,
  },
  emptyCart: {
    fontSize: 14,
    color: '#64748B',
    background: '#F8FAFC',
    border: '1px dashed #E2E8F0',
    borderRadius: 12,
    padding: 14,
  },
  cartSummary: {
    marginTop: 12,
    borderTop: '1px solid #E2E8F0',
    paddingTop: 12,
  },
  checkoutBtn: {
    width: '100%',
    height: 46,
    marginTop: 8,
    borderRadius: 10,
    border: '1px solid #16A34A',
    background: '#111c56ff',
    color: '#fff',
    fontWeight: 900,
    cursor: 'pointer',
  },

  // cards do carrinho
 card: {
  border: '1px solid #E2E8F0',
  borderRadius: 12,
  padding: 12,
  margin: '8px 0',
  background: '#fff',
  boxShadow: '0 6px 18px rgba(2,6,23,0.06)',
},
  cardHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  cardHeaderRight: { display: 'flex', alignItems: 'center', gap: 8 },
  cardTitle: { fontSize: 15, fontWeight: 800, color: '#0f172a' },
  cardSubtitle: { fontSize: 12, color: '#64748B' },
  removeBtn: {
    padding: '6px 10px',
    borderRadius: 10,
    background: '#FEE2E2',
    border: '1px solid #FCA5A5',
    color: '#7F1D1D',
    fontWeight: 800,
    cursor: 'pointer',
  },
  cardLine: { fontSize: 13, color: '#334155' },
  cardFooter: {
    marginTop: 8,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardTotal: { fontSize: 15, fontWeight: 900, color: '#0f172a' },
};

export default HomeDesktop;
