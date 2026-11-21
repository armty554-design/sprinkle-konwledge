/**
 * Migrate branch names across all Cloud Firestore collections:
 *   - "ดอนเมือง"  -> "ปทุมธานี 2"
 *   - "ปทุมธานี"  -> "ปทุมธานี 1"
 *   - "ปทุมธานี1" -> "ปทุมธานี 1"
 *   - "ปทุมธานี2" -> "ปทุมธานี 2"
 *
 * Usage:
 *   node scripts/migrate_branches_firestore.js --dry-run
 *   node scripts/migrate_branches_firestore.js --apply
 */

const apiKey = "AIzaSyCHxAVoOSdNoBS9HaISnWodE5vYxscMJK4";
const projectId = "studio-8742716914-acc69";
const baseDocUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
const commitUrl = `${baseDocUrl}:commit?key=${apiKey}`;

const isApply = process.argv.includes("--apply");
const isDryRun = !isApply;

const TARGET_COLLECTIONS = [
  { name: "employees", fields: ["branch"] },
  { name: "loginLogs", fields: ["branch"] },
  { name: "viewLogs", fields: ["branch", "Branch"] },
  { name: "pushTokens", fields: ["branch", "Branch"] },
  { name: "notificationHistory", fields: ["targetBranch", "TargetBranch", "branch"] },
  { name: "scheduledNotifications", fields: ["targetBranch", "TargetBranch", "branch"] }
];

function mapSingleBranch(token) {
  const t = String(token || "").trim();
  const cleaned = t.replace(/\s+/g, "");
  if (cleaned === "ดอนเมือง") return { val: "ปทุมธานี 2", rule: "donmuang_to_pathum2" };
  if (cleaned === "ปทุมธานี") return { val: "ปทุมธานี 1", rule: "pathum_to_pathum1" };
  if (cleaned === "ปทุมธานี1" && t !== "ปทุมธานี 1") return { val: "ปทุมธานี 1", rule: "spacing_pathum1" };
  if (cleaned === "ปทุมธานี2" && t !== "ปทุมธานี 2") return { val: "ปทุมธานี 2", rule: "spacing_pathum2" };
  return { val: t, rule: null };
}

function mapBranchFieldValue(rawVal) {
  if (typeof rawVal !== "string") return { changed: false, value: rawVal, rule: null };
  const trimmed = rawVal.trim();
  if (!trimmed || trimmed === "-" || trimmed === "ทุกสาขา" || trimmed === "ทั้งหมด" || trimmed === "ไม่ระบุสาขา") {
    return { changed: false, value: rawVal, rule: null };
  }
  if (trimmed.includes(",")) {
    const parts = trimmed.split(",");
    let anyChanged = false;
    let firstRule = null;
    const mapped = parts.map((p) => {
      const r = mapSingleBranch(p);
      if (r.rule) {
        anyChanged = true;
        if (!firstRule) firstRule = r.rule;
      }
      return r.val;
    });
    if (!anyChanged) return { changed: false, value: rawVal, rule: null };
    return { changed: true, value: mapped.join(", "), rule: firstRule };
  }
  const r = mapSingleBranch(trimmed);
  if (!r.rule) return { changed: false, value: rawVal, rule: null };
  return { changed: true, value: r.val, rule: r.rule };
}

async function listAllDocuments(collectionName) {
  const docs = [];
  let pageToken = null;
  do {
    let url = `${baseDocUrl}/${collectionName}?pageSize=300&key=${apiKey}`;
    if (pageToken) url += `&pageToken=${encodeURIComponent(pageToken)}`;
    const res = await fetch(url);
    if (res.status === 429) {
      const text = await res.text();
      const err = new Error(`Firestore 429 RESOURCE_EXHAUSTED on ${collectionName}: ${text}`);
      err.code = 429;
      throw err;
    }
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`List ${collectionName} failed (${res.status}): ${text}`);
    }
    const json = await res.json();
    if (Array.isArray(json.documents)) {
      docs.push(...json.documents);
    }
    pageToken = json.nextPageToken;
  } while (pageToken);
  return docs;
}

async function commitPatchBatch(writes, chunkSize = 100) {
  let committed = 0;
  for (let i = 0; i < writes.length; i += chunkSize) {
    const chunk = writes.slice(i, i + chunkSize);
    const res = await fetch(commitUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ writes: chunk })
    });
    if (res.status === 429) {
      const text = await res.text();
      const err = new Error(`Firestore 429 RESOURCE_EXHAUSTED during commit: ${text}`);
      err.code = 429;
      throw err;
    }
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Commit batch failed (${res.status}): ${text}`);
    }
    const json = await res.json();
    committed += (json.writeResults || []).length;
    await new Promise((r) => setTimeout(r, 150));
  }
  return committed;
}

async function main() {
  console.log(`\n=== Cloud Firestore Branch Migration (${isDryRun ? "DRY-RUN" : "APPLY"}) ===`);
  console.log(`Project: ${projectId}`);
  console.log(`Rules:   "ดอนเมือง" -> "ปทุมธานี 2", "ปทุมธานี" -> "ปทุมธานี 1"\n`);

  const summary = {
    mode: isDryRun ? "dry-run" : "apply",
    totalMatchedDocs: 0,
    totalCommitted: 0,
    collections: {}
  };

  for (const col of TARGET_COLLECTIONS) {
    const docs = await listAllDocuments(col.name);
    const writes = [];
    const byRule = { donmuang_to_pathum2: 0, pathum_to_pathum1: 0, spacing_pathum1: 0, spacing_pathum2: 0 };

    for (const doc of docs) {
      const fields = doc.fields || {};
      const updatedFields = {};
      const fieldPaths = [];

      for (const fieldName of col.fields) {
        const fVal = fields[fieldName];
        if (fVal && typeof fVal.stringValue === "string") {
          const mapped = mapBranchFieldValue(fVal.stringValue);
          if (mapped.changed) {
            updatedFields[fieldName] = { stringValue: mapped.value };
            fieldPaths.push(fieldName);
            if (mapped.rule && byRule[mapped.rule] !== undefined) {
              byRule[mapped.rule]++;
            }
          }
        }
      }

      if (fieldPaths.length > 0) {
        writes.push({
          update: {
            name: doc.name,
            fields: updatedFields
          },
          updateMask: {
            fieldPaths
          }
        });
      }
    }

    let committed = 0;
    if (isApply && writes.length > 0) {
      committed = await commitPatchBatch(writes, 100);
    }

    summary.totalMatchedDocs += writes.length;
    summary.totalCommitted += committed;
    summary.collections[col.name] = {
      scanned: docs.length,
      toUpdate: writes.length,
      committed,
      byRule
    };

    console.log(
      `[${col.name}] scanned=${docs.length}, toUpdate=${writes.length}, committed=${committed}, byRule=${JSON.stringify(byRule)}`
    );
  }

  console.log("\nSummary:", JSON.stringify(summary, null, 2));
  if (isDryRun) {
    console.log("\nℹ️ Dry-run only. Re-run with --apply to commit changes to Firestore.");
  } else {
    console.log("\n✅ Cloud Firestore migration complete!");
  }
}

main().catch((err) => {
  if (err && err.code === 429) {
    console.error("\n⚠️ Firestore quota currently exhausted (HTTP 429 RESOURCE_EXHAUSTED).");
    console.error("   Firebase Spark daily quota resets at 00:00 Pacific Time (~14:00-15:00 Bangkok time).");
    console.error("   Re-run once quota resets: node scripts/migrate_branches_firestore.js --apply\n");
    process.exit(2);
  }
  console.error("\n❌ Migration failed:", err);
  process.exit(1);
});
