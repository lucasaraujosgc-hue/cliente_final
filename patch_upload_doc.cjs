const fs = require('fs');
const path = 'src/server/routes.ts';
let code = fs.readFileSync(path, 'utf8');

const target = `      const [newDoc] = await db
        .insert(documents)
        .values({
          clientId,
          title,
          category,
          dueDate,
          competence,
          fileUrl: req.file ? \`/uploads/\${req.file.filename}\` : null,
          status: "new",
          uploadedBy: "accountant",
        })
        .returning();

      res.json({`;

const replacement = `      const [newDoc] = await db
        .insert(documents)
        .values({
          clientId,
          title,
          category,
          dueDate,
          competence,
          fileUrl: req.file ? \`/uploads/\${req.file.filename}\` : null,
          status: "new",
          uploadedBy: "accountant",
        })
        .returning();
        
      // Trigger debounced notification
      triggerDebouncedDocumentNotification(newDoc);

      res.json({`;

if (code.includes(target)) {
  code = code.replace(target, replacement);
  fs.writeFileSync(path, code, 'utf8');
  console.log('Successfully patched upload-doc.');
} else {
  console.log('Target not found.');
}
