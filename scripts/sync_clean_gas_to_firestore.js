const fs = require('fs');
const https = require('https');

function toFirestoreValue(val) {
  if (val === null || val === undefined) {
    return { nullValue: null };
  }
  if (typeof val === 'boolean') {
    return { booleanValue: val };
  }
  if (typeof val === 'number') {
    if (Number.isInteger(val)) {
      return { integerValue: val.toString() };
    }
    return { doubleValue: val };
  }
  if (typeof val === 'string') {
    return { stringValue: val };
  }
  if (Array.isArray(val)) {
    return {
      arrayValue: {
        values: val.map(item => toFirestoreValue(item))
      }
    };
  }
  if (typeof val === 'object') {
    const fields = {};
    for (const [k, v] of Object.entries(val)) {
      if (v !== undefined) {
        fields[k] = toFirestoreValue(v);
      }
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(val) };
}

function objectToFirestoreFields(obj) {
  const fields = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) {
      fields[k] = toFirestoreValue(v);
    }
  }
  return { fields };
}

const apiKey = "AIzaSyCHxAVoOSdNoBS9HaISnWodE5vYxscMJK4";
const projectId = "studio-8742716914-acc69";
const commitUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:commit?key=${apiKey}`;

function sendCommit(writes) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ writes });
    const u = new URL(commitUrl);
    const options = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(JSON.parse(body));
        } else {
          reject(new Error(`Commit failed (${res.statusCode}): ${body.slice(0, 300)}`));
        }
      });
    });

    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function batchCommitInChunks(writes, chunkSize = 150) {
  console.log(`Processing total ${writes.length} writes in chunks of ${chunkSize}...`);
  for (let i = 0; i < writes.length; i += chunkSize) {
    const chunk = writes.slice(i, i + chunkSize);
    console.log(`  > Committing items ${i + 1} to ${Math.min(i + chunkSize, writes.length)}...`);
    await sendCommit(chunk);
    await new Promise(r => setTimeout(r, 250));
  }
}

async function main() {
  console.log('=== Starting Firestore Sync with 100% Clean Data ===');
  const data = JSON.parse(fs.readFileSync('data_backup/clean_gas_data.json', 'utf8'));

  // 0. Delete rogue permissions doc
  console.log('\n--- 0. Deleting Rogue Corrupted Docs ---');
  const deleteWrites = [
    {
      delete: `projects/${projectId}/databases/(default)/documents/permissions/${encodeURIComponent('พนักงนขับรถ')}`
    }
  ];
  try {
    await sendCommit(deleteWrites);
    console.log('✅ Deleted rogue permissions/พนักงนขับรถ');
  } catch (e) {
    console.log('Note on delete rogue:', e.message);
  }

  // 1. Config & Permissions
  console.log('\n--- 1. Migrating Clean System Config & Permissions ---');
  const configWrites = [
    {
      update: {
        name: `projects/${projectId}/databases/(default)/documents/config/main`,
        fields: objectToFirestoreFields(data.config || {}).fields
      }
    }
  ];
  (data.permissions || []).forEach(perm => {
    const roleId = encodeURIComponent(perm.role || 'unknown');
    configWrites.push({
      update: {
        name: `projects/${projectId}/databases/(default)/documents/permissions/${roleId}`,
        fields: objectToFirestoreFields(perm).fields
      }
    });
  });
  await batchCommitInChunks(configWrites);
  console.log('✅ Config & Permissions synced.');

  // 2. Announcements
  console.log('\n--- 2. Migrating Clean Announcements ---');
  const annWrites = (data.announcements || []).map(ann => {
    const docId = String(ann.id || `ann_${Date.now()}`);
    return {
      update: {
        name: `projects/${projectId}/databases/(default)/documents/announcements/${encodeURIComponent(docId)}`,
        fields: objectToFirestoreFields(ann).fields
      }
    };
  });
  await batchCommitInChunks(annWrites);
  console.log(`✅ Announcements (${annWrites.length}) synced.`);

  // 3. QA
  console.log('\n--- 3. Migrating Clean QA ---');
  const qaWrites = (data.qa || []).map(q => {
    const docId = String(q.id || `qa_${Date.now()}`);
    return {
      update: {
        name: `projects/${projectId}/databases/(default)/documents/qa/${encodeURIComponent(docId)}`,
        fields: objectToFirestoreFields(q).fields
      }
    };
  });
  await batchCommitInChunks(qaWrites);
  console.log(`✅ QA (${qaWrites.length}) synced.`);

  // 4. Knowledge
  console.log('\n--- 4. Migrating Clean Knowledge (395 records) ---');
  const knowledgeWrites = (data.knowledge || []).map(k => {
    // If category has 'ประกาศฝ่ายบริการจัดส่ง ประจำป 2564', fix typo to 'ประกาศฝ่ายบริการจัดส่ง ประจำปี 2564'
    let cat = k.category;
    if (cat === 'ประกาศฝ่ายบริการจัดส่ง ประจำป 2564') {
      cat = 'ประกาศฝ่ายบริการจัดส่ง ประจำปี 2564';
    }
    const cleanItem = {
      ...k,
      category: cat
    };
    const docId = String(k.id || `k_${Date.now()}`);
    return {
      update: {
        name: `projects/${projectId}/databases/(default)/documents/knowledge/${encodeURIComponent(docId)}`,
        fields: objectToFirestoreFields(cleanItem).fields
      }
    };
  });
  await batchCommitInChunks(knowledgeWrites);
  console.log(`✅ Knowledge (${knowledgeWrites.length}) synced.`);

  // 5. Employees
  console.log('\n--- 5. Migrating Clean Employees (510 records) ---');
  const empWrites = (data.employees || []).map(emp => {
    const docId = String(emp.empId || emp.id || `emp_${Date.now()}`);
    return {
      update: {
        name: `projects/${projectId}/databases/(default)/documents/employees/${encodeURIComponent(docId)}`,
        fields: objectToFirestoreFields(emp).fields
      }
    };
  });
  await batchCommitInChunks(empWrites);
  console.log(`✅ Employees (${empWrites.length}) synced.`);

  console.log('\n🎉 ALL COLLECTIONS RESTORED WITH 100% CLEAN THAI TEXT!');
}

main().catch(console.error);
