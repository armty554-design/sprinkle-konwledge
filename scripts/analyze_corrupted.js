const fs = require('fs');
const data = JSON.parse(fs.readFileSync('data_backup/clean_gas_data.json', 'utf8'));
const kList = data.knowledge || [];
console.log('Total items in GAS:', kList.length);

let fieldsWithFFFD = {};
kList.forEach((k, idx) => {
  for (const [key, val] of Object.entries(k)) {
    if (typeof val === 'string' && val.includes('\uFFFD')) {
      fieldsWithFFFD[key] = (fieldsWithFFFD[key] || 0) + 1;
      if (fieldsWithFFFD[key] <= 3) {
        console.log(`[${key}] in item ${idx} (id: ${k.id}): ${val}`);
      }
    }
  }
});
console.log('Summary of fields containing \\uFFFD in GAS:');
console.log(JSON.stringify(fieldsWithFFFD, null, 2));

const allMainFolders = new Set(kList.map(k => k.mainFolder));
console.log('\nAll unique mainFolder values in GAS:');
console.log(Array.from(allMainFolders));

const allCategories = new Set(kList.map(k => k.category));
console.log('\nAll unique category values in GAS:');
console.log(Array.from(allCategories));
