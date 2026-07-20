import { apiFetch } from "../../lib/apiClient";
import React, { useEffect, useState, useRef, FormEvent } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft, Send, UploadCloud, MessageSquare, FileSpreadsheet, Edit3, DollarSign, Calendar, PlusCircle, Check, Trash2, Download, AlertCircle, X, CheckCircle } from "lucide-react";
import { format, parseISO, isBefore } from "date-fns";
import { ptBR } from "date-fns/locale";
import * as XLSX from "xlsx";

export function ClientDetail() {
  const { id } = useParams();
  const [data, setData] = useState<any>(null);

  const [editingMsg, setEditingMsg] = useState<any>(null);

  const [docFilterCategory, setDocFilterCategory] = useState("");
  const [docFilterOverdue, setDocFilterOverdue] = useState(false);

  const [editingDocId, setEditingDocId] = useState<string | null>(null);
  const [editDocForm, setEditDocForm] = useState({
    title: "",
    category: "",
    dueDate: "",
    status: "",
    valor: "",
    file: null as File | null
  });

  const [billingForm, setBillingForm] = useState({ 
    month: "", 
    servicesRevenue: 0, 
    salesRevenue: 0, 
    totalIncomes: 0, 
    servicesTaken: 0 
  });
  const [showBillingForm, setShowBillingForm] = useState(false);
  const excelFileRef = useRef<HTMLInputElement>(null);

  const handleExcelImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: "binary" });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const items = XLSX.utils.sheet_to_json(ws);
        
        const parsedData = items.map((row: any) => ({
           month: String(row.Competencia || row.Competência || row.Mes || row.Mês || row.month || "").trim(),
           servicesRevenue: Number(row.FaturamentoServico || row.FaturamentoServiço || row.servicesRevenue || 0),
           salesRevenue: Number(row.FaturamentoVenda || row.salesRevenue || 0),
           totalIncomes: Number(row.TotalEntradas || row.totalIncomes || 0),
           servicesTaken: Number(row.ServicosTomados || row.ServiçosTomados || row.servicesTaken || 0),
        })).filter(r => r.month && r.month.includes("/"));

        if (parsedData.length > 0) {
          const res = await apiFetch(`/api/accountant/client/${id}/bulk-billing`, {
            method: "POST",
            headers: { 
              "Content-Type": "application/json", 
               
            },
            body: JSON.stringify({ data: parsedData })
          }, "accountant");
          if (res.ok) {
            loadData();
            alert(`Sucesso! ${parsedData.length} registros de faturamento importados com sucesso.`);
          } else {
            alert("Erro ao salvar faturamentos no servidor.");
          }
        } else {
          alert("Nenhum registro de faturamento válido encontrado. Certifique-se de preencher as colunas (Ex: Competencia, FaturamentoServico, FaturamentoVenda, TotalEntradas, ServicosTomados) e que a competência esteja no formato MM/AAAA (Ex: 05/2026).");
        }
      } catch (err: any) {
        alert("Erro ao ler o arquivo Excel: " + err.message);
      }
      if (excelFileRef.current) excelFileRef.current.value = "";
    };
    reader.readAsBinaryString(file);
  };

  const handleSaveBilling = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!billingForm.month || !billingForm.month.includes("/")) {
       alert("Por favor, digite a Competência no formato MM/AAAA (Ex: 06/2026)");
       return;
    }
    
    try {
      const res = await apiFetch(`/api/accountant/client/${id}/update-billing`, {
         method: "POST",
         headers: {
           "Content-Type": "application/json",
           
         },
         body: JSON.stringify(billingForm)
      }, "accountant");
      if (res.ok) {
        setBillingForm({ month: "", servicesRevenue: 0, salesRevenue: 0, totalIncomes: 0, servicesTaken: 0 });
        setShowBillingForm(false);
        loadData();
        alert("Faturamento salvo com sucesso!");
      } else {
        alert("Erro ao salvar dados de faturamento.");
      }
    } catch (err: any) {
       alert("Erro de conexão.");
    }
  };

  const getAuthenticatedFileUrl = (url: string | null) => {
    if (!url) return undefined;
    if (url.startsWith('/api/')) {
      const token = localStorage.getItem('accountantToken') || sessionStorage.getItem('accountantToken');
      return `${url}?token=${token}`;
    }
    return url;
  };


  const handleDeleteDoc = async (docId: string) => {
    if (!confirm("Tem certeza que deseja excluir este arquivo?")) return;
    try {
      const res = await apiFetch("/api/accountant/files/bulk", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileIds: [docId] })
      }, "accountant");
      if (res.ok) {
        alert("Arquivo excluído com sucesso!");
        loadData();
      } else {
        alert("Erro ao excluir arquivo");
      }
    } catch (e: any) {
      alert("Erro de conexão: " + e.message);
    }
  };

  const loadData = () => {
    apiFetch(`/api/accountant/client/${id}`, {
      
    }, "accountant")
      .then(r => r.json())
      .then(setData);
  }

  useEffect(() => loadData(), [id]);

  const handleUpload = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    formData.append("clientId", id as string);
    await apiFetch("/api/accountant/upload-doc", {
      method: "POST",
      headers: { 
        
      },
      body: formData
    }, "accountant");
    (e.target as HTMLFormElement).reset();
    loadData();
    alert("Documento disponibilizado!");
  };

  const handleSendMessage = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const content = formData.get("content") as string;
    
    if (editingMsg) {
      await apiFetch(`/api/accountant/message/${editingMsg.id}`, {
        method: "PUT",
        headers: { 
          
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ content })
      }, "accountant");
      setEditingMsg(null);
      alert("Mensagem atualizada!");
    } else {
      await apiFetch("/api/accountant/message", {
        method: "POST",
        headers: { 
          
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ 
          clientId: id, 
          content
        })
      }, "accountant");
      alert("Mensagem enviada no mural do cliente!");
    }

    (e.target as HTMLFormElement).reset();
    loadData();
  };

  const deleteMessage = async (msgId: string) => {
    if (!confirm("Excluir esta mensagem?")) return;
    await apiFetch(`/api/accountant/message/${msgId}`, {
      method: "DELETE",
      
    }, "accountant");
    loadData();
  };

  const markDocOk = async (docId: string) => {
    await apiFetch(`/api/accountant/document/${docId}/status`, {
      method: "POST",
      headers: { 
        
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ status: "ok" })
    }, "accountant");
    loadData();
  };

  const markDocStatus = async (docId: string, status: string) => {
    await apiFetch(`/api/accountant/document/${docId}/status`, {
      method: "POST",
      headers: { 
        
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ status })
    }, "accountant");
    loadData();
  };

  const handleEditDocSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingDocId) return;

    const formData = new FormData();
    if (editDocForm.title) formData.append("title", editDocForm.title);
    if (editDocForm.category) formData.append("category", editDocForm.category);
    if (editDocForm.dueDate) formData.append("dueDate", editDocForm.dueDate);
    if (editDocForm.status) formData.append("status", editDocForm.status);
    if (editDocForm.valor) formData.append("valor", editDocForm.valor);
    if (editDocForm.file) formData.append("file", editDocForm.file);

    try {
      const res = await apiFetch(`/api/accountant/document/${editingDocId}`, {
        method: "PUT",
        headers: {
          
        },
        body: formData,
      }, "accountant");

      if (res.ok) {
        setEditingDocId(null);
        loadData();
      } else {
        const d = await res.json();
        alert(d.error || "Erro ao atualizar documento");
      }
    } catch (e) {
      console.error(e);
      alert("Erro na requisição.");
    }
  };

  if (!data) return null;

  return (
    <div className="space-y-8 animate-in fade-in">
      <header className="flex items-center gap-4 bg-white/40 backdrop-blur-md border border-white rounded-2xl shadow-sm px-6 py-4 -mx-4">
        <Link to="/admin/clients" className="p-2 bg-white/80 border border-white rounded-lg text-slate-500 hover:text-slate-900 transition-colors shadow-sm">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900">{data.client.name}</h1>
          <p className="text-slate-500 text-xs mt-1">CNPJ: {data.client.cnpj} • <span className={`font-semibold ${data.client.regularityStatus === 'green' ? 'text-emerald-600' : 'text-amber-600'}`}>Status: {data.client.regularityStatus}</span></p>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        
        {/* Upload Manual Panel */}
        <div className="bg-white/80 backdrop-blur-xl rounded-3xl border border-white shadow-xl shadow-slate-200/50 overflow-hidden">
           <div className="px-6 py-4 border-b border-white bg-white/50 flex flex-col justify-center">
             <h3 className="font-semibold text-slate-800 text-sm flex items-center"><UploadCloud className="w-4 h-4 mr-2" /> Upload Manual de Guia/Documento</h3>
           </div>
           <form onSubmit={handleUpload} className="p-6 space-y-4">
              <div>
                 <label className="block text-xs font-semibold text-slate-500 mb-1">Título do Arquivo</label>
                 <input name="title" required className="w-full px-3 py-2 text-sm border border-slate-200 bg-white/50 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" placeholder="Ex: DAS Junho 2026"/>
              </div>
              <div className="flex gap-4">
                <div className="flex-1">
                   <label className="block text-xs font-semibold text-slate-500 mb-1">Categoria</label>
                   <select name="category" className="w-full px-3 py-2 text-sm border border-slate-200 bg-white/50 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none">
                      <option value="">Selecione...</option>
                      <option value="Simples Nacional">Simples Nacional</option>
                      <option value="Honorários">Honorários</option>
                      <option value="Contracheque">Contracheque</option>
                      <option value="FGTS">FGTS</option>
                      <option value="INSS">INSS</option>
                      <option value="Folha de Pagamento">Folha de Pagamento</option>
                      <option value="Rescisão">Rescisão</option>
                      <option value="Férias">Férias</option>
                      <option value="Notas Fiscais">Notas Fiscais</option>
                      <option value="Parcelamento">Parcelamento</option>
                      <option value="Outros">Outros</option>
                      <option value="Corpo de Bombeiros">Corpo de Bombeiros</option>
                      <option value="IBAMA">IBAMA</option>
                      <option value="CSLL">CSLL</option>
                      <option value="IRPJ">IRPJ</option>
                      <option value="Alvará">Alvará</option>
                      <option value="IRPF">IRPF</option>
                   </select>
                </div>
                <div className="flex-1">
                   <label className="block text-xs font-semibold text-slate-500 mb-1">Competência</label>
                   <input type="text" name="competence" placeholder="MM/yyyy" className="w-full px-3 py-2 text-sm border border-slate-200 bg-white/50 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"/>
                </div>
                <div className="flex-1">
                   <label className="block text-xs font-semibold text-slate-500 mb-1">Vencimento (Opc.)</label>
                   <input type="date" name="dueDate" className="w-full px-3 py-2 text-sm border border-slate-200 bg-white/50 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"/>
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Arquivo Fiscal/PDF</label>
                <input type="file" name="file" required className="w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-slate-100 file:text-slate-700 hover:file:bg-slate-200" />
              </div>
              <div className="pt-2">
                 <button type="submit" className="w-full bg-slate-900 text-white py-2.5 rounded-lg text-sm font-bold hover:bg-slate-800 transition-colors shadow-md">
                    Disponibilizar no Cofre do Cliente
                 </button>
              </div>
           </form>
        </div>

       {/* Message Panel */}
        <div className="bg-white/80 backdrop-blur-xl rounded-3xl border border-white shadow-xl shadow-slate-200/50 overflow-hidden flex flex-col">
           <div className="px-6 py-4 border-b border-white bg-white/50 flex flex-col justify-center">
             <h3 className="font-semibold text-slate-800 text-sm flex items-center"><MessageSquare className="w-4 h-4 mr-2" /> Mural de Recados</h3>
           </div>
           
           <div className="flex-1 overflow-auto p-6 space-y-4 max-h-[300px]">
              {data.messages.length === 0 && <p className="text-sm text-slate-400 text-center py-4">Nenhum recado enviado.</p>}
              {data.messages.map((m:any) => {
                 const isFromClient = m.direction === 'client_to_accountant';
                 return (
                 <div key={m.id} className={`backdrop-blur-md border p-4 rounded-2xl text-sm shadow-sm relative group ${isFromClient ? 'bg-amber-50/80 border-amber-100/50 text-amber-900 shadow-amber-50' : 'bg-blue-50/80 border-blue-100/50 text-blue-900 shadow-blue-50'}`}>
                    <div className="flex items-center gap-2 mb-1">
                       <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${isFromClient ? 'bg-amber-200 text-amber-800' : 'bg-blue-200 text-blue-800'}`}>
                          {isFromClient ? 'DO CLIENTE' : 'SEU RECADO'}
                       </span>
                    </div>
                    <p className="font-medium">{m.content}</p>
                    <div className="flex justify-between items-end">
                       <span className={`text-[10px] uppercase font-bold mt-2 block ${isFromClient ? 'text-amber-500/80' : 'text-blue-400/80'}`}>{format(parseISO(m.createdAt), "dd MMM HH:mm", {locale: ptBR})}</span>
                       <div className="hidden group-hover:flex gap-2">
                          <button type="button" onClick={() => deleteMessage(m.id)} title="Excluir"><Trash2 className="w-4 h-4 text-red-500 hover:text-red-700"/></button>
                          {!isFromClient && <button type="button" onClick={() => setEditingMsg(m)} title="Editar"><Edit3 className="w-4 h-4 text-blue-500 hover:text-blue-700"/></button>}
                       </div>
                    </div>
                 </div>
                 );
              })}
           </div>

           <form onSubmit={handleSendMessage} className="p-4 border-t border-white bg-white/60 flex flex-col gap-2 relative">
              {editingMsg && (
                 <div className="flex items-center justify-between text-xs font-semibold text-blue-600 bg-blue-50 px-3 py-1 rounded-lg">
                    <span>Editando mensagem...</span>
                    <button type="button" onClick={() => setEditingMsg(null)} className="text-slate-400 hover:text-slate-600">Cancelar</button>
                 </div>
              )}
              <div className="flex gap-2">
                 <input name="content" required placeholder="Digite um aviso importante..." defaultValue={editingMsg?.content || ""} className="flex-1 px-4 py-2.5 text-sm border border-slate-200 bg-white/80 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none shadow-sm"/>
                 <button type="submit" className="bg-blue-600 text-white px-4 py-2.5 rounded-xl hover:bg-blue-700 transition-colors shadow-md">
                    <Send className="w-4 h-4" />
                 </button>
              </div>
           </form>
        </div>

      </div>

      {/* SEÇÃO DE FATURAMENTO - SIMPLES FINANCEIRO */}
      <div className="bg-white/80 backdrop-blur-xl rounded-3xl border border-white shadow-xl shadow-slate-200/50 overflow-hidden mt-8">
        <div className="px-6 py-4 border-b border-white bg-white/50 flex flex-col sm:flex-row justify-between sm:items-center gap-4">
           <div>
              <h3 className="font-semibold text-slate-800 text-sm flex items-center">
                <FileSpreadsheet className="w-5 h-5 mr-2 text-virgula-green" /> 
                Informar Faturamento Mensal (Serviços / Vendas)
              </h3>
              <p className="text-xs text-slate-500 mt-1">Insira os valores de faturamento do cliente manualmente ou importe via arquivo Excel.</p>
           </div>
           
           <div className="flex gap-2 shrink-0">
             <button 
                type="button"
                onClick={() => setShowBillingForm(!showBillingForm)} 
                className="bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold px-3 py-2 rounded-lg flex items-center transition-colors"
             >
                {showBillingForm ? "Ocultar Lançamento" : "Lançamento Manual"}
             </button>
             
             <input 
               type="file" 
               ref={excelFileRef} 
               onChange={handleExcelImport} 
               accept=".xlsx, .xls" 
               className="hidden" 
             />
             <button 
                type="button"
                onClick={() => excelFileRef.current?.click()} 
                className="bg-virgula-green hover:bg-emerald-600 text-white text-xs font-bold px-3 py-2 rounded-lg flex items-center transition-colors shadow-sm"
             >
                <UploadCloud className="w-4 h-4 mr-1.5" /> Importar Excel
             </button>
           </div>
        </div>

        {showBillingForm && (
           <form onSubmit={handleSaveBilling} className="p-6 border-b border-slate-100 bg-slate-50/50 space-y-4 animate-in slide-in-from-top duration-200">
              <div className="flex justify-between items-center mb-2">
                 <span className="text-xs text-slate-500 font-semibold">Preencha os valores (permite zerados):</span>
                 <a 
                   href="data:text/csv;charset=utf-8,Competencia,FaturamentoServico,FaturamentoVenda,TotalEntradas,ServicosTomados%0A06/2026,0,0,0,0" 
                   download="modelo_importacao.csv"
                   className="text-xs text-virgula-green hover:underline font-bold"
                 >
                   Baixar Modelo CSV
                 </a>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-5 gap-4">
                 <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1">Competência (MM/AAAA)</label>
                    <input 
                      type="text" 
                      required 
                      placeholder="Ex: 05/2026" 
                      value={billingForm.month}
                      onChange={e => setBillingForm({...billingForm, month: e.target.value})}
                      className="w-full px-3 py-2 border border-slate-200 bg-white rounded-lg text-sm outline-none focus:ring-2 focus:ring-virgula-green"
                    />
                 </div>
                 <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1">Faturamento Serviços (R$)</label>
                    <input 
                      type="number" 
                      step="0.01"
                      required
                      placeholder="0.00"
                      value={billingForm.servicesRevenue}
                      onChange={e => setBillingForm({...billingForm, servicesRevenue: e.target.value ? Number(e.target.value) : 0})}
                      className="w-full px-3 py-2 border border-slate-200 bg-white rounded-lg text-sm outline-none focus:ring-2 focus:ring-virgula-green"
                    />
                 </div>
                 <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1">Faturamento Vendas (R$)</label>
                    <input 
                      type="number" 
                      step="0.01"
                      required
                      placeholder="0.00"
                      value={billingForm.salesRevenue}
                      onChange={e => setBillingForm({...billingForm, salesRevenue: e.target.value ? Number(e.target.value) : 0})}
                      className="w-full px-3 py-2 border border-slate-200 bg-white rounded-lg text-sm outline-none focus:ring-2 focus:ring-virgula-green"
                    />
                 </div>
                 <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1">Total Entradas (R$)</label>
                    <input 
                      type="number" 
                      step="0.01"
                      required
                      placeholder="0.00"
                      value={billingForm.totalIncomes}
                      onChange={e => setBillingForm({...billingForm, totalIncomes: e.target.value ? Number(e.target.value) : 0})}
                      className="w-full px-3 py-2 border border-slate-200 bg-white rounded-lg text-sm outline-none focus:ring-2 focus:ring-virgula-green"
                    />
                 </div>
                 <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1">Serviços Tomados (R$)</label>
                    <input 
                      type="number" 
                      step="0.01"
                      required
                      placeholder="0.00"
                      value={billingForm.servicesTaken}
                      onChange={e => setBillingForm({...billingForm, servicesTaken: e.target.value ? Number(e.target.value) : 0})}
                      className="w-full px-3 py-2 border border-slate-200 bg-white rounded-lg text-sm outline-none focus:ring-2 focus:ring-virgula-green"
                    />
                 </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                 <button 
                   type="submit" 
                   className="bg-slate-900 text-white text-xs font-bold px-4 py-2 rounded-lg hover:bg-slate-800 transition-colors shadow-sm"
                 >
                   Salvar Lançamento
                 </button>
              </div>
           </form>
        )}

        <div className="p-6">
           <h4 className="text-xs font-bold text-slate-600 uppercase tracking-wider mb-3">Histórico de Faturamentos Lançados</h4>
           {(!data.billing || data.billing.length === 0) ? (
              <p className="text-sm text-slate-400 text-center py-6 bg-slate-50/50 rounded-xl border border-dashed border-slate-100">
                Nenhum registro de faturamento lançado para este cliente ainda. 
              </p>
           ) : (
              <div className="overflow-x-auto">
                 <table className="w-full text-left border-collapse text-sm">
                    <thead>
                       <tr className="border-b border-slate-100 text-slate-400 text-xs uppercase tracking-wider">
                          <th className="py-2.5 font-bold">Mês/Ano</th>
                          <th className="py-2.5 font-bold text-right">Fat. Serviços</th>
                          <th className="py-2.5 font-bold text-right">Fat. Vendas</th>
                          <th className="py-2.5 font-bold text-right">Tot. Entradas</th>
                          <th className="py-2.5 font-bold text-right">Servços Tomados</th>
                          <th className="py-2.5 font-bold text-right">Faturamento Total</th>
                       </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100/50 text-slate-700">
                       {data.billing.map((b: any) => {
                          const totalRevenue = (b.servicesRevenue || 0) + (b.salesRevenue || 0);
                          return (
                             <tr key={b.id} className="hover:bg-slate-50/40 transition-colors">
                                <td className="py-3 font-semibold text-slate-950 flex items-center">
                                   <Calendar className="w-4 h-4 text-slate-400 mr-2 shrink-0" />
                                   {b.month}
                                </td>
                                <td className="py-3 text-right">R$ {Number(b.servicesRevenue || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                <td className="py-3 text-right">R$ {Number(b.salesRevenue || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                <td className="py-3 text-right text-emerald-600 font-medium">R$ {Number(b.totalIncomes || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                <td className="py-3 text-right text-amber-600 font-medium">R$ {Number(b.servicesTaken || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                <td className="py-3 text-right font-bold text-slate-900 bg-slate-50 px-2.5 rounded-lg">R$ {totalRevenue.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                             </tr>
                          );
                       })}
                    </tbody>
                 </table>
              </div>
           )}
        </div>
      </div>

      <div className="bg-white/80 backdrop-blur-xl border text-slate-900 border-white rounded-3xl overflow-hidden shadow-xl shadow-slate-200/50 mt-8">
        <div className="px-6 py-4 border-b border-white bg-white/50 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
           <h3 className="font-semibold text-slate-800">Todos os Documentos do Cliente</h3>
           <div className="flex flex-wrap items-center gap-3">
             <label className="flex items-center gap-2 text-sm text-slate-600 font-medium bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-200 cursor-pointer hover:bg-slate-100 transition-colors">
                <input 
                  type="checkbox" 
                  checked={docFilterOverdue} 
                  onChange={e => setDocFilterOverdue(e.target.checked)}
                  className="rounded border-slate-300 text-rose-500 focus:ring-rose-500"
                />
                Apenas Atrasados
             </label>
             <select 
               value={docFilterCategory} 
               onChange={e => setDocFilterCategory(e.target.value)}
               className="px-3 py-1.5 text-sm border border-slate-200 rounded-lg bg-slate-50 outline-none focus:ring-2 focus:ring-blue-500"
             >
                <option value="">Todas as Categorias</option>
                <option value="Simples Nacional">Simples Nacional</option>
                <option value="Honorários">Honorários</option>
                <option value="Contracheque">Contracheque</option>
                <option value="FGTS">FGTS</option>
                <option value="INSS">INSS</option>
                <option value="Folha de Pagamento">Folha de Pagamento</option>
                <option value="Rescisão">Rescisão</option>
                <option value="Férias">Férias</option>
                <option value="Notas Fiscais">Notas Fiscais</option>
                <option value="Parcelamento">Parcelamento</option>
                <option value="Outros">Outros</option>
                <option value="Corpo de Bombeiros">Corpo de Bombeiros</option>
                <option value="IBAMA">IBAMA</option>
                <option value="CSLL">CSLL</option>
                <option value="IRPJ">IRPJ</option>
                <option value="Alvará">Alvará</option>
                <option value="IRPF">IRPF</option>
             </select>
           </div>
        </div>
        <div className="divide-y divide-slate-100/50 max-h-[500px] overflow-auto">
          {(() => {
            const filteredDocs = data.documents.filter((doc: any) => {
               if (docFilterCategory && doc.category !== docFilterCategory) return false;
               if (docFilterOverdue) {
                  if (!doc.dueDate) return false;
                  if (doc.status === 'paid' || doc.status === 'ok') return false;
                  const isLate = isBefore(parseISO(doc.dueDate), new Date());
                  if (!isLate) return false;
               }
               return true;
            });

            if (filteredDocs.length === 0) {
              return <div className="p-8 text-center text-slate-500">Nenhum documento encontrado.</div>;
            }

            return filteredDocs.map((doc: any) => {
              let isLate = false;
              if (doc.dueDate && doc.status !== 'paid' && doc.status !== 'ok') {
                isLate = isBefore(parseISO(doc.dueDate), new Date());
              }

              return (
                <div key={doc.id} className={`p-4 px-6 hover:bg-white flex items-center justify-between group transition-colors ${isLate ? 'bg-rose-50/30' : ''}`}>
                  <div className="flex items-center">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center mr-4 ${isLate ? 'bg-rose-100 text-rose-600' : (doc.uploadedBy === 'client' ? 'bg-amber-50 text-amber-600' : 'bg-blue-50 text-blue-600')}`}>
                      {isLate ? <AlertCircle className="w-5 h-5 animate-pulse" /> : (doc.uploadedBy === 'client' ? <UploadCloud className="w-5 h-5" /> : <MessageSquare className="w-5 h-5" />)}
                    </div>
                    <div className="flex-1">
                      <h4 className={`text-sm font-medium ${isLate ? 'text-rose-700' : 'text-slate-900'}`}>{doc.title} {doc.competence && `(Comp: ${doc.competence})`}</h4>
                      <div className="text-xs text-slate-500 mt-1 flex flex-wrap gap-2 items-center">
                         <span className="font-medium text-slate-700">Origem: {doc.uploadedBy === 'client' ? 'Cliente' : 'Contador'}</span>
                         <span>•</span>
                         <span className={doc.status === 'ok' || doc.status === 'viewed' ? 'text-emerald-500 font-semibold' : ''}>Status: {doc.status}</span>
                         <span>•</span>
                         <span>Cat: {doc.category}</span>
                         <span>•</span>
                         {doc.dueDate && (
                           <span className={isLate ? 'text-rose-600 font-bold' : ''}>
                             Vence: {doc.dueDate.includes('T') ? doc.dueDate.split('T')[0] : doc.dueDate} {isLate && '(ATRASADO)'}
                           </span>
                         )}
                         {doc.extractedData?.extractedValue && (
                           <>
                             <span>•</span>
                             <span className="text-slate-700 font-semibold">Valor: {doc.extractedData.extractedValue.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</span>
                           </>
                         )}
                         <span>•</span>
                         <span>{format(parseISO(doc.createdAt), "dd MMM, yyyy", {locale: ptBR})}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity ml-4">
                     <button 
                        onClick={() => {
                          setEditingDocId(doc.id);
                          setEditDocForm({
                             title: doc.title || "",
                             category: doc.category || "",
                             dueDate: doc.dueDate ? doc.dueDate.split('T')[0] : "",
                             status: doc.status || "",
                             valor: doc.extractedData?.extractedValue || "",
                             file: null
                          });
                        }} 
                        title="Editar Documento" 
                        className="p-2 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100"
                     >
                        <Edit3 className="w-4 h-4" />
                     </button>
                     {doc.fileUrl && (
                        <a href={getAuthenticatedFileUrl(doc.fileUrl)} target="_blank" download rel="noreferrer" title="Baixar" className="p-2 bg-slate-100 text-slate-600 rounded-lg hover:bg-slate-200">
                           <Download className="w-4 h-4" />
                        </a>
                     )}
                     <button onClick={() => markDocStatus(doc.id, "late")} title="Marcar como Atrasado" className="p-2 bg-rose-50 text-rose-600 rounded-lg hover:bg-rose-100">
                        <X className="w-4 h-4" />
                     </button>
                     <button onClick={() => markDocStatus(doc.id, "paid")} title="Marcar como Em Dia / Pago" className="p-2 bg-emerald-50 text-emerald-600 rounded-lg hover:bg-emerald-100">
                        <CheckCircle className="w-4 h-4" />
                     </button>
                     <button onClick={() => handleDeleteDoc(doc.id)} title="Excluir Arquivo" className="p-2 bg-red-50 text-red-600 rounded-lg hover:bg-red-100"><Trash2 className="w-4 h-4" /></button>
                     {doc.uploadedBy === 'client' && doc.status !== 'ok' && doc.status !== 'viewed' && doc.status !== 'paid' && doc.status !== 'late' && (
                        <button onClick={() => markDocOk(doc.id)} title="Marcar como Recebido/OK" className="p-2 bg-emerald-50 text-emerald-600 rounded-lg hover:bg-emerald-100">
                           <Check className="w-4 h-4" />
                        </button>
                     )}
                  </div>
                </div>
              );
            });
          })()}
        </div>
      </div>

      <div className="bg-white/80 backdrop-blur-xl rounded-3xl border border-white shadow-xl shadow-slate-200/50 overflow-hidden p-6 mt-8">
        <div className="flex justify-between items-center mb-4">
          <h3 className="font-bold text-slate-800 text-sm">Integração API (Hash da Empresa)</h3>
          {data.client.integrationHash ? (
            <button 
              onClick={async () => {
                await apiFetch(`/api/accountant/client/${id}/revoke-token`, {
                  method: "POST",
                  
                }, "accountant");
                loadData();
              }}
              className="text-xs bg-red-50 text-red-600 px-3 py-1.5 rounded-lg font-bold hover:bg-red-100"
            >
              Revogar
            </button>
          ) : (
            <button 
              onClick={async () => {
                await apiFetch(`/api/accountant/client/${id}/generate-token`, {
                  method: "POST",
                  
                }, "accountant");
                loadData();
              }}
              className="text-xs bg-slate-900 text-white px-3 py-1.5 rounded-lg font-bold hover:bg-slate-800"
            >
              Gerar Nova Hash
            </button>
          )}
        </div>
        <div className="bg-slate-50 border border-slate-100 rounded-xl p-4 flex items-center justify-between">
           {data.client.integrationHash ? (
              <code className="text-sm font-mono text-slate-600 select-all">{data.client.integrationHash}</code>
           ) : (
              <span className="text-sm text-slate-400">Nenhuma hash ativa. Gere uma para integrar com o sistema principal.</span>
           )}
        </div>
      </div>

      {editingDocId && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 w-full max-w-lg shadow-2xl overflow-y-auto max-h-[90vh]">
            <h2 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
              <Edit3 className="w-5 h-5 text-blue-500" /> Editar Documento
            </h2>
            <form onSubmit={handleEditDocSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Título</label>
                <input 
                  required 
                  type="text" 
                  value={editDocForm.title} 
                  onChange={e => setEditDocForm({ ...editDocForm, title: e.target.value })} 
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="flex gap-4">
                <div className="flex-1">
                  <label className="block text-xs font-semibold text-slate-500 mb-1">Categoria</label>
                  <select 
                    required 
                    value={editDocForm.category} 
                    onChange={e => setEditDocForm({ ...editDocForm, category: e.target.value })} 
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500"
                  >
                      <option value="">Selecione...</option>
                      <option value="Simples Nacional">Simples Nacional</option>
                      <option value="Honorários">Honorários</option>
                      <option value="Contracheque">Contracheque</option>
                      <option value="FGTS">FGTS</option>
                      <option value="INSS">INSS</option>
                      <option value="Folha de Pagamento">Folha de Pagamento</option>
                      <option value="Rescisão">Rescisão</option>
                      <option value="Férias">Férias</option>
                      <option value="Notas Fiscais">Notas Fiscais</option>
                      <option value="Parcelamento">Parcelamento</option>
                      <option value="Outros">Outros</option>
                      <option value="Corpo de Bombeiros">Corpo de Bombeiros</option>
                      <option value="IBAMA">IBAMA</option>
                      <option value="CSLL">CSLL</option>
                      <option value="IRPJ">IRPJ</option>
                      <option value="Alvará">Alvará</option>
                      <option value="IRPF">IRPF</option>
                  </select>
                </div>
                <div className="flex-1">
                  <label className="block text-xs font-semibold text-slate-500 mb-1">Vencimento</label>
                  <input 
                    type="date" 
                    value={editDocForm.dueDate} 
                    onChange={e => setEditDocForm({ ...editDocForm, dueDate: e.target.value })} 
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
              <div className="flex gap-4">
                <div className="flex-1">
                  <label className="block text-xs font-semibold text-slate-500 mb-1">Status</label>
                  <select 
                    required 
                    value={editDocForm.status} 
                    onChange={e => setEditDocForm({ ...editDocForm, status: e.target.value })} 
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="new">Novo / Pendente</option>
                    <option value="viewed">Visualizado</option>
                    <option value="ok">Recebido (Cliente)</option>
                    <option value="paid">Pago</option>
                  </select>
                </div>
                <div className="flex-1">
                  <label className="block text-xs font-semibold text-slate-500 mb-1">Valor (Opcional)</label>
                  <input 
                    type="number"
                    step="0.01"
                    value={editDocForm.valor} 
                    onChange={e => setEditDocForm({ ...editDocForm, valor: e.target.value })} 
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Ex: 150.00"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Substituir Arquivo (Opcional)</label>
                <input 
                  type="file" 
                  onChange={e => {
                    const f = e.target.files ? e.target.files[0] : null;
                    setEditDocForm({ ...editDocForm, file: f });
                  }}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="pt-4 flex justify-end gap-3">
                <button 
                  type="button" 
                  onClick={() => setEditingDocId(null)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-sm rounded-xl transition-colors"
                >
                  Cancelar
                </button>
                <button 
                  type="submit"
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm rounded-xl transition-colors"
                >
                  Salvar Alterações
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
