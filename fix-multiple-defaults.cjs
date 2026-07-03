const fs = require('fs');
let code = fs.readFileSync('src/pages/accountant/Notifications.tsx', 'utf8');

code = code.replace(
  '} else if (t === "on_multiple_files_available") {\n                        title = "Nova Guia Disponível: [CATEGORIA]";\n                        body = "Sua guia da categoria [CATEGORIA] está disponível no painel para pagamento. Vencimento: [VENCIMENTO].";\n                      }',
  '} else if (t === "on_multiple_files_available") {\n                        title = "Novas Guias Disponíveis";\n                        body = "Os seguintes documentos estão disponíveis:\\n[LISTA_GUIAS]";\n                      }'
);

fs.writeFileSync('src/pages/accountant/Notifications.tsx', code);
