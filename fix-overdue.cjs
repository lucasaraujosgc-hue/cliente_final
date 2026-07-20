const fs = require('fs');
let code = fs.readFileSync('src/pages/client/Overdue.tsx', 'utf8');

const target = `                      {(doc.category === "DCTFWEB" || doc.category === "SIMPLES_NACIONAL" || doc.category === "taxes" || doc.title?.toUpperCase().includes("DCTFWEB") || doc.title?.toUpperCase().includes("SIMPLES")) && (
                        <div className="w-full">
                          <GuiaAtualizarButton 
                            clienteId={doc.clientId}
                            guia={{
                              id: doc.id,
                              tipoGuia: (doc.category === "DCTFWEB" || doc.title?.toUpperCase().includes("DCTFWEB")) ? "DCTFWEB_INSS" : "DAS_SIMPLES",
                              competencia: doc.competence || "01/2026",
                              status: doc.status
                            }}
                            isOverdue={true}
                            onAtualizado={() => loadData()}
                          />
                        </div>
                      )}`;

const replacement = `                        <div className="w-full mt-2">
                          <GuiaAtualizarButton 
                            clienteId={doc.clientId}
                            guia={{
                              id: doc.id,
                              tipoGuia: (doc.category === "DCTFWEB" || doc.category === "INSS" || doc.category?.toUpperCase()?.includes("INSS") || doc.title?.toUpperCase()?.includes("DCTFWEB") || doc.title?.toUpperCase()?.includes("INSS")) ? "DCTFWEB_INSS" : ((doc.category === "SIMPLES_NACIONAL" || doc.category?.toUpperCase()?.includes("SIMPLES") || doc.title?.toUpperCase()?.includes("SIMPLES")) ? "DAS_SIMPLES" : "OUTROS"),
                              competencia: doc.competence || "01/2026",
                              status: doc.status,
                              title: doc.title
                            }}
                            isOverdue={true}
                            onAtualizado={() => loadData()}
                          />
                        </div>`;

if (code.includes(target)) {
    code = code.replace(target, replacement);
    fs.writeFileSync('src/pages/client/Overdue.tsx', code);
    console.log("Replaced using exact string.");
} else {
    console.log("Could not find target, trying regex...");
    const regex = /\{\(doc\.category === "DCTFWEB"[\s\S]*?<\/div>\n\s*\)\}/;
    if (regex.test(code)) {
        code = code.replace(regex, replacement);
        fs.writeFileSync('src/pages/client/Overdue.tsx', code);
        console.log("Replaced using regex.");
    } else {
        console.log("Failed to find target");
    }
}
