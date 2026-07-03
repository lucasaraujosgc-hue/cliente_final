const fs = require('fs');

function walk(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(function(file) {
    file = dir + '/' + file;
    const stat = fs.statSync(file);
    if (stat && stat.isDirectory()) { 
      results = results.concat(walk(file));
    } else {
      if (file.endsWith('.tsx')) {
        results.push(file);
      }
    }
  });
  return results;
}

const files = walk('src/pages/accountant');

files.forEach(file => {
  let content = fs.readFileSync(file, 'utf8');
  
  // Replace:
  // apiFetch("/api/...", { ... }) with apiFetch("/api/...", { ... }, "accountant")
  // Let's split by apiFetch(
  const parts = content.split('apiFetch(');
  if (parts.length > 1) {
    let newContent = parts[0];
    for (let i = 1; i < parts.length; i++) {
       // parts[i] starts right after 'apiFetch('
       // We need to find the matching closing parenthesis ')' for this call.
       // We can count parentheses.
       let parens = 1;
       let j = 0;
       let inString = false;
       let stringChar = '';
       for (; j < parts[i].length; j++) {
         const char = parts[i][j];
         if (inString) {
           if (char === stringChar && parts[i][j-1] !== '\\') {
             inString = false;
           }
         } else {
           if (char === '"' || char === "'" || char === '`') {
             inString = true;
             stringChar = char;
           } else if (char === '(') {
             parens++;
           } else if (char === ')') {
             parens--;
             if (parens === 0) {
               break;
             }
           }
         }
       }
       
       if (parens === 0) {
         // The args string is parts[i].substring(0, j)
         let args = parts[i].substring(0, j);
         // Check if it already has "accountant"
         if (!args.includes('"accountant"') && !args.includes("'accountant'")) {
            // Is it just one argument?
            if (!args.includes(',') || args.startsWith('f.fileUrl') || args.startsWith('authUrl')) {
               // apiFetch(url) -> apiFetch(url, {}, "accountant")
               newContent += 'apiFetch(' + args + ', {}, "accountant"' + parts[i].substring(j);
            } else {
               newContent += 'apiFetch(' + args + ', "accountant"' + parts[i].substring(j);
            }
         } else {
            newContent += 'apiFetch(' + parts[i];
         }
       } else {
         newContent += 'apiFetch(' + parts[i];
       }
    }
    content = newContent;
  }
  
  fs.writeFileSync(file, content);
});
