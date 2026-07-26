const fs = require('fs');
const path = 'src/server/routes.ts';
let code = fs.readFileSync(path, 'utf8');

const target = `let docsList = docs.map((d: any) => \`- \${d.category || "Documento"}\`).join('\\n');`;
const replacement = `let docsList = Array.from(new Set(docs.map((d: any) => d.category || "Documento"))).join(' · ');`;

if (code.includes(target)) {
  code = code.split(target).join(replacement);
  fs.writeFileSync(path, code, 'utf8');
  console.log('Successfully patched docsList to be inline.');
} else {
  console.log('Target not found.');
}
