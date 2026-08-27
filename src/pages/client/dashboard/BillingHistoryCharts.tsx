import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, Legend } from "recharts";

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

export function BillingHistoryCharts({ chartData }: BillingHistoryChartsProps) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 bg-slate-50/50 dark:bg-slate-900/50 p-4 rounded-3xl border border-slate-100 dark:border-slate-800">
      {/* Graph 1 */}
      <div className="bg-white dark:bg-slate-800/80 backdrop-blur-xl rounded-2xl border border-slate-100 dark:border-slate-800 p-6">
        <h3 className="font-bold text-slate-800 dark:text-white text-sm mb-4">Faturamento Declarado (Histórico 12 Meses)</h3>
        <div className="h-[230px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="colorServNew" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="colorVendNew" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" opacity={0.15} />
              <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 10, fontWeight: 'medium' }} dy={10} />
              <YAxis axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 10 }} />
              <Tooltip contentStyle={{ borderRadius: '12px', border: 'none', background: 'rgba(30,41,59,0.95)', color: 'white', backdropFilter: 'blur(8px)', fontSize: '12px' }} />
              <Legend iconType="circle" wrapperStyle={{ fontSize: '10px', paddingTop: '10px', color: '#94a3b8' }} />
              <Area type="monotone" name="Serviços" dataKey="FaturamentoServiço" stroke="#10b981" strokeWidth={2.5} fillOpacity={1} fill="url(#colorServNew)" />
              <Area type="monotone" name="Mercadorias" dataKey="FaturamentoVendas" stroke="#3b82f6" strokeWidth={2.5} fillOpacity={1} fill="url(#colorVendNew)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Graph 2 */}
      <div className="bg-white dark:bg-slate-800/80 backdrop-blur-xl rounded-2xl border border-slate-100 dark:border-slate-800 p-6">
        <h3 className="font-bold text-slate-800 dark:text-white text-sm mb-4">Total de Entradas vs Serviços Tomados</h3>
        <div className="h-[230px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" opacity={0.15} />
              <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 10, fontWeight: 'medium' }} dy={10} />
              <YAxis axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 10 }} />
              <Tooltip cursor={{ fill: 'rgba(255,255,255,0.05)' }} contentStyle={{ borderRadius: '12px', border: 'none', background: 'rgba(30,41,59,0.95)', color: 'white', backdropFilter: 'blur(8px)', fontSize: '12px' }} />
              <Legend iconType="circle" wrapperStyle={{ fontSize: '10px', paddingTop: '10px', color: '#94a3b8' }} />
              <Bar dataKey="Entradas" name="Entradas Totais" fill="#10b981" radius={[4, 4, 0, 0]} />
              <Bar dataKey="Tomados" name="Serviços Tomados" fill="#f43f5e" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
