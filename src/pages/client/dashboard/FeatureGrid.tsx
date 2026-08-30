import type { ComponentType } from "react";
import { useNavigate } from "react-router-dom";
import {
  Receipt,
  AlertTriangle,
  FolderOpen,
  Upload,
  TrendingUp,
  Bell,
} from "lucide-react";

const brl = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

type Accent = "brand" | "warn" | "danger" | "slate";

const accentRing: Record<Accent, string> = {
  brand: "bg-brand-wash text-brand-fg",
  warn: "bg-warn-wash text-warn",
  danger: "bg-danger-wash text-danger",
  slate: "bg-sunken text-faint",
};

interface Tile {
  key: string;
  title: string;
  sub: string;
  Icon: ComponentType<{ className?: string; strokeWidth?: number }>;
  accent: Accent;
  alert?: boolean;
  onClick: () => void;
}

interface FeatureGridProps {
  pendingCount: number;
  pendingTotal: number;
  overdueCount: number;
  vaultCount: number;
  uploadsCount: number;
  billingTotal: number;
  notificationsOn: boolean;
  onGoGuias: () => void;
  onGoCharts: () => void;
  onOpenNotifications: () => void;
  onEnableNotifications: () => void;
}

// The "everything at a glance, tap to go" grid — one tile per area of the
// portal, counts pulled from the dashboard payload (no new requests).
export function FeatureGrid({
  pendingCount,
  pendingTotal,
  overdueCount,
  vaultCount,
  uploadsCount,
  billingTotal,
  notificationsOn,
  onGoGuias,
  onGoCharts,
  onOpenNotifications,
  onEnableNotifications,
}: FeatureGridProps) {
  const navigate = useNavigate();

  const tiles: Tile[] = [
    {
      key: "guias",
      title: "Guias a pagar",
      sub:
        pendingCount > 0
          ? `${pendingCount} ${pendingCount === 1 ? "pendente" : "pendentes"} · ${brl(pendingTotal)}`
          : "Nada pendente",
      Icon: Receipt,
      accent: pendingCount > 0 ? "brand" : "slate",
      onClick: onGoGuias,
    },
    {
      key: "atraso",
      title: "Em atraso",
      sub:
        overdueCount > 0
          ? `${overdueCount} ${overdueCount === 1 ? "guia vencida" : "guias vencidas"}`
          : "Nenhuma",
      Icon: AlertTriangle,
      accent: overdueCount > 0 ? "danger" : "slate",
      alert: overdueCount > 0,
      onClick: () => navigate("/overdue"),
    },
    {
      key: "cofre",
      title: "Cofre digital",
      sub: `${vaultCount} ${vaultCount === 1 ? "documento" : "documentos"}`,
      Icon: FolderOpen,
      accent: "slate",
      onClick: () => navigate("/vault"),
    },
    {
      key: "envios",
      title: "Meus envios",
      sub: `${uploadsCount} ${uploadsCount === 1 ? "enviado" : "enviados"}`,
      Icon: Upload,
      accent: "slate",
      onClick: () => navigate("/uploads"),
    },
    {
      key: "faturamento",
      title: "Faturamento",
      sub: brl(billingTotal),
      Icon: TrendingUp,
      accent: "warn",
      onClick: onGoCharts,
    },
    {
      key: "notificacoes",
      title: "Notificações",
      sub: notificationsOn ? "Ativadas neste aparelho" : "Toque para ativar",
      Icon: Bell,
      accent: notificationsOn ? "brand" : "slate",
      onClick: notificationsOn ? onOpenNotifications : onEnableNotifications,
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {tiles.map((t) => (
        <button
          key={t.key}
          type="button"
          onClick={t.onClick}
          className={`flex flex-col gap-2 rounded-2xl border p-3.5 text-left shadow-xs transition-shadow hover:shadow-sm ${
            t.alert ? "border-danger/30 bg-danger-wash" : "border-line bg-surface"
          }`}
        >
          <span
            className={`grid size-9 place-items-center rounded-xl ${accentRing[t.accent]}`}
          >
            <t.Icon className="size-[17px]" strokeWidth={1.9} />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold leading-tight text-ink">
              {t.title}
            </span>
            <span className="mt-1 block text-xs leading-snug text-muted tabular-nums">
              {t.sub}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}
