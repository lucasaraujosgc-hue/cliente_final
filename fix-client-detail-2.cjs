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
  '  const loadData = () => {',
  deleteFunction + '\n  const loadData = () => {'
);

fs.writeFileSync('src/pages/accountant/ClientDetail.tsx', code);
