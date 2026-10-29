const fs = require('fs');

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
  return fields;
}

async function commitWrites(writes) {
  const res = await fetch(commitUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ writes })
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Commit failed (${res.status}): ${errText}`);
  }
  const json = await res.json();
  return json;
}

async function batchCommit(collectionName, writes, chunkSize = 100) {
  console.log(`\n--- Committing ${collectionName} (Total ${writes.length} items) ---`);
  for (let i = 0; i < writes.length; i += chunkSize) {
    const chunk = writes.slice(i, i + chunkSize);
    console.log(`  > ${collectionName} [${i + 1} - ${Math.min(i + chunkSize, writes.length)}]...`);
    const res = await commitWrites(chunk);
    console.log(`    ✅ Success: ${res.writeResults?.length} writes confirmed.`);
    await new Promise(r => setTimeout(r, 200));
  }
}

async function run() {
  const raw = fs.readFileSync('data_backup/clean_gas_data.json', 'utf8');
  const data = JSON.parse(raw);

  // 1. Config & Permissions
  const configWrites = [
    {
      update: {
        name: `projects/${projectId}/databases/(default)/documents/config/main`,
        fields: objectToFirestoreFields(data.config || {})
      }
    }
  ];
  (data.permissions || []).forEach(perm => {
    const roleId = encodeURIComponent(perm.role || 'unknown');
    configWrites.push({
      update: {
        name: `projects/${projectId}/databases/(default)/documents/permissions/${roleId}`,
        fields: objectToFirestoreFields(perm)
      }
    });
  });
  await batchCommit('Config & Permissions', configWrites, 50);

  // 2. Announcements
  const annWrites = (data.announcements || []).map(ann => ({
    update: {
      name: `projects/${projectId}/databases/(default)/documents/announcements/${encodeURIComponent(String(ann.id))}`,
      fields: objectToFirestoreFields(ann)
    }
  }));
  await batchCommit('Announcements', annWrites, 50);

  // 3. QA
  const qaWrites = (data.qa || []).map(q => ({
    update: {
      name: `projects/${projectId}/databases/(default)/documents/qa/${encodeURIComponent(String(q.id))}`,
      fields: objectToFirestoreFields(q)
    }
  }));
  await batchCommit('QA', qaWrites, 50);

  // 4. Knowledge
  const knowledgeWrites = (data.knowledge || []).map(k => {
    let cat = k.category;
    if (cat === 'ประกาศฝ่ายบริการจัดส่ง ประจำป 2564') {
      cat = 'ประกาศฝ่ายบริการจัดส่ง ประจำปี 2564';
    }
    const cleanItem = { ...k, category: cat };
    return {
      update: {
        name: `projects/${projectId}/databases/(default)/documents/knowledge/${encodeURIComponent(String(k.id))}`,
        fields: objectToFirestoreFields(cleanItem)
      }
    };
  });
  await batchCommit('Knowledge', knowledgeWrites, 100);

  // 5. Employees
  const empWrites = (data.employees || []).map(emp => ({
    update: {
      name: `projects/${projectId}/databases/(default)/documents/employees/${encodeURIComponent(String(emp.empId || emp.id))}`,
      fields: objectToFirestoreFields(emp)
    }
  }));
  await batchCommit('Employees', empWrites, 100);

  console.log('\n🎉 ALL COLLECTIONS SUCCESSFULLY COMMITTED VIA FETCH!');
}

run().catch(console.error);
