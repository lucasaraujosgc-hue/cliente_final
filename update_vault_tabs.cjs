const fs = require('fs');
const path = 'src/pages/client/Vault.tsx';
let code = fs.readFileSync(path, 'utf8');

const targetTabs = \`  const tabs = [
    { id: "company", label: "Documentos Empresa", icon: FileIcon },
  ];

  const filteredDocs = docs.filter(d => {
    if (activeTab === "received") {
      return (d.category === "taxes" || d.category === "payroll" || d.category === "webhook_doc" || d.category === "SITFIS_RECEITA") && d.competence === selectedCompetence;
    }
    if (activeTab === "company") {
      return d.category === "company";
    }
    return d.category === activeTab;
  });\`;

const newTabs = \`  const tabs = [
    { id: "received", label: "Guias e Impostos", icon: FileIcon },
    { id: "company", label: "Documentos da Empresa", icon: FileIcon },
  ];

  const filteredDocs = docs.filter(d => {
    if (activeTab === "received") {
      return d.uploadedBy === "accountant" && d.category !== "company";
    }
    if (activeTab === "company") {
      return d.category === "company";
    }
    return true;
  });\`;

code = code.replace(targetTabs, newTabs);

const targetDefaultTab = \`const [activeTab, setActiveTab] = useState("company");\`;
const newDefaultTab = \`const [activeTab, setActiveTab] = useState("received");\`;
code = code.replace(targetDefaultTab, newDefaultTab);

fs.writeFileSync(path, code, 'utf8');
console.log('Successfully patched Vault.tsx');
