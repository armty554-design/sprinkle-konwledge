const https = require('https');
const apiKey = "AIzaSyCHxAVoOSdNoBS9HaISnWodE5vYxscMJK4";
const projectId = "studio-8742716914-acc69";

async function test() {
  console.log("=== Testing Cloud Firestore Announcement Fetch ===");
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/announcements?pageSize=100&key=${apiKey}`;
  const res = await fetch(url);
  const data = await res.json();
  const docs = data.documents || [];
  console.log("Total announcements in Firestore:", docs.length);

  const targetDoc = docs.find(d => d.name.includes("ann_1793325565436"));
  if (targetDoc) {
    console.log("✅ Found recently added announcement in Firestore!");
    console.log("  Title:", targetDoc.fields?.title?.stringValue);
    console.log("  Date:", targetDoc.fields?.date?.stringValue);
    console.log("  Status:", targetDoc.fields?.status?.stringValue);
    console.log("  DisplayOrder:", targetDoc.fields?.displayOrder?.integerValue);
  } else {
    console.error("❌ Announcement ann_1793325565436 NOT found in Firestore!");
  }
}

test().catch(console.error);
