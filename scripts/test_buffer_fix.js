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
        res.on('end', () => {
          const fullBuf = Buffer.concat(chunks);
          resolve(JSON.parse(fullBuf.toString('utf8')));
        });
        res.on('error', reject);
      });
    });
    if (data.documents) docs = docs.concat(data.documents);
    pageToken = data.nextPageToken || '';
  } while (pageToken);
  return docs;
}

async function verifyAll() {
  for (const col of ['knowledge', 'announcements', 'qa', 'employees', 'permissions']) {
    const docs = await listDocs(col);
    let ufffdCount = 0;
    for (const d of docs) {
      const s = JSON.stringify(d);
      if (s.includes('\uFFFD')) {
        ufffdCount++;
        console.log(`Corrupt in ${col}: ${d.name}`);
      }
    }
    console.log(`Collection [${col}]: Total docs = ${docs.length}, Corrupted docs = ${ufffdCount}`);
  }
}

verifyAll().catch(console.error);
