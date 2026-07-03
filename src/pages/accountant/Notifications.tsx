import { apiFetch } from "../../lib/apiClient";
import React, { useState, useEffect } from "react";
import { Send, Bell, CheckSquare, Square, Clock, Trash2, Calendar, AlertTriangle } from "lucide-react";

export function AccountantNotifications() {
  const [loading, setLoading] = useState(false);
  const [clients, setClients] = useState<any[]>([]);
  const [selectedClientIds, setSelectedClientIds] = useState<string[]>([]);
  
  // Tab control: 'imediato', 'agendado', 'solicitacoes'
  const [activeTab, setActiveTab] = useState<'imediato' | 'agendado' | 'solicitacoes'>('imediato');

  // Immediate notification form
  const [formImmediate, setFormImmediate] = useState({ title: "", body: "" });

  // Scheduled notification form
  const [formScheduled, setFormScheduled] = useState({
    clientId: "",
    type: "3_days_before", // 'recurrent', '3_days_before', 'on_due_date', 'on_file_available'
    title: "Lembrete: Vencimento da Guia [NOME_GUIA]",
    body: "Olá! Lembramos que sua guia [NOME_GUIA] vence em [VENCIMENTO]. Efetue o pagamento para evitar multas.",
    scheduleDay: "5", // Default day of month for recurrent
    scheduleTime: "09:00", // Default time
  });

  // List of active scheduled notification rules
  const [scheduledRules, setScheduledRules] = useState<any[]>([]);

  // List of pending recalculations
  const [solicitacoes, setSolicitacoes] = useState<any[]>([]);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [resolveForm, setResolveForm] = useState({ valor: "", dueDate: "", file: null as File | null });

  const loadClients = () => {
    apiFetch("/api/accountant/clients", {
      
    }, "accountant")
      .then(res => res.json())
      .then(data => setClients(data.clients || []));
  };

  const loadScheduledRules = () => {
    apiFetch("/api/admin/notifications/scheduled", {
      
    }, "accountant")
      .then(res => res.json())
      .then(data => setScheduledRules(data.list || []))
      .catch(err => console.error("Erro ao carregar agendamentos:", err));
  };

  const loadSolicitacoes = () => {
    apiFetch("/api/accountant/solicitacoes", {
      
    }, "accountant")
      .then(res => res.json())
      .then(data => setSolicitacoes(data.solicitacoes || []))
      .catch(err => console.error("Erro ao carregar solicitações:", err));
  };

  useEffect(() => {
    loadClients();
    loadScheduledRules();
    loadSolicitacoes();
  }, []);

  const handleSendImmediate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedClientIds.length === 0) {
      alert("Selecione pelo menos um cliente.");
      return;
    }
    
    setLoading(true);
    try {
      const res = await apiFetch("/api/admin/notifications/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          
        },
        body: JSON.stringify({
          userIds: selectedClientIds,
          title: formImmediate.title,
          body: formImmediate.body
        })
      }, "accountant");
      if (res.ok) {
        alert("Notificação push disparada com sucesso!");
        setFormImmediate({ title: "", body: "" });
        setSelectedClientIds([]);
      } else {
        alert("Erro ao enviar notificação.");
      }
    } catch (err: any) {
      alert("Erro de conexão: " + err.message);
    }
    setLoading(false);
  };

  const handleCreateSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await apiFetch("/api/admin/notifications/schedule", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          
        },
        body: JSON.stringify({
          clientId: formScheduled.clientId || null,
          type: formScheduled.type,
          title: formScheduled.title,
          body: formScheduled.body,
          scheduleDay: formScheduled.type === "recurrent" ? formScheduled.scheduleDay : null,
          scheduleTime: formScheduled.scheduleTime
        })
      }, "accountant");
      if (res.ok) {
        alert("Regra de alerta salva com sucesso!");
        loadScheduledRules();
        // Reset to defaults
        setFormScheduled({
          clientId: "",
          type: "3_days_before",
          title: "Lembrete: Vencimento da Guia [NOME_GUIA]",
          body: "Olá! Lembramos que sua guia [NOME_GUIA] vence em [VENCIMENTO]. Efetue o pagamento para evitar multas.",
          scheduleDay: "5",
          scheduleTime: "09:00"
        });
      } else {
        const data = await res.json();
        alert("Erro ao salvar agendamento: " + (data.error || "Erro interno"));
      }
    } catch (err: any) {
      alert("Erro ao salvar: " + err.message);
    }
    setLoading(false);
  };

  const handleDeleteRule = async (id: number) => {
    if (!confirm("Tem certeza que deseja excluir esta regra de alerta?")) return;
    try {
      const res = await apiFetch(`/api/admin/notifications/scheduled/${id}`, {
        method: "DELETE",
        
      }, "accountant");
      if (res.ok) {
        loadScheduledRules();
      } else {
        alert("Erro ao deletar regra.");
      }
    } catch (err: any) {
      alert("Erro ao deletar: " + err.message);
    }
  };

  const toggleClient = (id: string) => {
    if (selectedClientIds.includes(id)) {
      setSelectedClientIds(selectedClientIds.filter(cId => cId !== id));
    } else {
      setSelectedClientIds([...selectedClientIds, id]);
    }
  };

  const toggleAll = () => {
    if (selectedClientIds.length === clients.length) {
      setSelectedClientIds([]);
    } else {
      setSelectedClientIds(clients.map(c => c.id));
    }
  };

  const getClientName = (id: string | null) => {
    if (!id) return "Todos os Clientes";
    const found = clients.find(c => c.id === id);
    return found ? found.name : "Cliente Desconhecido";
  };

  const handleResolveSolicitacao = async (id: string) => {
    if (!resolveForm.file) {
        alert("Por favor, selecione o arquivo da nova guia.");
        return;
    }
    
    setLoading(true);
    const formData = new FormData();
    formData.append("file", resolveForm.file);
    if (resolveForm.valor) formData.append("valor", resolveForm.valor);
    if (resolveForm.dueDate) formData.append("dueDate", resolveForm.dueDate);

    try {
        const res = await apiFetch(`/api/accountant/solicitacoes/${id}`, {
            method: "POST",
            body: formData
        }, "accountant");

        if (res.ok) {
            alert("Guia enviada com sucesso ao cliente!");
            setResolvingId(null);
            setResolveForm({ valor: "", dueDate: "", file: null });
            loadSolicitacoes();
        } else {
            const data = await res.json();
            alert("Erro ao enviar guia: " + (data.error || "Erro desconhecido"));
        }
    } catch (err: any) {
        alert("Erro de conexão: " + err.message);
    }
    setLoading(false);
  };

  const getRuleTypeLabel = (type: string) => {
    switch (type) {
      case "recurrent": return "Recorrente Mensal";
      case "3_days_before": return "Faltando 3 Dias p/ Vencimento";
      case "on_due_date": return "No Dia do Vencimento";
      case "on_file_available": return "Assim que a Guia for Disponibilizada";
      default: return type;
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in max-w-6xl mx-auto pb-16">
      
      {/* HEADER SECTION */}
      <header className="h-16 flex items-center justify-between px-8 bg-white/40 dark:bg-slate-900/30 backdrop-blur-md border border-slate-100 dark:border-slate-800 rounded-3xl shadow-sm">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">Notificações Push</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">Disparar ou agendar alertas automáticos para seus clientes fiscais.</p>
        </div>
      </header>

      {/* TABS DE SELEÇÃO DE FLUXO */}
      <div className="flex bg-slate-100 dark:bg-slate-850 p-1.5 rounded-2xl w-fit gap-1 shadow-inner">
        <button
          onClick={() => setActiveTab('imediato')}
          className={`px-5 py-2.5 rounded-xl text-xs font-bold transition-all ${
            activeTab === 'imediato'
              ? "bg-white dark:bg-slate-800 text-slate-950 dark:text-white shadow-xs"
              : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-300"
          }`}
        >
          <Bell className="w-3.5 h-3.5 inline mr-1.5" /> Envio Imediato
        </button>
        <button
          onClick={() => setActiveTab('agendado')}
          className={`px-5 py-2.5 rounded-xl text-xs font-bold transition-all ${
            activeTab === 'agendado'
              ? "bg-white dark:bg-slate-800 text-slate-950 dark:text-white shadow-xs"
              : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-300"
          }`}
        >
          <Clock className="w-3.5 h-3.5 inline mr-1.5" /> Alertas Inteligentes & Agendados
        </button>
        <button
          onClick={() => setActiveTab('solicitacoes')}
          className={`px-5 py-2.5 rounded-xl text-xs font-bold transition-all ${
            activeTab === 'solicitacoes'
              ? "bg-white dark:bg-slate-800 text-slate-950 dark:text-white shadow-xs"
              : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-300"
          }`}
        >
          <AlertTriangle className="w-3.5 h-3.5 inline mr-1.5" /> Solicitações de Recálculo
        </button>
      </div>

      {activeTab === 'imediato' && (
        /* TAB 1: ENVIO IMEDIATO */
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-start">
          {/* Formulário de Envio */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-xs">
             <h2 className="text-sm font-bold text-slate-800 dark:text-white mb-4 flex items-center">
                <Bell className="w-4 h-4 mr-2 text-indigo-500" /> Disparar Push Notification
             </h2>
             <form onSubmit={handleSendImmediate} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">Título da Mensagem</label>
                  <input 
                    type="text" 
                    required 
                    value={formImmediate.title}
                    onChange={e => setFormImmediate({...formImmediate, title: e.target.value})}
                    placeholder="Ex: Novo fechamento de faturamento disponível" 
                    className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">Mensagem (Corpo)</label>
                  <textarea 
                    required 
                    value={formImmediate.body}
                    onChange={e => setFormImmediate({...formImmediate, body: e.target.value})}
                    placeholder="Sua guia referente ao mês 05/2026 já está disponível na sua tela de vencimentos." 
                    className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500 min-h-[120px]"
                  />
                </div>
                <button 
                  type="submit" 
                  disabled={loading}
                  className="w-full bg-slate-900 dark:bg-indigo-600 hover:bg-slate-800 dark:hover:bg-indigo-700 text-white font-bold text-sm px-4 py-3 rounded-xl flex items-center justify-center transition-colors disabled:opacity-50"
                >
                  <Send className="w-4 h-4 mr-2" /> {loading ? "Enviando..." : "Disparar Alerta Agora"}
                </button>
             </form>
          </div>

          {/* Lista de Clientes */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-xs flex flex-col max-h-[500px]">
            <div className="flex items-center justify-between mb-4 shrink-0">
               <h2 className="text-sm font-bold text-slate-800 dark:text-white">Selecione os Clientes</h2>
               <button 
                 type="button" 
                 onClick={toggleAll}
                 className="text-xs font-semibold text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/30 hover:bg-indigo-100 px-3 py-1.5 rounded-xl transition-colors"
               >
                 {selectedClientIds.length === clients.length ? "Desmarcar Todos" : "Selecionar Todos"}
               </button>
            </div>
            <div className="overflow-y-auto pr-2 space-y-2 flex-1 scrollbar-thin">
               {clients.length === 0 ? (
                 <p className="text-sm text-slate-500 italic text-center py-4">Nenhum cliente cadastrado.</p>
               ) : (
                 clients.map(client => (
                   <div 
                     key={client.id} 
                     onClick={() => toggleClient(client.id)}
                     className={`flex items-center gap-3 p-3 rounded-2xl border cursor-pointer transition-colors ${
                       selectedClientIds.includes(client.id)
                         ? "border-indigo-500/30 bg-indigo-500/5 dark:bg-indigo-950/20"
                         : "border-slate-100 hover:border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-850"
                     }`}
                   >
                     {selectedClientIds.includes(client.id) ? (
                       <CheckSquare className="w-5 h-5 text-indigo-500 shrink-0" />
                     ) : (
                       <Square className="w-5 h-5 text-slate-300 shrink-0" />
                     )}
                     <div className="flex-1 min-w-0">
                       <p className="text-sm font-bold text-slate-800 dark:text-white truncate">{client.name}</p>
                       <p className="text-[10px] text-slate-500 dark:text-slate-400 truncate uppercase">
                         {client.accountantCategory || "Geral"} • {client.cnpj}
                       </p>
                     </div>
                   </div>
                 ))
               )}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'agendado' && (
        /* TAB 2: AGENDAMENTOS E ALERTAS AUTOMÁTICOS */
        <div className="space-y-8">
          
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-8 items-start">
            
            {/* Form de Configuração de Regra */}
            <div className="lg:col-span-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-xs">
              <h2 className="text-sm font-bold text-slate-800 dark:text-white mb-4 flex items-center">
                 <Clock className="w-4 h-4 mr-2 text-indigo-500" /> Nova Regra de Alerta
              </h2>
              
              <form onSubmit={handleCreateSchedule} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">Destinatário</label>
                  <select
                    value={formScheduled.clientId}
                    onChange={e => setFormScheduled({...formScheduled, clientId: e.target.value})}
                    className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="">Todos os Clientes</option>
                    {clients.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">Gatilho de Disparo</label>
                  <select
                    value={formScheduled.type}
                    onChange={e => {
                      const t = e.target.value;
                      let title = formScheduled.title;
                      let body = formScheduled.body;
                      if (t === "recurrent") {
                        title = "Lembrete: Informe seu Faturamento";
                        body = "Olá! Lembramos que você deve informar o faturamento mensal no portal contábil até o final do período.";
                      } else if (t === "3_days_before") {
                        title = "Lembrete: Vencimento da Guia [NOME_GUIA]";
                        body = "Olá! Lembramos que sua guia [NOME_GUIA] vence em [VENCIMENTO]. Efetue o pagamento para evitar multas.";
                      } else if (t === "on_due_date") {
                        title = "⚠️ Vence Hoje: Guia [NOME_GUIA]";
                        body = "Atenção: A sua guia [NOME_GUIA] vence no dia de hoje ([VENCIMENTO]). Pague via Pix copiando o código no painel.";
                      } else if (t === "on_file_available") {
                        title = "Nova Guia Disponível: [CATEGORIA]";
                        body = "Sua guia da categoria [CATEGORIA] está disponível no painel para pagamento. Vencimento: [VENCIMENTO].";
                      }
                      setFormScheduled({...formScheduled, type: t, title, body});
                    }}
                    className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="3_days_before">Faltando 3 Dias para Vencimento de Guias</option>
                    <option value="on_due_date">No Dia do Vencimento de Guias</option>
                    <option value="recurrent">Recorrente Mensal (Lembrete de Faturamento)</option>
                    <option value="on_file_available">Assim que a guia for disponibilizada</option>
                  </select>
                </div>

                {formScheduled.type === "recurrent" && (
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1">Dia do Envio (Mensal)</label>
                    <select
                      value={formScheduled.scheduleDay}
                      onChange={e => setFormScheduled({...formScheduled, scheduleDay: e.target.value})}
                      className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                    >
                      {Array.from({ length: 28 }, (_, i) => i + 1).map(d => (
                        <option key={d} value={String(d)}>Todo dia {d}</option>
                      ))}
                    </select>
                  </div>
                )}

                {formScheduled.type !== "on_file_available" && (
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1">Horário de Envio (Brasília UTC-3)</label>
                    <input
                      type="time"
                      value={formScheduled.scheduleTime}
                      onChange={e => setFormScheduled({...formScheduled, scheduleTime: e.target.value})}
                      className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                )}

                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">Título do Alerta</label>
                  <input 
                    type="text"
                    required
                    value={formScheduled.title}
                    onChange={e => setFormScheduled({...formScheduled, title: e.target.value})}
                    className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">Corpo do Alerta</label>
                  <textarea 
                    required
                    value={formScheduled.body}
                    onChange={e => setFormScheduled({...formScheduled, body: e.target.value})}
                    className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500 min-h-[100px]"
                  />
                  {(formScheduled.type === "3_days_before" || formScheduled.type === "on_due_date" || formScheduled.type === "on_file_available") && (
                    <span className="text-[10px] text-slate-400 mt-1 block">
                      Variáveis aceitas: <code className="bg-slate-100 dark:bg-slate-800 px-1 py-0.5 rounded text-indigo-500">[NOME_GUIA]</code>, <code className="bg-slate-100 dark:bg-slate-800 px-1 py-0.5 rounded text-indigo-500">[VENCIMENTO]</code> e <code className="bg-slate-100 dark:bg-slate-800 px-1 py-0.5 rounded text-indigo-500">[CATEGORIA]</code>
                    </span>
                  )}
                </div>

                <button 
                  type="submit" 
                  disabled={loading}
                  className="w-full bg-slate-900 dark:bg-indigo-600 hover:bg-slate-800 dark:hover:bg-indigo-700 text-white font-bold text-sm px-4 py-3 rounded-xl flex items-center justify-center transition-colors disabled:opacity-50"
                >
                  <Calendar className="w-4 h-4 mr-2" /> Salvar Regra de Alerta
                </button>
              </form>
            </div>

            {/* Lista de Regras de Alerta Atuais */}
            <div className="lg:col-span-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-xs flex flex-col">
              <h2 className="text-sm font-bold text-slate-800 dark:text-white mb-4">Regras de Alerta Ativas</h2>
              
              <div className="space-y-4 max-h-[500px] overflow-y-auto pr-2">
                {scheduledRules.length === 0 ? (
                  <div className="py-12 text-center text-slate-500">
                    <AlertTriangle className="w-8 h-8 text-slate-350 mx-auto mb-2" />
                    <p className="text-xs font-semibold">Nenhuma regra de notificação ativa.</p>
                    <p className="text-[11px] mt-1">Crie uma regra ao lado para automatizar lembretes.</p>
                  </div>
                ) : (
                  scheduledRules.map(rule => (
                    <div 
                      key={rule.id} 
                      className="border border-slate-100 dark:border-slate-800 rounded-2xl p-4 space-y-2 hover:border-slate-250 transition-colors bg-slate-50/50 dark:bg-slate-850/20"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <span className="px-2 py-0.5 text-[9px] font-bold uppercase bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 rounded-full border border-indigo-100 dark:border-indigo-900/30">
                            {getRuleTypeLabel(rule.type)}
                          </span>
                          <h4 className="font-bold text-slate-800 dark:text-white text-sm mt-1">{rule.title}</h4>
                        </div>
                        <button
                          onClick={() => handleDeleteRule(rule.id)}
                          className="p-1.5 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/20 rounded-lg transition-colors shrink-0"
                          title="Remover regra"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                      
                      <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">{rule.body}</p>
                      
                      <div className="flex items-center justify-between pt-2 border-t border-slate-100/50 dark:border-slate-800/50 text-[10px] text-slate-400">
                        <span>Foco: <strong>{getClientName(rule.clientId)}</strong></span>
                        <div className="flex gap-3">
                          {rule.scheduleDay && <span>Dia de Envio: <strong>Todo dia {rule.scheduleDay}</strong></span>}
                          {rule.scheduleTime && <span>Horário: <strong>{rule.scheduleTime}</strong></span>}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

          </div>
          
        </div>
      )}

      {activeTab === 'solicitacoes' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-xs min-h-[400px]">
          <h2 className="text-sm font-bold text-slate-800 dark:text-white mb-4 flex items-center">
             <AlertTriangle className="w-4 h-4 mr-2 text-indigo-500" /> Guias Aguardando Recálculo
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mb-6">
            Documentos em que o cliente solicitou recálculo e não são suportados nativamente (FGTS, Honorários, etc). Você precisa gerar o novo arquivo, informar os valores e reenviar por aqui.
          </p>

          {solicitacoes.length === 0 ? (
            <div className="text-center py-10">
               <p className="text-slate-400 text-sm">Nenhuma solicitação de recálculo pendente.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {solicitacoes.map(sol => (
                <div key={sol.id} className="border border-slate-200 dark:border-slate-800 rounded-2xl p-4 bg-slate-50 dark:bg-slate-800/30 flex flex-col md:flex-row gap-4 justify-between items-start md:items-center">
                  <div className="flex-1">
                    <p className="text-xs text-indigo-500 font-bold mb-1">Cliente: {sol.clientName} ({sol.clientCnpj})</p>
                    <h3 className="font-bold text-slate-800 dark:text-white">{sol.title}</h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400">Categoria: {sol.category} • Vencimento original: {sol.dueDate}</p>
                    <p className="text-[10px] text-slate-400 mt-2">Solicitado em: {new Date(sol.createdAt).toLocaleString('pt-BR')}</p>
                  </div>
                  
                  {resolvingId === sol.id ? (
                    <div className="w-full md:w-auto bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 p-4 rounded-xl shadow-xs space-y-3">
                       <div>
                         <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Novo Arquivo (PDF)</label>
                         <input type="file" accept=".pdf" onChange={e => setResolveForm({...resolveForm, file: e.target.files?.[0] || null})} className="text-xs w-full text-slate-700 dark:text-slate-300 file:mr-2 file:py-1 file:px-2 file:rounded-md file:border-0 file:text-xs file:bg-indigo-50 dark:file:bg-indigo-900 file:text-indigo-700 dark:file:text-indigo-300" />
                       </div>
                       <div className="flex gap-2">
                         <div className="flex-1">
                            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Novo Vencimento</label>
                            <input type="text" placeholder="DD/MM/AAAA" value={resolveForm.dueDate} onChange={e => setResolveForm({...resolveForm, dueDate: e.target.value})} className="w-full px-2 py-1.5 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 rounded text-xs text-slate-900 dark:text-white" />
                         </div>
                         <div className="flex-1">
                            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Valor (Opcional)</label>
                            <input type="number" step="0.01" placeholder="Ex: 150.00" value={resolveForm.valor} onChange={e => setResolveForm({...resolveForm, valor: e.target.value})} className="w-full px-2 py-1.5 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 rounded text-xs text-slate-900 dark:text-white" />
                         </div>
                       </div>
                       <div className="flex gap-2 mt-2">
                          <button onClick={() => setResolvingId(null)} className="flex-1 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800">Cancelar</button>
                          <button onClick={() => handleResolveSolicitacao(sol.id)} disabled={loading} className="flex-1 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold transition-colors">{loading ? 'Enviando...' : 'Enviar Guia'}</button>
                       </div>
                    </div>
                  ) : (
                    <button onClick={() => setResolvingId(sol.id)} className="px-4 py-2 rounded-xl bg-slate-900 dark:bg-indigo-600 text-white font-bold text-xs shrink-0 hover:bg-slate-800 dark:hover:bg-indigo-700">
                      Responder / Enviar Nova Guia
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}