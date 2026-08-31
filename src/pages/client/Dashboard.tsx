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
  Settings,
} from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { format, parse, subMonths, parseISO, differenceInDays } from "date-fns";
import { ptBR } from "date-fns/locale";
import * as XLSX from "xlsx";
import { PwaBanner } from "./dashboard/PwaBanner";
import { DueDatesCard, DocDueStatus } from "./dashboard/DueDatesCard";
import { BillingHistoryCharts } from "./dashboard/BillingHistoryCharts";
import { SupportCards } from "./dashboard/SupportCards";
import { NotificationPreferencesModal } from "./dashboard/NotificationPreferencesModal";
import { StatusHeroCard } from "./dashboard/StatusHeroCard";
import { FeatureGrid } from "./dashboard/FeatureGrid";
import { NfseCallout } from "./dashboard/NfseCallout";
import { ClientDashboardSkeleton } from "../../components/Skeleton";

export function ClientDashboard() {
  const location = useLocation();
  const navigate = useNavigate();
  
  const [data, setData] = useState<any>(null);
  const [whatsappSupport, setWhatsappSupport] = useState("");
  const [selectedCompetence, setSelectedCompetence] = useState(format(subMonths(new Date(), 1), "MM/yyyy"));
  const [isUploading, setIsUploading] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [paidFlashId, setPaidFlashId] = useState<string | null>(null);
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
  const guiasRef = useRef<HTMLDivElement>(null);
  const chartsRef = useRef<HTMLDivElement>(null);
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
        setPaidFlashId(docId);
        setTimeout(() => setPaidFlashId((cur) => (cur === docId ? null : cur)), 2800);
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
  const getDocDueStatus = (doc: any): DocDueStatus => {
    const base: DocDueStatus = {
      label: "Pendente",
      colorClass: "",
      badgeColor: "",
      priority: 2,
      isOverdue: false,
      isSoon: false,
    };
    if (doc.status === "paid") return { ...base, label: "Pago", priority: 3 };
    if (doc.status === "late") return { ...base, label: "Atrasada", priority: 0, isOverdue: true };

    const isSpecialCategory = ["contracheque", "notas fiscais", "nota fiscal", "outros", "payroll"].includes(doc.category?.toLowerCase() || "");
    if (!doc.dueDate || isSpecialCategory) return { ...base, label: "Disponível", priority: 4 };

    const todayDate = new Date();
    const parsedDue = parseDueDateString(doc.dueDate);
    if (!parsedDue) return base;

    todayDate.setHours(0, 0, 0, 0);
    parsedDue.setHours(0, 0, 0, 0);
    const diffDays = differenceInDays(parsedDue, todayDate);

    if (diffDays < 0) return { ...base, label: `Atrasada ${Math.abs(diffDays)}d`, priority: 0, isOverdue: true };
    if (diffDays === 0) return { ...base, label: "Vence hoje", priority: 1, isSoon: true };
    if (diffDays <= 4) return { ...base, label: `Vence em ${diffDays}d`, priority: 1, isSoon: true };
    return base;
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

  // Sort documents: Overdue first, followed by soon-to-expire, standard pending, and paid
  const sortedExpirations = [...allCurrentDocs].sort((a: any, b: any) => {
    const statusA = getDocDueStatus(a);
    const statusB = getDocDueStatus(b);
    return statusA.priority - statusB.priority;
  });

  // --- Cross-competence guia view — drives the status hero + the chronological strip ---
  const isGuiaLikeDoc = (d: any) => {
    const c = (d.category || "").toLowerCase();
    if (["bank_statement", "sitfis_receita", "sitfis", "contracheque", "outros", "payroll", "company", "upload"].includes(c)) return false;
    return Boolean(d.dueDate) || Boolean(d.pixCode);
  };
  const guiaDueTime = (d: any) => {
    const parsed = parseDueDateString(d.dueDate);
    return parsed ? parsed.getTime() : Number.MAX_SAFE_INTEGER;
  };

  const unpaidGuias = data.documents.filter(
    (d: any) => isGuiaLikeDoc(d) && d.status !== "paid" && d.status !== "ok" && d.dueDate,
  );
  const upcomingGuias = [...unpaidGuias].sort((a: any, b: any) => guiaDueTime(a) - guiaDueTime(b));

  const pendingGuiasNotOverdue = upcomingGuias.filter((d: any) => !getDocDueStatus(d).isOverdue);
  const totalPendingGuiasValue = pendingGuiasNotOverdue.reduce((sum: number, doc: any) => {
    const val = doc.extractedData?.extractedValue;
    return sum + (typeof val === "number" ? val : 0);
  }, 0);
  const hasAnyGuia = data.documents.some(isGuiaLikeDoc);

  const scrollToGuias = () => guiasRef.current?.scrollIntoView({ block: "start" });
  const scrollToCharts = () => chartsRef.current?.scrollIntoView({ block: "start" });

  // Counts for the feature grid — same filters the target pages use.
  const vaultCount = data.documents.filter(
    (d: any) => d.uploadedBy === "accountant",
  ).length;
  const uploadsCount = data.documents.filter(
    (d: any) => d.category === "upload",
  ).length;

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

  const iconBtn =
    "grid size-9 place-items-center rounded-lg border border-line bg-surface text-muted shadow-xs transition-colors hover:bg-sunken hover:text-ink disabled:opacity-50";

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="min-w-0">
          <h1 className="font-serif text-xl font-semibold leading-tight text-ink sm:text-[1.75rem]">
            Olá, {data.client.name}
          </h1>
          <p className="mt-1 hidden items-center gap-2 text-sm text-muted sm:flex">
            O que você deve e quando vence.
            {isRefreshing && (
              <span className="flex items-center gap-1 text-xs text-faint">
                <RefreshCw className="size-3 animate-spin" /> atualizando
              </span>
            )}
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <div className="flex h-9 items-center overflow-hidden rounded-lg border border-line bg-surface shadow-xs">
            <button
              onClick={handlePrevCompetence}
              disabled={availableCompetences.indexOf(selectedCompetence) === availableCompetences.length - 1}
              className="grid h-full w-8 place-items-center text-muted transition-colors hover:bg-sunken disabled:opacity-30"
              aria-label="Competência anterior"
            >
              <ChevronLeft className="size-4" />
            </button>
            <span className="min-w-[86px] px-1 text-center text-sm font-semibold text-ink tabular-nums">
              {selectedCompetence}
            </span>
            <button
              onClick={handleNextCompetence}
              disabled={availableCompetences.indexOf(selectedCompetence) === 0}
              className="grid h-full w-8 place-items-center text-muted transition-colors hover:bg-sunken disabled:opacity-30"
              aria-label="Próxima competência"
            >
              <ChevronRight className="size-4" />
            </button>
          </div>

          <button disabled={isRefreshing} onClick={loadData} className={iconBtn} title="Atualizar" id="refresh-dashboard-btn">
            <RefreshCw className={`size-4 ${isRefreshing ? "animate-spin" : ""}`} strokeWidth={1.9} />
          </button>
          <button onClick={() => setShowPrefsModal(true)} className={iconBtn} title="Notificações">
            <Bell className="size-4" strokeWidth={1.9} />
          </button>
          <button onClick={() => window.dispatchEvent(new CustomEvent("open-password-change-modal"))} className={iconBtn} title="Alterar senha">
            <Settings className="size-4" strokeWidth={1.9} />
          </button>
        </div>
      </header>

      <StatusHeroCard
        overdueCount={allOverdueDocs.length}
        overdueTotal={totalOverdueValue}
        pendingCount={pendingGuiasNotOverdue.length}
        pendingTotal={totalPendingGuiasValue}
        hasAnyGuia={hasAnyGuia}
        onSeeGuias={scrollToGuias}
      />

      {!data.client?.firstAccessDone && (
        <div className="flex flex-col gap-3 rounded-xl border border-warn/25 bg-warn-wash px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <Edit3 className="mt-0.5 size-4 shrink-0 text-warn" strokeWidth={1.9} />
            <div>
              <p className="text-sm font-semibold text-ink">Sua senha ainda é o CNPJ</p>
              <p className="mt-0.5 text-xs leading-relaxed text-muted">
                Troque por uma senha sua e cadastre um e-mail de contato.
              </p>
            </div>
          </div>
          <button
            onClick={() => window.dispatchEvent(new CustomEvent("open-password-change-modal"))}
            className="shrink-0 self-start rounded-lg bg-brand px-3.5 py-2 text-xs font-semibold text-white shadow-xs transition-colors hover:bg-brand-strong sm:self-center"
          >
            Alterar agora
          </button>
        </div>
      )}

      {data.messages
        ?.filter((m: any) => !m.read && m.direction !== "client_to_accountant")
        .map((msg: any) => (
          <div key={msg.id} className="rounded-xl border border-line bg-sunken px-4 py-3.5">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-faint">
                Mensagem do escritório
              </p>
              <span className="text-[11px] text-faint tabular-nums">
                {format(parseISO(msg.createdAt), "dd MMM · HH:mm", { locale: ptBR })}
              </span>
            </div>
            <p className="mt-1.5 text-sm leading-relaxed text-ink">{msg.content}</p>
          </div>
        ))}

      <div ref={guiasRef} className="scroll-mt-4">
        <DueDatesCard
          docs={sortedExpirations}
          selectedCompetence={selectedCompetence}
          clientId={data.client.id}
          copiedId={copiedId}
          paidFlashId={paidFlashId}
          getDocDueStatus={getDocDueStatus}
          onCopyCode={handleCopyCode}
          onMarkAsPaid={handleMarkAsPaid}
          onReloadData={loadData}
        />
      </div>

      <NfseCallout />

      <FeatureGrid
        pendingCount={pendingGuiasNotOverdue.length}
        pendingTotal={totalPendingGuiasValue}
        overdueCount={allOverdueDocs.length}
        vaultCount={vaultCount}
        uploadsCount={uploadsCount}
        billingTotal={monthsTotalBilling}
        notificationsOn={pushGranted}
        onGoGuias={scrollToGuias}
        onGoCharts={scrollToCharts}
        onOpenNotifications={() => setShowPrefsModal(true)}
        onEnableNotifications={() => subscribeToPush().then(() => setPushGranted(true))}
      />

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1.4fr_1fr] lg:items-start">
        <div className="rounded-2xl border border-line bg-surface p-5 shadow-sm">
          <h3 className="font-serif text-base font-semibold text-ink">
            Extrato bancário — {selectedCompetence}
          </h3>
          <p className="mt-0.5 text-xs text-muted">Envie o extrato do mês em PDF ou OFX.</p>
          <div className="mt-4">
            {hasBankStatement ? (
              <div className="flex items-center justify-center gap-2 rounded-lg border border-brand/25 bg-brand-wash py-3 text-sm font-semibold text-brand-fg">
                <FileCheck className="size-4" strokeWidth={1.9} /> Extrato anexado
              </div>
            ) : (
              <>
                <input type="file" ref={fileInputRef} className="hidden" accept=".pdf,.ofx" onChange={handleUploadBankStatement} />
                <button
                  disabled={isUploading}
                  onClick={() => fileInputRef.current?.click()}
                  className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-strong disabled:opacity-50"
                >
                  <Upload className="size-4" strokeWidth={1.9} />
                  {isUploading ? "Enviando..." : "Enviar extrato (PDF/OFX)"}
                </button>
              </>
            )}
          </div>
        </div>

        <SupportCards whatsappSupport={whatsappSupport} />
      </div>

      <div ref={chartsRef} className="scroll-mt-4">
        <BillingHistoryCharts chartData={chartData} />
      </div>

      {showPwaBanner && <PwaBanner onDismiss={dismissPwaBanner} />}

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
