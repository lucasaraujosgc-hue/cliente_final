import React, { useState, useEffect } from "react";
import { Outlet, Navigate, Link, useLocation, useNavigate } from "react-router-dom";
import { LayoutDashboard, Folder, Upload, LogOut, Settings, Users, Calculator, Menu, Pin, X, Bell, AlertCircle } from "lucide-react";
import { cn } from "../lib/utils";
import { ThemeToggle } from "./ThemeToggle";

export function ClientLayout() {
  const token = localStorage.getItem("clientToken") || sessionStorage.getItem("clientToken");
  let user: any = {};
  try {
    user = JSON.parse(localStorage.getItem("clientUser") || sessionStorage.getItem("clientUser") || "{}");
  } catch (e) {
    localStorage.removeItem("clientUser");
    sessionStorage.removeItem("clientUser");
  }
  const location = useLocation();
  const navigate = useNavigate();

  const [desktopSidebarOpen, setDesktopSidebarOpen] = useState(true);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  
  // Password Change Modal State
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [emailForm, setEmailForm] = useState(user.email || "");
  const [passwordForm, setPasswordForm] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [modalError, setModalError] = useState("");
  const [modalSuccess, setModalSuccess] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    // Keep email input in sync when user object charges
    if (user.email && !emailForm) {
      setEmailForm(user.email);
    }
  }, [user.email]);

  useEffect(() => {
    const handleOpenModal = () => {
      setShowPasswordModal(true);
    };
    window.addEventListener("open-password-change-modal", handleOpenModal);
    return () => {
      window.removeEventListener("open-password-change-modal", handleOpenModal);
    };
  }, []);

  if (!token) {
    return <Navigate to="/login" replace />;
  }

  useEffect(() => {
    const handleUnauthorized = () => {
      handleLogout();
    };
    window.addEventListener("unauthorized", handleUnauthorized);
    return () => {
      window.removeEventListener("unauthorized", handleUnauthorized);
    };
  }, []);

  const handleLogout = () => {
    localStorage.removeItem("clientToken");
    localStorage.removeItem("clientUser");
    sessionStorage.removeItem("clientToken");
    sessionStorage.removeItem("clientUser");
    navigate("/login");
  };

  const handlePasswordChangeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setModalError("");
    setModalSuccess("");

    if (passwordForm && passwordForm !== confirmPassword) {
      setModalError("As senhas informadas não coincidem.");
      return;
    }

    setIsSaving(true);
    try {
      const res = await fetch("/api/client/setup-profile", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          email: emailForm,
          password: passwordForm || undefined
        })
      });

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

  const menu = [
    { name: "Painel Resumo", path: "/dashboard", icon: LayoutDashboard },
    { name: "Atrasados", path: "/overdue", icon: AlertCircle },
    { name: "Cofre Digital", path: "/vault", icon: Folder },
    { name: "Meus Envios", path: "/uploads", icon: Upload },
  ];

  const renderSidebarContent = () => (
    <div className="flex flex-col h-full bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800">
      <div className="h-20 flex items-center justify-between px-6 border-b border-slate-100 dark:border-slate-800">
        <div className="flex items-center space-x-3">
           <div className="w-10 h-10 bg-virgula-card rounded-xl border border-white/10 flex items-center justify-center text-virgula-green shadow-[0_0_20px_rgba(16,185,129,0.25)] shrink-0">
             <Calculator strokeWidth={2.5} className="w-[24px] h-[24px]" />
           </div>
           <div className="flex flex-col justify-center">
              <span className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight leading-none mb-0.5">Vírgula</span>
              <span className="text-xs font-semibold text-virgula-green tracking-widest leading-none uppercase">Contábil</span>
           </div>
        </div>
        {/* Mobile close button */}
        <button onClick={() => setMobileSidebarOpen(false)} className="md:hidden p-1.5 text-slate-400 hover:text-slate-600 rounded-lg">
          <X className="w-5 h-5" />
        </button>
      </div>

      <nav className="flex-1 px-4 py-4 space-y-1 overflow-y-auto">
        {menu.map((item) => {
          const Icon = item.icon;
          const active = location.pathname === item.path;
          return (
            <Link
              key={item.path}
              to={item.path}
              onClick={() => setMobileSidebarOpen(false)}
              className={cn(
                "flex items-center px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                active ? "bg-virgula-green/10 text-virgula-green dark:bg-virgula-green/20" : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700/50"
              )}
            >
              <Icon className={cn("w-5 h-5 mr-3", active ? "text-virgula-green" : "text-slate-400")} />
              {item.name}
            </Link>
          );
        })}

        {/* Password / Settings link */}
        <button
          onClick={() => {
            setShowPasswordModal(true);
            setMobileSidebarOpen(false);
          }}
          className="w-full flex items-center px-3 py-2.5 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700/50 rounded-lg text-sm font-medium transition-colors text-left"
        >
          <Settings className="w-5 h-5 mr-3 text-slate-400" />
          Alterar Senha
        </button>
      </nav>

      <div className="p-4 border-t border-slate-200 dark:border-slate-800">
        <div className="flex items-center px-3 py-2">
           <div className="w-8 h-8 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center text-slate-600 dark:text-slate-300 font-bold mr-3 shrink-0">
             {user.name?.charAt(0) || "C"}
           </div>
           <div className="flex flex-col overflow-hidden">
             <span className="text-sm font-medium text-slate-900 dark:text-white truncate">{user.name}</span>
             <span className="text-xs text-slate-500 dark:text-slate-400 truncate">Cliente</span>
           </div>
        </div>
        <button
          onClick={handleLogout}
          className="mt-2 w-full flex items-center px-3 py-2 text-sm font-medium text-slate-600 dark:text-slate-400 hover:bg-red-50 dark:hover:bg-red-900/30 hover:text-red-600 dark:hover:text-red-400 rounded-lg transition-colors"
        >
          <LogOut className="w-5 h-5 mr-3" />
          Sair
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex h-screen w-full bg-[#f8fafc] dark:bg-slate-900 text-slate-800 dark:text-slate-100 font-sans overflow-hidden transition-colors">
      
      {/* 3. Main Content Pane */}
      <main className="flex-1 flex flex-col relative overflow-hidden">
        
        {/* Top bar */}
        <header className="h-14 flex items-center justify-between px-4 bg-white/50 dark:bg-slate-800/50 backdrop-blur-md border-b border-slate-200/60 dark:border-slate-800/60 w-full z-10 shrink-0">
          <div className="flex items-center space-x-3">
             {/* Settings Gear replacing hamburger */}
             <button onClick={() => setShowPasswordModal(true)} className="p-2 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors" aria-label="Alterar Senha">
               <Settings className="w-5 h-5" />
             </button>
             <span className="text-sm font-semibold text-slate-500 dark:text-slate-400 truncate max-w-[200px] sm:max-w-none">
                Empresa: <strong className="text-slate-800 dark:text-white">{user.name}</strong>
             </span>
          </div>
          <div className="flex items-center space-x-4">
             <button onClick={() => window.dispatchEvent(new CustomEvent('open-notifications'))} className="text-slate-500 hover:text-indigo-500 transition-colors" title="Notificações">
               <Bell className="w-5 h-5" />
             </button>
             <button onClick={handleLogout} className="text-slate-500 hover:text-red-500 transition-colors" title="Sair">
               <LogOut className="w-5 h-5" />
             </button>
          </div>
        </header>

        <div className="absolute inset-0 top-14 bg-gradient-to-br from-virgula-green/5 via-transparent to-transparent -z-10 pointer-events-none"></div>
        <div className="flex-1 overflow-auto z-0 flex flex-col">
          <div className="max-w-7xl w-full mx-auto p-4 md:p-8 relative flex-1 flex flex-col">
            
            {/* Global Tabs */}
            <div className="flex gap-2 mb-6 overflow-x-auto pb-2 border-b border-slate-200 dark:border-slate-800 shrink-0">
              <Link
                to="/dashboard"
                className={`px-4 py-2 text-sm font-bold rounded-t-xl transition-colors ${location.pathname === '/dashboard' ? 'text-indigo-600 dark:text-indigo-400 border-b-2 border-indigo-600 dark:border-indigo-400' : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'}`}
              >
                Visão Geral
              </Link>
              <Link
                to="/overdue"
                className={`px-4 py-2 text-sm font-bold rounded-t-xl transition-colors ${location.pathname === '/overdue' ? 'text-indigo-600 dark:text-indigo-400 border-b-2 border-indigo-600 dark:border-indigo-400' : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'}`}
              >
                Atrasados
              </Link>
              <Link
                to="/vault"
                className={`px-4 py-2 text-sm font-bold rounded-t-xl transition-colors ${location.pathname === '/vault' ? 'text-indigo-600 dark:text-indigo-400 border-b-2 border-indigo-600 dark:border-indigo-400' : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'}`}
              >
                Cofre Digital
              </Link>
              <Link
                to="/uploads"
                className={`px-4 py-2 text-sm font-bold rounded-t-xl transition-colors ${location.pathname === '/uploads' ? 'text-indigo-600 dark:text-indigo-400 border-b-2 border-indigo-600 dark:border-indigo-400' : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'}`}
              >
                Meus Envios
              </Link>
            </div>

            <Outlet />
          </div>
        </div>
      </main>

      {/* 4. Password Change Modal */}
      {showPasswordModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-2xl border border-slate-100 dark:border-slate-700 p-6 w-full max-w-md relative">
            <button onClick={() => setShowPasswordModal(false)} className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">
               <X className="w-5 h-5" />
            </button>
            <h2 className="text-lg font-bold text-slate-900 dark:text-white mb-2">Alterar Senha de Acesso</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-6">Mantenha seus dados e credenciais de acesso atualizados com segurança.</p>

            {modalError && (
              <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 text-xs rounded-lg border border-red-100 dark:border-red-800">
                {modalError}
              </div>
            )}
            {modalSuccess && (
              <div className="mb-4 p-3 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 text-xs rounded-lg border border-emerald-100 dark:border-emerald-800">
                {modalSuccess}
              </div>
            )}

            <form onSubmit={handlePasswordChangeSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">E-mail Cadastrado</label>
                <input required type="email" value={emailForm} onChange={(e) => setEmailForm(e.target.value)} className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-lg text-sm bg-slate-50 dark:bg-slate-900 dark:text-white focus:bg-white focus:outline-none focus:ring-2 focus:ring-virgula-green" placeholder="exemplo@empresa.com" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Nova Senha (deixe em branco se não quiser alterar)</label>
                <input type="password" value={passwordForm} onChange={(e) => setPasswordForm(e.target.value)} className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-lg text-sm bg-slate-50 dark:bg-slate-900 dark:text-white focus:bg-white focus:outline-none focus:ring-2 focus:ring-virgula-green" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Confirmar Nova Senha</label>
                <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-lg text-sm bg-slate-50 dark:bg-slate-900 dark:text-white focus:bg-white focus:outline-none focus:ring-2 focus:ring-virgula-green" />
              </div>
              <button disabled={isSaving} type="submit" className="w-full py-2.5 bg-slate-900 dark:bg-virgula-green text-white rounded-xl text-sm font-bold shadow-md hover:opacity-90 transition-opacity">
                {isSaving ? "Salvando..." : "Confirmar Alterações"}
              </button>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}

export function AccountantLayout() {
  const token = localStorage.getItem("accountantToken");
  const location = useLocation();
  const navigate = useNavigate();

  const [desktopSidebarOpen, setDesktopSidebarOpen] = useState(true);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [totalSize, setTotalSize] = useState<number | null>(null);

  if (!token) {
    return <Navigate to="/admin/login" replace />;
  }

  useEffect(() => {
    const handleUnauthorized = () => {
      handleLogout();
    };
    window.addEventListener("unauthorized", handleUnauthorized);
    
    // Fetch stats
    const fetchStats = async () => {
      try {
        const res = await fetch("/api/accountant/files/stats", {
          headers: { Authorization: `Bearer ${token}` }
        });
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

  const handleLogout = () => {
    localStorage.removeItem("accountantToken");
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
    { name: "Notificações", path: "/admin/notifications", icon: Bell },
    { 
      name: `Galeria de Arquivos ${totalSize !== null ? `(${formatSize(totalSize)})` : ''}`, 
      path: "/admin/gallery", 
      icon: Folder 
    },
    { name: "Configurações", path: "/admin/settings", icon: Settings },
  ];

  const renderSidebarContent = () => (
    <div className="flex flex-col h-full bg-slate-900 dark:bg-slate-950 text-slate-100">
      <div className="h-20 flex items-center justify-between px-6 border-b border-slate-800">
        <div className="flex items-center space-x-3">
           <div className="w-10 h-10 bg-virgula-card rounded-xl border border-white/10 flex items-center justify-center text-virgula-green shadow-[0_0_20px_rgba(16,185,129,0.25)] shrink-0">
             <Calculator strokeWidth={2.5} className="w-[24px] h-[24px]" />
           </div>
           <div className="flex flex-col justify-center">
              <span className="text-2xl font-bold text-white tracking-tight leading-none mb-0.5">Vírgula</span>
              <span className="text-xs font-semibold text-virgula-green tracking-widest leading-none uppercase">Contábil</span>
           </div>
        </div>
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
