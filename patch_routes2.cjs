const fs = require('fs');
const path = 'src/server/routes.ts';
let code = fs.readFileSync(path, 'utf8');

// Replace local 1
const target1 = `                let title = (rule.title || "Nova Guia Disponível")
                            .replace(/\\[NOME_GUIA\\]/g, doc.title || "")
                            .replace(/\\[CATEGORIA\\]/g, doc.category || "");
                let body = (rule.body || "")
                           .replace(/\\[NOME_GUIA\\]/g, doc.title || "")
                           .replace(/\\[CATEGORIA\\]/g, doc.category || "")
                           .replace(/\\[VENCIMENTO\\]/g, doc.dueDate || "N/A");`;

const replacement1 = `                let title = (rule.title || "Nova Guia Disponível")
                            .replace(/\\[NOME_GUIA\\]/g, doc.category || "")
                            .replace(/\\[CATEGORIA\\]/g, doc.category || "");
                let body = (rule.body || "")
                           .replace(/\\[NOME_GUIA\\]/g, doc.category || "")
                           .replace(/\\[CATEGORIA\\]/g, doc.category || "")
                           .replace(/\\[VENCIMENTO\\]/g, doc.dueDate || "N/A");`;

if (code.includes(target1)) {
  code = code.replace(target1, replacement1);
  console.log('Target 1 replaced');
} else {
  console.log('Target 1 NOT FOUND');
}

// Replace local 2
const target2 = `            let docsList = docs.map((d: any) => \`- \${d.title || "Documento"}\`).join('\\\\n');`;
const replacement2 = `            let docsList = docs.map((d: any) => \`- \${d.category || "Documento"}\`).join('\\n');`;

if (code.includes(target2)) {
  code = code.replace(target2, replacement2);
  console.log('Target 2 replaced');
} else {
  console.log('Target 2 NOT FOUND');
}

// Replace local 3
const target3 = `            let title = (rule.title || "Nova Guia Disponível").replace(/\\[NOME_GUIA\\]/g, doc.title).replace(/\\[CATEGORIA\\]/g, doc.category);
            let body = (rule.body || "").replace(/\\[NOME_GUIA\\]/g, doc.title)
                                         .replace(/\\[CATEGORIA\\]/g, doc.category)
                                         .replace(/\\[VENCIMENTO\\]/g, updatedDoc.dueDate || "N/A");`;

const replacement3 = `            let title = (rule.title || "Nova Guia Disponível").replace(/\\[NOME_GUIA\\]/g, doc.category).replace(/\\[CATEGORIA\\]/g, doc.category);
            let body = (rule.body || "").replace(/\\[NOME_GUIA\\]/g, doc.category)
                                         .replace(/\\[CATEGORIA\\]/g, doc.category)
                                         .replace(/\\[VENCIMENTO\\]/g, updatedDoc.dueDate || "N/A");`;

if (code.includes(target3)) {
  code = code.replace(target3, replacement3);
  console.log('Target 3 replaced');
} else {
  console.log('Target 3 NOT FOUND');
}

fs.writeFileSync(path, code, 'utf8');
console.log('Finished patching');
