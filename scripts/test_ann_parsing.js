const fs = require('fs');

// Simulate the logic in sprinkle-firestore-adapter.js
function testAddAnnouncement() {
  function addAnnouncement() {
    var annObj = {};
    var skipNotif = false;
    if (arguments.length === 1 && typeof arguments[0] === 'object' && arguments[0] !== null) {
      annObj = Object.assign({}, arguments[0]);
      skipNotif = !!annObj.skipNotification;
    } else {
      annObj = {
        title: String(arguments[0] || "").trim(),
        content: String(arguments[1] || "").trim(),
        imageUrl: String(arguments[2] || "").trim(),
        createdBy: String(arguments[3] || "").trim(),
        linkUrl: String(arguments[4] || "").trim(),
        targetAudience: String(arguments[5] || "ทั้งหมด").trim(),
        autoCloseDate: String(arguments[6] || "").trim(),
        date: String(arguments[7] || "").trim(),
        displayOrder: (arguments[8] !== undefined && arguments[8] !== "") ? Number(arguments[8]) : 1,
        isPinned: !!arguments[9]
      };
      skipNotif = !!arguments[10];
    }
    return { annObj, skipNotif };
  }

  // Call with positional arguments exactly like saveAnnouncementData()
  const result = addAnnouncement(
    "หัวข้อประกาศทดสอบ",
    "เนื้อหาประกาศทดสอบ",
    "https://example.com/pic.jpg",
    "Admin",
    "https://example.com",
    "พนักงาน",
    "",
    "2026-10-30",
    2,
    true,
    false
  );

  console.log("Positional parse result:", JSON.stringify(result, null, 2));

  if (result.annObj.title !== "หัวข้อประกาศทดสอบ" ||
      result.annObj.content !== "เนื้อหาประกาศทดสอบ" ||
      result.annObj.isPinned !== true ||
      result.annObj.displayOrder !== 2) {
    throw new Error("Positional parsing failed!");
  }

  // Call with object argument
  const objResult = addAnnouncement({
    title: "จาก Object",
    content: "เนื้อหาจาก Object",
    isPinned: false
  });
  console.log("Object parse result:", JSON.stringify(objResult, null, 2));
  if (objResult.annObj.title !== "จาก Object") {
    throw new Error("Object parsing failed!");
  }

  console.log("✅ All announcement argument parsing tests PASSED!");
}

testAddAnnouncement();
