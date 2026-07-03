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
  if (content.includes('apiFetch(') && !content.includes('apiFetch } from')) {
    let depth = file.split('/').length - 2;
    let relPath = '../'.repeat(depth) + 'lib/apiClient';
    content = `import { apiFetch } from "${relPath}";\n` + content;
    fs.writeFileSync(file, content);
  }
});
