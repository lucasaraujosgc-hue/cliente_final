import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
} from "recharts";

interface ChartPoint {
  month: string;
  FaturamentoServiço: number;
  FaturamentoVendas: number;
  Tomados: number;
  Entradas: number;
}

interface BillingHistoryChartsProps {
  chartData: ChartPoint[];
}

const C = {
  brand: "#0d7a51",
  blue: "#3a7ca5",
  rust: "#b0472c",
  axis: "#8a9b93",
  grid: "#8a9b9333",
};

const axisTick = { fill: C.axis, fontSize: 10 };
const tooltipStyle = {
  borderRadius: 10,
  border: "1px solid rgba(0,0,0,0.08)",
  background: "#fff",
  color: "#17211d",
  fontSize: 12,
  boxShadow: "0 8px 24px -12px rgba(20,40,32,0.2)",
};

function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div className="mb-4 flex flex-wrap gap-x-4 gap-y-1">
      {items.map((i) => (
        <span key={i.label} className="flex items-center gap-1.5 text-[11px] text-muted">
          <span className="size-2 rounded-full" style={{ background: i.color }} />
          {i.label}
        </span>
      ))}
    </div>
  );
}

export function BillingHistoryCharts({ chartData }: BillingHistoryChartsProps) {
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      <div className="rounded-2xl border border-line bg-surface p-5 shadow-sm">
        <h3 className="font-serif text-base font-semibold text-ink">Faturamento declarado</h3>
        <p className="mt-0.5 text-xs text-muted">Histórico dos últimos meses</p>
        <div className="mt-3">
          <Legend
            items={[
              { label: "Serviços", color: C.brand },
              { label: "Mercadorias", color: C.blue },
            ]}
          />
          <div className="h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 6, right: 8, left: -18, bottom: 0 }}>
                <defs>
                  <linearGradient id="fillServ" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={C.brand} stopOpacity={0.16} />
                    <stop offset="100%" stopColor={C.brand} stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="fillVend" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={C.blue} stopOpacity={0.16} />
                    <stop offset="100%" stopColor={C.blue} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="0" vertical={false} stroke={C.grid} />
                <XAxis dataKey="month" axisLine={false} tickLine={false} tick={axisTick} dy={8} />
                <YAxis axisLine={false} tickLine={false} tick={axisTick} width={54} />
                <Tooltip contentStyle={tooltipStyle} />
                <Area type="monotone" name="Serviços" dataKey="FaturamentoServiço" stroke={C.brand} strokeWidth={2} fill="url(#fillServ)" />
                <Area type="monotone" name="Mercadorias" dataKey="FaturamentoVendas" stroke={C.blue} strokeWidth={2} fill="url(#fillVend)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-line bg-surface p-5 shadow-sm">
        <h3 className="font-serif text-base font-semibold text-ink">Entradas e serviços tomados</h3>
        <p className="mt-0.5 text-xs text-muted">Comparativo mensal</p>
        <div className="mt-3">
          <Legend
            items={[
              { label: "Entradas totais", color: C.brand },
              { label: "Serviços tomados", color: C.rust },
            ]}
          />
          <div className="h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 6, right: 8, left: -18, bottom: 0 }} barGap={4}>
                <CartesianGrid strokeDasharray="0" vertical={false} stroke={C.grid} />
                <XAxis dataKey="month" axisLine={false} tickLine={false} tick={axisTick} dy={8} />
                <YAxis axisLine={false} tickLine={false} tick={axisTick} width={54} />
                <Tooltip cursor={{ fill: "#8a9b9314" }} contentStyle={tooltipStyle} />
                <Bar dataKey="Entradas" name="Entradas totais" fill={C.brand} radius={[3, 3, 0, 0]} maxBarSize={22} />
                <Bar dataKey="Tomados" name="Serviços tomados" fill={C.rust} radius={[3, 3, 0, 0]} maxBarSize={22} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}
