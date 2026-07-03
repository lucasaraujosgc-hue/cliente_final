const fs = require('fs');
let code = fs.readFileSync('src/server/routes.ts', 'utf8');

const startIndex = code.indexOf('        try {\n          const config = await db.select().from(serproConfig)');
const endIndex = code.indexOf('        } catch(e) {', startIndex) + '        } catch(e) {'.length;

fs.writeFileSync('target.txt', code.substring(startIndex, endIndex));
console.log(startIndex);
