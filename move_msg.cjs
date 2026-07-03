const fs = require('fs');
let code = fs.readFileSync('src/pages/client/Dashboard.tsx', 'utf8');

const messageMarker = '          {/* SATELLITE COMMUNICATIONS FROM ACCOUNTANT */}';
const messageEnd = '          ))}';
const messageStartIdx = code.indexOf(messageMarker);
const messageEndIdx = code.indexOf(messageEnd, messageStartIdx) + messageEnd.length + 1; // get to newline

const block = code.substring(messageStartIdx, messageEndIdx);

// Remove the block
code = code.substring(0, messageStartIdx) + code.substring(messageEndIdx);

const insertMarker = '          {/* 🚨 DEDICATED HIGH-VISIBILITY DUE DATE SECTION (VENCIMENTOS) */}';
const insertIdx = code.indexOf(insertMarker);

code = code.substring(0, insertIdx) + block + '\n\n' + code.substring(insertIdx);

fs.writeFileSync('src/pages/client/Dashboard.tsx', code);
console.log('SUCCESS');
