const fs = require('fs');
let code = fs.readFileSync('src/pages/accountant/Notifications.tsx', 'utf8');

code = code.replace(
  'case "on_file_available": return "Assim que a Guia for Disponibilizada";',
  'case "on_file_available": return "Assim que a Guia for Disponibilizada";\n      case "on_multiple_files_available": return "Assim que Várias Guias forem Disponibilizadas";'
);

code = code.replace(
  'type: "3_days_before", // \'recurrent\', \'3_days_before\', \'on_due_date\', \'on_file_available\'',
  'type: "3_days_before", // \'recurrent\', \'3_days_before\', \'on_due_date\', \'on_file_available\', \'on_multiple_files_available\''
);

code = code.replace(
  '} else if (t === "on_file_available") {',
  '} else if (t === "on_file_available") {\n                        title = "Nova Guia Disponível: [CATEGORIA]";\n                        body = "Sua guia da categoria [CATEGORIA] está disponível no painel para pagamento. Vencimento: [VENCIMENTO].";\n                      } else if (t === "on_multiple_files_available") {'
);

code = code.replace(
  '<option value="on_file_available">Assim que a guia for disponibilizada</option>',
  '<option value="on_file_available">Assim que a guia for disponibilizada</option>\n                    <option value="on_multiple_files_available">Assim que várias guias forem disponibilizadas (lote)</option>'
);

code = code.replace(
  '{formScheduled.type !== "on_file_available" && (',
  '{formScheduled.type !== "on_file_available" && formScheduled.type !== "on_multiple_files_available" && ('
);

code = code.replace(
  '(formScheduled.type === "3_days_before" || formScheduled.type === "on_due_date" || formScheduled.type === "on_file_available") && (',
  '(formScheduled.type === "3_days_before" || formScheduled.type === "on_due_date" || formScheduled.type === "on_file_available" || formScheduled.type === "on_multiple_files_available") && ('
);

code = code.replace(
  'Variáveis aceitas: <code className="bg-slate-100 dark:bg-slate-800 px-1 py-0.5 rounded text-indigo-500">[NOME_GUIA]</code>, <code className="bg-slate-100 dark:bg-slate-800 px-1 py-0.5 rounded text-indigo-500">[VENCIMENTO]</code> e <code className="bg-slate-100 dark:bg-slate-800 px-1 py-0.5 rounded text-indigo-500">[CATEGORIA]</code>',
  'Variáveis aceitas: <code className="bg-slate-100 dark:bg-slate-800 px-1 py-0.5 rounded text-indigo-500">[NOME_GUIA]</code>, <code className="bg-slate-100 dark:bg-slate-800 px-1 py-0.5 rounded text-indigo-500">[VENCIMENTO]</code>, <code className="bg-slate-100 dark:bg-slate-800 px-1 py-0.5 rounded text-indigo-500">[CATEGORIA]</code>{formScheduled.type === "on_multiple_files_available" && <span> e <code className="bg-slate-100 dark:bg-slate-800 px-1 py-0.5 rounded text-indigo-500">[LISTA_GUIAS]</code></span>}'
);

fs.writeFileSync('src/pages/accountant/Notifications.tsx', code);
