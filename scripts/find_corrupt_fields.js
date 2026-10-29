const https = require('https');
const apiKey = 'AIzaSyCHxAVoOSdNoBS9HaISnWodE5vYxscMJK4';
const projectId = 'studio-8742716914-acc69';

async function listDocs(collection) {
  let docs = [];
  let pageToken = '';
  do {
    const url = 'https://firestore.googleapis.com/v1/projects/' + projectId + '/databases/(default)/documents/' + collection + '?pageSize=300&key=' + apiKey + (pageToken ? '&pageToken=' + pageToken : '');
    const data = await new Promise((resolve, reject) => {
      https.get(url, (res) => {
        let b = '';
        res.on('data', c => b += c);
        res.on('end', () => resolve(JSON.parse(b)));
        res.on('error', reject);
      });
    });
    if (data.documents) docs = docs.concat(data.documents);
    pageToken = data.nextPageToken || '';
  } while (pageToken);
  return docs;
}

async function findCorrupt() {
  const docs = await listDocs('knowledge');
  let count = 0;
  for (const d of docs) {
    const s = JSON.stringify(d);
    if (s.includes('\uFFFD')) {
      count++;
      const id = decodeURIComponent(d.name.split('/').pop());
      console.log('Doc ID:', id);
      for (const [k, v] of Object.entries(d.fields || {})) {
        const valStr = JSON.stringify(v);
        if (valStr.includes('\uFFFD')) {
          console.log('  field ' + k + ':', valStr);
        }
      }
      if (count >= 10) break;
    }
  }
}
findCorrupt().catch(console.error);
