import { apiFetch } from "../../lib/apiClient";
import React, { useState, useEffect, useMemo } from "react";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Search, Download, Trash2, File as FileIcon, Loader2, CheckSquare, Square, Filter } from "lucide-react";
import JSZip from "jszip";
import { saveAs } from "file-saver";

export function FileGallery() {
  const [files, setFiles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [isDeleting, setIsDeleting] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [filterClient, setFilterClient] = useState("all");
  const [filterCategory, setFilterCategory] = useState("all");

  const fetchFiles = async () => {
    try {
      const token = localStorage.getItem("accountantToken");
      const res = await apiFetch("/api/accountant/files", {
        
      }, "accountant");
      const data = await res.json();
      if (res.ok) {
        setFiles(data.files || []);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFiles();
  }, []);

  const formatSize = (bytes: number) => {
    if (!bytes) return "0 B";
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const filteredFiles = useMemo(() => {
    return files.filter(f => {
      const matchSearch = (f.title || "").toLowerCase().includes(searchTerm.toLowerCase()) || 
                          (f.clientName || "").toLowerCase().includes(searchTerm.toLowerCase());
      const matchClient = filterClient === "all" || f.clientId === filterClient;
      const matchCategory = filterCategory === "all" || f.category === filterCategory;
      return matchSearch && matchClient && matchCategory;
    });
  }, [files, searchTerm, filterClient, filterCategory]);

  const uniqueClients = useMemo(() => {
    const clients = new Map();
    files.forEach(f => clients.set(f.clientId, f.clientName));
    return Array.from(clients.entries()).map(([id, name]) => ({ id, name }));
  }, [files]);

  const uniqueCategories = useMemo(() => {
    const cats = new Set(files.map(f => f.category));
    return Array.from(cats);
  }, [files]);

  const toggleSelection = (id: string) => {
    const newSelection = new Set(selectedFiles);
    if (newSelection.has(id)) {
      newSelection.delete(id);
    } else {
      newSelection.add(id);
    }
    setSelectedFiles(newSelection);
  };

  const toggleAll = () => {
    if (selectedFiles.size === filteredFiles.length && filteredFiles.length > 0) {
      setSelectedFiles(new Set());
    } else {
      setSelectedFiles(new Set(filteredFiles.map(f => f.id)));
    }
  };

  const handleDelete = async (ids: string[]) => {
    if (!window.confirm(`Tem certeza que deseja excluir ${ids.length} arquivo(s)?`)) return;
    
    setIsDeleting(true);
    try {
      const token = localStorage.getItem("accountantToken");
      const res = await apiFetch("/api/accountant/files/bulk", {
        method: "DELETE",
        headers: { 
          "Content-Type": "application/json",
           
        },
        body: JSON.stringify({ fileIds: ids })
      }, "accountant");
      if (res.ok) {
        setSelectedFiles(new Set());
        await fetchFiles();
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsDeleting(false);
    }
  };

  const getAuthenticatedFileUrl = (url: string | null) => {
    if (!url) return "";
    if (url.startsWith('/api/')) {
      const token = localStorage.getItem('accountantToken') || sessionStorage.getItem('accountantToken');
      return `${url}?token=${token}`;
    }
    return url;
  };

  const downloadFile = (fileUrl: string, title: string) => {
    const link = document.createElement('a');
    link.href = getAuthenticatedFileUrl(fileUrl);
    link.download = title;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleBulkDownload = async () => {
    if (selectedFiles.size === 0) return;
    setIsDownloading(true);
    try {
      const zip = new JSZip();
      const filesToDownload = files.filter(f => selectedFiles.has(f.id));
      
      for (const f of filesToDownload) {
        if (!f.fileUrl) continue;
        
        let blob;
        const authUrl = getAuthenticatedFileUrl(f.fileUrl);
        if (f.fileUrl.startsWith("data:")) {
          const res = await apiFetch(f.fileUrl, {}, "accountant");
          blob = await res.blob();
        } else {
          // fetch from server
          const res = await apiFetch(authUrl, {}, "accountant");
          blob = await res.blob();
        }
        
        const ext = f.fileUrl.includes('pdf') ? 'pdf' : (f.fileUrl.includes('png') ? 'png' : 'jpg'); // simplified
        const filename = `${f.title}.${ext}`.replace(/[^a-zA-Z0-9.\-_]/g, '_');
        zip.file(filename, blob);
      }
      
      const content = await zip.generateAsync({ type: "blob" });
      saveAs(content, `arquivos_virgula_${format(new Date(), 'yyyyMMdd_HHmm')}.zip`);
    } catch (e) {
      console.error(e);
      alert("Erro ao baixar os arquivos");
    } finally {
      setIsDownloading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 dark:text-white">Galeria de Arquivos</h1>
          <p className="text-sm text-slate-500 mt-1">Gerencie todos os arquivos armazenados no sistema.</p>
        </div>
        
        {selectedFiles.size > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-slate-600 dark:text-slate-400 mr-2">
              {selectedFiles.size} selecionado(s)
            </span>
            <button
              onClick={handleBulkDownload}
              disabled={isDownloading}
              className="flex items-center gap-2 px-3 py-2 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 dark:bg-indigo-900/30 dark:text-indigo-400 dark:hover:bg-indigo-900/50 rounded-lg text-sm font-medium transition-colors"
            >
              {isDownloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              Baixar ZIP
            </button>
            <button
              onClick={() => handleDelete(Array.from(selectedFiles))}
              disabled={isDeleting}
              className="flex items-center gap-2 px-3 py-2 bg-red-50 text-red-700 hover:bg-red-100 dark:bg-red-900/30 dark:text-red-400 dark:hover:bg-red-900/50 rounded-lg text-sm font-medium transition-colors"
            >
              {isDeleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
              Excluir
            </button>
          </div>
        )}
      </div>

      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm p-4">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1 relative">
            <Search className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Buscar por nome ou cliente..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          
          <select
            value={filterClient}
            onChange={(e) => setFilterClient(e.target.value)}
            className="px-4 py-2 border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 min-w-[200px]"
          >
            <option value="all">Todos os clientes</option>
            {uniqueClients.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          
          <select
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
            className="px-4 py-2 border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="all">Todas as categorias</option>
            {uniqueCategories.map(c => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-800">
              <tr>
                <th className="px-4 py-3 font-semibold text-slate-600 dark:text-slate-300 w-10">
                  <button onClick={toggleAll} className="text-slate-400 hover:text-indigo-500 transition-colors">
                    {selectedFiles.size === filteredFiles.length && filteredFiles.length > 0 ? (
                      <CheckSquare className="w-5 h-5 text-indigo-500" />
                    ) : (
                      <Square className="w-5 h-5" />
                    )}
                  </button>
                </th>
                <th className="px-4 py-3 font-semibold text-slate-600 dark:text-slate-300">Arquivo</th>
                <th className="px-4 py-3 font-semibold text-slate-600 dark:text-slate-300">Cliente</th>
                <th className="px-4 py-3 font-semibold text-slate-600 dark:text-slate-300">Categoria</th>
                <th className="px-4 py-3 font-semibold text-slate-600 dark:text-slate-300">Tamanho</th>
                <th className="px-4 py-3 font-semibold text-slate-600 dark:text-slate-300">Data Upload</th>
                <th className="px-4 py-3 font-semibold text-slate-600 dark:text-slate-300 w-24">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {filteredFiles.map((file) => (
                <tr key={file.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                  <td className="px-4 py-3">
                    <button onClick={() => toggleSelection(file.id)} className="text-slate-400 hover:text-indigo-500 transition-colors">
                      {selectedFiles.has(file.id) ? (
                        <CheckSquare className="w-5 h-5 text-indigo-500" />
                      ) : (
                        <Square className="w-5 h-5" />
                      )}
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-indigo-50 dark:bg-indigo-900/30 rounded-lg text-indigo-600 dark:text-indigo-400">
                        <FileIcon className="w-4 h-4" />
                      </div>
                      <span className="font-medium text-slate-700 dark:text-slate-200 truncate max-w-[200px]">
                        {file.title}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-slate-600 dark:text-slate-400">{file.clientName}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="px-2 py-1 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 rounded-md text-xs font-medium uppercase tracking-wider">
                      {file.category}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-slate-600 dark:text-slate-400">{formatSize(file.size)}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-slate-600 dark:text-slate-400">
                      {format(parseISO(file.createdAt), "dd/MM/yyyy HH:mm")}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => file.fileUrl && downloadFile(file.fileUrl, file.title)}
                        disabled={!file.fileUrl}
                        className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 rounded-lg transition-colors"
                        title="Baixar"
                      >
                        <Download className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDelete([file.id])}
                        className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg transition-colors"
                        title="Excluir"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              
              {filteredFiles.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                    Nenhum arquivo encontrado com os filtros selecionados.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
