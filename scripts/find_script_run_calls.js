const fs = require('fs');
const html = fs.readFileSync('index.html', 'utf8');

const calls = new Map();
const lines = html.split('\n');

for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('google.script.run')) {
    const snippet = lines.slice(i, i + 12).join(' ');
    // Match chained invocation
    const matches = [...snippet.matchAll(/\.([a-zA-Z0-9_]+)\s*\(([^)]*)\)/g)];
    for (const m of matches) {
      const fnName = m[1];
      if (fnName !== 'withSuccessHandler' && fnName !== 'withFailureHandler' && fnName !== 'then' && fnName !== 'catch') {
        if (!calls.has(fnName)) calls.set(fnName, []);
        calls.get(fnName).push({ line: i + 1, args: m[2].trim().replace(/\s+/g, ' ') });
      }
    }
  }
}

for (const [fn, occurrences] of calls.entries()) {
  console.log(`\n=== Function: ${fn} (${occurrences.length} calls) ===`);
  occurrences.slice(0, 3).forEach(o => console.log(`  Line ${o.line}: ${fn}(${o.args})`));
}
