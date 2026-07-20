const fs = require('fs');
let code = fs.readFileSync('src/server/db.ts', 'utf8');

code = code.replace(
  '  } finally {\n    client.release();\n  }',
  '  } finally {\n    if (client) client.release();\n  }'
);

fs.writeFileSync('src/server/db.ts', code);
