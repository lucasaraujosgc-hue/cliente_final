const fs = require('fs');
const path = 'src/server/routes.ts';
let code = fs.readFileSync(path, 'utf8');

const target = `  app.post("/api/admin/clean-subscriptions", async (req, res) => {
    try {
      const { pool } = require('./db');`;

const replacement = `  app.post("/api/admin/clean-subscriptions", async (req, res) => {
    try {
      const { pool } = await import('./db');`;

if (code.includes(target)) {
  code = code.replace(target, replacement);
  fs.writeFileSync(path, code, 'utf8');
  console.log('Successfully replaced require with import().');
} else {
  console.log('Target not found.');
}
