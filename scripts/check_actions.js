const fs = require('fs');
const code = fs.readFileSync('Code.js', 'utf8');
console.log('ALLOWED_ACTIONS includes setupFCM:', code.includes('"setupFCM":'));
