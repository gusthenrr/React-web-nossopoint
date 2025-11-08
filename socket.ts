import { io, Socket } from "socket.io-client";

export type ServerToClientEvents = {
  respostaCardapio: (data: any) => void;
  respostaComandas: (data: any) => void;
  alerta_restantes: (data: any) => void;
  quantidade_insuficiente: (data: any) => void;
};
export type ClientToServerEvents = {
  getCardapio: (args: { emitir: boolean; carrinho: string }) => void;
  getComandas: (args: { emitir: boolean; carrinho: string }) => void;
  insert_order: (args: any) => void;
};

let socketSingleton: Socket<ServerToClientEvents, ClientToServerEvents> | null = null;

// --------------- Resolvedor de URL sem tocar em "process" diretamente ---------------
function resolveApiUrl(): string {
  // Vite: import.meta.env.VITE_API_URL
  const viteUrl =
    (typeof import.meta !== "undefined" &&
      (import.meta as any).env &&
      (import.meta as any).env.VITE_API_URL) as string | undefined;

  // Next/qualquer outro: globalThis.process?.env?.NEXT_PUBLIC_API_URL
  const nextUrl =
    (typeof globalThis !== "undefined" &&
      (globalThis as any).process &&
      (globalThis as any).process.env &&
      (globalThis as any).process.env.NEXT_PUBLIC_API_URL) as string | undefined;

  return "https://flask-backend-server-yxom.onrender.com";
}

export function getSocket(): Socket<ServerToClientEvents, ClientToServerEvents> {
  if (socketSingleton) return socketSingleton;

  const url = resolveApiUrl();

  socketSingleton = io<ServerToClientEvents, ClientToServerEvents>(url, {
    path: "/socket.io",
    transports: ["websocket"],
    autoConnect: true,
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 500,
    timeout: 20000,
    withCredentials: true,
  });

  return socketSingleton;
}

export function setSocketAuth(auth: {
  token_user?: string;
  carrinho?: string;
  username?: string;
}) {
  const s = getSocket();
  s.auth = auth || {};
  s.io.opts.query = {
    ...(s.io.opts.query as Record<string, string>),
    ...(auth?.carrinho ? { carrinho: auth.carrinho } : {}),
  };
  if (!s.connected) s.connect();
}

export function destroySocket() {
  if (socketSingleton) {
    socketSingleton.removeAllListeners();
    socketSingleton.disconnect();
    socketSingleton = null;
  }
}
