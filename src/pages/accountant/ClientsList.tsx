import { apiFetch } from "../../lib/apiClient";
import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Users, Search, ChevronRight, Plus, X, Edit, Trash2, Megaphone, CheckSquare, Square, Upload } from "lucide-react";
import * as XLSX from "xlsx";

export function ClientsList() {
  const [clients, setClients] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [showModal, setShowModal] = useState(false);
  const [editClient, setEditClient] = useState<any>(null);
  const [clientForm, setClientForm] = useState({ cnpj: "", name: "", accountantCategory: "", integrationHash: "" });
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Mural State
  const [showMuralModal, setShowMuralModal] = useState(false);
  const [muralSearch, setMuralSearch] = useState("");
  const [muralCategoryFilter, setMuralCategoryFilter] = useState("all");
  const [muralSelectedIds, setMuralSelectedIds] = useState<string[]>([]);
  const [muralMessage, setMuralMessage] = useState("");
  const [isSendingMural, setIsSendingMural] = useState(false);
  const [isImporting, setIsImporting] = useState(false);

  const loadClients = () => {
    apiFetch("/api/accountant/clients", {
      
    }, "accountant")
      .then(r => r.json())
      .then(data => setClients(data.clients));
  };

  useEffect(() => {
    loadClients();
  }, []);

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsImporting(true);
    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data);
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(worksheet) as any[];

      // Expected columns: CNPJ, Nome, Categorias
      let successCount = 0;
      let errCount = 0;

      for (const row of rows) {
        let cnpj = row['CNPJ'] || row['cnpj'] || row['Cnpj'];
        const name = row['Nome'] || row['nome'] || row['Razão Social'] || row['razao social'];
        const accountantCategory = row['Categorias'] || row['categorias'] || row['Categoria'] || row['categoria'] || "";

        if (cnpj && name) {
           cnpj = String(cnpj).replace(/\D/g, "");
           try {
              const res = await apiFetch("/api/accountant/clients", {
                method: "POST",
                headers: { "Content-Type": "application/json",  },
                body: JSON.stringify({ cnpj, name, accountantCategory, integrationHash: "" })
              }, "accountant");
              if (res.ok) successCount++;
              else errCount++;
           } catch {
              errCount++;
           }
        } else {
           errCount++;
        }
      }

      alert(`Importação concluída. Sucessos: ${successCount}. Falhas (ou incompletos): ${errCount}.`);
      loadClients();
    } catch (err: any) {
      alert("Erro ao importar planilha: " + err.message);
    }
    setIsImporting(false);
    if (e.target) e.target.value = "";
  };

  const handleDownloadTemplate = () => {
     const worksheet = XLSX.utils.json_to_sheet([
       { "CNPJ": "12.345.678/0001-99", "Nome": "Empresa XPTO Ltda", "Categorias": "Lucro Presumido, TI" },
       { "CNPJ": "98.765.432/0001-11", "Nome": "Nova Startup", "Categorias": "Simples Nacional" },
     ]);
     const workbook = XLSX.utils.book_new();
     XLSX.utils.book_append_sheet(workbook, worksheet, "Clientes");
     XLSX.writeFile(workbook, "exemplo_clientes.xlsx");
  };

  const handleSaveClient = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    
    if (editClient) {
      await apiFetch(`/api/accountant/client/${editClient.id}`, {
        method: "PUT",
        headers: { 
          "Content-Type": "application/json",
           
        },
        body: JSON.stringify(clientForm)
      }, "accountant");
    } else {
      await apiFetch("/api/accountant/clients", {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
           
        },
        body: JSON.stringify(clientForm)
      }, "accountant");
    }
    
    setShowModal(false);
    setEditClient(null);
    setClientForm({ cnpj: "", name: "", accountantCategory: "", integrationHash: "" });
    setIsSubmitting(false);
    loadClients();
  };

  const handleDeleteClient = async (id: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (window.confirm("Deseja realmente excluir este cliente? Toda a dependência no banco de dados será apagada.")) {
      await apiFetch(`/api/accountant/client/${id}`, {
        method: "DELETE",
        
      }, "accountant");
      loadClients();
    }
  };

  const openEditModal = (client: any, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setEditClient(client);
    setClientForm({
      cnpj: client.cnpj,
      name: client.name,
      accountantCategory: client.accountantCategory || "",
      integrationHash: client.integrationHash || ""
    });
    setShowModal(true);
  };

  const openCreateModal = () => {
    setEditClient(null);
    setClientForm({ cnpj: "", name: "", accountantCategory: "", integrationHash: "" });
    setShowModal(true);
  };

  const handleSendMural = async (e: React.FormEvent) => {
    e.preventDefault();
    if (muralSelectedIds.length === 0) {
      alert("Selecione ao menos uma empresa.");
      return;
    }
    setIsSendingMural(true);
    await apiFetch("/api/accountant/message/bulk", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        
      },
      body: JSON.stringify({ clientIds: muralSelectedIds, content: muralMessage })
    }, "accountant");
    setMuralMessage("");
    setMuralSelectedIds([]);
    setShowMuralModal(false);
    setIsSendingMural(false);
    alert("Mensagens enviadas com sucesso para as empresas selecionadas.");
  };

  // Extract unique categories
  const categories = Array.from(new Set(
    clients.map(c => c.accountantCategory).filter(Boolean)
      .flatMap(cats => cats.split(",").map((c: string) => c.trim()).filter(Boolean))
  ));

  const filtered = clients.filter(c => {
    const matchSearch = c.name.toLowerCase().includes(search.toLowerCase()) || c.cnpj.includes(search);
    const clientCats = c.accountantCategory ? c.accountantCategory.split(",").map((cat: string) => cat.trim()) : [];
    const matchCategory = categoryFilter === "all" || clientCats.includes(categoryFilter);
    return matchSearch && matchCategory;
  });

  return (
    <div className="space-y-8 animate-in fade-in relative">
      <header className="h-16 flex items-center justify-between px-8 bg-white/40 backdrop-blur-md border border-white rounded-2xl shadow-sm -mx-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900">Clientes</h1>
          <p className="text-xs text-slate-500">Gerencie a carteira de clientes do escritório.</p>
        </div>
        <div className="flex gap-3 relative">
          <button onClick={() => setShowMuralModal(true)} className="bg-indigo-50 text-indigo-600 px-4 py-2 rounded-xl text-sm font-bold flex items-center hover:bg-indigo-100 transition-colors">
            <Megaphone className="w-4 h-4 mr-2" /> Mural de Recados
          </button>
          
          <div className="flex flex-col items-center justify-center relative">
            <div className="relative">
               <input 
                 type="file" 
                 accept=".xlsx, .xls, .csv" 
                 className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                 onChange={handleImport}
                 disabled={isImporting}
               />
               <button className="bg-slate-100 text-slate-700 px-4 py-2 rounded-xl text-sm font-bold flex items-center hover:bg-slate-200 transition-colors h-full disabled:opacity-50" disabled={isImporting}>
                 <Upload className="w-4 h-4 mr-2" /> {isImporting ? "Importando..." : "Importar .xlsx"}
               </button>
            </div>
            <button onClick={handleDownloadTemplate} className="text-[10px] text-slate-500 hover:text-slate-700 underline absolute -bottom-5 whitespace-nowrap" title="Baixar planilha de exemplo">
              Baixar Exemplo
            </button>
          </div>

          <button onClick={openCreateModal} className="bg-slate-900 text-white px-4 py-2 rounded-xl text-sm font-bold flex items-center shadow-md hover:bg-slate-800 transition-colors">
            <Plus className="w-4 h-4 mr-2" /> Novo Cliente
          </button>
        </div>
      </header>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
          <div className="bg-white rounded-3xl shadow-2xl border border-slate-100 p-6 w-full max-w-md relative">
            <button onClick={() => setShowModal(false)} className="absolute top-4 right-4 text-slate-400 hover:text-slate-600">
               <X className="w-5 h-5" />
            </button>
            <h2 className="text-lg font-bold text-slate-900 mb-6">{editClient ? "Editar Cliente" : "Cadastrar Cliente"}</h2>
            <form onSubmit={handleSaveClient} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">CNPJ</label>
                <input required disabled={!!editClient} type="text" value={clientForm.cnpj} onChange={(e) => setClientForm({...clientForm, cnpj: e.target.value})} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-slate-50 focus:bg-white disabled:opacity-50" placeholder="00.000.000/0001-00" />
                {!editClient && <span className="text-[10px] text-slate-400 mt-1 block">ℹ️ O login e a senha inicial de acesso do cliente serão este CNPJ.</span>}
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Razão Social</label>
                <input required type="text" value={clientForm.name} onChange={(e) => setClientForm({...clientForm, name: e.target.value})} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-slate-50 focus:bg-white" placeholder="Empresa XPTO Ltda" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Categorias (Opcional - separe por vírgula)</label>
                <input 
                  type="text" 
                  value={clientForm.accountantCategory} 
                  onChange={(e) => setClientForm({...clientForm, accountantCategory: e.target.value})} 
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-slate-50 focus:bg-white" 
                  placeholder="Ex: Lucro Presumido, Simples Nacional" 
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Hash / Token Integração Externa (Opcional)</label>
                <input type="text" value={clientForm.integrationHash} onChange={(e) => setClientForm({...clientForm, integrationHash: e.target.value})} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-slate-50 focus:bg-white" placeholder="Cole aqui o hash gerado no outro sistema" />
              </div>
              <button disabled={isSubmitting} type="submit" className="w-full py-2 bg-slate-900 text-white rounded-xl text-sm font-bold shadow-md hover:opacity-90">
                {isSubmitting ? "Salvando..." : (editClient ? "Salvar Alterações" : "Salvar Cliente")}
              </button>
            </form>
          </div>
        </div>
      )}

      {showMuralModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
          <div className="bg-white rounded-3xl shadow-2xl border border-slate-100 p-6 w-full max-w-2xl relative flex flex-col max-h-[90vh]">
            <button onClick={() => setShowMuralModal(false)} className="absolute top-4 right-4 text-slate-400 hover:text-slate-600">
               <X className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-3 mb-6">
              <div className="p-3 bg-indigo-50 text-indigo-600 rounded-2xl">
                <Megaphone className="w-6 h-6" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-slate-900">Mural Geral</h2>
                <p className="text-xs text-slate-500">Envie mensagens que aparecerão como notificação no PWA dos clientes selecionados.</p>
              </div>
            </div>

            <div className="flex-1 overflow-hidden flex flex-col gap-4">
              <div className="flex gap-4">
                <input 
                  type="text" 
                  placeholder="Filtrar por nome ou CNPJ..." 
                  value={muralSearch}
                  onChange={e => setMuralSearch(e.target.value)}
                  className="flex-1 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                />
                <select
                  value={muralCategoryFilter}
                  onChange={(e) => setMuralCategoryFilter(e.target.value)}
                  className="px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                >
                  <option value="all">Todas</option>
                  {categories.map((cat: any) => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
              </div>

              <div className="flex-1 overflow-y-auto border border-slate-200 rounded-xl p-2 max-h-60">
                {clients.filter(c => {
                   const matchSearch = c.name.toLowerCase().includes(muralSearch.toLowerCase()) || c.cnpj.includes(muralSearch);
                   const clientCats = c.accountantCategory ? c.accountantCategory.split(",").map((cat: string) => cat.trim()) : [];
                   const matchCategory = muralCategoryFilter === "all" || clientCats.includes(muralCategoryFilter);
                   return matchSearch && matchCategory;
                }).map(client => (
                  <button 
                    key={client.id}
                    type="button"
                    onClick={() => {
                      setMuralSelectedIds(prev => 
                        prev.includes(client.id) ? prev.filter(id => id !== client.id) : [...prev, client.id]
                      )
                    }}
                    className="w-full flex items-center justify-between p-2 hover:bg-slate-50 rounded-lg text-left transition-colors"
                  >
                    <div>
                      <h4 className="text-sm font-semibold text-slate-800">{client.name}</h4>
                      <p className="text-xs text-slate-500">{client.cnpj} {client.accountantCategory ? `• ${client.accountantCategory}` : ''}</p>
                    </div>
                    {muralSelectedIds.includes(client.id) ? (
                      <CheckSquare className="w-5 h-5 text-indigo-600" />
                    ) : (
                      <Square className="w-5 h-5 text-slate-300" />
                    )}
                  </button>
                ))}
              </div>

              <form onSubmit={handleSendMural} className="mt-2 space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Mensagem ({muralSelectedIds.length} clientes selecionados)</label>
                  <textarea 
                    required
                    rows={3}
                    className="w-full p-3 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none resize-none"
                    placeholder="Digite a mensagem que aparecerá no mural..."
                    value={muralMessage}
                    onChange={e => setMuralMessage(e.target.value)}
                  ></textarea>
                </div>
                <button disabled={isSendingMural || muralSelectedIds.length === 0} type="submit" className="w-full py-2 bg-indigo-600 text-white rounded-xl text-sm font-bold shadow-md hover:bg-indigo-700 disabled:opacity-50 transition-colors">
                  {isSendingMural ? "Enviando..." : "Enviar para Mural PWA"}
                </button>
              </form>
            </div>
          </div>
        </div>
      )}

      <div className="bg-white/80 backdrop-blur-xl border text-slate-900 border-white rounded-3xl overflow-hidden shadow-xl shadow-slate-200/50">
        <div className="p-4 border-b border-white flex gap-4 bg-white/50 flex-col sm:flex-row">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input 
              type="text" 
              placeholder="Buscar por nome ou CNPJ..." 
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none bg-white"
            />
          </div>
          <div className="flex-none">
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white outline-none focus:ring-2 focus:ring-slate-900"
            >
              <option value="all">Todas as Categorias</option>
              {categories.map((cat: any) => (
                 <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="divide-y divide-slate-100/50">
          {filtered.map(client => (
            <div key={client.id} className="group relative">
              <Link 
                to={`/admin/client/${client.id}`}
                className="flex items-center justify-between p-4 px-6 hover:bg-slate-50/80 transition-colors"
              >
                <div className="flex items-center">
                  <div className="w-10 h-10 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center font-semibold text-sm mr-4 group-hover:bg-slate-200 transition-colors">
                    {client.name.charAt(0)}
                  </div>
                  <div>
                    <h4 className="text-sm font-medium text-slate-900">{client.name}</h4>
                    <div className="flex items-center space-x-2 mt-0.5">
                       <p className="text-xs text-slate-500">{client.cnpj}</p>
                       {client.accountantCategory && (
                         <>
                           <span className="text-xs text-slate-300">•</span>
                           <span className="text-xs text-slate-600 font-medium bg-slate-100 px-1.5 py-0.5 rounded-md">{client.accountantCategory}</span>
                         </>
                       )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2 mr-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button 
                      onClick={(e) => openEditModal(client, e)}
                      className="p-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg transition-colors"
                      title="Editar Cliente"
                    >
                      <Edit className="w-4 h-4" />
                    </button>
                    <button 
                      onClick={(e) => handleDeleteClient(client.id, e)}
                      className="p-1.5 bg-red-50 hover:bg-red-100 text-red-600 rounded-lg transition-colors"
                      title="Excluir Cliente"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                  <span className={`px-2.5 py-1 text-[10px] uppercase tracking-wider font-semibold rounded-full ${
                    client.regularityStatus === 'green' ? 'bg-emerald-100 text-emerald-700' :
                    client.regularityStatus === 'warning' ? 'bg-amber-100 text-amber-700' :
                    'bg-red-100 text-red-700'
                  }`}>
                    {client.regularityStatus === 'green' ? 'Regular' : client.regularityStatus === 'warning' ? 'Atenção' : 'Irregular'}
                  </span>
                  <ChevronRight className="w-5 h-5 text-slate-300 group-hover:text-slate-600 transition-colors" />
                </div>
              </Link>
            </div>
          ))}
          {filtered.length === 0 && (
             <div className="p-8 text-center text-slate-500">Nenhum cliente encontrado.</div>
          )}
        </div>
      </div>
    </div>
  );
}
