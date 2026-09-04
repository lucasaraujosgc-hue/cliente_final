import React, { useState, useEffect } from "react";
import { Outlet, Navigate, Link, useLocation, useNavigate } from "react-router-dom";
import { LayoutDashboard, Folder, Upload, LogOut, Settings, Users, Menu, Pin, X, Bell, AlertCircle, Smartphone, History, Receipt, FileText } from "lucide-react";
import { cn } from "../lib/utils";
import { apiFetch, hasSession, logout } from "../lib/apiClient";
import { ThemeToggle } from "./ThemeToggle";
import { Logo } from "./Logo";

const CHROME_FIELD =
  "w-full rounded-lg bg-sunken border border-line px-3.5 py-2.5 text-[15px] text-ink placeholder:text-faint transition-colors focus:outline-none focus:border-brand focus:bg-surface";
const CHROME_LABEL = "block text-[11px] font-semibold uppercase tracking-[0.08em] text-muted mb-1.5";

export function ClientLayout() {
  const token = hasSession("client");
  let user: any = {};
  try {
    user = JSON.parse(localStorage.getItem("clientUser") || sessionStorage.getItem("clientUser") || "{}");
  } catch (e) {
    localStorage.removeItem("clientUser");
    sessionStorage.removeItem("clientUser");
  }
  const location = useLocation();
  const navigate = useNavigate();

  // Password Change Modal State
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [emailForm, setEmailForm] = useState(user.email || "");
  const [passwordForm, setPasswordForm] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [modalError, setModalError] = useState("");
  const [modalSuccess, setModalSuccess] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const handleLogout = () => {
    void logout("client");
    try {
      localStorage.removeItem("clientUser");
      sessionStorage.removeItem("clientUser");
    } catch {
      /* ignore */
    }
    navigate("/login");
  };

  useEffect(() => {
    // Keep email input in sync when user object changes
    if (user.email && !emailForm) {
      setEmailForm(user.email);
    }
  }, [user.email]);

  useEffect(() => {
    const handleOpenModal = () => setShowPasswordModal(true);
    window.addEventListener("open-password-change-modal", handleOpenModal);
    return () => window.removeEventListener("open-password-change-modal", handleOpenModal);
  }, []);

  useEffect(() => {
    const handleUnauthorized = () => handleLogout();
    window.addEventListener("unauthorized", handleUnauthorized);
    return () => window.removeEventListener("unauthorized", handleUnauthorized);
  }, []);

  // All hooks must run before this early return — bailing out earlier
  // changed the hook call order between renders and violated the rules of
  // hooks (React would warn / misbehave on logout).
  if (!token) {
    return <Navigate to="/login" replace />;
  }

  const handlePasswordChangeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setModalError("");
    setModalSuccess("");

    if (passwordForm && passwordForm.length < 8) {
      setModalError("A nova senha precisa ter ao menos 8 caracteres.");
      return;
    }
    if (passwordForm && passwordForm !== confirmPassword) {
      setModalError("As senhas informadas não coincidem.");
      return;
    }

    setIsSaving(true);
    try {
      const res = await apiFetch("/api/client/setup-profile", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: emailForm,
          password: passwordForm || undefined
        })
      }, "client");

      const data = await res.json();
      if (res.ok) {
        setModalSuccess("Dados de acesso atualizados com sucesso!");
        setPasswordForm("");
        setConfirmPassword("");
        // Save the updated email in the user details
        const updatedUser = { ...user, email: emailForm, firstAccessDone: true };
        if (localStorage.getItem("clientUser")) {
          localStorage.setItem("clientUser", JSON.stringify(updatedUser));
        } else {
          sessionStorage.setItem("clientUser", JSON.stringify(updatedUser));
        }
      } else {
        setModalError(data.error || "Ocorreu um erro ao atualizar os dados.");
      }
    } catch (e: any) {
      setModalError("Erro de conexão com o servidor.");
    } finally {
      setIsSaving(false);
    }
  };

  // One nav model, two chrome shells: a left sidebar from `lg` up, a fixed
  // bottom bar below it (phones + tablets). `short` labels keep the bottom bar
  // readable on narrow screens.
  const nav = [
    { to: "/dashboard", label: "Visão Geral", short: "Visão Geral", Icon: LayoutDashboard },
    { to: "/overdue", label: "Atrasados", short: "Atrasados", Icon: AlertCircle },
    { to: "/vault", label: "Cofre Digital", short: "Cofre", Icon: Folder },
    { to: "/uploads", label: "Meus Envios", short: "Envios", Icon: Upload },
  ];
  const isActive = (to: string) =>
    location.pathname === to || (to === "/dashboard" && location.pathname === "/");

  return (
    <div className="flex h-screen w-full overflow-hidden bg-ground text-ink">

      {/* Sidebar — desktop / installed PWA (lg and up) */}
      <aside className="hidden shrink-0 flex-col border-r border-line bg-surface lg:flex lg:w-60">
        <div className="flex h-16 items-center border-b border-line px-5">
          <Logo size="sm" />
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-4">
          {nav.map(({ to, label, Icon }) => (
            <Link
              key={to}
              to={to}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                isActive(to)
                  ? "bg-brand-wash text-brand-fg"
                  : "text-muted hover:bg-sunken hover:text-ink",
              )}
            >
              <Icon className="size-[18px] shrink-0" strokeWidth={isActive(to) ? 2.2 : 1.8} />
              {label}
            </Link>
          ))}
        </nav>
        <div className="space-y-0.5 border-t border-line p-3">
          <p className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-faint truncate">
            {user.name || "Cliente"}
          </p>
          {[
            { label: "Alterar senha", Icon: Settings, onClick: () => setShowPasswordModal(true) },
            { label: "Notificações", Icon: Bell, onClick: () => window.dispatchEvent(new CustomEvent("open-notifications")) },
          ].map(({ label, Icon, onClick }) => (
            <button
              key={label}
              onClick={onClick}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted transition-colors hover:bg-sunken hover:text-ink"
            >
              <Icon className="size-4 shrink-0" strokeWidth={1.8} /> {label}
            </button>
          ))}
          <button
            onClick={handleLogout}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted transition-colors hover:bg-danger-wash hover:text-danger"
          >
            <LogOut className="size-4 shrink-0" strokeWidth={1.8} /> Sair
          </button>
        </div>
      </aside>

      <main className="relative flex flex-1 flex-col overflow-hidden">

        {/* Compact top bar — mobile / tablet only (gear + bell live on Visão Geral) */}
        <header className="flex h-12 shrink-0 items-center justify-between border-b border-line bg-surface/85 px-4 backdrop-blur lg:hidden">
          <span className="truncate text-sm font-semibold text-ink">
            {user.name || "Portal do Cliente"}
          </span>
          <button onClick={handleLogout} className="-mr-1.5 p-1.5 text-muted transition-colors hover:text-danger" title="Sair">
            <LogOut className="size-5" strokeWidth={1.8} />
          </button>
        </header>

        <div className="z-0 flex flex-1 flex-col overflow-auto">
          <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-6 md:px-8 md:py-9">
            <Outlet />
          </div>
        </div>

        {/* Bottom navigation — mobile + tablet (hidden from lg up) */}
        <nav className="flex shrink-0 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
          {nav.map(({ to, short, Icon }) => {
            const active = isActive(to);
            return (
              <Link
                key={to}
                to={to}
                className={cn(
                  "flex flex-1 flex-col items-center justify-center gap-1 py-2.5 text-[10px] font-semibold tracking-tight transition-colors",
                  active ? "text-brand" : "text-faint",
                )}
              >
                <Icon className="size-[19px]" strokeWidth={active ? 2.2 : 1.8} />
                {short}
              </Link>
            );
          })}
        </nav>
      </main>

      {/* Password Change Modal */}
      {showPasswordModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
          <div className="relative w-full max-w-md rounded-2xl border border-line bg-surface p-6 shadow-lg">
            <button onClick={() => setShowPasswordModal(false)} className="absolute right-4 top-4 text-faint transition-colors hover:text-muted" aria-label="Fechar">
              <X className="size-5" />
            </button>
            <h2 className="font-serif text-xl font-semibold text-ink">Alterar dados de acesso</h2>
            <p className="mt-1.5 text-sm text-muted">E-mail de contato e senha do portal.</p>

            {modalError && (
              <div className="mt-4 rounded-lg border border-danger/25 bg-danger-wash px-3.5 py-3 text-sm text-danger">{modalError}</div>
            )}
            {modalSuccess && (
              <div className="mt-4 rounded-lg border border-ok/25 bg-ok-wash px-3.5 py-3 text-sm text-brand-fg">{modalSuccess}</div>
            )}

            <form onSubmit={handlePasswordChangeSubmit} className="mt-5 space-y-4">
              <div>
                <label className={CHROME_LABEL}>E-mail de contato</label>
                <input required type="email" value={emailForm} onChange={(e) => setEmailForm(e.target.value)} className={CHROME_FIELD} placeholder="exemplo@empresa.com" />
              </div>
              <div>
                <label className={CHROME_LABEL}>Nova senha (deixe em branco para manter)</label>
                <input type="password" minLength={8} autoComplete="new-password" placeholder="Mínimo de 8 caracteres" value={passwordForm} onChange={(e) => setPasswordForm(e.target.value)} className={CHROME_FIELD} />
              </div>
              <div>
                <label className={CHROME_LABEL}>Confirmar nova senha</label>
                <input type="password" autoComplete="new-password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className={CHROME_FIELD} />
              </div>
              <button disabled={isSaving} type="submit" className="w-full rounded-lg bg-brand py-2.5 text-[15px] font-semibold text-white shadow-sm transition-colors hover:bg-brand-strong disabled:opacity-50">
                {isSaving ? "Salvando..." : "Confirmar alterações"}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export function AccountantLayout() {
  const token = hasSession("accountant");
  const location = useLocation();
  const navigate = useNavigate();

  const [desktopSidebarOpen, setDesktopSidebarOpen] = useState(true);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [totalSize, setTotalSize] = useState<number | null>(null);

  useEffect(() => {
    if (!token) return;
    const handleUnauthorized = () => {
      handleLogout();
    };
    window.addEventListener("unauthorized", handleUnauthorized);

    // Fetch stats
    const fetchStats = async () => {
      try {
        const res = await apiFetch("/api/accountant/files/stats", {}, "accountant");
        const data = await res.json();
        if (data.totalSize !== undefined) {
          setTotalSize(data.totalSize);
        }
      } catch(e) {}
    };
    fetchStats();

    return () => {
      window.removeEventListener("unauthorized", handleUnauthorized);
    };
  }, []);

  // All hooks must run before this early return (rules of hooks).
  if (!token) {
    return <Navigate to="/admin/login" replace />;
  }

  const handleLogout = () => {
    void logout("accountant");
    navigate("/admin/login");
  };

  const formatSize = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const menu = [
    { name: "Inbox", path: "/admin", icon: Upload },
    { name: "Clientes", path: "/admin/clients", icon: Users },
    { name: "NFS-e", path: "/admin/nfse", icon: FileText },
    { name: "Pagamentos", path: "/admin/payments", icon: Receipt },
    { name: "Notificações", path: "/admin/notifications", icon: Bell },
    { 
      name: `Galeria de Arquivos ${totalSize !== null ? `(${formatSize(totalSize)})` : ''}`, 
      path: "/admin/gallery", 
      icon: Folder 
    },
    { name: "Dispositivos", path: "/admin/devices", icon: Smartphone },
    { name: "Histórico", path: "/admin/audit", icon: History },
    { name: "Configurações", path: "/admin/settings", icon: Settings },
  ];

  const renderSidebarContent = () => (
    <div className="flex flex-col h-full bg-slate-900 dark:bg-slate-950 text-slate-100">
      <div className="h-20 flex items-center justify-between px-6 border-b border-slate-800">
        <Logo onDark />
        {/* Mobile close button */}
        <button onClick={() => setMobileSidebarOpen(false)} className="md:hidden p-1.5 text-slate-400 hover:text-slate-200 rounded-lg">
          <X className="w-5 h-5" />
        </button>
      </div>

      <nav className="flex-1 px-4 py-4 space-y-1 overflow-y-auto">
        {menu.map((item) => {
          const Icon = item.icon;
          const active = location.pathname === item.path || (location.pathname.startsWith('/admin/client/') && item.path === '/admin/clients');
          return (
            <Link
              key={item.path}
              to={item.path}
              onClick={() => setMobileSidebarOpen(false)}
              className={cn(
                "flex items-center px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                active ? "bg-slate-800 text-white shadow-inner" : "text-slate-400 hover:bg-slate-800/50 hover:text-white"
              )}
            >
              <Icon className={cn("w-5 h-5 mr-3", active ? "text-virgula-green" : "text-slate-500")} />
              {item.name}
            </Link>
          );
        })}
      </nav>

      <div className="p-4 border-t border-slate-800">
         <button
          onClick={handleLogout}
          className="w-full flex items-center justify-between px-3 py-2 text-sm font-medium text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
        >
          <span>Sair do sistema</span>
          <LogOut className="w-4 h-4" />
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex h-screen w-full bg-[#f8fafc] dark:bg-slate-900 text-slate-800 dark:text-slate-100 font-sans overflow-hidden transition-colors">
      
      {/* 1. Desktop Sidebar */}
      {desktopSidebarOpen && (
        <aside className="hidden md:flex md:w-64 flex-col shrink-0 z-20 shadow-2xl">
          {renderSidebarContent()}
        </aside>
      )}

      {/* 2. Mobile Sidebar Slide-out Drawer */}
      {mobileSidebarOpen && (
        <div className="fixed inset-0 z-50 md:hidden flex">
          {/* Backdrop */}
          <div onClick={() => setMobileSidebarOpen(false)} className="fixed inset-0 bg-slate-950/40 backdrop-blur-xs transition-opacity"></div>
          {/* Menu Drawer */}
          <div className="relative flex flex-col w-64 max-w-xs h-full bg-slate-900 animate-in slide-in-from-left duration-300">
            {renderSidebarContent()}
          </div>
        </div>
      )}

      {/* 3. Main Content Pane */}
      <main className="flex-1 flex flex-col relative overflow-hidden">
        
        {/* Top bar */}
        <header className="h-14 flex items-center justify-between px-4 bg-white/50 dark:bg-slate-800/50 backdrop-blur-md border-b border-slate-200/60 dark:border-slate-800/60 w-full z-10 shrink-0">
          <div className="flex items-center space-x-3">
             <button onClick={() => setMobileSidebarOpen(true)} className="md:hidden p-2 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors" aria-label="Menu">
               <Menu className="w-5 h-5" />
             </button>
             <button onClick={() => setDesktopSidebarOpen(!desktopSidebarOpen)} className="hidden md:flex p-2 text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors" title="Alternar visão lateral">
               <Menu className="w-5 h-5" />
             </button>
             <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                Contador: <strong className="text-slate-800 dark:text-white">Admin Vírgula</strong>
             </span>
          </div>
          <div className="flex items-center space-x-4">
             <ThemeToggle />
          </div>
        </header>

        <div className="absolute inset-0 top-14 bg-gradient-to-br from-virgula-green/5 via-transparent to-transparent -z-10 pointer-events-none"></div>
        <div className="flex-1 overflow-auto z-0">
          <div className="max-w-7xl mx-auto p-4 md:p-8 relative">
            <Outlet />
          </div>
        </div>
      </main>

    </div>
  );
}
