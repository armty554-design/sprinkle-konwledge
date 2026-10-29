const https = require('https');
const fs = require('fs');

const d = JSON.parse(fs.readFileSync('data_backup/clean_gas_data.json', 'utf8'));
const k = d.knowledge.find(x => String(x.id) === '1000768.3');

const apiKey = "AIzaSyCHxAVoOSdNoBS9HaISnWodE5vYxscMJK4";
const projectId = "studio-8742716914-acc69";
const commitUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:commit?key=${apiKey}`;

function toFirestoreValue(val) {
  if (val === null || val === undefined) return { nullValue: null };
  if (typeof val === 'boolean') return { booleanValue: val };
  if (typeof val === 'number') {
    if (Number.isInteger(val)) return { integerValue: val.toString() };
    return { doubleValue: val };
  }
  if (typeof val === 'string') return { stringValue: val };
  if (Array.isArray(val)) return { arrayValue: { values: val.map(toFirestoreValue) } };
  if (typeof val === 'object') {
    const fields = {};
    for (const [k, v] of Object.entries(val)) {
      if (v !== undefined) fields[k] = toFirestoreValue(v);
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(val) };
}

function objectToFirestoreFields(obj) {
  const fields = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) fields[k] = toFirestoreValue(v);
  }
  return { fields };
}

const write = {
  update: {
    name: `projects/${projectId}/databases/(default)/documents/knowledge/${encodeURIComponent(String(k.id))}`,
    fields: objectToFirestoreFields(k).fields
  }
};

const payload = JSON.stringify({ writes: [write] });
const u = new URL(commitUrl);
const req = https.request({
  hostname: u.hostname,
  path: u.pathname + u.search,
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload)
  }
}, res => {
  let b = '';
  res.on('data', c => b += c);
  res.on('end', () => {
    console.log('Status:', res.statusCode);
    console.log('Response:', b);
  });
});
req.write(payload);
req.end();
