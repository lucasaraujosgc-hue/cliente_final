const fs = require('fs');
let code = fs.readFileSync('src/server/db.ts', 'utf8');

code = code.replace(
  '  const client = await pool.connect();\n  try {',
  '  let client;\n  try {\n    client = await pool.connect();'
);

fs.writeFileSync('src/server/db.ts', code);
