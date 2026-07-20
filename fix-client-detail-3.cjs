const fs = require('fs');
let code = fs.readFileSync('src/pages/accountant/ClientDetail.tsx', 'utf8');

code = code.replace(
  'body: JSON.stringify({ ids: [docId] })',
  'body: JSON.stringify({ fileIds: [docId] })'
);

fs.writeFileSync('src/pages/accountant/ClientDetail.tsx', code);
