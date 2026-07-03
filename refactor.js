const fs = require('fs');

const files = [
  'src/pages/accountant/FileGallery.tsx',
  'src/pages/accountant/Dashboard.tsx',
  'src/pages/accountant/Settings.tsx',
  'src/pages/accountant/ClientsList.tsx',
  'src/pages/accountant/Notifications.tsx',
  'src/pages/accountant/ClientDetail.tsx',
  'src/pages/client/Vault.tsx',
  'src/pages/client/Overdue.tsx',
  'src/pages/client/Dashboard.tsx',
  'src/pages/client/MyUploads.tsx',
  'src/pages/client/SetupProfile.tsx',
  'src/pages/Auth.tsx'
];

files.forEach(file => {
  if (fs.existsSync(file)) {
    let content = fs.readFileSync(file, 'utf8');
    let changed = false;

    // Check if fetch is used
    if (content.match(/\Wfetch\(/)) {
      // add import at top
      if (!content.includes('apiFetch')) {
        // Calculate relative path to lib/apiClient
        let depth = file.split('/').length - 2; // src/pages/file.tsx -> depth 1 -> ../lib/apiClient
        if (file === 'src/pages/Auth.tsx') {
           content = 'import { apiFetch } from "../lib/apiClient";\n' + content;
        } else {
           let relPath = '../'.repeat(depth) + 'lib/apiClient';
           content = `import { apiFetch } from "${relPath}";\n` + content;
        }
        changed = true;
      }
      
      // We will replace all fetch(...) with apiFetch(..., userType)
      // Since it's hard to do AST-based replacement here, I will just manually fix the ones using sed or one by one
    }

    if (changed) {
      fs.writeFileSync(file, content);
    }
  }
});
