const https = require('https');
const apiKey = 'AIzaSyCHxAVoOSdNoBS9HaISnWodE5vYxscMJK4';
const projectId = 'studio-8742716914-acc69';

async function listDocs(collection) {
  let docs = [];
  let pageToken = '';
  do {
    const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${collection}?pageSize=300&key=${apiKey}${pageToken ? '&pageToken=' + pageToken : ''}`;
    const data = await new Promise((resolve, reject) => {
      https.get(url, (res) => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))));
        res.on('error', reject);
      });
    });
    if (data.documents) docs = docs.concat(data.documents);
    pageToken = data.nextPageToken || '';
  } while (pageToken);
  return docs;
}

async function run() {
  const docs = await listDocs('knowledge');
  const folders = new Map();
  const cats = new Map();
  for (const d of docs) {
    const f = d.fields?.mainFolder?.stringValue || 'N/A';
    const c = d.fields?.category?.stringValue || 'N/A';
    folders.set(f, (folders.get(f) || 0) + 1);
    cats.set(c, (cats.get(c) || 0) + 1);
  }
  console.log('=== Firestore Knowledge Main Folders (' + folders.size + ' folders) ===');
  for (const [k, v] of folders.entries()) {
    console.log(`- ${k}: ${v} เรื่อง`);
  }
  console.log('\n=== Firestore Knowledge Categories (' + cats.size + ' categories) ===');
  for (const [k, v] of [...cats.entries()].sort((a,b) => a[0].localeCompare(b[0], 'th'))) {
    console.log(`- ${k}: ${v} เรื่อง`);
  }
}

run().catch(console.error);
