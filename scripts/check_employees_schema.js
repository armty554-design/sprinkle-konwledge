const fs = require('fs');
const code = fs.readFileSync('Code.js', 'utf8');
const lines = code.split('\n');
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('getSheetByName("Employees")')) {
    console.log('Line ' + (i+1) + ': ' + lines[i]);
    console.log(lines.slice(i, i + 20).join('\n'));
    break;
  }
}
