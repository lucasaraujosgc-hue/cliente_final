const fs = require('fs');
const path = require('path');

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

const files = walk('src/pages');

files.forEach(file => {
  let content = fs.readFileSync(file, 'utf8');
  
  // A naive replacement for exact strings commonly found:
  // headers: { Authorization: `Bearer ${localStorage.getItem("accountantToken")}` }
  // headers: { Authorization: `Bearer ${token}` }
  // headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }
  // Authorization: `Bearer ${localStorage.getItem("clientToken") || sessionStorage.getItem("clientToken")}`,
  // We'll replace with just headers: { "Content-Type": "application/json" } or remove if only Authorization
  
  let newContent = content;
  
  // 1. Remove bare headers block that only have Authorization
  newContent = newContent.replace(/headers:\s*{\s*Authorization:\s*`Bearer\s*\$\{([^}]+)\}`\s*}/g, '');
  newContent = newContent.replace(/headers:\s*{\s*Authorization:\s*`Bearer\s*\$\{([^}]+)\}`\s*},?/g, '');
  
  // 2. Remove Authorization from mixed headers
  newContent = newContent.replace(/Authorization:\s*`Bearer\s*\$\{([^}]+)\}`,?/g, '');
  
  if (newContent !== content) {
    fs.writeFileSync(file, newContent);
  }
});
