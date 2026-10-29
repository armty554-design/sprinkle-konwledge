const fs = require('fs');
const path = require('path');
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

async function batchCommitInChunks(writes, chunkSize = 200) {
  console.log(`Processing total ${writes.length} writes in chunks of ${chunkSize}...`);
  for (let i = 0; i < writes.length; i += chunkSize) {
    const chunk = writes.slice(i, i + chunkSize);
    console.log(`  > Committing items ${i + 1} to ${Math.min(i + chunkSize, writes.length)}...`);
    await sendCommit(chunk);
    // tiny delay to avoid burst
    await new Promise(r => setTimeout(r, 200));
  }
}

async function runMigration() {
  console.log('=== Starting SPRINKLE Migration to Cloud Firestore ===');
  const backupPath = path.join(__dirname, '..', 'data_backup', 'sprinkle_full_backup_20261029.json');
  if (!fs.existsSync(backupPath)) {
    throw new Error('Backup file not found at: ' + backupPath);
  }

  const data = JSON.parse(fs.readFileSync(backupPath, 'utf8'));

  // 1. Config & Permissions
  console.log('\n--- 1. Migrating System Config & Permissions ---');
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
  console.log('✅ Config & Permissions migrated.');

  // 2. Announcements
  console.log('\n--- 2. Migrating Announcements ---');
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
  console.log(`✅ Announcements (${annWrites.length}) migrated.`);

  // 3. QA
  console.log('\n--- 3. Migrating QA ---');
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
  console.log(`✅ QA (${qaWrites.length}) migrated.`);

  // 4. Employees
  console.log('\n--- 4. Migrating Employees ---');
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
  console.log(`✅ Employees (${empWrites.length}) migrated.`);

  // 5. Knowledge
  console.log('\n--- 5. Migrating Knowledge ---');
  const knowledgeWrites = (data.knowledge || []).map(k => {
    const docId = String(k.id || `k_${Date.now()}`);
    return {
      update: {
        name: `projects/${projectId}/databases/(default)/documents/knowledge/${encodeURIComponent(docId)}`,
        fields: objectToFirestoreFields(k).fields
      }
    };
  });
  await batchCommitInChunks(knowledgeWrites);
  console.log(`✅ Knowledge (${knowledgeWrites.length}) migrated.`);

  console.log('\n🎉🎉🎉 ALL DATA MIGRATED TO CLOUD FIRESTORE SUCCESSFULLY! 🎉🎉🎉');
}

runMigration().catch(err => {
  console.error('❌ Migration failed:', err);
  process.exit(1);
});
