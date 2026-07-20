const fs = require('fs');
let code = fs.readFileSync('src/pages/accountant/ClientDetail.tsx', 'utf8');

const deleteFunction = `
  const handleDeleteDoc = async (docId: string) => {
    if (!confirm("Tem certeza que deseja excluir este arquivo?")) return;
    try {
      const res = await apiFetch("/api/accountant/files/bulk", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [docId] })
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
`;

code = code.replace(
  'const loadData = async () => {',
  deleteFunction + '\n  const loadData = async () => {'
);

const deleteButton = `
                     <button onClick={() => handleDeleteDoc(doc.id)} title="Excluir Arquivo" className="p-2 bg-red-50 text-red-600 rounded-lg hover:bg-red-100">
                        <Trash2 className="w-4 h-4" />
                     </button>
                  </div>
`;

code = code.replace(
  '</button>\n                     {doc.uploadedBy === \'client\' &&',
  '</button>\n                     <button onClick={() => handleDeleteDoc(doc.id)} title="Excluir Arquivo" className="p-2 bg-red-50 text-red-600 rounded-lg hover:bg-red-100"><Trash2 className="w-4 h-4" /></button>\n                     {doc.uploadedBy === \'client\' &&'
);

fs.writeFileSync('src/pages/accountant/ClientDetail.tsx', code);
