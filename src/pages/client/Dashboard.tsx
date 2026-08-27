import { apiFetch } from "../../lib/apiClient";
import React, { useEffect, useState, useRef } from "react";
import { 
  Bell, 
  Upload, 
  FileCheck, 
  Edit3, 
  ChevronLeft,
  ChevronRight,
  RefreshCw,
} from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { format, parse, subMonths, parseISO, differenceInDays } from "date-fns";
import { ptBR } from "date-fns/locale";
import * as XLSX from "xlsx";
import { PwaBanner } from "./dashboard/PwaBanner";
import { DueDatesCard, DocDueStatus } from "./dashboard/DueDatesCard";
import { KpiCards } from "./dashboard/KpiCards";
import { BillingHistoryCharts } from "./dashboard/BillingHistoryCharts";
import { SupportCards } from "./dashboard/SupportCards";
import { NotificationPreferencesModal } from "./dashboard/NotificationPreferencesModal";
import { ClientDashboardSkeleton } from "../../components/Skeleton";

export function ClientDashboard() {
  const location = useLocation();
  const navigate = useNavigate();
  
  const [data, setData] = useState<any>(null);
  const [whatsappSupport, setWhatsappSupport] = useState("");
  const [selectedCompetence, setSelectedCompetence] = useState(format(subMonths(new Date(), 1), "MM/yyyy"));
  const [isUploading, setIsUploading] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [isCapacitorApp, setIsCapacitorApp] = useState(false);
  const [pushGranted, setPushGranted] = useState(false);

  useEffect(() => {
    const checkPushState = async () => {
      const isCapacitor = typeof window !== "undefined" && (window as any).Capacitor !== undefined;
      setIsCapacitorApp(isCapacitor);
      if (isCapacitor) {
        const PushNotifications = (window as any).Capacitor.Plugins.PushNotifications;
        if (PushNotifications) {
          const status = await PushNotifications.checkPermissions();
          setPushGranted(status.receive === 'granted');
        }
      } else if ('Notification' in window) {
        setPushGranted(Notification.permission === 'granted');
      }
    };
    checkPushState();
  }, []);

  const [showPwaBanner, setShowPwaBanner] = useState(() => {
    return localStorage.getItem("dismissPwaBanner_v2") !== "true";
  });
  const [isRefreshing, setIsRefreshing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const excelFileRef = useRef<HTMLInputElement>(null);
  let user = {};
  try {
    user = JSON.parse(localStorage.getItem("clientUser") || sessionStorage.getItem("clientUser") || "{}");
  } catch (e) {}

  const [billingForm, setBillingForm] = useState({ servicesRevenue: 0, salesRevenue: 0, totalIncomes: 0, servicesTaken: 0 });
  const [showBillingForm, setShowBillingForm] = useState(false);

  const [showPrefsModal, setShowPrefsModal] = useState(false);
  const [prefsForm, setPrefsForm] = useState({
    receives_all: true,
    recurrent: true,
    before_due: true,
    on_due: true,
    on_new_file: true
  });

  const loadData = async () => {
    setIsRefreshing(true);
    const token = localStorage.getItem("clientToken") || sessionStorage.getItem("clientToken");
    try {
      const response = await apiFetch("/api/client/dashboard", {
        
      });
      const d = await response.json();
      setData(d);
      if (d.whatsappSupport) {
        setWhatsappSupport(d.whatsappSupport);
      }
      if (d.client?.notificationPreferences) {
        setPrefsForm(d.client.notificationPreferences);
      }
      const entry = d.billing.find((b: any) => b.month === selectedCompetence);
      if (entry) {
        setBillingForm({ 
          servicesRevenue: entry.servicesRevenue, 
          salesRevenue: entry.salesRevenue, 
          totalIncomes: entry.totalIncomes, 
          servicesTaken: entry.servicesTaken 
        });
      } else {
        setBillingForm({ servicesRevenue: 0, salesRevenue: 0, totalIncomes: 0, servicesTaken: 0 });
      }
    } catch (e) {
      console.error("Error loading dashboard data", e);
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleSavePrefs = async () => {
    try {
      const token = localStorage.getItem("clientToken") || sessionStorage.getItem("clientToken");
      const res = await apiFetch("/api/client/preferences", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          
        },
        body: JSON.stringify({ notificationPreferences: prefsForm })
      });
      if (res.ok) {
        setShowPrefsModal(false);
        loadData();
      }
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    const handleOpenNotif = () => setShowPrefsModal(true);
    window.addEventListener('open-notifications', handleOpenNotif);
    return () => window.removeEventListener('open-notifications', handleOpenNotif);
  }, []);

  useEffect(() => {
    if (data) {
      const entry = data.billing.find((b: any) => b.month === selectedCompetence);
      if (entry) {
        setBillingForm({ 
          servicesRevenue: entry.servicesRevenue, 
          salesRevenue: entry.salesRevenue, 
          totalIncomes: entry.totalIncomes, 
          servicesTaken: entry.servicesTaken 
        });
      } else {
        setBillingForm({ servicesRevenue: 0, salesRevenue: 0, totalIncomes: 0, servicesTaken: 0 });
      }
    }
  }, [selectedCompetence]);

  const subscribeToPush = async () => {
    try {
      const isCapacitor = typeof window !== "undefined" && (window as any).Capacitor !== undefined;
      
      let fcmToken = null;
      let subscriptionObject = null;

      if (isCapacitor) {
        // Handle Capacitor Mobile Push Notifications (FCM)
        const PushNotifications = (window as any).Capacitor.Plugins.PushNotifications;
        if (PushNotifications) {
          let permStatus = await PushNotifications.checkPermissions();
          if (permStatus.receive === 'prompt') {
            permStatus = await PushNotifications.requestPermissions();
          }
          if (permStatus.receive !== 'granted') {
            throw new Error('User denied push permission');
          }
          
          await PushNotifications.register();
          
          // Wait for token using a Promise
          fcmToken = await new Promise((resolve, reject) => {
            PushNotifications.addListener('registration', (token: any) => {
              resolve(token.value);
            });
            PushNotifications.addListener('registrationError', (error: any) => {
              reject(error);
            });
            // Timeout just in case it doesn't fire
            setTimeout(() => resolve(null), 5000);
          });
        }
      } else if ("serviceWorker" in navigator && "PushManager" in window) {
        // Handle Web Push (PWA/Browser)
        const registration = await navigator.serviceWorker.ready;
        
        // Get public key
        const response = await apiFetch("/api/vapidPublicKey");
        const vapidPublicKey = await response.text();
        const convertedVapidKey = urlBase64ToUint8Array(vapidPublicKey);

        subscriptionObject = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: convertedVapidKey
        });
      }

      if (fcmToken || subscriptionObject) {
        await apiFetch("/api/notifications/subscribe", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            subscriptionObject,
            fcmToken,
            deviceName: navigator.userAgent
          })
        });
        console.log("Push notifications subscribed!");
      }
      if (isCapacitor) {
        const PushNotifications = (window as any).Capacitor.Plugins.PushNotifications;
        if (PushNotifications) {
          const status = await PushNotifications.checkPermissions();
          setPushGranted(status.receive === 'granted');
        }
      } else if ('Notification' in window) {
        setPushGranted(Notification.permission === 'granted');
      }
    } catch (e) {
      console.error("Failed to subscribe to push notifications", e);
      if (isCapacitorApp) {
        const PushNotifications = (window as any).Capacitor.Plugins.PushNotifications;
        if (PushNotifications) {
          const status = await PushNotifications.checkPermissions();
          setPushGranted(status.receive === 'granted');
        }
      } else if ('Notification' in window) {
        setPushGranted(Notification.permission === 'granted');
      }
    }
  };

  useEffect(() => {
    loadData();

    // Only refresh the push subscription automatically when the user has
    // already granted permission — never prompt on mount. The "Ativar
    // Notificações" button handles the opt-in flow explicitly.
    const isCapacitor = typeof window !== "undefined" && (window as any).Capacitor !== undefined;
    if (!isCapacitor && "Notification" in window && Notification.permission === "granted") {
      subscribeToPush();
    }

    const checkPushState = async () => {
      const isCapacitor = typeof window !== "undefined" && (window as any).Capacitor !== undefined;
      setIsCapacitorApp(isCapacitor);
      if (isCapacitor) {
        const PushNotifications = (window as any).Capacitor.Plugins.PushNotifications;
        if (PushNotifications) {
          const status = await PushNotifications.checkPermissions();
          setPushGranted(status.receive === 'granted');
        }
      } else if ('Notification' in window) {
        setPushGranted(Notification.permission === 'granted');
      }
    };
    checkPushState();
  }, []);

  function urlBase64ToUint8Array(base64String: string) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding)
      .replace(/\-/g, '+')
      .replace(/_/g, '/');

    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);

    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  }

  const handleUploadBankStatement = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    const token = localStorage.getItem("clientToken") || sessionStorage.getItem("clientToken");
    
    try {
      const formData = new FormData();
      formData.append("title", `Extrato Bancário (${selectedCompetence})`);
      formData.append("category", "bank_statement");
      formData.append("competence", selectedCompetence);
      formData.append("file", file);

      await apiFetch("/api/client/upload", {
        method: "POST",
        headers: {
          
        },
        body: formData,
      });
      loadData();
    } catch (e) {
      console.error(e);
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const saveBillingData = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const token = localStorage.getItem("clientToken") || sessionStorage.getItem("clientToken");
    try {
      await apiFetch("/api/client/update-billing", {
        method: "POST",
        headers: { "Content-Type": "application/json",  },
        body: JSON.stringify({ month: selectedCompetence, ...billingForm })
      });
      setShowBillingForm(false);
      loadData();
    } catch (e) {
      console.error(e);
    }
  };

  const handleExcelImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (evt) => {
      const bstr = evt.target?.result;
      const wb = XLSX.read(bstr, { type: "binary" });
      const wsname = wb.SheetNames[0];
      const ws = wb.Sheets[wsname];
      const data = XLSX.utils.sheet_to_json(ws);
      
      const parsedData = data.map((row: any) => ({
         month: row.Competencia || row.Mes || row.month,
         servicesRevenue: Number(row.FaturamentoServico || row.servicesRevenue || 0),
         salesRevenue: Number(row.FaturamentoVenda || row.salesRevenue || 0),
         totalIncomes: Number(row.TotalEntradas || row.totalIncomes || 0),
         servicesTaken: Number(row.ServicosTomados || row.servicesTaken || 0),
      })).filter(r => r.month);

      if (parsedData.length > 0) {
        const token = localStorage.getItem("clientToken") || sessionStorage.getItem("clientToken");
        await apiFetch("/api/client/bulk-billing", {
          method: "POST",
          headers: { "Content-Type": "application/json",  },
          body: JSON.stringify({ data: parsedData })
        });
        loadData();
      }
      if (excelFileRef.current) excelFileRef.current.value = "";
    };
    reader.readAsBinaryString(file);
  };

  const handleMarkAsPaid = async (docId: string) => {
    const token = localStorage.getItem("clientToken") || sessionStorage.getItem("clientToken");
    try {
      const res = await apiFetch(`/api/client/mark-doc/${docId}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          
        },
        body: JSON.stringify({ status: "paid" })
      });
      if (res.ok) {
        loadData();
      }
    } catch (err) {
      console.error("Error setting doc as paid", err);
    }
  };

  const handleCopyCode = (docId: string, textToCopy: string) => {
    navigator.clipboard.writeText(textToCopy);
    setCopiedId(docId);
    setTimeout(() => {
      setCopiedId(null);
    }, 2500);
  };

  const dismissPwaBanner = () => {
    localStorage.setItem("dismissPwaBanner_v2", "true");
    setShowPwaBanner(false);
  };

  // Compute competences list once
  const availableCompetences = Array.from({ length: 24 }, (_, i) => format(subMonths(new Date(), i), "MM/yyyy"));

  const handlePrevCompetence = () => {
    const idx = availableCompetences.indexOf(selectedCompetence);
    if (idx < availableCompetences.length - 1) {
      setSelectedCompetence(availableCompetences[idx + 1]);
    }
  };

  const handleNextCompetence = () => {
    const idx = availableCompetences.indexOf(selectedCompetence);
    if (idx > 0) {
      setSelectedCompetence(availableCompetences[idx - 1]);
    }
  };

  if (!data) {
    return <ClientDashboardSkeleton />;
  }

  // Parse Brazilian Date String (DD/MM/YYYY) or ISO (YYYY-MM-DD) to standard Date object
  const parseDueDateString = (dateStr: string) => {
    if (!dateStr) return null;
    try {
      if (dateStr.includes("/")) {
        const [day, month, year] = dateStr.split("/").map(Number);
        return new Date(year, month - 1, day);
      } else if (dateStr.includes("-")) {
        // YYYY-MM-DD format (to avoid UTC shift)
        const parts = dateStr.split("T")[0].split("-");
        return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
      }
      return new Date(dateStr);
    } catch (e) {
      return null;
    }
  };

  // Check the status of each expiration based on standard system date June 22, 2026
  const getDocDueStatus = (doc: any) => {
    if (doc.status === "paid") {
      return { label: "Pago", colorClass: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300", badgeColor: "bg-emerald-500", priority: 3 };
    }
    if (doc.status === "late") {
      return { label: "Atrasado 🔴", colorClass: "bg-rose-100 text-rose-800 border-rose-300 dark:bg-rose-950/30 dark:text-rose-400 dark:border-rose-800/50 shadow-sm", badgeColor: "bg-rose-500", priority: 0, isOverdue: true };
    }
    
    const isSpecialCategory = ["contracheque", "notas fiscais", "nota fiscal", "outros", "payroll"].includes(doc.category?.toLowerCase() || "");

    if (!doc.dueDate || isSpecialCategory) {
      return { label: "Disponível ✓", colorClass: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300", badgeColor: "bg-emerald-500", priority: 4 };
    }

    const todayDate = new Date(); // Use actual current date
    const parsedDue = parseDueDateString(doc.dueDate);

    if (!parsedDue) {
      return { label: "Pendente", colorClass: "bg-amber-100 text-amber-800 dark:bg-amber-900/20 dark:text-amber-400", badgeColor: "bg-amber-500", priority: 2 };
    }

    // Reset times
    todayDate.setHours(0,0,0,0);
    parsedDue.setHours(0,0,0,0);

    const diffDays = differenceInDays(parsedDue, todayDate);

    if (diffDays < 0) {
      return { label: `Atrasado [${Math.abs(diffDays)}d] 🔴`, colorClass: "bg-rose-100 text-rose-800 border-rose-300 dark:bg-rose-950/30 dark:text-rose-400 dark:border-rose-800/50 blink shadow-sm", badgeColor: "bg-rose-500", priority: 0, isOverdue: true };
    } else if (diffDays === 0) {
      return { label: `Vence hoje ⚠️`, colorClass: "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950/20 dark:text-amber-400 dark:border-amber-700/50 animate-pulse", badgeColor: "bg-amber-500", priority: 1, isSoon: true };
    } else if (diffDays <= 4) {
      return { label: `Vence em breve [${diffDays}d] ⚠️`, colorClass: "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950/20 dark:text-amber-400 dark:border-amber-700/50 animate-pulse", badgeColor: "bg-amber-500", priority: 1, isSoon: true };
    } else {
      const formattedDue = doc.dueDate?.includes("-") ? `${doc.dueDate.split("T")[0].split("-")[2]}/${doc.dueDate.split("T")[0].split("-")[1]}/${doc.dueDate.split("T")[0].split("-")[0]}` : doc.dueDate;
      return { label: `Vence em ${formattedDue}`, colorClass: "bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400", badgeColor: "bg-blue-500", priority: 2 };
    }
  };

  // Find all documents for the selected competence or with important upcoming maturities
  const allCurrentDocs = data.documents.filter((d: any) => 
    d.competence === selectedCompetence && 
    d.category !== "bank_statement" && 
    d.category !== "SITFIS_RECEITA" && 
    d.category?.toLowerCase() !== "sitfis"
  );
  
  const sitFisDoc = data.documents.find((d: any) => (d.category === 'SITFIS_RECEITA' || d.category === 'sitfis' || d.category?.toUpperCase() === 'SITFIS') && d.extractedData);
  const sitFisItems = Array.isArray(sitFisDoc?.extractedData) ? sitFisDoc.extractedData : [];
  const hasPendingSitFis = sitFisItems.length > 0 && sitFisItems.some((d: any) => d.type || (d.status && String(d.status).toUpperCase() !== "REGULAR"));

  // Calculate global overdue documents (across all competencies)
  const allOverdueDocs = data.documents.filter((d: any) => {
    if (d.status === "paid" || d.status === "ok" || d.category === "bank_statement" || d.category === "SITFIS_RECEITA" || d.category?.toLowerCase() === "sitfis") return false;
    if (['contracheque', 'outros', 'payroll'].includes(d.category?.toLowerCase())) return false;
    const dueInfo = getDocDueStatus(d);
    return dueInfo.isOverdue;
  });
  
  const totalOverdueValue = allOverdueDocs.reduce((sum: number, doc: any) => {
    const val = doc.extractedData?.extractedValue;
    return sum + (typeof val === 'number' ? val : 0);
  }, 0);

  // Filter pending ones explicitly
  const pendingDocs = allCurrentDocs.filter((d: any) => 
    d.status !== "paid" && 
    d.dueDate && 
    !['contracheque', 'outros', 'payroll'].includes(d.category?.toLowerCase())
  );

  const totalPendingValue = pendingDocs.reduce((sum: number, doc: any) => {
    const val = doc.extractedData?.extractedValue;
    return sum + (typeof val === 'number' ? val : 0);
  }, 0);

  // Sort documents: Overdue first, followed by soon-to-expire, standard pending, and paid
  const sortedExpirations = [...allCurrentDocs].sort((a: any, b: any) => {
    const statusA = getDocDueStatus(a);
    const statusB = getDocDueStatus(b);
    return statusA.priority - statusB.priority;
  });

  const monthsTotalBilling = billingForm.servicesRevenue + billingForm.salesRevenue;
  const hasBankStatement = data.documents.some((d: any) => d.category === "bank_statement" && d.competence === selectedCompetence);

  // Compile historic dataset for Recharts
  const compDate = parse(selectedCompetence, "MM/yyyy", new Date());
  compDate.setDate(1);
  const last12Months = Array.from({ length: 12 }, (_, i) => format(subMonths(compDate, 11 - i), "MM/yyyy"));
  const chartData = last12Months.map(m => {
    const found = data.billing.find((b: any) => b.month === m);
    return {
      month: m,
      FaturamentoServiço: found?.servicesRevenue || 0,
      FaturamentoVendas: found?.salesRevenue || 0,
      Tomados: found?.servicesTaken || 0,
      Entradas: found?.totalIncomes || 0
    };
  });

  return (
    <div className="space-y-6 pb-24 px-4 sm:px-6 animate-in fade-in slide-in-from-bottom-2 duration-500 max-w-7xl mx-auto">
      
      {/* 📱 PWA SMART HELPER BANNER */}
      {showPwaBanner && <PwaBanner onDismiss={dismissPwaBanner} />}

      {/* HEADER SECTION */}
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pt-3">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded-full border border-emerald-500/20">
              Painel PWA Ativo
            </span>
            {!pushGranted && (
              <button 
                onClick={() => subscribeToPush().then(() => setPushGranted(true))}
                className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-indigo-500 text-white rounded-full hover:bg-indigo-600 transition-colors cursor-pointer"
              >
                Ativar Notificações
              </button>
            )}
            {isRefreshing && (
              <span className="text-slate-400 text-xs flex items-center animate-pulse">
                <RefreshCw className="w-3 h-3 animate-spin mr-1 text-slate-500" /> Sincronizando...
              </span>
            )}
          </div>
          <h1 className="text-2xl font-black tracking-tight text-slate-900 dark:text-white mt-1">
            Olá, {data.client.name}
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Gerenciamento contábil e obrigações fiscais em tempo real.
          </p>
        </div>
        
        <div className="flex flex-wrap items-center gap-3 mt-2 sm:mt-0">
          <div className="flex items-center bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden h-10 w-[200px]">
            <button 
              onClick={handlePrevCompetence}
              disabled={availableCompetences.indexOf(selectedCompetence) === availableCompetences.length - 1}
              className="px-3 h-full flex items-center justify-center text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-30 transition-colors"
            >
               <ChevronLeft className="w-4 h-4" />
            </button>
            <div className="flex-1 flex flex-col items-center justify-center">
               <span className="text-[10px] font-semibold text-slate-400 leading-none mb-0.5">Competência</span>
               <span className="text-sm font-black text-slate-800 dark:text-white leading-none">{selectedCompetence}</span>
            </div>
            <button 
              onClick={handleNextCompetence}
              disabled={availableCompetences.indexOf(selectedCompetence) === 0}
              className="px-3 h-full flex items-center justify-center text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-30 transition-colors"
            >
               <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          <button 
            disabled={isRefreshing}
            onClick={loadData}
            className="p-2.5 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 shadow-sm active:scale-95 transition-all text-xs flex items-center justify-center h-10 w-10 disabled:opacity-50"
            title="Atualizar dados"
            id="refresh-dashboard-btn"
          >
            <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </header>

      <div className="space-y-6 mt-6">
        {/* SATELLITE COMMUNICATIONS FROM ACCOUNTANT */}
          {data.messages && data.messages.filter((m: any) => !m.read && m.direction !== 'client_to_accountant').map((msg: any) => (
            <div key={msg.id} className="bg-indigo-50/70 dark:bg-slate-800/40 backdrop-blur-md border border-indigo-100/40 dark:border-slate-700/60 rounded-3xl p-4 flex items-start shadow-xs">
              <Bell className="text-indigo-500 dark:text-indigo-400 w-5 h-5 mt-0.5 mr-3 shrink-0" />
              <div>
                <h4 className="font-bold text-indigo-950 dark:text-indigo-300 text-sm">Mensagem do Contador</h4>
                <p className="text-slate-600 dark:text-slate-300 text-xs mt-1 leading-relaxed">{msg.content}</p>
                <span className="text-[10px] text-slate-400 mt-2 block font-mono">{format(parseISO(msg.createdAt), "dd MMM, HH:mm", { locale: ptBR })}</span>
              </div>
            </div>
          ))}


          {/* 🚨 DEDICATED HIGH-VISIBILITY DUE DATE SECTION (VENCIMENTOS) */}
          <DueDatesCard
            docs={sortedExpirations}
            selectedCompetence={selectedCompetence}
            clientId={data.client.id}
            copiedId={copiedId}
            getDocDueStatus={getDocDueStatus}
            onCopyCode={handleCopyCode}
            onMarkAsPaid={handleMarkAsPaid}
            onReloadData={loadData}
          />

          {/* ⚡ TACTILE QUICK KPI STATS CARDS */}
          <KpiCards
            selectedCompetence={selectedCompetence}
            monthsTotalBilling={monthsTotalBilling}
            pendingDocsCount={pendingDocs.length}
            totalPendingValue={totalPendingValue}
            overdueDocsCount={allOverdueDocs.length}
            totalOverdueValue={totalOverdueValue}
          />

      {/* SECURITY / PASSWORD RESET NOTIFICATION BOX — only until first access is done */}
      {!data.client?.firstAccessDone && (
      <div className="bg-gradient-to-r from-slate-50 to-indigo-50 dark:from-slate-800/30 dark:to-slate-800/10 border border-slate-200/50 dark:border-slate-700/50 rounded-3xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-sm">
        <div className="flex items-start sm:items-center">
          <div className="p-2.5 bg-blue-500/10 text-blue-600 dark:text-blue-400 rounded-xl mr-3 shrink-0">
            <Edit3 className="w-5 h-5 animate-pulse" />
          </div>
          <div>
            <h4 className="font-bold text-slate-800 dark:text-slate-200 text-sm">Configuração de Acesso</h4>
            <p className="text-slate-500 dark:text-slate-400 text-xs mt-0.5 leading-relaxed">
              O login e a senha inicial do portal do cliente cadastrados são o seu CNPJ. Altere de forma segura clicando ao lado.
            </p>
          </div>
        </div>
        <button 
          onClick={() => window.dispatchEvent(new CustomEvent("open-password-change-modal"))}
          className="px-4 py-2.5 text-xs font-bold rounded-xl bg-slate-900 hover:bg-slate-800 dark:bg-emerald-500 dark:text-white dark:hover:bg-emerald-600 text-white shadow-sm transition-transform active:scale-95 flex items-center justify-center shrink-0 self-start sm:self-center"
        >
          Alterar Senha de Acesso
        </button>
      </div>
      )}

      {/* MAIN LAYOUT */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        
        {/* COLUMN 1 & 2 */}
        <div className="lg:col-span-2 space-y-6">
          
          {/* UPLOAD & DATA ENTRY AREA */}
          <div className="bg-white/85 dark:bg-slate-800/95 backdrop-blur-md border border-slate-100 dark:border-slate-800 rounded-3xl p-6 shadow-sm flex flex-col justify-center">
            <h3 className="font-bold text-slate-800 dark:text-white mb-1">Inserir Dados da Competência {selectedCompetence}</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-5">Selecione o extrato bancário do seu negócio. Apenas formato PDF ou OFX.</p>
            
            <div className="flex flex-col sm:flex-row gap-3">
               {hasBankStatement ? (
                  <div className="flex-1 min-h-[44px] flex justify-center items-center text-emerald-600 font-bold bg-emerald-500/10 p-3 rounded-2xl border border-emerald-500/20 text-sm">
                    <FileCheck className="w-5 h-5 mr-2 text-emerald-500" /> Extrato Bancário Anexado
                  </div>
                ) : (
                  <div className="flex-1">
                    <input type="file" ref={fileInputRef} className="hidden" accept=".pdf,.ofx" onChange={handleUploadBankStatement}/>
                    <button 
                      disabled={isUploading} 
                      onClick={() => fileInputRef.current?.click()} 
                      className="w-full min-h-[44px] px-4 py-3 bg-slate-900 dark:bg-slate-700 text-white text-sm font-bold rounded-2xl shadow-sm hover:bg-slate-800 dark:hover:bg-slate-600 transition-colors flex items-center justify-center disabled:opacity-50"
                    >
                      <Upload className="w-4 h-4 mr-2" /> {isUploading ? "Enviando extrato..." : "Upload Extrato Bancário (PDF/OFX)"}
                    </button>
                  </div>
                )}
             </div>
          </div>


        </div>

        {/* COLUMN 3 */}
        <SupportCards whatsappSupport={whatsappSupport} />
      </div>

      {/* 📊 ACCUMULATED HISTORIC GRAPH AREA SECTION */}
      <BillingHistoryCharts chartData={chartData} />
      </div>

      {/* MODAL CONFIG NOTIFICAÇÕES */}
      <NotificationPreferencesModal
        show={showPrefsModal}
        form={prefsForm}
        onChange={setPrefsForm}
        onClose={() => setShowPrefsModal(false)}
        onSave={handleSavePrefs}
      />

    </div>
  );
}
