import React, { useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, NavLink, useLocation } from "react-router-dom";
import HomeDesktop from "./HomeScreen";
import Comandas from "./Comandas"; // precisa export default no arquivo
import PedidosScreen from "./PedidosScreen"; // nova página

// ---------------- Top Bar + Drawer infra ----------------

type DrawerItem = { to: string; label: string };

function Drawer({
  open,
  onClose,
  items,
}: {
  open: boolean;
  onClose: () => void;
  items: DrawerItem[];
}) {
  // fecha no ESC
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    if (open) window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <>
      {/* overlay */}
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          background: open ? "rgba(0,0,0,0.45)" : "transparent",
          opacity: open ? 1 : 0,
          pointerEvents: open ? "auto" : "none",
          transition: "opacity .2s ease",
          zIndex: 1199,
        }}
      />
      {/* painel esquerdo */}
      <aside
        style={{
          position: "fixed",
          top: 56, // abaixo da topbar
          left: 0,
          bottom: 56, // acima das tabs
          width: 280,
          background: "#0b1220",
          borderRight: "1px solid #1e293b",
          transform: open ? "translateX(0)" : "translateX(-100%)",
          transition: "transform .2s ease",
          zIndex: 1200,
          display: "flex",
          flexDirection: "column",
          padding: 12,
          gap: 8,
        }}
        aria-hidden={!open}
      >
        <div style={{ color: "#cbd5e1", fontWeight: 800, margin: "2px 4px 8px" }}>Navegação</div>
        {items.map((it) => (
          <NavLink
            key={it.to}
            to={it.to}
            end
            onClick={onClose}
            style={({ isActive }) => ({
              textDecoration: "none",
              padding: "10px 12px",
              borderRadius: 10,
              fontWeight: 800,
              background: isActive ? "#ffe600" : "transparent",
              color: isActive ? "#111" : "#cbd5e1",
              border: isActive ? "1px solid #eab308" : "1px solid transparent",
            })}
          >
            {it.label}
          </NavLink>
        ))}
      </aside>
    </>
  );
}

// fecha o drawer ao trocar de rota (segurança extra se desejar)
function useCloseOnRouteChange(close: () => void) {
  const loc = useLocation();
  useEffect(() => {
    close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loc.pathname]);
}

// ---------------- App Shell (com TopBar/Drawer/Routes/Tabs) ----------------
function AppShell() {
  const [open, setOpen] = useState(false);
  const drawerItems: DrawerItem[] = [
    { to: "/", label: "Home" },
    { to: "/comandas", label: "Comandas" },
    { to: "/pedidos", label: "Pedidos" }, // novo
  ];

  useCloseOnRouteChange(() => setOpen(false));

  return (
    <>
      <Drawer open={open} onClose={() => setOpen(false)} items={drawerItems} />

      {/* Área de conteúdo com espaços para topbar e tabs */}
      <div
        style={{
          minHeight: "100vh",
          paddingTop: 56,
          paddingBottom: 56,
          background: "#F1F5F9",
        }}
      >
        <Routes>
          <Route
            path="/"
            element={<HomeDesktop username="pc" tokenUser="seuToken" carrinho="nossopoint" />}
          />
          <Route path="/comandas" element={<Comandas />} />
          <Route path="/pedidos" element={<PedidosScreen />} />
        </Routes>
      </div>

      {/* Bottom Tabs (mantidas) */}
      <nav
        style={{
          position: "fixed",
          left: 0,
          right: 0,
          bottom: 0,
          height: 56,
          background: "#0f172a",
          borderTop: "1px solid #1e293b",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 16,
          zIndex: 1000,
        }}
      >
        <Tab to="/" label="Home" />
        <Tab to="/comandas" label="Comandas" />
        <Tab to="/pedidos" label="Pedidos" />
      </nav>
    </>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppShell />
    </BrowserRouter>
  );
}

function Tab({ to, label }: { to: string; label: string }) {
  return (
    <NavLink
      to={to}
      end
      style={({ isActive }) => ({
        textDecoration: "none",
        padding: "8px 14px",
        borderRadius: 12,
        fontWeight: 800,
        background: isActive ? "#ffe600" : "transparent",
        color: isActive ? "#111" : "#cbd5e1",
        border: isActive ? "1px solid #eab308" : "1px solid transparent",
      })}
    >
      {label}
    </NavLink>
  );
}
