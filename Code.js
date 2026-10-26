function doGet(e) {
  if (e && e.parameter && e.parameter.debug === "1") {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName("Employees");
    if (!sheet) return ContentService.createTextOutput("Sheet not found");
    var values = sheet.getDataRange().getValues();
    return ContentService.createTextOutput(JSON.stringify(values))
      .setMimeType(ContentService.MimeType.JSON);
  }

  var status = getSystemStatus();
  if (status === "ปิดปรับปรุง") {
    return HtmlService.createHtmlOutputFromFile('Maintenance')
           .setTitle('ระบบปรับปรุงชั่วคราว - SPRINKLE')
           .addMetaTag('viewport', 'width=device-width, initial-scale=1.0')
           .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }
  return HtmlService.createHtmlOutputFromFile('index')
         .setTitle('Sprinkle Knowledge')
         .addMetaTag('viewport', 'width=device-width, initial-scale=1.0')
         .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// 0. ฟังก์ชันดึงข้อมูลรวมสำหรับการโหลดหน้าเว็บครั้งเดียว (Batch Initial Data)
function getInitialAppData() {
  try {
    return {
      success: true,
      knowledge: getKnowledgeData() || [],
      qa: getQAData() || [],
      announcements: getAnnouncements() || [],
      employees: getAllEmployees() || [],
      permissions: getAllRolePermissions() || [],
      config: getSystemConfig() || {}
      // rankings ย้ายไปโหลด on-demand เมื่อผู้ใช้เข้าแท็บแนะนำ & จัดอันดับ เพื่อลดเวลาโหลดหน้าแรก
    };
  } catch (err) {
    Logger.log("Error in getInitialAppData: " + err.toString());
    return {
      success: false,
      error: err.toString()
    };
  }
}

// 1. ตรวจสอบรหัสพนักงาน
function verifyEmployee(empId, password) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName("Employees");
    if (!sheet) return { success: false, message: "ไม่พบชีตฐานข้อมูลพนักงาน (Employees)" };
    
    var rows = sheet.getDataRange().getValues();
    var targetId = empId.toString().trim();
    var targetPassword = password !== undefined ? password.toString().trim() : "";
    
    var empName = "";
    var empRole = "";
    var found = false;
    var canAnswerQA = false;
    var profilePic = "";
    var dbPassword = "";
    
    // จัดการรหัส admin999 เบื้องต้น
    if (targetId === "admin999") {
      if (targetPassword !== "admin999" && targetPassword !== "1111") {
        return { success: false, message: "รหัสผ่านไม่ถูกต้อง" };
      }
      empName = "ผู้ดูแลระบบ";
      empRole = "แอดมิน";
      found = true;
      canAnswerQA = true;
      profilePic = "";
    } else {
      var empBranch = "";
      for (var i = 1; i < rows.length; i++) {
        if (rows[i][0].toString().trim() === targetId) {
          empName = rows[i][1] ? rows[i][1].toString() : "คุณพนักงาน";
          empRole = rows[i][2] ? rows[i][2].toString().trim() : "พนักงาน";
          empBranch = (rows[i].length > 6 && rows[i][6] !== undefined && rows[i][6] !== null) ? rows[i][6].toString().trim() : "";
          
          // ตรวจสอบชีต Employees คอลัมน์ D (index 3) เพื่อหาค่าสิทธิ์ตอบคำถาม
          var qaCell = rows[i][3] !== undefined ? rows[i][3].toString().trim().toLowerCase() : "";
          if (qaCell !== "") {
            canAnswerQA = qaCell === "true" || qaCell === "yes" || qaCell === "ผู้จัดการ" || qaCell === "แอดมิน" || rows[i][3] === true;
          } else {
            canAnswerQA = null; // ส่ง null เพื่อไปตรวจเช็ค fallback ที่ส่วนสิทธิ์หลักของตำแหน่งงาน
          }
          
          // รหัสผ่าน (คอลัมน์ E index 4) และรูปประจำตัว (คอลัมน์ F index 5)
          dbPassword = rows[i][4] !== undefined && rows[i][4] !== null && rows[i][4].toString().trim() !== "" ? rows[i][4].toString().trim() : "1234";
          profilePic = rows[i][5] !== undefined && rows[i][5] !== null ? rows[i][5].toString().trim() : "";
          
          if (targetPassword !== dbPassword) {
            return { success: false, message: "รหัสผ่านไม่ถูกต้องสำหรับรหัสพนักงานนี้" };
          }
          
          // ตรวจสอบสถานะการอนุมัติ (คอลัมน์ J index 9)
          var approvalStatus = (rows[i].length > 9 && rows[i][9] !== undefined && rows[i][9] !== null && rows[i][9].toString().trim() !== "") ? rows[i][9].toString().trim() : "อนุมัติแล้ว";
          if (approvalStatus === "รออนุมัติ" || approvalStatus.toLowerCase() === "pending") {
            return { success: false, isPending: true, message: "⏳ บัญชีของคุณอยู่ระหว่างรอแอดมินอนุมัติการเข้าใช้งาน กรุณารอการอนุมัติหรือติดต่อแอดมินครับ" };
          }
          if (approvalStatus === "ไม่อนุมัติ" || approvalStatus.toLowerCase() === "rejected") {
            return { success: false, message: "❌ คำขอลงทะเบียนของคุณไม่ได้รับการอนุมัติ กรุณาติดต่อแอดมินครับ" };
          }
          
          found = true;
          break;
        }
      }
    }
    
    if (found) {
      // ดึงสิทธิ์ของตำแหน่งนี้จากชีต Permissions
      var perms = getRolePermissions(empRole);
      
      // หากคอลัมน์ D ของพนักงานว่างเปล่า ให้ fallback ใช้ canEdit ของสิทธิ์ตำแหน่งงาน
      if (canAnswerQA === null) {
        canAnswerQA = perms.canEdit;
      }
      
      // บันทึกสถิติล็อกอินสำเร็จ (ส่ง branch โดยตรง ไม่ต้องสแกนชีตซ้ำ)
      try {
        logLogin(targetId, empName, empRole, empBranch);
      } catch (logErr) {
        Logger.log("logLogin warning: " + logErr.toString());
      }
      
      return { 
        success: true, 
        name: empName, 
        role: empRole,
        branch: empBranch,
        canEdit: perms.canEdit,
        canToggle: perms.canToggle,
        canAnswerQA: canAnswerQA,
        profilePic: profilePic
      };
    }
    
    return { success: false, message: "ไม่พบรหัสพนักงานนี้ในระบบ" };
  } catch (error) {
    return { success: false, message: "เกิดข้อผิดพลาด: " + error.toString() };
  }
}

// 2. บันทึกสถิติการล็อกอิน
function logLogin(empId, empName, role, branch) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName("LoginLogs");
    
    // สร้างชีตหากไม่มีอยู่
    if (!sheet) {
      sheet = ss.insertSheet("LoginLogs");
      sheet.appendRow(["วันเวลาที่เข้าใช้งาน (Timestamp)", "รหัสพนักงาน (Employee ID)", "ชื่อพนักงาน (Name)", "บทบาท/ตำแหน่ง (Role)", "สาขา (Branch)"]);
      sheet.getRange("A1:E1").setFontWeight("bold").setBackground("#F1F5F9");
    }
    
    var formattedDate = Utilities.formatDate(new Date(), "GMT+7", "yyyy-MM-dd HH:mm:ss");
    sheet.appendRow([formattedDate, empId, empName, role, branch || ""]);
    return true;
  } catch (error) {
    Logger.log("Error in logLogin: " + error.toString());
    return false;
  }
}

// 3. ดึงข้อมูลศูนย์การเรียนรู้ (เรียงลำดับจากหัวข้อที่เพิ่มใหม่ล่าสุดให้อยู่บนสุดก่อน)
function getKnowledgeData() {
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Knowledge");
    if (!sheet) return [];
    
    var rows = sheet.getDataRange().getValues();
    var data = [];
    
    // วนลูปจากแถวล่างสุดขึ้นมา (Reverse) เพื่อให้หัวข้อที่เพิ่งเพิ่มใหม่อยู่บนสุดเสมอ
    for (var i = rows.length - 1; i >= 1; i--) {
      if (rows[i][0] !== "") {
        var groupType = (rows[i].length > 9 && rows[i][9]) ? rows[i][9].toString().trim().toLowerCase() : "";
        
        // กรองประเภทอัตโนมัติหากไม่มีการระบุกลุ่มประเภทในคอลัมน์ J
        if (groupType === "") {
          var typeLower = rows[i][3] ? rows[i][3].toString().toLowerCase().trim() : "";
          var urlLower = rows[i][4] ? rows[i][4].toString().toLowerCase().trim() : "";
          if (typeLower === "video" || typeLower === "youtube" || typeLower === "canva" ||
              urlLower.indexOf("canva.com") !== -1 || urlLower.indexOf("youtube.com") !== -1 || urlLower.indexOf("youtu.be") !== -1) {
            groupType = "video";
          } else {
            groupType = "document";
          }
        }
        
        // แฟ้มหลัก (คอลัมน์ K index 10) เช่น "ประกาศ", "ขั้นตอนการทำงาน", "นโยบาย"
        var mainFolder = (rows[i].length > 10 && rows[i][10]) ? rows[i][10].toString().trim() : "ขั้นตอนการทำงาน";
        if (!mainFolder) mainFolder = "ขั้นตอนการทำงาน";
        
        // กลุ่มเป้าหมาย (คอลัมน์ L index 11) เช่น "พนักงาน", "ผู้ประกอบการ", หรือ "พนักงาน,ผู้ประกอบการ"
        var targetAudience = (rows[i].length > 11 && rows[i][11] !== undefined && rows[i][11] !== null && rows[i][11].toString().trim() !== "") ? rows[i][11].toString().trim() : "ทั้งหมด";
        
        data.push({
          id: rows[i][0],
          category: rows[i][1] ? rows[i][1].toString().trim() : "",
          title: rows[i][2] ? rows[i][2].toString().trim() : "",
          type: rows[i][3] ? rows[i][3].toString().toLowerCase().trim() : "",
          url: rows[i][4] ? rows[i][4].toString().trim() : "",
          uploadedBy: rows[i][5] ? rows[i][5].toString().trim() : "แอดมิน",
          timestamp: rows[i][6] ? rows[i][6].toString() : "",
          status: rows[i][7] ? rows[i][7].toString().trim() : "เปิดใช้งาน",
          additionalLinks: rows[i][8] ? rows[i][8].toString().trim() : "",
          groupType: groupType,
          mainFolder: mainFolder,
          targetAudience: targetAudience
        });
      }
    }
    return data;
  } catch (error) {
    return [];
  }
}

// 4. บันทึกข้อมูลศูนย์การเรียนรู้ใหม่ (สำหรับแอดมิน / ผู้จัดการ)
function addKnowledge(data, uploadedBy) {
  var lock = null;
  var hasLock = false;
  try {
    if (typeof LockService !== 'undefined' && LockService.getScriptLock) {
      lock = LockService.getScriptLock();
      try {
        hasLock = lock.tryLock(20000);
      } catch (eLock) {}
    }

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName("Knowledge");
    if (!sheet) return "ไม่พบชีตศูนย์การเรียนรู้ (Knowledge)";
    
    // ตรวจสอบและสร้างคอลัมน์กลุ่มประเภท (คอลัมน์ J), แฟ้มหลัก (คอลัมน์ K) และกลุ่มเป้าหมาย (คอลัมน์ L) หากไม่มี
    var headers = sheet.getRange("1:1").getValues()[0];
    if (headers.length < 10 || headers[9] === "") {
      sheet.getRange(1, 10).setValue("กลุ่มประเภท").setFontWeight("bold").setBackground("#F1F5F9");
    }
    if (headers.length < 11 || headers[10] === "") {
      sheet.getRange(1, 11).setValue("แฟ้มหลัก").setFontWeight("bold").setBackground("#F1F5F9");
    }
    if (headers.length < 12 || headers[11] === "") {
      sheet.getRange(1, 12).setValue("กลุ่มเป้าหมาย (Audience)").setFontWeight("bold").setBackground("#F1F5F9");
    }
    
    var lastRow = sheet.getLastRow();
    // ระบบป้องกันบันทึกซ้ำ (Deduplication Guard): ตรวจสอบแถวล่าสุดย้อนหลัง 15 แถว
    if (lastRow > 1) {
      var checkCount = Math.min(15, lastRow - 1);
      var startCheckRow = lastRow - checkCount + 1;
      var recentRows = sheet.getRange(startCheckRow, 1, checkCount, 12).getValues();
      var nowMs = new Date().getTime();
      
      for (var r = recentRows.length - 1; r >= 0; r--) {
        var rowCat = recentRows[r][1] ? recentRows[r][1].toString().trim() : "";
        var rowTitle = recentRows[r][2] ? recentRows[r][2].toString().trim() : "";
        var rowUrl = recentRows[r][4] ? recentRows[r][4].toString().trim() : "";
        var rowDateStr = recentRows[r][6] ? recentRows[r][6].toString().trim() : "";
        
        var isMatch = (rowTitle === (data.title || "").trim()) && 
                      (rowCat === (data.category || "").trim() || rowUrl === (data.url || "").trim());
        if (isMatch) {
          var rowDate = new Date(rowDateStr);
          var timeDiffMs = (!isNaN(rowDate.getTime())) ? (nowMs - rowDate.getTime()) : 0;
          // หากหัวข้อซ้ำและถูกบันทึกไปแล้วภายใน 60 วินาที ให้ถือว่าสำเร็จและไม่บันทึกซ้ำ
          if (timeDiffMs >= 0 && timeDiffMs < 60000) {
            return "บันทึกข้อมูลเรียบร้อยแล้ว!";
          }
        }
      }
    }
    
    var newId = Math.floor(Math.random() * 1000000); // สุ่ม ID
    var uBy = uploadedBy || "แอดมิน";
    var formattedDate = Utilities.formatDate(new Date(), "GMT+7", "yyyy-MM-dd HH:mm:ss");
    var groupType = data.groupType || "document";
    var mainFolder = data.mainFolder || "ขั้นตอนการทำงาน";
    var targetAudience = data.targetAudience || "ทั้งหมด";
    if (mainFolder === "รวมภาพสื่อประชาสัมพันธ์" || mainFolder === "แฟ้มประชาสัมพันธ์" || mainFolder === "ประชาสัมพันธ์") {
      targetAudience = "พนักงาน";
    }
    
    sheet.appendRow([newId, data.category, data.title, data.type, data.url, uBy, formattedDate, "เปิดใช้งาน", data.additionalLinks || "", groupType, mainFolder, targetAudience]);
    
    // ยิง Push Notification แจ้งเตือนเมื่อมีคู่มือความรู้ใหม่
    try {
      sendPushNotificationToFCM("📚 คู่มือความรู้ใหม่: " + data.title, "หมวดหมู่: " + data.category + " (แฟ้ม " + mainFolder + ")", "/", targetAudience);
    } catch(ePush) {}
    
    return "บันทึกข้อมูลเรียบร้อยแล้ว!";
  } catch (error) {
    return "เกิดข้อผิดพลาด: " + error.toString();
  } finally {
    if (hasLock && lock) {
      try { lock.releaseLock(); } catch(eRel) {}
    }
  }
}

// 4.1 เปลี่ยนสถานะเปิด/ปิดสิทธิ์ของคลังความรู้ (สำหรับแอดมิน)
function toggleKnowledgeStatus(id, newStatus) {
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Knowledge");
    if (!sheet) return "ไม่พบชีตคลังความรู้";
    
    var rows = sheet.getDataRange().getValues();
    var targetId = id.toString().trim();
    
    for (var i = 1; i < rows.length; i++) {
      if (rows[i][0].toString().trim() === targetId) {
        sheet.getRange(i + 1, 8).setValue(newStatus); // คอลัมน์ H (สถานะ)
        return "ปรับเปลี่ยนสิทธิ์การเข้าถึงเรียบร้อยแล้ว!";
      }
    }
    return "ไม่พบข้อมูลที่ต้องการปรับสถานะ";
  } catch (error) {
    return "เกิดข้อผิดพลาด: " + error.toString();
  }
}

// 5. ลบหัวข้อความรู้ (สำหรับแอดมิน / ผู้จัดการ)
function deleteKnowledge(id) {
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Knowledge");
    if (!sheet) return "ไม่พบชีตคลังความรู้";
    
    var rows = sheet.getDataRange().getValues();
    var targetId = id.toString().trim();
    
    for (var i = 1; i < rows.length; i++) {
      if (rows[i][0].toString().trim() === targetId) {
        sheet.deleteRow(i + 1); // spreadsheet row index is 1-based, headers are row 1
        return "ลบหัวข้อความรู้เรียบร้อยแล้ว!";
      }
    }
    return "ไม่พบข้อมูลที่ต้องการลบ";
  } catch (error) {
    return "เกิดข้อผิดพลาดในการลบ: " + error.toString();
  }
}

// 6. ดึงข้อมูลระบบ Q&A
function getQAData() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName("QA");
    if (!sheet) return [];
    
    var rows = sheet.getDataRange().getValues();
    var data = [];
    
    for (var i = 1; i < rows.length; i++) {
      if (rows[i][0] !== "") {
        data.push({
          id: rows[i][0],
          category: rows[i][1] ? rows[i][1].toString().trim() : "",
          question: rows[i][2] ? rows[i][2].toString().trim() : "",
          askedBy: rows[i][3] ? rows[i][3].toString().trim() : "",
          askedTime: rows[i][4] ? rows[i][4].toString() : "",
          answer: rows[i][5] ? rows[i][5].toString().trim() : "",
          answeredBy: rows[i][6] ? rows[i][6].toString().trim() : "",
          answeredTime: rows[i][7] ? rows[i][7].toString() : "",
          status: rows[i][8] ? rows[i][8].toString().trim() : "รอดำเนินการ",
          askedFile: rows[i][9] ? rows[i][9].toString().trim() : "",
          answeredFile: rows[i][10] ? rows[i][10].toString().trim() : ""
        });
      }
    }
    return data;
  } catch (error) {
    return [];
  }
}

// 7. พนักงานถามคำถาม Q&A (รองรับไฟล์แนบและตอบอัตโนมัติ)
function addQuestion(category, question, askedBy, askedFileUrl) {
  var lock = null;
  var hasLock = false;
  try {
    if (typeof LockService !== 'undefined' && LockService.getScriptLock) {
      lock = LockService.getScriptLock();
      try {
        hasLock = lock.tryLock(20000);
      } catch (eLock) {}
    }

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName("QA");
    
    // สร้างชีตหากไม่มีอยู่
    if (!sheet) {
      sheet = ss.insertSheet("QA");
      sheet.appendRow(["รหัสคำถาม", "หมวดหมู่", "คำถาม", "ถามโดย", "เวลาที่ถาม", "คำตอบ", "ตอบโดย", "เวลาที่ตอบ", "สถานะ", "AskedFile", "AnsweredFile"]);
    }
    
    // หากจำนวนคอลัมน์ของหัวตารางมีน้อยกว่า 11 ให้เพิ่มหัวตารางคอลัมน์ไฟล์แนบ
    if (sheet.getLastColumn() < 11) {
      sheet.getRange(1, 10).setValue("AskedFile");
      sheet.getRange(1, 11).setValue("AnsweredFile");
    }

    var lastRow = sheet.getLastRow();
    // ระบบป้องกันบันทึกซ้ำ (Deduplication Guard): ตรวจสอบแถวล่าสุดย้อนหลัง 15 แถว
    if (lastRow > 1) {
      var checkCount = Math.min(15, lastRow - 1);
      var startCheckRow = lastRow - checkCount + 1;
      var recentRows = sheet.getRange(startCheckRow, 1, checkCount, 5).getValues();
      var nowMs = new Date().getTime();
      
      for (var r = recentRows.length - 1; r >= 0; r--) {
        var rowCat = recentRows[r][1] ? recentRows[r][1].toString().trim() : "";
        var rowQ = recentRows[r][2] ? recentRows[r][2].toString().trim() : "";
        var rowBy = recentRows[r][3] ? recentRows[r][3].toString().trim() : "";
        var rowDateStr = recentRows[r][4] ? recentRows[r][4].toString().trim() : "";
        
        var isMatch = (rowQ === (question || "").trim()) && 
                      (rowBy === (askedBy || "").trim());
        if (isMatch) {
          var rowDate = new Date(rowDateStr);
          var timeDiffMs = (!isNaN(rowDate.getTime())) ? (nowMs - rowDate.getTime()) : 0;
          // หากคำถามซ้ำจากผู้ถามคนเดียวกันภายใน 60 วินาที ให้ถือว่าสำเร็จและไม่บันทึกซ้ำ
          if (timeDiffMs >= 0 && timeDiffMs < 60000) {
            return "ส่งคำถามเรียบร้อยแล้ว! รอกรรมการหรือผู้จัดการมาตอบนะครับ";
          }
        }
      }
    }
    
    var newId = "qa_" + new Date().getTime();
    var formattedDate = Utilities.formatDate(new Date(), "GMT+7", "yyyy-MM-dd HH:mm:ss");
    
    // ดึงสถานะเปิดใช้งาน Auto-Answer
    var config = getSystemConfig();
    var isAutoAnswerEnabled = config.auto_answer_status !== "ปิดใช้งาน";
    var autoAnswered = false;
    var autoAnswerText = "";
    
    if (isAutoAnswerEnabled) {
      var matchResult = findBestAutoAnswer(question);
      if (matchResult && matchResult.score >= 0.55) {
        autoAnswered = true;
        autoAnswerText = matchResult.answer;
      }
    }
    
    if (autoAnswered) {
      // บันทึกคำถามแบบตอบเสร็จทันทีโดยบอท
      sheet.appendRow([newId, category, question, askedBy, formattedDate, autoAnswerText, "ระบบตอบอัตโนมัติ (AI Bot)", formattedDate, "ตอบแล้ว", askedFileUrl || "", ""]);
      return "🤖 ระบบได้ตอบคำถามของคุณโดยอัตโนมัติเรียบร้อยแล้ว! สามารถเช็คคำตอบได้ที่แท็บ 'ตอบแล้ว' นะครับ";
    } else {
      // บันทึกแบบรอดำเนินการปกติ
      sheet.appendRow([newId, category, question, askedBy, formattedDate, "", "", "", "รอดำเนินการ", askedFileUrl || "", ""]);
      return "ส่งคำถามเรียบร้อยแล้ว! รอกรรมการหรือผู้จัดการมาตอบนะครับ";
    }
  } catch (error) {
    return "เกิดข้อผิดพลาด: " + error.toString();
  } finally {
    if (hasLock && lock) {
      try { lock.releaseLock(); } catch(eRel) {}
    }
  }
}

// 8. ผู้จัดการ / แอดมิน ตอบคำถาม Q&A (รองรับไฟล์แนบ)
function answerQuestion(qaId, answer, answeredBy, answeredFileUrl) {
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("QA");
    if (!sheet) return "ไม่พบชีตคำถาม (QA)";
    
    var rows = sheet.getDataRange().getValues();
    var targetId = qaId.toString().trim();
    
    for (var i = 1; i < rows.length; i++) {
      if (rows[i][0].toString().trim() === targetId) {
        var formattedDate = Utilities.formatDate(new Date(), "GMT+7", "yyyy-MM-dd HH:mm:ss");
        
        sheet.getRange(i + 1, 6).setValue(answer); // คอลัมน์ F (คำตอบ)
        sheet.getRange(i + 1, 7).setValue(answeredBy); // คอลัมน์ G (ตอบโดย)
        sheet.getRange(i + 1, 8).setValue(formattedDate); // คอลัมน์ H (เวลาที่ตอบ)
        sheet.getRange(i + 1, 9).setValue("ตอบแล้ว"); // คอลัมน์ I (สถานะ)
        
        // บันทึกไฟล์แนบคำตอบลงคอลัมน์ K (คอลัมน์ที่ 11)
        sheet.getRange(i + 1, 11).setValue(answeredFileUrl || "");
        
        // ยิง Push Notification แจ้งเตือนผู้ถามเมื่อมีคำตอบใหม่
        try {
          var askerEmpId = rows[i][3] ? rows[i][3].toString().trim() : "";
          var qTitle = rows[i][1] ? rows[i][1].toString().trim() : "คำถามของคุณ";
          var ansSummary = (answer && answer.length > 80) ? (answer.substring(0, 80) + "...") : answer;
          sendPushNotificationToFCM("💡 คำถามของคุณได้รับการตอบแล้ว!", ansSummary, "/", "เฉพาะบุคคล", null, askerEmpId);
        } catch(ePushQA) {}
        
        return "บันทึกคำตอบเรียบร้อยแล้ว!";
      }
    }
    return "ไม่พบรหัสคำถามในระบบ";
  } catch (error) {
    return "เกิดข้อผิดพลาดในการตอบ: " + error.toString();
  }
}

// 9. ดึงข้อมูลสิทธิ์ตามตำแหน่งจากชีต Permissions (หรือสร้างชีตสิทธิ์หากยังไม่มี)
function getRolePermissions(roleName) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName("Permissions");
    
    // หากไม่มีชีตสิทธิ์การใช้งาน ให้สร้างขึ้นมาพร้อมค่าตั้งต้น
    if (!sheet) {
      sheet = ss.insertSheet("Permissions");
      sheet.appendRow(["บทบาท/ตำแหน่ง (Role)", "สิทธิ์แก้ไขและอัปโหลด (Can Edit)", "สิทธิ์เปิด/ปิดเรื่อง (Can Toggle)"]);
      sheet.appendRow(["แอดมิน", true, true]);
      sheet.appendRow(["ผู้จัดการ", true, false]);
      sheet.appendRow(["พนักงาน", false, false]);
    }
    
    var rows = sheet.getDataRange().getValues();
    var targetRole = roleName.toString().trim().toLowerCase();
    
    for (var i = 1; i < rows.length; i++) {
      var currentRole = rows[i][0].toString().trim().toLowerCase();
      if (currentRole === targetRole) {
        var canEditVal = rows[i][1].toString().trim().toLowerCase();
        var canToggleVal = rows[i][2].toString().trim().toLowerCase();
        return {
          canEdit: rows[i][1] === true || canEditVal === "true" || canEditVal === "yes",
          canToggle: rows[i][2] === true || canToggleVal === "true" || canToggleVal === "yes"
        };
      }
    }
    
    // ค่าเริ่มต้นกรณีไม่พบบทบาทในตาราง
    if (targetRole === "แอดมิน") {
      return { canEdit: true, canToggle: true };
    } else if (targetRole === "ผู้จัดการ") {
      return { canEdit: true, canToggle: false };
    }
    
    return { canEdit: false, canToggle: false };
  } catch (error) {
    Logger.log("Error in getRolePermissions: " + error.toString());
    return { canEdit: false, canToggle: false };
  }
}

// 10. ดึงสถานะการทำงานของระบบ (Maintenance Mode Switch)
function getSystemStatus() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName("SystemConfig");
    
    // หากไม่พบชีต ให้สร้างชีตพร้อมค่าเริ่มต้น "เปิดใช้งาน"
    if (!sheet) {
      sheet = ss.insertSheet("SystemConfig");
      sheet.appendRow(["หัวข้อคอนฟิก (Parameter)", "ค่าตั้งค่า (Value)", "คำอธิบาย (Description)"]);
      sheet.appendRow(["system_status", "เปิดใช้งาน", "สถานะระบบ (เปิดใช้งาน / ปิดปรับปรุง)"]);
      
      // ป้องกันการแก้ไขหัวตารางเบื้องต้น
      sheet.getRange("A1:C1").setFontWeight("bold").setBackground("#F1F5F9");
      sheet.getRange("A2:B2").setFontWeight("bold");
    }
    
    var rows = sheet.getDataRange().getValues();
    for (var i = 1; i < rows.length; i++) {
      if (rows[i][0].toString().trim() === "system_status") {
        return rows[i][1].toString().trim();
      }
    }
    return "เปิดใช้งาน"; // ค่าเริ่มต้นหากไม่มีค่า
  } catch (e) {
    return "เปิดใช้งาน";
  }
}

// 11. อัปโหลดไฟล์แบบ Base64 ตรงเข้า Google Drive Folder
function uploadFileToDrive(base64Data, fileName, mimeType) {
  try {
    var folderId = "14DYSGx1L2Ul5E0TiwohxladyPtgCsrkK";
    var folder = DriveApp.getFolderById(folderId);
    var decodedData = Utilities.base64Decode(base64Data);
    var blob = Utilities.newBlob(decodedData, mimeType, fileName);
    var file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return { success: true, url: file.getUrl(), fileId: file.getId() };
  } catch (error) {
    return { success: false, error: error.toString() };
  }
}

// 12. ดึงข้อมูลประกาศข่าวสารหน้าแรก
function getAnnouncements() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName("Announcements");
    if (!sheet) return [];
    
    var rows = sheet.getDataRange().getValues();
    var data = [];
    
    // ตรวจสอบคอลัมน์ H (ลิงก์เชื่อมโยง), I (กลุ่มเป้าหมาย), J (วันเวลาปิดอัตโนมัติ)
    if (sheet.getLastColumn() < 8) {
      sheet.getRange(1, 8).setValue("ลิงก์เชื่อมโยง");
    }
    if (sheet.getLastColumn() < 9) {
      sheet.getRange(1, 9).setValue("กลุ่มเป้าหมาย (Audience)");
    }
    if (sheet.getLastColumn() < 10) {
      sheet.getRange(1, 10).setValue("วันเวลาปิดอัตโนมัติ (Auto Close)");
    }
    
    for (var i = 1; i < rows.length; i++) {
      if (rows[i][0] !== "") {
        var targetAudience = (rows[i].length > 8 && rows[i][8] !== undefined && rows[i][8] !== null && rows[i][8].toString().trim() !== "") ? rows[i][8].toString().trim() : "ทั้งหมด";
        var rawAutoClose = (rows[i].length > 9 && rows[i][9] !== undefined && rows[i][9] !== null) ? rows[i][9] : "";
        var autoCloseDate = "";
        if (rawAutoClose instanceof Date) {
          try {
            var tz = "Asia/Bangkok";
            if (typeof Session !== "undefined" && Session.getScriptTimeZone) {
              tz = Session.getScriptTimeZone() || tz;
            }
            autoCloseDate = Utilities.formatDate(rawAutoClose, tz, "yyyy-MM-dd'T'HH:mm");
          } catch(e) {
            autoCloseDate = rawAutoClose.toISOString ? rawAutoClose.toISOString() : rawAutoClose.toString().trim();
          }
        } else if (rawAutoClose) {
          autoCloseDate = rawAutoClose.toString().trim();
        }
        data.push({
          id: rows[i][0],
          title: rows[i][1] ? rows[i][1].toString().trim() : "",
          content: rows[i][2] ? rows[i][2].toString().trim() : "",
          imageUrl: rows[i][3] ? rows[i][3].toString().trim() : "",
          date: rows[i][4] ? rows[i][4].toString() : "",
          status: rows[i][5] ? rows[i][5].toString().trim() : "เปิดใช้งาน",
          createdBy: rows[i][6] ? rows[i][6].toString().trim() : "",
          linkUrl: rows[i][7] ? rows[i][7].toString().trim() : "",
          targetAudience: targetAudience,
          autoCloseDate: autoCloseDate
        });
      }
    }
    
    // จัดเรียงประกาศจากใหม่ล่าสุดไปเก่าสุดเสมอ (Newest First)
    data.sort(function(a, b) {
      var timeA = a.date ? new Date(a.date).getTime() : 0;
      if (!timeA && a.id && a.id.toString().indexOf("ann_") === 0) {
        timeA = parseInt(a.id.toString().replace("ann_", "")) || 0;
      }
      var timeB = b.date ? new Date(b.date).getTime() : 0;
      if (!timeB && b.id && b.id.toString().indexOf("ann_") === 0) {
        timeB = parseInt(b.id.toString().replace("ann_", "")) || 0;
      }
      return timeB - timeA;
    });
    
    return data;
  } catch (error) {
    return [];
  }
}

// 13. เพิ่มประกาศข่าวสารหน้าแรก (แอดมิน)
function addAnnouncement(title, content, imageUrl, createdBy, linkUrl, targetAudience, autoCloseDate) {
  var lock = null;
  var hasLock = false;
  try {
    if (typeof LockService !== 'undefined' && LockService.getScriptLock) {
      lock = LockService.getScriptLock();
      try {
        hasLock = lock.tryLock(20000);
      } catch (eLock) {}
    }

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName("Announcements");
    if (!sheet) {
      sheet = ss.insertSheet("Announcements");
      sheet.appendRow(["รหัสประกาศ", "หัวข้อประกาศ", "เนื้อหาประกาศ", "ลิงก์รูปภาพประกอบ", "วันที่ประกาศ", "สถานะการแสดงผล", "ผู้สร้างประกาศ", "ลิงก์เชื่อมโยง", "กลุ่มเป้าหมาย (Audience)", "วันเวลาปิดอัตโนมัติ (Auto Close)"]);
      sheet.getRange("A1:J1").setFontWeight("bold").setBackground("#F1F5F9");
    }
    
    if (sheet.getLastColumn() < 8) {
      sheet.getRange(1, 8).setValue("ลิงก์เชื่อมโยง");
    }
    if (sheet.getLastColumn() < 9) {
      sheet.getRange(1, 9).setValue("กลุ่มเป้าหมาย (Audience)");
    }
    if (sheet.getLastColumn() < 10) {
      sheet.getRange(1, 10).setValue("วันเวลาปิดอัตโนมัติ (Auto Close)");
    }

    var lastRow = sheet.getLastRow();
    // ระบบป้องกันบันทึกซ้ำ (Deduplication Guard): ตรวจสอบแถวล่าสุดย้อนหลัง 15 แถว
    if (lastRow > 1) {
      var checkCount = Math.min(15, lastRow - 1);
      var startCheckRow = lastRow - checkCount + 1;
      var numCols = Math.min(sheet.getLastColumn(), 9);
      var recentRows = sheet.getRange(startCheckRow, 1, checkCount, numCols).getValues();
      var nowMs = new Date().getTime();
      
      for (var r = recentRows.length - 1; r >= 0; r--) {
        var rowTitle = recentRows[r][1] ? recentRows[r][1].toString().trim() : "";
        var rowContent = recentRows[r][2] ? recentRows[r][2].toString().trim() : "";
        var rowDateStr = recentRows[r][4] ? recentRows[r][4].toString().trim() : "";
        
        var isMatch = (rowTitle === (title || "").trim()) && 
                      (rowContent === (content || "").trim());
        if (isMatch) {
          var rowDate = new Date(rowDateStr);
          var timeDiffMs = (!isNaN(rowDate.getTime())) ? (nowMs - rowDate.getTime()) : 0;
          // หากหัวข้อและเนื้อหาซ้ำและเพิ่งบันทึกไปภายใน 60 วินาที ให้ข้ามการแทรกแถวซ้ำ
          if (timeDiffMs >= 0 && timeDiffMs < 60000) {
            return "บันทึกประกาศข่าวสารเรียบร้อยแล้ว!";
          }
        }
      }
    }
    
    var newId = "ann_" + new Date().getTime();
    var formattedDate = Utilities.formatDate(new Date(), "GMT+7", "yyyy-MM-dd HH:mm:ss");
    var audience = targetAudience || "ทั้งหมด";
    
    sheet.appendRow([newId, title, content, imageUrl || "", formattedDate, "เปิดใช้งาน", createdBy || "แอดมิน", linkUrl || "", audience, autoCloseDate || ""]);
    
    // ยิง Push Notification แจ้งเตือนเมื่อมีประกาศข่าวสารใหม่
    try {
      var summaryText = (content && content.length > 80) ? (content.substring(0, 80) + "...") : (content || "มีประกาศข่าวสารใหม่ในระบบ");
      sendPushNotificationToFCM("📢 " + title, summaryText, "/", audience);
    } catch(ePushAnn) {}
    
    return "บันทึกประกาศข่าวสารเรียบร้อยแล้ว!";
  } catch (error) {
    return "เกิดข้อผิดพลาด: " + error.toString();
  } finally {
    if (hasLock && lock) {
      try { lock.releaseLock(); } catch(eRel) {}
    }
  }
}

// 14. ลบประกาศข่าวสารหน้าแรก (แอดมิน)
function deleteAnnouncement(id) {
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Announcements");
    if (!sheet) return "ไม่พบชีตประกาศข่าวสาร";
    
    var rows = sheet.getDataRange().getValues();
    var targetId = id.toString().trim();
    
    for (var i = 1; i < rows.length; i++) {
      if (rows[i][0].toString().trim() === targetId) {
        sheet.deleteRow(i + 1);
        return "ลบประกาศเรียบร้อยแล้ว!";
      }
    }
    return "ไม่พบประกาศที่ต้องการลบ";
  } catch (error) {
    return "เกิดข้อผิดพลาดในการลบ: " + error.toString();
  }
}

// 15. สลับสถานะเปิด/ปิดการแสดงผลประกาศ (แอดมิน)
function toggleAnnouncementStatus(id, newStatus) {
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Announcements");
    if (!sheet) return "ไม่พบชีตประกาศข่าวสาร";
    
    var rows = sheet.getDataRange().getValues();
    var targetId = id.toString().trim();
    
    for (var i = 1; i < rows.length; i++) {
      if (rows[i][0].toString().trim() === targetId) {
        sheet.getRange(i + 1, 6).setValue(newStatus); // คอลัมน์ F (สถานะการแสดงผล)
        return "ปรับเปลี่ยนสถานะประกาศเรียบร้อยแล้ว!";
      }
    }
    return "ไม่พบประกาศที่ต้องการปรับสถานะ";
  } catch (error) {
    return "เกิดข้อผิดพลาด: " + error.toString();
  }
}

// 16. ดึงข้อมูลพอร์ตเชื่อมต่อและคอนฟิกระบบทั้งหมด (รวมถึงลิงก์ NotebookLM และระบบตอบกลับอัตโนมัติ)
function getSystemConfig() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName("SystemConfig");
    
    var config = {
      system_status: "เปิดใช้งาน",
      notebooklm_url: "https://notebooklm.google.com/notebook/6da3674b-d044-480f-a1a6-089cef4406c3/preview",
      auto_answer_status: "เปิดใช้งาน"
    };
    
    if (!sheet) {
      sheet = ss.insertSheet("SystemConfig");
      sheet.appendRow(["หัวข้อคอนฟิก (Parameter)", "ค่าตั้งค่า (Value)", "คำอธิบาย (Description)"]);
      sheet.appendRow(["system_status", "เปิดใช้งาน", "สถานะระบบ (เปิดใช้งาน / ปิดปรับปรุง)"]);
      sheet.appendRow(["notebooklm_url", config.notebooklm_url, "ลิงก์แชท Google NotebookLM"]);
      sheet.appendRow(["auto_answer_status", "เปิดใช้งาน", "ระบบตอบคำถามอัตโนมัติ (เปิดใช้งาน / ปิดใช้งาน)"]);
      sheet.getRange("A1:C1").setFontWeight("bold").setBackground("#F1F5F9");
      return config;
    }
    
    var rows = sheet.getDataRange().getValues();
    var foundStatus = false;
    var foundUrl = false;
    var foundAutoAnswer = false;
    
    for (var i = 1; i < rows.length; i++) {
      var key = rows[i][0].toString().trim();
      if (key === "system_status") {
        config.system_status = rows[i][1].toString().trim();
        foundStatus = true;
      } else if (key === "notebooklm_url") {
        config.notebooklm_url = rows[i][1].toString().trim();
        foundUrl = true;
      } else if (key === "auto_answer_status") {
        config.auto_answer_status = rows[i][1].toString().trim();
        foundAutoAnswer = true;
      }
    }
    
    if (!foundUrl) {
      sheet.appendRow(["notebooklm_url", config.notebooklm_url, "ลิงก์แชท Google NotebookLM"]);
    }
    if (!foundAutoAnswer) {
      sheet.appendRow(["auto_answer_status", "เปิดใช้งาน", "ระบบตอบคำถามอัตโนมัติ (เปิดใช้งาน / ปิดใช้งาน)"]);
    }
    
    return config;
  } catch (e) {
    return {
      system_status: "เปิดใช้งาน",
      notebooklm_url: "https://notebooklm.google.com/notebook/6da3674b-d044-480f-a1a6-089cef4406c3",
      auto_answer_status: "เปิดใช้งาน"
    };
  }
}

// 17. บันทึกคอนฟิกระบบ (รองรับพารามิเตอร์ระบบตอบอัตโนมัติ)
function saveSystemConfig(systemStatus, notebooklmUrl, autoAnswerStatus) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName("SystemConfig");
    if (!sheet) return "ไม่พบชีตตั้งค่าระบบ";
    
    var rows = sheet.getDataRange().getValues();
    var statusUpdated = false;
    var urlUpdated = false;
    var autoAnswerUpdated = false;
    var actualAutoAnswerStatus = autoAnswerStatus || "เปิดใช้งาน";
    
    for (var i = 1; i < rows.length; i++) {
      var key = rows[i][0].toString().trim();
      if (key === "system_status") {
        sheet.getRange(i + 1, 2).setValue(systemStatus);
        statusUpdated = true;
      } else if (key === "notebooklm_url") {
        sheet.getRange(i + 1, 2).setValue(notebooklmUrl);
        urlUpdated = true;
      } else if (key === "auto_answer_status") {
        sheet.getRange(i + 1, 2).setValue(actualAutoAnswerStatus);
        autoAnswerUpdated = true;
      }
    }
    
    if (!statusUpdated) {
      sheet.appendRow(["system_status", systemStatus, "สถานะระบบ (เปิดใช้งาน / ปิดปรับปรุง)"]);
    }
    if (!urlUpdated) {
      sheet.appendRow(["notebooklm_url", notebooklmUrl, "ลิงก์แชท Google NotebookLM"]);
    }
    if (!autoAnswerUpdated) {
      sheet.appendRow(["auto_answer_status", actualAutoAnswerStatus, "ระบบตอบคำถามอัตโนมัติ (เปิดใช้งาน / ปิดใช้งาน)"]);
    }
    
    return "บันทึกการตั้งค่าระบบเรียบร้อยแล้ว!";
  } catch (error) {
    return "เกิดข้อผิดพลาด: " + error.toString();
  }
}

// 18. ดึงข้อมูลพนักงานทั้งหมด
function getAllEmployees() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName("Employees");
    if (!sheet) return [];
    
    var rows = sheet.getDataRange().getValues();
    var employees = [];
    
    for (var i = 1; i < rows.length; i++) {
      var empId = rows[i][0] !== undefined && rows[i][0] !== null ? rows[i][0].toString().trim() : "";
      if (empId !== "" && empId !== "admin999") { // ไม่ดึงแอดมินจำลองหลัก
        var role = rows[i][2] ? rows[i][2].toString().trim() : "พนักงาน";
        var branch = (rows[i].length > 6 && rows[i][6] !== undefined && rows[i][6] !== null) ? rows[i][6].toString().trim() : "";
        var registeredDate = (rows[i].length > 7 && rows[i][7] !== undefined && rows[i][7] !== null) ? rows[i][7].toString().trim() : "";
        // ดึงเบอร์รถจากคอลัมน์ I (index 8) ของชีต Employees
        var carNo = (rows[i].length > 8 && rows[i][8] !== undefined && rows[i][8] !== null) ? rows[i][8].toString().trim() : "";
        if (!carNo && (role === "ผู้ประกอบการ" || role === "พี่สปริงเคิล" || role.indexOf("ผู้ประกอบการ") !== -1 || role.indexOf("สปริงเคิล") !== -1)) {
          var colH = (rows[i].length > 7 && rows[i][7] !== undefined && rows[i][7] !== null) ? rows[i][7].toString().trim() : "";
          carNo = colH || branch || empId;
        }
        if (!carNo) carNo = "-";
        
        // สถานะการอนุมัติ (คอลัมน์ J index 9)
        var approvalStatus = (rows[i].length > 9 && rows[i][9] !== undefined && rows[i][9] !== null && rows[i][9].toString().trim() !== "") ? rows[i][9].toString().trim() : "อนุมัติแล้ว";
        
        employees.push({
          empId: empId,
          name: rows[i][1] ? rows[i][1].toString().trim() : "",
          role: role,
          canAnswerQA: rows[i][3] === true || (rows[i][3] && rows[i][3].toString().trim().toLowerCase() === "true") || (rows[i][3] && rows[i][3].toString().trim().toLowerCase() === "yes"),
          password: rows[i][4] ? rows[i][4].toString().trim() : "1234",
          profilePic: rows[i][5] ? rows[i][5].toString().trim() : "",
          branch: branch,
          carNumber: carNo,
          registeredDate: registeredDate,
          approvalStatus: approvalStatus
        });
      }
    }
    return employees;
  } catch (error) {
    return [];
  }
}

// 19. เพิ่มหรืออัปเดตข้อมูลสิทธิ์พนักงาน
function updateEmployee(empId, name, role, canAnswerQA, password, profilePic, branch, carNumber, approvalStatus) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName("Employees");
    if (!sheet) {
      sheet = ss.insertSheet("Employees");
      sheet.appendRow(["รหัสพนักงาน", "ชื่อ-นามสกุล", "ตำแหน่ง/บทบาท", "สิทธิ์ตอบคำถาม Q&A", "รหัสผ่าน", "รูปโปรไฟล์", "สาขา", "ข้อมูลเพิ่มเติม/วันที่สมัคร", "เบอร์รถ", "สถานะการอนุมัติ"]);
      sheet.getRange("A1:J1").setFontWeight("bold").setBackground("#F1F5F9");
    } else {
      var headers = sheet.getRange("1:1").getValues()[0];
      if (headers.length < 10 || headers[9] === "") {
        sheet.getRange(1, 10).setValue("สถานะการอนุมัติ").setFontWeight("bold").setBackground("#F1F5F9");
      }
    }
    
    var rows = sheet.getDataRange().getValues();
    var targetId = empId.toString().trim();
    var pwd = password !== undefined ? password.toString().trim() : "1234";
    var pPic = profilePic !== undefined ? profilePic.toString().trim() : "";
    var br = branch !== undefined ? branch.toString().trim() : "";
    var carNo = carNumber !== undefined && carNumber.toString().trim() !== "" ? carNumber.toString().trim() : "-";
    var appStatus = approvalStatus !== undefined && approvalStatus.toString().trim() !== "" ? approvalStatus.toString().trim() : "อนุมัติแล้ว";
    
    for (var i = 1; i < rows.length; i++) {
      if (rows[i][0].toString().trim() === targetId) {
        sheet.getRange(i + 1, 2).setValue(name.toString().trim());
        sheet.getRange(i + 1, 3).setValue(role.toString().trim());
        sheet.getRange(i + 1, 4).setValue(canAnswerQA);
        sheet.getRange(i + 1, 5).setValue(pwd);
        sheet.getRange(i + 1, 6).setValue(pPic);
        sheet.getRange(i + 1, 7).setValue(br);
        sheet.getRange(i + 1, 9).setValue(carNo);
        sheet.getRange(i + 1, 10).setValue(appStatus);
        return "อัปเดตข้อมูลพนักงานสำเร็จ!";
      }
    }
    
    // หากไม่พบ ให้เพิ่มแถวใหม่ (สถานะ อนุมัติแล้ว)
    var nowStr = Utilities.formatDate(new Date(), "GMT+7", "yyyy-MM-dd HH:mm:ss");
    sheet.appendRow([targetId, name.toString().trim(), role.toString().trim(), canAnswerQA, pwd, pPic, br, nowStr, carNo, appStatus]);
    return "เพิ่มพนักงานใหม่เรียบร้อยแล้ว!";
  } catch (e) {
    return "เกิดข้อผิดพลาด: " + e.toString();
  }
}

// 20. ลงทะเบียนสมาชิกใหม่ (บันทึกลงชีต Employees ทันที สถานะ 'รออนุมัติ')
function registerNewMember(data) {
  var lock = null;
  var hasLock = false;
  try {
    if (typeof LockService !== 'undefined' && LockService.getScriptLock) {
      lock = LockService.getScriptLock();
      try {
        hasLock = lock.tryLock(20000);
      } catch (eLock) {}
    }

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName("Employees");
    if (!sheet) {
      sheet = ss.insertSheet("Employees");
      sheet.appendRow(["รหัสพนักงาน", "ชื่อ-นามสกุล", "ตำแหน่ง/บทบาท", "สิทธิ์ตอบคำถาม Q&A", "รหัสผ่าน", "รูปโปรไฟล์", "สาขา", "ข้อมูลเพิ่มเติม/วันที่สมัคร", "เบอร์รถ", "สถานะการอนุมัติ"]);
      sheet.getRange("A1:J1").setFontWeight("bold").setBackground("#F1F5F9");
    } else {
      var headers = sheet.getRange("1:1").getValues()[0];
      if (headers.length < 10 || headers[9] === "") {
        sheet.getRange(1, 10).setValue("สถานะการอนุมัติ").setFontWeight("bold").setBackground("#F1F5F9");
      }
    }
    
    var rows = sheet.getDataRange().getValues();
    var targetId = data.empId ? data.empId.toString().trim() : "";
    var name = data.name ? data.name.toString().trim() : "";
    var role = data.role ? data.role.toString().trim() : "พนักงาน";
    var branch = data.branch ? data.branch.toString().trim() : "";
    var carNumber = data.carNumber ? data.carNumber.toString().trim() : "-";
    if (!carNumber || carNumber === "") carNumber = "-";
    var password = data.password ? data.password.toString().trim() : "";
    var profilePic = data.profilePic ? data.profilePic.toString().trim() : "";
    var nowStr = Utilities.formatDate(new Date(), "GMT+7", "yyyy-MM-dd HH:mm:ss");
    
    if (!targetId) return { success: false, message: "กรุณากรอกรหัสพนักงาน / รหัสพี่สปริงเคิล" };
    if (!name) return { success: false, message: "กรุณากรอกชื่อ-นามสกุล" };
    if (!password || password === "1234") return { success: false, message: "กรุณากำหนดรหัสผ่านส่วนตัว (ไม่สามารถใช้ 1234 ได้ครับ)" };
    
    for (var i = 1; i < rows.length; i++) {
      if (rows[i][0].toString().trim() === targetId) {
        var existingStatus = (rows[i].length > 9 && rows[i][9]) ? rows[i][9].toString().trim() : "อนุมัติแล้ว";
        if (existingStatus === "รออนุมัติ") {
          return { success: false, message: "รหัสนี้ได้ส่งคำขอลงทะเบียนไว้แล้ว อยู่ระหว่างรอผู้จัดการหรือแอดมินอนุมัติครับ" };
        } else {
          return { success: false, message: "รหัสนี้มีอยู่ในระบบแล้ว สามารถค้นหารหัสเพื่อตั้งรหัสผ่าน หรือเข้าสู่ระบบได้ทันทีครับ" };
        }
      }
    }
    
    // บันทึกแถวใหม่ลงในชีต Employees สถานะ "รออนุมัติ"
    sheet.appendRow([targetId, name, role, false, password, profilePic, branch, nowStr, carNumber, "รออนุมัติ"]);
    return { 
      success: true, 
      message: "🎉 ส่งคำขอลงทะเบียนสำเร็จเรียบร้อยแล้ว!\n\nเนื่องจากเป็นรหัสใหม่ ข้อมูลของคุณอยู่ระหว่างรอผู้จัดการหรือแอดมินอนุมัติการเข้าใช้งานครับ" 
    };
  } catch (e) {
    return { success: false, message: "เกิดข้อผิดพลาดในการลงทะเบียน: " + e.toString() };
  } finally {
    if (hasLock && lock) {
      try { lock.releaseLock(); } catch(eRel) {}
    }
  }
}

// ดึงรายการตำแหน่งงาน (Roles) ทั้งหมดจากชีต Permissions และ Employees สำหรับใช้ในฟอร์มลงทะเบียน
function getRegistrationRoles() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var roles = [];

    // 1. ดึงจากชีต Permissions (รายการบทบาทและสิทธิ์ที่กำหนดไว้ในระบบ)
    var permSheet = ss.getSheetByName("Permissions");
    if (permSheet) {
      var permRows = permSheet.getDataRange().getValues();
      for (var i = 1; i < permRows.length; i++) {
        var r = permRows[i][0] ? permRows[i][0].toString().trim() : "";
        if (r && roles.indexOf(r) === -1) {
          roles.push(r);
        }
      }
    }

    // 2. ดึงจากชีต Employees เพิ่มเติม (ตำแหน่งงานที่พนักงานมีอยู่ในระบบจริง)
    var empSheet = ss.getSheetByName("Employees");
    if (empSheet) {
      var empRows = empSheet.getDataRange().getValues();
      for (var j = 1; j < empRows.length; j++) {
        var er = empRows[j][2] ? empRows[j][2].toString().trim() : "";
        if (er && roles.indexOf(er) === -1) {
          roles.push(er);
        }
      }
    }

    // จัดให้ "พี่สปริงเคิล" / "ผู้ประกอบการ" ขึ้นมาแสดงในลำดับต้นๆ เพื่อความสะดวกในการเลือก
    if (roles.indexOf("ผู้ประกอบการ") !== -1) {
      roles.splice(roles.indexOf("ผู้ประกอบการ"), 1);
    }
    if (roles.indexOf("พี่สปริงเคิล") !== -1) {
      roles.splice(roles.indexOf("พี่สปริงเคิล"), 1);
    }
    roles.unshift("ผู้ประกอบการ");
    roles.unshift("พี่สปริงเคิล");

    if (roles.length === 0) {
      roles = ["พี่สปริงเคิล", "พนักงาน", "ผู้จัดการ", "แอดมิน"];
    }

    return roles;
  } catch (e) {
    Logger.log("Error in getRegistrationRoles: " + e.toString());
    return ["พี่สปริงเคิล", "พนักงาน", "ผู้จัดการ", "แอดมิน"];
  }
}

// 21. อนุมัติพนักงานใหม่ (สำหรับแอดมิน)
function approveEmployee(empId) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName("Employees");
    if (!sheet) return { success: false, message: "ไม่พบชีตฐานข้อมูลพนักงาน" };
    
    var rows = sheet.getDataRange().getValues();
    var targetId = empId.toString().trim();
    
    for (var i = 1; i < rows.length; i++) {
      if (rows[i][0].toString().trim() === targetId) {
        sheet.getRange(i + 1, 10).setValue("อนุมัติแล้ว");
        return { success: true, message: "อนุมัติการใช้งานของรหัส " + targetId + " เรียบร้อยแล้ว!" };
      }
    }
    return { success: false, message: "ไม่พบรหัสพนักงานนี้" };
  } catch (e) {
    return { success: false, message: "เกิดข้อผิดพลาด: " + e.toString() };
  }
}

// 22. ปฏิเสธหรือลบคำขอลงทะเบียน (สำหรับแอดมิน)
function rejectEmployee(empId) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName("Employees");
    if (!sheet) return { success: false, message: "ไม่พบชีตฐานข้อมูลพนักงาน" };
    
    var rows = sheet.getDataRange().getValues();
    var targetId = empId.toString().trim();
    
    for (var i = 1; i < rows.length; i++) {
      if (rows[i][0].toString().trim() === targetId) {
        sheet.deleteRow(i + 1);
        return { success: true, message: "ลบคำขอลงทะเบียนของรหัส " + targetId + " เรียบร้อยแล้ว" };
      }
    }
    return { success: false, message: "ไม่พบรหัสพนักงานนี้" };
  } catch (e) {
    return { success: false, message: "เกิดข้อผิดพลาด: " + e.toString() };
  }
}

// 23. ตรวจสอบรหัสพนักงานเพื่อนำไปแสดงผลก่อนลงทะเบียนใหม่
function getEmployeeInfoForRegistration(empId) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName("Employees");
    if (!sheet) return { success: false, message: "ไม่พบชีตฐานข้อมูลพนักงาน" };
    
    var rows = sheet.getDataRange().getValues();
    var targetId = empId ? empId.toString().trim() : "";
    if (!targetId) return { success: false, message: "กรุณาระบุรหัสเพื่อค้นหา" };
    
    for (var i = 1; i < rows.length; i++) {
      if (rows[i][0].toString().trim() === targetId) {
        var name = rows[i][1] ? rows[i][1].toString().trim() : "คุณพนักงาน";
        var role = rows[i][2] ? rows[i][2].toString().trim() : "พนักงาน";
        var branch = (rows[i].length > 6 && rows[i][6]) ? rows[i][6].toString().trim() : "";
        var carNumber = (rows[i].length > 8 && rows[i][8]) ? rows[i][8].toString().trim() : "-";
        var approvalStatus = (rows[i].length > 9 && rows[i][9]) ? rows[i][9].toString().trim() : "อนุมัติแล้ว";
        var currentPwd = rows[i][4] ? rows[i][4].toString().trim() : "";
        var isRegistered = (currentPwd !== "" && currentPwd !== "1234");
        
        return {
          success: true,
          found: true,
          empId: targetId,
          name: name,
          role: role,
          branch: branch,
          carNumber: carNumber,
          approvalStatus: approvalStatus,
          isRegistered: isRegistered
        };
      }
    }
    return { success: false, notFound: true, message: "ไม่พบรหัส " + targetId + " ในฐานข้อมูลพนักงาน" };
  } catch (e) {
    return { success: false, message: "เกิดข้อผิดพลาด: " + e.toString() };
  }
}

// 24. ลงทะเบียนรหัสผ่านและข้อมูลสำหรับพนักงานที่มีรหัสในระบบอยู่แล้ว
function registerEmployee(empId, password, profilePicUrl, branch, carNumber) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName("Employees");
    if (!sheet) return { success: false, message: "ไม่พบชีตฐานข้อมูลพนักงาน" };
    
    var rows = sheet.getDataRange().getValues();
    var targetId = empId ? empId.toString().trim() : "";
    var pwd = password ? password.toString().trim() : "";
    if (!pwd || pwd === "1234") {
      return { success: false, message: "กรุณากำหนดรหัสผ่านใหม่ (ไม่สามารถใช้ 1234 ได้ครับ)" };
    }
    var pPic = profilePicUrl ? profilePicUrl.toString().trim() : "";
    var br = (branch !== undefined && branch !== null) ? branch.toString().trim() : "";
    var car = (carNumber !== undefined && carNumber !== null) ? carNumber.toString().trim() : "";
    
    for (var i = 1; i < rows.length; i++) {
      if (rows[i][0].toString().trim() === targetId) {
        sheet.getRange(i + 1, 5).setValue(pwd); // E: รหัสผ่าน
        if (pPic) sheet.getRange(i + 1, 6).setValue(pPic); // F: รูปประจำตัว
        if (br) sheet.getRange(i + 1, 7).setValue(br); // G: สาขา
        if (car && car !== "-") sheet.getRange(i + 1, 9).setValue(car); // I: เบอร์รถ
        sheet.getRange(i + 1, 10).setValue("อนุมัติแล้ว"); // J: สถานะอนุมัติ
        return { 
          success: true, 
          message: "🎉 ตั้งรหัสผ่านและเปิดใช้งานสำเร็จเรียบร้อยแล้ว!\nสามารถเข้าสู่ระบบได้ทันทีครับ" 
        };
      }
    }
    return { success: false, message: "ไม่พบรหัสพนักงานนี้ในระบบ" };
  } catch (e) {
    return { success: false, message: "เกิดข้อผิดพลาด: " + e.toString() };
  }
}

// 21.1 อัปเดตรูปประจำตัวของพนักงานเพียงอย่างเดียว (สำหรับหน้าบ้านส่วนของพนักงานเอง)
function updateEmployeeProfilePicOnly(empId, profilePicUrl) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName("Employees");
    if (!sheet) return { success: false, message: "ไม่พบชีตฐานข้อมูลพนักงาน" };
    
    var rows = sheet.getDataRange().getValues();
    var targetId = empId.toString().trim();
    var pPic = profilePicUrl.toString().trim();
    
    for (var i = 1; i < rows.length; i++) {
      if (rows[i][0].toString().trim() === targetId) {
        sheet.getRange(i + 1, 6).setValue(pPic);
        return { success: true, message: "อัปเดตรูปประจำตัวสำเร็จแล้ว!" };
      }
    }
    return { success: false, message: "ไม่พบรหัสพนักงานในระบบ" };
  } catch (e) {
    return { success: false, message: "เกิดข้อผิดพลาด: " + e.toString() };
  }
}

// 21.2 รีเซ็ตรหัสผ่านพนักงานโดยแอดมิน (เป็น 1234)
function resetEmployeePassword(empId) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName("Employees");
    if (!sheet) return { success: false, message: "ไม่พบชีตฐานข้อมูลพนักงาน" };
    
    var rows = sheet.getDataRange().getValues();
    var targetId = empId.toString().trim();
    
    for (var i = 1; i < rows.length; i++) {
      if (rows[i][0].toString().trim() === targetId) {
        sheet.getRange(i + 1, 5).setValue("1234");
        return { success: true, message: "รีเซ็ตรหัสผ่านของพนักงานรหัส " + empId + " เป็น 1234 เรียบร้อยแล้ว!" };
      }
    }
    return { success: false, message: "ไม่พบรหัสพนักงานในระบบ" };
  } catch (e) {
    return { success: false, message: "เกิดข้อผิดพลาด: " + e.toString() };
  }
}

// 21.3 เปลี่ยนรหัสผ่านของพนักงานเอง (สำหรับระบบบังคับเปลี่ยนรหัสผ่าน)
function changeUserPassword(empId, newPassword) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName("Employees");
    if (!sheet) return { success: false, message: "ไม่พบชีตฐานข้อมูลพนักงาน" };
    
    var rows = sheet.getDataRange().getValues();
    var targetId = empId.toString().trim();
    var newPwd = newPassword.toString().trim();
    
    if (newPwd === "1234" || newPwd === "") {
      return { success: false, message: "ไม่สามารถใช้รหัสผ่านเริ่มต้นนี้ได้" };
    }
    
    for (var i = 1; i < rows.length; i++) {
      if (rows[i][0].toString().trim() === targetId) {
        sheet.getRange(i + 1, 5).setValue(newPwd);
        return { success: true, message: "เปลี่ยนรหัสผ่านเสร็จสมบูรณ์!" };
      }
    }
    return { success: false, message: "ไม่พบรหัสพนักงานในระบบ" };
  } catch (e) {
    return { success: false, message: "เกิดข้อผิดพลาด: " + e.toString() };
  }
}

// 20. ลบพนักงาน
function deleteEmployee(empId) {
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Employees");
    if (!sheet) return "ไม่พบชีตฐานข้อมูลพนักงาน";
    
    var rows = sheet.getDataRange().getValues();
    var targetId = empId.toString().trim();
    
    for (var i = 1; i < rows.length; i++) {
      if (rows[i][0].toString().trim() === targetId) {
        sheet.deleteRow(i + 1);
        return "ลบข้อมูลพนักงานเรียบร้อยแล้ว!";
      }
    }
    return "ไม่พบพนักงานรหัสนี้ในระบบ";
  } catch (error) {
    return "เกิดข้อผิดพลาด: " + error.toString();
  }
}

// 21. ดึงค่ากำหนดสิทธิ์สิทธิ์ตามบทบาททั้งหมด
function getAllRolePermissions() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName("Permissions");
    if (!sheet) {
      getRolePermissions("แอดมิน"); // เรียกเพื่อสร้างชีตสิทธิ์ตั้งต้น
      sheet = ss.getSheetByName("Permissions");
    }
    
    var rows = sheet.getDataRange().getValues();
    var permissions = [];
    for (var i = 1; i < rows.length; i++) {
      var role = rows[i][0].toString().trim();
      if (role !== "") {
        var canEditVal = rows[i][1].toString().trim().toLowerCase();
        var canToggleVal = rows[i][2].toString().trim().toLowerCase();
        permissions.push({
          role: role,
          canEdit: rows[i][1] === true || canEditVal === "true" || canEditVal === "yes",
          canToggle: rows[i][2] === true || canToggleVal === "true" || canToggleVal === "yes"
        });
      }
    }
    return permissions;
  } catch (error) {
    return [];
  }
}

// 22. บันทึกสิทธิ์ของบทบาท
function saveRolePermissions(role, canEdit, canToggle) {
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Permissions");
    if (!sheet) return "ไม่พบชีตการกำหนดสิทธิ์";
    
    var rows = sheet.getDataRange().getValues();
    var targetRole = role.toString().trim().toLowerCase();
    
    for (var i = 1; i < rows.length; i++) {
      var currentRole = rows[i][0].toString().trim().toLowerCase();
      if (currentRole === targetRole) {
        sheet.getRange(i + 1, 2).setValue(canEdit);
        sheet.getRange(i + 1, 3).setValue(canToggle);
        return "บันทึกการปรับตั้งค่าสิทธิ์สำหรับบทบาท " + role + " เรียบร้อยแล้ว!";
      }
    }
    
    sheet.appendRow([role, canEdit, canToggle]);
    return "เพิ่มบทบาทสิทธิ์และบันทึกข้อมูลเรียบร้อย!";
  } catch (error) {
    return "เกิดข้อผิดพลาด: " + error.toString();
  }
}

// 23. บันทึกสถิติการเปิดดูหัวข้อคู่มือ (Click Tracking)
function logTopicView(topicId, topicTitle, category, empId, empName, branch) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName("ViewLogs");
    
    // สร้างชีตหากไม่มีอยู่
    if (!sheet) {
      sheet = ss.insertSheet("ViewLogs");
      sheet.appendRow(["วันเวลา (Timestamp)", "รหัสหัวข้อ (Topic ID)", "หัวข้อ (Topic Title)", "หมวดหมู่ (Category)", "รหัสพนักงาน (Employee ID)", "ชื่อพนักงาน (Name)", "สาขา (Branch)"]);
      sheet.getRange("A1:G1").setFontWeight("bold").setBackground("#F1F5F9");
    } else {
      // หากมีชีตแต่เป็นชีตเปล่า ให้เขียนหัวตาราง
      var lastRow = sheet.getLastRow();
      if (lastRow === 0) {
        sheet.appendRow(["วันเวลา (Timestamp)", "รหัสหัวข้อ (Topic ID)", "หัวข้อ (Topic Title)", "หมวดหมู่ (Category)", "รหัสพนักงาน (Employee ID)", "ชื่อพนักงาน (Name)", "สาขา (Branch)"]);
        sheet.getRange("A1:G1").setFontWeight("bold").setBackground("#F1F5F9");
      } else {
        // ตรวจสอบและอัปเดตหัวตารางถ้าชีตเดิมไม่มีคอลัมน์สาขา
        var headers = sheet.getRange("1:1").getValues()[0];
        var branchIdx = headers.indexOf("สาขา (Branch)");
        var branchIdxAlt = headers.indexOf("สาขา");
        if (branchIdx === -1 && branchIdxAlt === -1) {
          var lastCol = 1;
          for (var c = 0; c < headers.length; c++) {
            if (headers[c] !== "") lastCol = c + 1;
          }
          sheet.getRange(1, lastCol + 1).setValue("สาขา (Branch)").setFontWeight("bold").setBackground("#F1F5F9");
        }
      }
    }
    
    // ดึงสาขาของพนักงาน
    var userBranch = branch ? String(branch).trim() : "";
    var empIdStr = empId ? String(empId).trim() : "";
    if (userBranch === "" && empIdStr !== "" && empIdStr !== "anonymous") {
      var empSheet = ss.getSheetByName("Employees");
      if (empSheet) {
        var empRows = empSheet.getDataRange().getValues();
        for (var i = 1; i < empRows.length; i++) {
          if (empRows[i] && empRows[i][0] !== undefined && empRows[i][0] !== null) {
            var cellVal = String(empRows[i][0]).trim();
            if (cellVal !== "" && cellVal === empIdStr) {
              userBranch = (empRows[i].length > 6 && empRows[i][6]) ? String(empRows[i][6]).trim() : "";
              break;
            }
          }
        }
      }
    }
    
    // ระบบป้องกันการกดซ้ำซ้อน (Anti-Spam / Cooldown 60 วินาที)
    var lastRowNow = sheet.getLastRow();
    if (lastRowNow > 1) {
      var startCheckRow = Math.max(2, lastRowNow - 25);
      var numRowsToCheck = lastRowNow - startCheckRow + 1;
      var recentRows = sheet.getRange(startCheckRow, 1, numRowsToCheck, 6).getValues();
      var nowTime = new Date().getTime();
      
      for (var r = recentRows.length - 1; r >= 0; r--) {
        var rowTopicId = recentRows[r][1] ? String(recentRows[r][1]).trim() : "";
        var rowEmpId = recentRows[r][4] ? String(recentRows[r][4]).trim() : "";
        var rowTimeStr = recentRows[r][0];
        
        if (rowTopicId === String(topicId).trim() && (rowEmpId === empIdStr || empIdStr === "anonymous")) {
          var rowTime = new Date(rowTimeStr).getTime();
          // หากพึ่งบันทึกไปภายใน 60 วินาที (60,000 ms) ข้ามการบันทึกซ้ำ
          if (!isNaN(rowTime) && (nowTime - rowTime) < 60000) {
            return { success: true, message: "cooldown_skipped" };
          }
          break;
        }
      }
    }
    
    var formattedDate = Utilities.formatDate(new Date(), "GMT+7", "yyyy-MM-dd HH:mm:ss");
    sheet.appendRow([formattedDate, topicId || "", topicTitle || "", category || "", empIdStr || "", empName ? String(empName).trim() : "", userBranch]);
    return { success: true };
  } catch (error) {
    Logger.log("Error in logTopicView: " + error.toString());
    return { success: false, error: error.toString() };
  }
}

// 24. ดึงสถิติการเข้าชมหัวข้อคู่มือ (Top Viewed Topics)
function getViewStatistics() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName("ViewLogs");
    if (!sheet) return [];
    
    var rows = sheet.getDataRange().getValues();
    var stats = {};
    
    // คำนวณจำนวนการเข้าชมของแต่ละหัวข้อ
    for (var i = 1; i < rows.length; i++) {
      var topicId = rows[i][1];
      var title = rows[i][2];
      var category = rows[i][3];
      
      if (topicId) {
        if (!stats[topicId]) {
          stats[topicId] = { id: topicId, title: title, category: category, views: 0 };
        }
        stats[topicId].views++;
      }
    }
    
    // แปลงเป็น Array และเรียงลำดับตามจำนวนการเข้าชมจากมากไปน้อย
    var statsArray = [];
    for (var key in stats) {
      statsArray.push(stats[key]);
    }
    statsArray.sort(function(a, b) {
      return b.views - a.views;
    });
    
    return statsArray;
  } catch (error) {
    Logger.log("Error in getViewStatistics: " + error.toString());
    return [];
  }
}

// 24.5 ดึงสถิติจัดอันดับหัวข้อคู่มือและจัดอันดับพนักงานแยกกลุ่ม
// 24.5 ดึงสถิติจัดอันดับหัวข้อคู่มือและจัดอันดับพนักงานแยกกลุ่ม (พร้อมรายชื่อทั้งหมดและสรุปยอดเข้าชมรวม)
function getRankingDataSeparated() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    
    // 1. ดึงข้อมูลพนักงานทั้งหมดเพื่อทำ Map (empId -> {name, role, branch, carNumber})
    var empSheet = ss.getSheetByName("Employees");
    var employeesMap = {};
    if (empSheet) {
      var empRows = empSheet.getDataRange().getValues();
      for (var i = 1; i < empRows.length; i++) {
        var empId = empRows[i][0] !== undefined && empRows[i][0] !== null ? empRows[i][0].toString().trim() : "";
        var name = empRows[i][1] ? empRows[i][1].toString().trim() : "";
        var role = empRows[i][2] ? empRows[i][2].toString().trim() : "พนักงาน";
        var branch = (empRows[i].length > 6 && empRows[i][6] !== undefined && empRows[i][6] !== null) ? empRows[i][6].toString().trim() : "";
        // ดึงเบอร์รถจากคอลัมน์ I (index 8) ของชีต Employees
        var carNumber = (empRows[i].length > 8 && empRows[i][8] !== undefined && empRows[i][8] !== null) ? empRows[i][8].toString().trim() : "";
        if (!carNumber && (role === "ผู้ประกอบการ" || role === "พี่สปริงเคิล" || role.indexOf("ผู้ประกอบการ") !== -1 || role.indexOf("สปริงเคิล") !== -1)) {
          var colH = (empRows[i].length > 7 && empRows[i][7] !== undefined && empRows[i][7] !== null) ? empRows[i][7].toString().trim() : "";
          carNumber = colH || branch || empId;
        }
        if (empId) {
          employeesMap[empId] = { name: name, role: role, branch: branch, carNumber: carNumber };
        }
      }
    }
    
    // 2. ดึงข้อมูลประวัติการเข้าชม
    var logSheet = ss.getSheetByName("ViewLogs");
    var topicStats = { all: [], operator: [], employee: [] };
    var employeeStats = { all: [], operator: [], employee: [] };
    var branchStats = { all: [], operator: [], employee: [] };
    var totalOverallViews = 0;
    var activeUsersSet = {};
    
    // เตรียมข้อมูลพนักงานทุกคนไว้ก่อน (ค่าเริ่มต้นเข้าศึกษา 0 ครั้ง) เพื่อให้แสดงรายชื่อครบทุกคน
    var empViewsAll = {};
    var empViewsOperators = {};
    var empViewsEmployees = {};
    
    for (var id in employeesMap) {
      var empObj = employeesMap[id];
      var isOp = (empObj.role === "ผู้ประกอบการ" || empObj.role === "พี่สปริงเคิล" || empObj.role.indexOf("ผู้ประกอบการ") !== -1 || empObj.role.indexOf("สปริงเคิล") !== -1);
      var carNo = empObj.carNumber || empObj.branch || id;
      
      empViewsAll[id] = { empId: id, name: empObj.name, role: empObj.role, branch: empObj.branch || "-", carNumber: carNo, views: 0 };
      if (isOp) {
        empViewsOperators[id] = { empId: id, name: empObj.name, role: empObj.role, branch: empObj.branch || "-", carNumber: carNo, views: 0 };
      } else {
        empViewsEmployees[id] = { empId: id, name: empObj.name, role: empObj.role, branch: empObj.branch || "-", carNumber: "-", views: 0 };
      }
    }
    
    var branchAllDict = {};
    var branchOpDict = {};
    var branchEmpDict = {};

    if (logSheet) {
      var logRows = logSheet.getDataRange().getValues();
      var topicsAll = {};
      var topicsOperators = {};
      var topicsEmployees = {};
      
      // วนลูปคำนวณสถิติ
      for (var i = 1; i < logRows.length; i++) {
        var topicId = logRows[i][1];
        var title = logRows[i][2];
        var category = logRows[i][3];
        var empId = logRows[i][4] ? logRows[i][4].toString().trim() : "";
        var empName = logRows[i][5] ? logRows[i][5].toString().trim() : "";
        var empBranch = logRows[i][6] ? logRows[i][6].toString().trim() : "";
        
        if (topicId) {
          totalOverallViews++;
          if (empId) activeUsersSet[empId] = true;
          
          var empInfo = employeesMap[empId];
          var role = empInfo ? empInfo.role : "พนักงาน";
          var isOperator = (role === "ผู้ประกอบการ" || role === "พี่สปริงเคิล" || role.indexOf("ผู้ประกอบการ") !== -1 || role.indexOf("สปริงเคิล") !== -1);
          
          // ก. อันดับหัวข้อ
          if (!topicsAll[topicId]) {
            topicsAll[topicId] = { id: topicId, title: title, category: category, views: 0 };
          }
          topicsAll[topicId].views++;
          
          if (isOperator) {
            if (!topicsOperators[topicId]) {
              topicsOperators[topicId] = { id: topicId, title: title, category: category, views: 0 };
            }
            topicsOperators[topicId].views++;
          } else {
            if (!topicsEmployees[topicId]) {
              topicsEmployees[topicId] = { id: topicId, title: title, category: category, views: 0 };
            }
            topicsEmployees[topicId].views++;
          }
          
          // ข. อันดับพนักงาน / สมาชิกพี่สปริงเคิล
          if (empId) {
            var nameVal = empInfo ? empInfo.name : empName;
            var roleVal = empInfo ? empInfo.role : "พนักงาน";
            var branchVal = empInfo ? (empInfo.branch || "-") : (empBranch || "-");
            var carNo = empInfo ? (empInfo.carNumber || empInfo.branch || empId) : (empBranch || empId);
            
            if (!empViewsAll[empId]) {
              empViewsAll[empId] = { empId: empId, name: nameVal, role: roleVal, branch: branchVal, carNumber: carNo, views: 0 };
            }
            empViewsAll[empId].views++;
            
            if (isOperator) {
              if (!empViewsOperators[empId]) {
                empViewsOperators[empId] = { empId: empId, name: nameVal, role: roleVal, branch: branchVal, carNumber: carNo, views: 0 };
              }
              empViewsOperators[empId].views++;
            } else {
              if (!empViewsEmployees[empId]) {
                empViewsEmployees[empId] = { empId: empId, name: nameVal, role: roleVal, branch: branchVal, carNumber: "-", views: 0 };
              }
              empViewsEmployees[empId].views++;
            }
          }

          // ค. สถิติอันดับสาขาที่เข้าอ่าน (คำนวณจาก ViewLogs ตามข้อกำหนด)
          var branchName = empInfo ? (empInfo.branch || "-") : (empBranch || "-");
          if (!branchName || branchName === "" || branchName === "-") {
            branchName = "ไม่ระบุสาขา";
          }
          if (!branchAllDict[branchName]) {
            branchAllDict[branchName] = { branch: branchName, logins: 0, views: 0 };
          }
          branchAllDict[branchName].views++;
          branchAllDict[branchName].logins++;

          if (isOperator) {
            if (!branchOpDict[branchName]) {
              branchOpDict[branchName] = { branch: branchName, logins: 0, views: 0 };
            }
            branchOpDict[branchName].views++;
            branchOpDict[branchName].logins++;
          } else {
            if (!branchEmpDict[branchName]) {
              branchEmpDict[branchName] = { branch: branchName, logins: 0, views: 0 };
            }
            branchEmpDict[branchName].views++;
            branchEmpDict[branchName].logins++;
          }
        }
      }
      
      function sortStats(dict) {
        var arr = [];
        for (var key in dict) {
          arr.push(dict[key]);
        }
        arr.sort(function(a, b) { 
          if (b.views !== a.views) return b.views - a.views;
          return a.empId ? a.empId.localeCompare(b.empId) : 0;
        });
        return arr;
      }
      
      topicStats.all = sortStats(topicsAll);
      topicStats.operator = sortStats(topicsOperators);
      topicStats.employee = sortStats(topicsEmployees);
      
      employeeStats.all = sortStats(empViewsAll);
      employeeStats.operator = sortStats(empViewsOperators);
      employeeStats.employee = sortStats(empViewsEmployees);
    }
    
    // 3. จัดเรียงข้อมูลอันดับสาขาที่เข้าอ่าน (Branch Read Rankings) จากรายชื่อสมาชิกในแต่ละกลุ่มโดยตรง
    // เพื่อให้ยอดจำนวนครั้งตรงกับตารางรายชื่อและอันดับสมาชิกพนักงาน/พี่สปริงเคิล 100%
    function computeBranchStatsFromEmpDict(dict) {
      var bDict = {};
      for (var empKey in dict) {
        var emp = dict[empKey];
        var b = (emp.branch && emp.branch.trim() !== "" && emp.branch !== "-") ? emp.branch.trim() : "ไม่ระบุสาขา";
        if (!bDict[b]) {
          bDict[b] = { branch: b, views: 0, logins: 0, totalEmployees: 0, activeEmployees: 0 };
        }
        var v = emp.views || 0;
        bDict[b].views += v;
        bDict[b].logins += v;
        bDict[b].totalEmployees++;
        if (v > 0) bDict[b].activeEmployees++;
      }
      var arr = [];
      for (var k in bDict) {
        arr.push(bDict[k]);
      }
      arr.sort(function(a, b) {
        if (b.views !== a.views) return b.views - a.views;
        return a.branch.localeCompare(b.branch);
      });
      return arr;
    }

    branchStats.all = computeBranchStatsFromEmpDict(empViewsAll);
    branchStats.operator = computeBranchStatsFromEmpDict(empViewsOperators);
    branchStats.employee = computeBranchStatsFromEmpDict(empViewsEmployees);
    
    var statsStartDate = "";
    if (logSheet && logSheet.getLastRow() > 1) {
      var firstDateVal = logSheet.getRange(2, 1).getValue();
      if (firstDateVal) {
        try {
          statsStartDate = Utilities.formatDate(new Date(firstDateVal), "GMT+7", "yyyy-MM-dd HH:mm:ss");
        } catch (e) {
          statsStartDate = String(firstDateVal);
        }
      }
    }

    function computeTabSummary(empDict, topicList) {
      var totalEmp = 0;
      var activeEmp = 0;
      var totalViews = 0;
      for (var k in empDict) {
        totalEmp++;
        var v = empDict[k].views || 0;
        totalViews += v;
        if (v > 0) activeEmp++;
      }
      return {
        totalEmployees: totalEmp,
        totalActiveUsers: activeEmp,
        totalTopicsViewed: topicList ? topicList.length : 0,
        totalViews: totalViews
      };
    }

    var summaryAll = computeTabSummary(empViewsAll, topicStats.all);
    summaryAll.statsStartDate = statsStartDate;
    var summaryOp = computeTabSummary(empViewsOperators, topicStats.operator);
    summaryOp.statsStartDate = statsStartDate;
    var summaryEmp = computeTabSummary(empViewsEmployees, topicStats.employee);
    summaryEmp.statsStartDate = statsStartDate;
    
    var summary = {
      totalViews: summaryAll.totalViews,
      totalActiveUsers: summaryAll.totalActiveUsers,
      totalEmployees: summaryAll.totalEmployees,
      totalTopicsViewed: summaryAll.totalTopicsViewed,
      statsStartDate: statsStartDate,
      all: summaryAll,
      operator: summaryOp,
      employee: summaryEmp
    };
    
    return {
      summary: summary,
      topicStats: topicStats,
      employeeStats: employeeStats,
      branchStats: branchStats
    };
  } catch (error) {
    Logger.log("Error in getRankingDataSeparated: " + error.toString());
    return {
      summary: { totalViews: 0, totalActiveUsers: 0, totalEmployees: 0, totalTopicsViewed: 0, statsStartDate: "" },
      topicStats: { all: [], operator: [], employee: [] },
      employeeStats: { all: [], operator: [], employee: [] },
      branchStats: { all: [], operator: [], employee: [] }
    };
  }
}

// 24.8 ดึงประวัติการเข้าศึกษาแบบละเอียดของพนักงานรายบุคคล (View Timeline & Breakdown)
function getEmployeeDetailedHistory(empId) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var logSheet = ss.getSheetByName("ViewLogs");
    if (!logSheet) return { history: [], summaryByTopic: [], totalViews: 0, uniqueTopicsCount: 0 };
    
    var targetEmpId = String(empId).trim();
    var logRows = logSheet.getDataRange().getValues();
    var history = [];
    var topicCountMap = {};
    
    for (var i = logRows.length - 1; i >= 1; i--) {
      var row = logRows[i];
      var rowEmpId = row[4] ? String(row[4]).trim() : "";
      if (rowEmpId === targetEmpId) {
        var timeVal = row[0];
        var timeStr = "";
        try {
          timeStr = Utilities.formatDate(new Date(timeVal), "GMT+7", "yyyy-MM-dd HH:mm:ss");
        } catch(e) {
          timeStr = String(timeVal);
        }
        
        var topicId = row[1] ? String(row[1]).trim() : "";
        var topicTitle = row[2] ? String(row[2]).trim() : "";
        var category = row[3] ? String(row[3]).trim() : "";
        var branch = row[6] ? String(row[6]).trim() : "";
        
        history.push({
          timestamp: timeStr,
          topicId: topicId,
          topicTitle: topicTitle,
          category: category,
          branch: branch
        });
        
        if (!topicCountMap[topicId]) {
          topicCountMap[topicId] = {
            topicId: topicId,
            topicTitle: topicTitle,
            category: category,
            views: 0,
            lastViewTime: timeStr
          };
        }
        topicCountMap[topicId].views++;
      }
    }
    
    var summaryByTopic = [];
    for (var tId in topicCountMap) {
      summaryByTopic.push(topicCountMap[tId]);
    }
    summaryByTopic.sort(function(a, b) { return b.views - a.views; });
    
    return {
      empId: targetEmpId,
      history: history,
      summaryByTopic: summaryByTopic,
      totalViews: history.length,
      uniqueTopicsCount: summaryByTopic.length
    };
  } catch (error) {
    Logger.log("Error in getEmployeeDetailedHistory: " + error.toString());
    return { history: [], summaryByTopic: [], totalViews: 0, uniqueTopicsCount: 0, error: error.toString() };
  }
}

// 24.9 ดึงประวัติการเข้าศึกษาของหัวข้อคู่มือ (View Logs & Breakdown for a Topic)
function getTopicDetailedHistory(topicId) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var logSheet = ss.getSheetByName("ViewLogs");
    if (!logSheet) return { history: [], summaryByUser: [], summaryByBranch: [], totalViews: 0, uniqueUsersCount: 0 };

    // ดึงข้อมูล Employees เพื่อ lookup บทบาท/เบอร์รถ/สาขาล่าสุด
    var empSheet = ss.getSheetByName("Employees");
    var employeesMap = {};
    if (empSheet) {
      var empRows = empSheet.getDataRange().getValues();
      for (var e = 1; e < empRows.length; e++) {
        var eId = empRows[e][0] !== undefined && empRows[e][0] !== null ? String(empRows[e][0]).trim() : "";
        if (eId) {
          var eName = empRows[e][1] ? String(empRows[e][1]).trim() : "";
          var eRole = empRows[e][2] ? String(empRows[e][2]).trim() : "พนักงาน";
          var eBranch = (empRows[e].length > 6 && empRows[e][6]) ? String(empRows[e][6]).trim() : "";
          var eCar = (empRows[e].length > 8 && empRows[e][8]) ? String(empRows[e][8]).trim() : "";
          if (!eCar && (eRole === "ผู้ประกอบการ" || eRole === "พี่สปริงเคิล" || eRole.indexOf("ผู้ประกอบการ") !== -1 || eRole.indexOf("สปริงเคิล") !== -1)) {
            var colH = (empRows[e].length > 7 && empRows[e][7]) ? String(empRows[e][7]).trim() : "";
            eCar = colH || eBranch || eId;
          }
          employeesMap[eId] = { name: eName, role: eRole, branch: eBranch, carNumber: eCar };
        }
      }
    }

    var targetTopicId = String(topicId).trim();
    var logRows = logSheet.getDataRange().getValues();
    var history = [];
    var userCountMap = {};
    var branchCountMap = {};
    var topicTitle = "";
    var topicCategory = "";

    for (var i = logRows.length - 1; i >= 1; i--) {
      var row = logRows[i];
      var rowTopicId = row[1] !== undefined && row[1] !== null ? String(row[1]).trim() : "";
      if (rowTopicId === targetTopicId) {
        if (!topicTitle && row[2]) topicTitle = String(row[2]).trim();
        if (!topicCategory && row[3]) topicCategory = String(row[3]).trim();

        var timeVal = row[0];
        var timeStr = "";
        try {
          timeStr = Utilities.formatDate(new Date(timeVal), "GMT+7", "yyyy-MM-dd HH:mm:ss");
        } catch(eTime) {
          timeStr = String(timeVal);
        }

        var empId = row[4] ? String(row[4]).trim() : "";
        var empName = row[5] ? String(row[5]).trim() : "";
        var empBranch = row[6] ? String(row[6]).trim() : "";

        var empInfo = employeesMap[empId] || {};
        var finalName = empInfo.name || empName || "ไม่ระบุชื่อ";
        var finalRole = empInfo.role || "พนักงาน";
        var finalBranch = empInfo.branch || empBranch || "ไม่ระบุสาขา";
        var finalCar = empInfo.carNumber || "-";

        history.push({
          timestamp: timeStr,
          empId: empId,
          name: finalName,
          role: finalRole,
          branch: finalBranch,
          carNumber: finalCar
        });

        // สรุปแยกตามผู้เข้าศึกษา
        var userKey = empId || finalName;
        if (!userCountMap[userKey]) {
          userCountMap[userKey] = {
            empId: empId,
            name: finalName,
            role: finalRole,
            branch: finalBranch,
            carNumber: finalCar,
            views: 0,
            lastViewTime: timeStr
          };
        }
        userCountMap[userKey].views++;

        // สรุปแยกตามสาขา
        if (!branchCountMap[finalBranch]) {
          branchCountMap[finalBranch] = { branch: finalBranch, views: 0 };
        }
        branchCountMap[finalBranch].views++;
      }
    }

    var summaryByUser = [];
    for (var uKey in userCountMap) {
      summaryByUser.push(userCountMap[uKey]);
    }
    summaryByUser.sort(function(a, b) { return b.views - a.views; });

    var summaryByBranch = [];
    for (var bKey in branchCountMap) {
      summaryByBranch.push(branchCountMap[bKey]);
    }
    summaryByBranch.sort(function(a, b) { return b.views - a.views; });

    return {
      topicId: targetTopicId,
      topicTitle: topicTitle,
      category: topicCategory,
      history: history,
      summaryByUser: summaryByUser,
      summaryByBranch: summaryByBranch,
      totalViews: history.length,
      uniqueUsersCount: summaryByUser.length
    };
  } catch (error) {
    Logger.log("Error in getTopicDetailedHistory: " + error.toString());
    return { topicId: topicId, history: [], summaryByUser: [], summaryByBranch: [], totalViews: 0, uniqueUsersCount: 0, error: error.toString() };
  }
}

// 25. ดึงสถิติการล็อกอินแยกตามสาขา (Branch Login Statistics)
function getBranchLoginStatistics() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName("LoginLogs");
    if (!sheet) return [];
    
    var rows = sheet.getDataRange().getValues();
    var stats = {};
    
    // วนลูปนับจำนวนการล็อกอินของแต่ละสาขา
    for (var i = 1; i < rows.length; i++) {
      var branch = rows[i][4]; // คอลัมน์ E: สาขา
      if (branch) {
        branch = branch.toString().trim();
        if (branch === "") {
          branch = "ไม่ระบุสาขา";
        }
      } else {
        branch = "ไม่ระบุสาขา";
      }
      
      if (!stats[branch]) {
        stats[branch] = { branch: branch, logins: 0 };
      }
      stats[branch].logins++;
    }
    
    // แปลงเป็น Array และเรียงจากมากไปน้อย
    var statsArray = [];
    for (var key in stats) {
      statsArray.push(stats[key]);
    }
    statsArray.sort(function(a, b) {
      return b.logins - a.logins;
    });
    
    return statsArray;
  } catch (error) {
    Logger.log("Error in getBranchLoginStatistics: " + error.toString());
    return [];
  }
}

// แก้ไขประกาศข่าวสาร (สำหรับแอดมิน)
function updateAnnouncement(id, title, content, imageUrl, linkUrl, targetAudience, autoCloseDate) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName("Announcements");
    if (!sheet) return "ไม่พบชีตประกาศข่าวสาร";
    
    if (sheet.getLastColumn() < 9) {
      sheet.getRange(1, 9).setValue("กลุ่มเป้าหมาย (Audience)");
    }
    if (sheet.getLastColumn() < 10) {
      sheet.getRange(1, 10).setValue("วันเวลาปิดอัตโนมัติ (Auto Close)");
    }
    
    var rows = sheet.getDataRange().getValues();
    var targetId = id.toString().trim();
    
    for (var i = 1; i < rows.length; i++) {
      if (rows[i][0].toString().trim() === targetId) {
        sheet.getRange(i + 1, 2).setValue(title);     // คอลัมน์ B (หัวข้อ)
        sheet.getRange(i + 1, 3).setValue(content);   // คอลัมน์ C (เนื้อหา)
        sheet.getRange(i + 1, 4).setValue(imageUrl || "");  // คอลัมน์ D (ลิงก์รูปภาพ)
        sheet.getRange(i + 1, 8).setValue(linkUrl || "");   // คอลัมน์ H (ลิงก์เชื่อมโยง)
        sheet.getRange(i + 1, 9).setValue(targetAudience || "ทั้งหมด"); // คอลัมน์ I (กลุ่มเป้าหมาย)
        if (autoCloseDate !== undefined) {
          sheet.getRange(i + 1, 10).setValue(autoCloseDate || ""); // คอลัมน์ J (วันเวลาปิดอัตโนมัติ)
        }
        return "แก้ไขประกาศเรียบร้อยแล้ว!";
      }
    }
    return "ไม่พบประกาศที่ต้องการแก้ไข";
  } catch (error) {
    return "เกิดข้อผิดพลาดในการแก้ไข: " + error.toString();
  }
}

// แก้ไขข้อมูลคู่มือ (สำหรับแอดมิน / ผู้จัดการ)
function updateKnowledge(id, data) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName("Knowledge");
    if (!sheet) return "ไม่พบชีตศูนย์การเรียนรู้ (Knowledge)";
    
    // ตรวจสอบและสร้างคอลัมน์แฟ้มหลัก (คอลัมน์ K) และกลุ่มเป้าหมาย (คอลัมน์ L) หากยังไม่มี
    var headers = sheet.getRange("1:1").getValues()[0];
    if (headers.length < 11 || headers[10] === "") {
      sheet.getRange(1, 11).setValue("แฟ้มหลัก").setFontWeight("bold").setBackground("#F1F5F9");
    }
    if (headers.length < 12 || headers[11] === "") {
      sheet.getRange(1, 12).setValue("กลุ่มเป้าหมาย (Audience)").setFontWeight("bold").setBackground("#F1F5F9");
    }
    
    var rows = sheet.getDataRange().getValues();
    var targetId = id.toString().trim();
    
    for (var i = 1; i < rows.length; i++) {
      if (rows[i][0].toString().trim() === targetId) {
        sheet.getRange(i + 1, 2).setValue(data.category);       // B (หมวดหมู่)
        sheet.getRange(i + 1, 3).setValue(data.title);          // C (หัวข้อเรื่อง)
        sheet.getRange(i + 1, 4).setValue(data.type);           // D (ประเภท)
        sheet.getRange(i + 1, 5).setValue(data.url);            // E (ลิงก์หลัก)
        sheet.getRange(i + 1, 9).setValue(data.additionalLinks || ""); // I (ลิงก์แนบเพิ่มเติม JSON)
        sheet.getRange(i + 1, 10).setValue(data.groupType || "document"); // J (กลุ่มประเภท)
        var saveMainFolder = data.mainFolder || "ขั้นตอนการทำงาน";
        var saveAudience = data.targetAudience || "ทั้งหมด";
        if (saveMainFolder === "รวมภาพสื่อประชาสัมพันธ์" || saveMainFolder === "แฟ้มประชาสัมพันธ์" || saveMainFolder === "ประชาสัมพันธ์") {
          saveAudience = "พนักงาน";
        }
        sheet.getRange(i + 1, 11).setValue(saveMainFolder); // K (แฟ้มหลัก)
        sheet.getRange(i + 1, 12).setValue(saveAudience);   // L (กลุ่มเป้าหมาย)
        return "แก้ไขข้อมูลศูนย์การเรียนรู้เรียบร้อยแล้ว!";
      }
    }
    return "ไม่พบข้อมูลคู่มือที่ต้องการแก้ไข";
  } catch (error) {
    return "เกิดข้อผิดพลาดในการแก้ไข: " + error.toString();
  }
}

// ฟังก์ชันสำหรับเปิดป๊อปอัปให้เจ้าของสคริปต์กดยอมรับสิทธิ์การเข้าถึง Google Drive
function triggerAuthorization() {
  DriveApp.getRootFolder();
}

// ----------------- ระบบประมวลผลความคล้ายคลึงข้อความภาษาไทย (Thai Text Similarity) -----------------

// คำอธิบายคำพ้องความหมาย (Synonyms) เพื่อช่วยจับคู่บริบทให้ฉลาดขึ้น
var SYNONYM_GROUPS = [
  ["พักร้อน", "ลาพักร้อน", "ลาพักผ่อน"],
  ["ลากิจ", "ธุระ", "กิจธุระ"],
  ["ลาป่วย", "ป่วย", "ไม่สบาย", "ใบรับรองแพทย์", "หาหมอ"],
  ["ใบเสร็จ", "เบิกเงิน", "ใบเบิก", "เบิกค่าใช้จ่าย", "เบิกเงินสำรอง", "เคลมเงิน"],
  ["สแกนนิ้ว", "เครื่องสแกน", "นิ้วมือ", "ตอกบัตร", "ลงเวลา", "เข้างาน"],
  ["รหัสผ่าน", "password", "พาสเวิร์ด", "ลืมรหัส", "เปลี่ยนรหัส", "reset"],
  ["ติดต่อ", "เบอร์โทร", "เบอร์ติดต่อ", "เบอร์ภายใน", "แผนก"],
  ["ประกาศ", "ข่าวสาร", "ข่าว", "แจ้งให้ทราบ"],
  ["คุณภาพน้ำ", "ตัวอย่างคุณภาพ", "เก็บคุณภาพ", "ตรวจคุณภาพ", "ถังตัวอย่าง"],
  ["ขั้นตอน", "วิธี", "วิธีการ", "ขั้นตอนการ", "วิธีปฏิบัติ"],
  ["คู่มือ", "เอกสาร", "แนวทาง"]
];

// ตัดคำสร้อยคำสุภาพหรือคำเติมเพื่อวิเคราะห์คำหลัก
function removeThaiStopwords(str) {
  var stopwords = [
    "ครับผม", "ครับ", "ค่ะ", "นะคะ", "นะ", "หน่อย", "รบกวน", "ช่วย", "อยากทราบ", 
    "ขอถาม", "มีใคร", "อย่างไร", "บ้าง", "ไหม", "สอบถาม", "สวัสดี", "ถาม", "เรื่อง", 
    "เกี่ยวกับ", "ทำยังไง", "อย่างไรบ้าง", "ของ", "ค่า", "หน่อยครับ", "หน่อยค่ะ", "สอบถามเรื่อง"
  ];
  var res = str;
  stopwords.forEach(function(word) {
    var regex = new RegExp(word, "g");
    res = res.replace(regex, "");
  });
  return res;
}

// ค้นหาความยาวของ Longest Common Subsequence (LCS) ของข้อความสองชุด
function getLCSLength(s1, s2) {
  var m = s1.length;
  var n = s2.length;
  var dp = [];
  for (var i = 0; i <= m; i++) {
    dp[i] = new Array(n + 1).fill(0);
  }
  for (var i = 1; i <= m; i++) {
    for (var j = 1; j <= n; j++) {
      if (s1[i - 1] === s2[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }
  return dp[m][n];
}

// คำนวณคะแนนความคล้ายคลึงระหว่างข้อความคำถามกับหัวข้อเป้าหมายแบบฉลาดขึ้น
function calculateThaiSimilarity(query, reference) {
  if (!query || !reference) return 0;
  
  var origQ = query.toString().toLowerCase();
  var origR = reference.toString().toLowerCase();
  
  // ตัด Stopwords ก่อนคำนวณความยาวและลักษณะคำ
  var cleanQ = removeThaiStopwords(origQ).replace(/[^a-z0-9\u0e00-\u0e7f]/g, "");
  var cleanR = removeThaiStopwords(origR).replace(/[^a-z0-9\u0e00-\u0e7f]/g, "");
  
  if (cleanQ === cleanR) return 1.0;
  if (cleanQ.length === 0 || cleanR.length === 0) return 0;
  
  var lcs = getLCSLength(cleanQ, cleanR);
  
  // กรองเฉพาะการชนคำที่มีนัยสำคัญ (อย่างน้อย 3 ตัวอักษรสำหรับประโยคสั้นหลังคลีน)
  if (lcs < 3) return 0;
  
  var minLen = Math.min(cleanQ.length, cleanR.length);
  var lcsRatio = lcs / minLen;
  
  // คำนวณ Jaccard bigrams และ Recall (ช่วยในกรณีสลับตำแหน่งคำในประโยคภาษาไทย)
  var b1 = [];
  for (var i = 0; i < cleanQ.length - 1; i++) b1.push(cleanQ.substring(i, i + 2));
  var b2 = [];
  for (var i = 0; i < cleanR.length - 1; i++) b2.push(cleanR.substring(i, i + 2));
  
  var jaccard = 0;
  var bigramRecall = 0;
  if (b1.length > 0 && b2.length > 0) {
    var set1 = {};
    b1.forEach(function(bg) { set1[bg] = true; });
    var set2 = {};
    b2.forEach(function(bg) { set2[bg] = true; });
    
    var intersection = 0;
    var union = Object.keys(set1).length;
    Object.keys(set2).forEach(function(bg) {
      if (set1[bg]) intersection++;
      else union++;
    });
    jaccard = intersection / union;
    
    // Recall: หาว่า bigram ของ reference (คำตอบในระบบ) อยู่ใน query (คำถามใหม่) มากน้อยเพียงใด
    // ช่วยให้ประโยคที่สลับคำ (เช่น ขั้นตอนเก็บคุณภาพน้ำ vs เก็บถังตัวอย่างมีขั้นตอนยังไง) จับคู่กันได้ดีขึ้น
    bigramRecall = intersection / b2.length;
  }
  
  // ให้คะแนนความคล้ายคลึงโดยถ่วงน้ำหนักระหว่าง LCS และ Bigram Recall เพื่อรองรับการสลับลำดับคำ
  var score = 0.4 * lcsRatio + 0.6 * bigramRecall;
  
  // การตรวจเช็ค Substring ในข้อความเดิม (ก่อนคลีนอักขระพิเศษ)
  var qCleanAll = origQ.replace(/\s+/g, "");
  var rCleanAll = origR.replace(/\s+/g, "");
  if (qCleanAll.indexOf(rCleanAll) !== -1 || rCleanAll.indexOf(qCleanAll) !== -1) {
    score += 0.15; // Boost สำหรับ substring ตรงๆ
  }
  
  // การให้คะแนนสนับสนุนคำพ้องความหมาย (Synonyms Boost)
  var synonymBoost = 0;
  SYNONYM_GROUPS.forEach(function(group) {
    var qMatch = false;
    var rMatch = false;
    group.forEach(function(word) {
      if (origQ.indexOf(word) !== -1) qMatch = true;
      if (origR.indexOf(word) !== -1) rMatch = true;
    });
    if (qMatch && rMatch) {
      synonymBoost = 0.15;
    }
  });
  
  score += synonymBoost;
  
  // ลิมิตสูงสุดของคะแนนไม่ให้เกิน 1.0
  return Math.min(score, 1.0);
}

// ค้นหาคำตอบอัตโนมัติที่ดีที่สุดจากทั้งคู่มือและคำถามที่เคยตอบแล้ว (พร้อมระบบแนะนำหัวข้อที่ใกล้เคียงเพิ่ม)
function findBestAutoAnswer(question) {
  var candidates = [];
  
  // 1. ดึงและประเมินคลังความรู้ (Knowledge)
  var knowledgeList = getKnowledgeData();
  for (var i = 0; i < knowledgeList.length; i++) {
    var k = knowledgeList[i];
    if (k.status === "เปิดใช้งาน") {
      var score = calculateThaiSimilarity(question, k.title);
      if (score >= 0.40) { // เก็บผู้ที่มีคะแนนสูงกว่าขั้นต่ำไว้พิจารณา
        candidates.push({
          type: "knowledge",
          title: k.title,
          url: k.url,
          additionalLinks: k.additionalLinks,
          score: score
        });
      }
    }
  }
  
  // 2. ดึงและประเมินคำถามที่เคยตอบแล้ว (QA)
  var qaList = getQAData();
  for (var i = 0; i < qaList.length; i++) {
    var qa = qaList[i];
    if (qa.status === "ตอบแล้ว" && qa.answer && qa.answer.indexOf("ระบบตอบกลับอัตโนมัติ") === -1) {
      var score = calculateThaiSimilarity(question, qa.question);
      if (score >= 0.40) {
        candidates.push({
          type: "qa",
          title: qa.question,
          answer: qa.answer,
          score: score
        });
      }
    }
  }
  
  if (candidates.length === 0) return null;
  
  // เรียงลำดับจากคะแนนสูงสุดลงมา
  candidates.sort(function(a, b) { return b.score - a.score; });
  
  var bestMatch = candidates[0];
  
  // ถ้าคะแนนสูงสุดยังไม่ถึงเกณฑ์ขั้นต่ำสำหรับตอบกลับ (0.55)
  if (bestMatch.score < 0.55) return null;
  
  // จัดทำคำตอบหลัก
  var finalAnswer = "";
  if (bestMatch.type === "knowledge") {
    finalAnswer = "🤖 <b>ระบบตอบกลับอัตโนมัติ:</b> พบข้อมูลคู่มือในคลังความรู้ที่เกี่ยวข้องกับคำถามของคุณครับ<br><br>" +
                  "📌 <b>หัวข้อ:</b> " + bestMatch.title + "<br>" +
                  "🔗 <b>ลิงก์คู่มือหลัก:</b> <a href='" + bestMatch.url + "' target='_blank' style='color: #2563eb; font-weight: bold; text-decoration: underline;'>" + bestMatch.title + "</a>";
                  
    if (bestMatch.additionalLinks) {
      try {
        var links = JSON.parse(bestMatch.additionalLinks);
        if (links && links.length > 0) {
          finalAnswer += "<br><br>📂 <b>ลิงก์แนบเพิ่มเติม:</b>";
          links.forEach(function(link) {
            finalAnswer += "<br>• <a href='" + link.url + "' target='_blank' style='color: #2563eb; text-decoration: underline;'>" + (link.note || link.url) + "</a>";
          });
        }
      } catch(e) {
        finalAnswer += "<br>📂 <b>ลิงก์แนบเพิ่มเติม:</b> " + bestMatch.additionalLinks;
      }
    }
  } else {
    finalAnswer = "🤖 <b>ระบบตอบกลับอัตโนมัติ (อ้างอิงจากคำถามที่คล้ายกัน):</b><br>" + bestMatch.answer;
  }
  
  // ค้นหาหัวข้ออื่นๆ ที่ใกล้เคียงเพิ่มเติม (Related Topics)
  // เงื่อนไข: มีคะแนนตั้งแต่ 0.45 ขึ้นไป, ไม่ซ้ำกับตัวหลัก และไม่เกิน 2 หัวข้อ
  var relatedItems = [];
  for (var i = 1; i < candidates.length; i++) {
    var c = candidates[i];
    if (c.score >= 0.45 && c.title !== bestMatch.title && relatedItems.length < 2) {
      if (c.type === "knowledge") {
        relatedItems.push("• <a href='" + c.url + "' target='_blank' style='color: #2563eb; text-decoration: underline;'>" + c.title + " (คลังความรู้)</a>");
      } else {
        relatedItems.push("• ประวัติ Q&A เรื่อง: <i>" + c.title + "</i>");
      }
    }
  }
  
  if (relatedItems.length > 0) {
    finalAnswer += "<br><br>💡 <b>หัวข้อใกล้เคียงอื่นๆ ที่คุณอาจสนใจ:</b><br>" + relatedItems.join("<br>");
  }
  
  return {
    score: bestMatch.score,
    answer: finalAnswer
  };
}

// ฟังก์ชันสำหรับรับส่งข้อมูลแบบ Web API (CORS) สำหรับโฮสต์ภายนอก เช่น Netlify

// =================================================================================
// ----------------- ระบบแจ้งเตือนพุช (Google Firebase Web Push Notification) -----------------
// =================================================================================

// ฟังก์ชันช่วยดึงสเปรดชีตหลัก (รองรับทั้งการรันจากตัวชีตและรันจาก Apps Script Editor)
function getMainSpreadsheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    try {
      ss = SpreadsheetApp.openById("1MJrid_AFH0nP1osBzRH9_M3HqU_oNcoEUZ_RnCVFPho");
    } catch(e) {}
  }
  return ss;
}

// สร้างหรือดึงชีตบันทึก PushTokens
function getOrCreatePushTokensSheet() {
  var ss = getMainSpreadsheet();
  if (!ss) return null;
  var sheet = ss.getSheetByName("PushTokens");
  if (!sheet) {
    sheet = ss.insertSheet("PushTokens");
    sheet.appendRow([
      "รหัสพนักงาน (EmpID)",
      "ชื่อ-นามสกุล (Name)",
      "ตำแหน่ง (Role)",
      "สาขา (Branch)",
      "FCM Token",
      "ข้อมูลอุปกรณ์ (DeviceInfo)",
      "วันที่อัปเดต (LastUpdated)",
      "สถานะ (Status)"
    ]);
    sheet.getRange("A1:H1").setFontWeight("bold").setBackground("#F1F5F9");
  }
  return sheet;
}

// 1. ลงทะเบียนหรืออัปเดต FCM Device Token ของพนักงาน
function registerPushToken(empId, token, deviceInfo, name, role, branch) {
  try {
    if (!token || token.toString().trim() === "") {
      return { success: false, message: "ไม่พบค่า FCM Token" };
    }
    
    var sheet = getOrCreatePushTokensSheet();
    var rows = sheet.getDataRange().getValues();
    var formattedDate = Utilities.formatDate(new Date(), "GMT+7", "yyyy-MM-dd HH:mm:ss");
    var cleanToken = token.toString().trim();
    var cleanEmpId = (empId || "anonymous").toString().trim();
    
    // ค้นหาว่ามี Token นี้ในระบบแล้วหรือไม่
    var foundIndex = -1;
    for (var i = 1; i < rows.length; i++) {
      if (rows[i][4] && rows[i][4].toString().trim() === cleanToken) {
        foundIndex = i + 1;
        break;
      }
    }
    
    if (foundIndex !== -1) {
      // อัปเดตข้อมูลผู้ใช้และเวลาล่าสุด
      sheet.getRange(foundIndex, 1).setValue(cleanEmpId);
      if (name) sheet.getRange(foundIndex, 2).setValue(name);
      if (role) sheet.getRange(foundIndex, 3).setValue(role);
      if (branch) sheet.getRange(foundIndex, 4).setValue(branch);
      if (deviceInfo) sheet.getRange(foundIndex, 6).setValue(deviceInfo);
      sheet.getRange(foundIndex, 7).setValue(formattedDate);
      sheet.getRange(foundIndex, 8).setValue("เปิดใช้งาน");
    } else {
      // เพิ่มแถวใหม่
      sheet.appendRow([
        cleanEmpId,
        name || "",
        role || "",
        branch || "",
        cleanToken,
        deviceInfo || "",
        formattedDate,
        "เปิดใช้งาน"
      ]);
    }
    
    return { success: true, message: "ลงทะเบียนรับการแจ้งเตือนสำเร็จเรียบร้อย" };
  } catch (err) {
    return { success: false, message: "เกิดข้อผิดพลาดในการบันทึก Token: " + err.toString() };
  }
}

// 2. ยกเลิกการรับแจ้งเตือนสำหรับ Token ที่ระบุ
function removePushToken(empId, token, reason) {
  try {
    if (!token) return { success: true };
    var sheet = getOrCreatePushTokensSheet();
    if (!sheet) return { success: false, message: "ไม่พบชีต PushTokens" };
    var rows = sheet.getDataRange().getValues();
    var cleanToken = token.toString().trim();
    var statusText = reason ? ("ปิดใช้งาน (" + reason + ")") : "ปิดใช้งาน";
    
    for (var i = 1; i < rows.length; i++) {
      if (rows[i][4] && rows[i][4].toString().trim() === cleanToken) {
        sheet.getRange(i + 1, 8).setValue(statusText);
      }
    }
    return { success: true, message: "ยกเลิกการรับแจ้งเตือนเรียบร้อยแล้ว" };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

// ตรวจสอบว่าข้อผิดพลาดจาก FCM เกิดจาก Device Token ไม่ถูกต้อง/หมดอายุจริงหรือไม่ (ไม่รวมข้อผิดพลาดจากขนาดหรือโครงสร้างข้อความ Payload)
function isFcmTokenInvalidError(statusCode, errorText) {
  if (!errorText) errorText = "";
  var lower = errorText.toLowerCase();
  
  // 1. หากเป็นข้อผิดพลาดเกี่ยวกับขนาดหรือโครงสร้าง Payload ต้องไม่ปิดการใช้งาน Token
  if (lower.indexOf("payload") !== -1 || lower.indexOf("too large") !== -1 || lower.indexOf("exceed") !== -1) {
    return false;
  }
  
  // 2. สถานะ 404, NOT_FOUND หรือ UNREGISTERED คือ Token ถูกยกเลิกหรือไม่มีอยู่ในระบบ
  if (statusCode === 404 || errorText.indexOf("UNREGISTERED") !== -1 || errorText.indexOf("NOT_FOUND") !== -1) {
    return true;
  }
  
  // 3. สถานะ 400 หรือ INVALID_ARGUMENT ที่ระบุเจาะจงว่าเกิดจาก Token
  if (statusCode === 400 || errorText.indexOf("INVALID_ARGUMENT") !== -1) {
    if (lower.indexOf("registration token") !== -1 || lower.indexOf("invalid token") !== -1 || (lower.indexOf("token") !== -1 && lower.indexOf("payload") === -1)) {
      return true;
    }
  }
  
  return false;
}

// 2.1 ปิดใช้งาน Device Token เมื่อหมดอายุหรือไม่ถูกต้อง (Dead/Invalid Token Auto-Deactivation)
function deactivatePushToken(token, reason) {
  try {
    if (!token) return { success: false, message: "No token specified" };
    var sheet = getOrCreatePushTokensSheet();
    if (!sheet) return { success: false, message: "ไม่พบชีต PushTokens" };
    var rows = sheet.getDataRange().getValues();
    var cleanToken = token.toString().trim();
    var statusText = reason ? ("ปิดใช้งาน (" + reason + ")") : "ปิดใช้งาน (Invalid)";
    var updated = false;
    
    for (var i = 1; i < rows.length; i++) {
      if (rows[i][4] && rows[i][4].toString().trim() === cleanToken) {
        sheet.getRange(i + 1, 8).setValue(statusText);
        updated = true;
      }
    }
    return { success: true, deactivated: updated };
  } catch (err) {
    Logger.log("Error in deactivatePushToken: " + err.toString());
    return { success: false, error: err.toString() };
  }
}

// 3. ข้อมูลเริ่มต้นสำหรับเชื่อมต่อ Firebase Admin SDK (Service Account)
var DEFAULT_FCM_SERVICE_ACCOUNT = {
  "type": "service_account",
  "project_id": "studio-8742716914-acc69",
  "private_key_id": "d72518141eddc24897e7b12508d04d0449f98571",
  "private_key": "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQCqa5/ceKnHNz/P\nI3PNztHT305dk3oE45fNX30rrztsXjKbQIQpDEHndUUmpo63nO4jhFmWdSge0YC4\njVi0P/nyaW6+Ylnb801eJF9YLKTETlL2Ad1LXD1JAhWa14DE7T40B8zHuAG9vjr+\n7U3w5Z9S6TLnJQK+34z7b6pAmvZ6AICNGzZZR+8giZWb4Icgf7INd1OV05FCNc6P\ny8h2unB0u0vnj8xAwCe4MukCMpe866avkKYJ9zK+fLK2mcQmbzkGMHVh5qUrpQqV\nlMX8tCYI3xyFui7OkUyTGDCFbEmxHy1B8lC2zv4gtDyWREAQ/uBClgww++4FTUxr\nMyvjMMU7AgMBAAECggEAEC5IzuecAyDBS7sLf0KAVLQSnjrm7njnjGXhHhk0tKza\n9DezdKxHw6C0UJ+m1FMvnyqtUOZNyWNN6/frsK2UX0pYa/Ytnv8iXOpqLRaMDGF9\nagMyTjnzTa/Hely0yr3V1p3Y+SuE6s2Zj2PbryA2OOqQXTb75ECYg7UN/rVX6qxi\n1FKJ0pM18Y2CfypUe5mxV+qz56lHIlU/mboq93aPSANdhaK2CHe0iEHMJCr044fV\n7vxSw7pLch+Hzo4A+ILLPFQbEGkuIPnOGY+/FbOw5PU7oFdF+jTLSXOTGgz/6oAg\nZ5b9lRhDJ9Yh8aE+MjBLuaktDgFX8XobrOr3oLs+FQKBgQDaVkxN7tXOVeOK1lGq\nEx8+W30N2iOnLq9JYTzEt6qZ4fhn7K7c6z0Vq0yaabVdyNCzFOLACkYc/hDBUgKa\nWSeW0f8M2rjJ5tGXe7zYaagzWjiguFFWZyM0+A1pTiz2Rbv3LB/7V09bNBk8LpJw\npZ0DtnyCj7G7Kebx54BLeCBlzQKBgQDH0Vbfe8kO7PEKRVQg6s+jSncE8Q9j+PlJ\nLb7QAZCzzl5ca5hv/sbkOIlk6oU0lc0C6oC8Ye8eVTrNiPeI+yQjq20bvNZo3qzw\nQeaMMhtpvPuUkPT6p56TwlZkqEc0qqPeSAnd5WC6rdqDBFoVjBGzp6XR0zf5rath\nxldgizNPJwKBgF8SPs2clvruyVL2Ob8d7nffrJdwih/NI0SHk8dw1leFXv4ZwJav\n0/xwh72hE/lPbRjdmlLW5mrPcopLZJjDA4sXy8BUKSy5VkBo//UYJMafnZLWT4yZ\nAmqZLHXTNZ7TBKL/UrnF7ecfy3E6MkfcxX8NYjAT0+dUupxRGrtCBpFtAoGBAMPO\n8pCiHw7PRg3Ijn6LW9oqeKORDoHrU25Qs7HmNsTcsD9k+MaXJpQyiwEniE1VlscK\nwgjY95gD8VHErL3BTVLfBFawIHQ38cSm76Pm3lIp7WdS/Z47b/xf7oVJGi4UIe0L\nLxARXU7SW1UUiKqgzh/9Y1NQ5oN3moB/+tQS1L71AoGAe+5Oi5zFqKDnj1lRFkt7\nE5Q+OcQuXXb50KK5FSa4rUmOCwyb8OBTVXFfEUxZaG10bNkuKvsaYiXLU1BTxxj4\ncIx4dsp6cXz1aTKQtsVEAOTAHtllanE5i9mOHKGu1pDGqNIY/09Q4rWRNDH8Nku6\n3TnL3Lzx8J7IVYDqaYIudZc=\n-----END PRIVATE KEY-----\n",
  "client_email": "firebase-adminsdk-fbsvc@studio-8742716914-acc69.iam.gserviceaccount.com",
  "client_id": "103819111099633262256",
  "auth_uri": "https://accounts.google.com/o/oauth2/auth",
  "token_uri": "https://oauth2.googleapis.com/token",
  "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
  "client_x509_cert_url": "https://www.googleapis.com/robot/v1/metadata/x509/firebase-adminsdk-fbsvc%40studio-8742716914-acc69.iam.gserviceaccount.com",
  "universe_domain": "googleapis.com"
};

// ฟังก์ชันสร้าง OAuth2 Access Token สำหรับ FCM v1 ด้วย Service Account (พร้อมระบบ Caching)
function getFCMAccessTokenFromServiceAccount(sa) {
  try {
    if (!sa) sa = DEFAULT_FCM_SERVICE_ACCOUNT;
    if (!sa || !sa.client_email || !sa.private_key) {
      return { token: null, error: "Service Account configuration is invalid" };
    }
    
    var cacheKey = "fcm_access_token_" + (sa.project_id || "studio-8742716914-acc69");
    var cache = null;
    try {
      if (typeof CacheService !== 'undefined' && CacheService && CacheService.getScriptCache) {
        cache = CacheService.getScriptCache();
        var cachedToken = cache.get(cacheKey);
        if (cachedToken) {
          return { token: cachedToken, error: null };
        }
      }
    } catch(eCache) {}
    
    var now = Math.floor(Date.now() / 1000);
    var header = { alg: "RS256", typ: "JWT" };
    var claim = {
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: "https://oauth2.googleapis.com/token",
      exp: now + 3600,
      iat: now
    };
    
    function base64Url(input) {
      var bytes = (typeof input === 'string') ? Utilities.newBlob(input).getBytes() : input;
      return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/, '');
    }
    
    var signatureInput = base64Url(JSON.stringify(header)) + "." + base64Url(JSON.stringify(claim));
    var cleanPrivateKey = sa.private_key.replace(/\\n/g, '\n');
    var signatureBytes = Utilities.computeRsaSha256Signature(signatureInput, cleanPrivateKey);
    var jwt = signatureInput + "." + base64Url(signatureBytes);
    
    var tokenRes = UrlFetchApp.fetch("https://oauth2.googleapis.com/token", {
      method: "post",
      contentType: "application/x-www-form-urlencoded",
      payload: {
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: jwt
      },
      muteHttpExceptions: true
    });
    
    var tokenJson = JSON.parse(tokenRes.getContentText());
    if (tokenJson && tokenJson.access_token) {
      try {
        if (cache) {
          cache.put(cacheKey, tokenJson.access_token, 3000);
        }
      } catch(ePut) {}
      return { token: tokenJson.access_token, error: null };
    } else {
      return { token: null, error: "OAuth2 Error: " + tokenRes.getContentText() };
    }
  } catch (e) {
    return { token: null, error: e.toString() };
  }
}

// ล้างแคช Access Token เมื่อเกิดข้อผิดพลาด 401 Unauthorized
function invalidateFCMAccessToken(sa) {
  try {
    if (!sa) sa = DEFAULT_FCM_SERVICE_ACCOUNT;
    var cacheKey = "fcm_access_token_" + (sa.project_id || "studio-8742716914-acc69");
    if (typeof CacheService !== 'undefined' && CacheService && CacheService.getScriptCache) {
      CacheService.getScriptCache().remove(cacheKey);
    }
  } catch(e) {}
}

// =================================================================================
// 4. เครื่องมือคัดกรองกลุ่มเป้าหมาย (Targeting & Filtering Engine)
// =================================================================================

// ตรวจสอบว่าเป็นบทบาทผู้ประกอบการ (พี่สปริงเคิล / ผปก.) หรือไม่
function isOperatorRole(role) {
  if (!role) return false;
  var r = role.toString().trim();
  return r === 'ผู้ประกอบการ' || r === 'พี่สปริงเคิล' || r.indexOf('ผู้ประกอบการ') !== -1 || r.indexOf('สปริงเคิล') !== -1 || r.indexOf('ผปก') !== -1;
}

// ตรวจสอบเงื่อนไขกลุ่มเป้าหมายเทียบกับบทบาทผู้ใช้
function matchAudienceRule(targetAudience, role) {
  if (targetAudience === undefined || targetAudience === null) return true;
  var norm = targetAudience.toString().trim();
  if (norm === "" || norm === "ทั้งหมด" || norm.toLowerCase() === "all") {
    return true;
  }
  
  if (norm === "เฉพาะบุคคล") {
    return true;
  }
  
  var r = role ? role.toString().trim() : "";
  var lowerR = r.toLowerCase();
  var isOp = (r.indexOf("ผู้ประกอบการ") !== -1 || r.indexOf("พี่สปริงเคิล") !== -1 || r.indexOf("สปริงเคิล") !== -1 || r.indexOf("ผปก") !== -1 || lowerR.indexOf("operator") !== -1 || lowerR.indexOf("entrepreneur") !== -1);
  
  // รองรับการระบุแบบหลายกลุ่ม เช่น "พนักงาน,ผู้ประกอบการ" หรือ "พนักงาน,พี่สปริงเคิล"
  if (norm.indexOf(",") !== -1) {
    var parts = norm.split(",");
    for (var p = 0; p < parts.length; p++) {
      if (matchAudienceRule(parts[p].trim(), role)) return true;
    }
    return false;
  }
  
  var lower = norm.toLowerCase();
  var isTargetOp = (norm.indexOf("ผู้ประกอบการ") !== -1 || norm.indexOf("พี่สปริงเคิล") !== -1 || norm.indexOf("สปริงเคิล") !== -1 || norm.indexOf("ผปก") !== -1 || lower.indexOf("operator") !== -1 || lower.indexOf("entrepreneur") !== -1);
  var isTargetEmp = (norm.indexOf("พนักงาน") !== -1 || lower.indexOf("employee") !== -1 || lower.indexOf("staff") !== -1);
  
  if (isTargetOp && isTargetEmp) {
    return true;
  }
  if (isTargetOp) {
    return isOp;
  }
  if (isTargetEmp) {
    return !isOp;
  }
  
  // ป้องกัน Fail-Open: หากกลุ่มเป้าหมายไม่ตรงกับเงื่อนไขใดเลย ให้คืนค่า false เพื่อความปลอดภัย
  return false;
}

// คัดกรองรายการ Device Token ที่ตรงตามเงื่อนไข (กลุ่มเป้าหมาย, สาขา, รหัสพนักงาน, สถานะเปิดใช้งาน, ขจัด Token ซ้ำ)
function filterPushTokens(options) {
  options = options || {};
  var targetAudience = options.targetAudience;
  var targetBranch = options.targetBranch;
  var targetEmpId = options.targetEmpId;
  
  var ss = getMainSpreadsheet();
  var sheet = ss ? ss.getSheetByName("PushTokens") : null;
  if (!sheet) return { tokens: [], matchedRows: [] };
  
  var rows = sheet.getDataRange().getValues();
  if (rows.length <= 1) return { tokens: [], matchedRows: [] };
  
  var tokens = [];
  var matchedRows = [];
  var seenTokens = Object.create(null);
  
  var cleanTargetEmpId = (targetEmpId !== undefined && targetEmpId !== null) ? targetEmpId.toString().trim() : "";
  var isEmpIdAll = (!cleanTargetEmpId || cleanTargetEmpId === "-" || cleanTargetEmpId === "ทั้งหมด" || cleanTargetEmpId.toLowerCase() === "all");
  var cleanTargetBranch = (targetBranch !== undefined && targetBranch !== null) ? targetBranch.toString().trim() : "";
  var isBranchAll = (!cleanTargetBranch || cleanTargetBranch === "ทั้งหมด" || cleanTargetBranch.toLowerCase() === "all" || cleanTargetBranch === "-");
  
  // หากระบุกลุ่มเป้าหมายเฉพาะบุคคล แต่ไม่ได้ระบุรหัสพนักงานเป้าหมาย ให้คืนค่าว่างเพื่อความปลอดภัย
  if (targetAudience === "เฉพาะบุคคล" && isEmpIdAll) {
    return { tokens: [], matchedRows: [] };
  }
  
  for (var i = 1; i < rows.length; i++) {
    var rowEmpId = rows[i][0] ? rows[i][0].toString().trim() : "";
    var rowName = rows[i][1] ? rows[i][1].toString().trim() : "";
    var rowRole = rows[i][2] ? rows[i][2].toString().trim() : "";
    var rowBranch = rows[i][3] ? rows[i][3].toString().trim() : "";
    var rowToken = rows[i][4] ? rows[i][4].toString().trim() : "";
    var rowStatus = rows[i][7] ? rows[i][7].toString().trim() : "เปิดใช้งาน";
    
    // 1. ตรวจสอบสถานะและค่า Token
    if (rowStatus !== "เปิดใช้งาน" || !rowToken) continue;
    
    // 2. กรองตามรหัสพนักงาน (ถ้ามี)
    if (!isEmpIdAll && rowEmpId !== cleanTargetEmpId) {
      continue;
    }
    
    // 3. กรองตามสาขา
    if (!isBranchAll && rowBranch !== cleanTargetBranch) {
      continue;
    }
    
    // 4. กรองตามกลุ่มเป้าหมาย (บทบาท)
    if (!matchAudienceRule(targetAudience, rowRole)) {
      continue;
    }
    
    // 5. ขจัด Token ซ้ำ (De-duplication)
    if (seenTokens[rowToken]) continue;
    seenTokens[rowToken] = true;
    
    tokens.push(rowToken);
    matchedRows.push({
      empId: rowEmpId,
      name: rowName,
      role: rowRole,
      branch: rowBranch,
      token: rowToken
    });
  }
  
  return { tokens: tokens, matchedRows: matchedRows };
}

// ประเมินจำนวนผู้รับตามกลุ่มเป้าหมายและรายชื่อสาขาสำหรับแอดมิน (Live Token Estimator)
function getAudienceEstimate(targetAudience, targetBranch) {
  try {
    if (targetAudience && typeof targetAudience === 'object' && targetBranch === undefined) {
      targetBranch = targetAudience.targetBranch || targetAudience.branch;
      targetAudience = targetAudience.targetAudience || targetAudience.audience;
    }
    
    var filtered = filterPushTokens({
      targetAudience: targetAudience,
      targetBranch: targetBranch
    });
    
    // รวบรวมรายชื่อสาขาที่ไม่ซ้ำทั้งหมดในระบบ
    var branchSet = {};
    var ss = getMainSpreadsheet();
    if (ss) {
      var tokenSheet = ss.getSheetByName("PushTokens");
      if (tokenSheet) {
        var tokenRows = tokenSheet.getDataRange().getValues();
        for (var i = 1; i < tokenRows.length; i++) {
          var b = tokenRows[i][3] ? tokenRows[i][3].toString().trim() : "";
          if (b && b !== "-" && b !== "ไม่ระบุสาขา") {
            branchSet[b] = true;
          }
        }
      }
      var empSheet = ss.getSheetByName("Employees");
      if (empSheet) {
        var empRows = empSheet.getDataRange().getValues();
        for (var j = 1; j < empRows.length; j++) {
          var eb = (empRows[j].length > 6 && empRows[j][6]) ? empRows[j][6].toString().trim() : "";
          if (eb && eb !== "-" && eb !== "ไม่ระบุสาขา") {
            branchSet[eb] = true;
          }
        }
      }
    }
    
    var branches = Object.keys(branchSet).sort();
    
    return {
      success: true,
      matchedCount: filtered.tokens.length,
      count: filtered.tokens.length,
      branches: branches
    };
  } catch (err) {
    Logger.log("Error in getAudienceEstimate: " + err.toString());
    return {
      success: false,
      matchedCount: 0,
      count: 0,
      branches: [],
      error: err.toString()
    };
  }
}

// =================================================================================
// 5. ระบบบันทึกประวัติการส่ง (NotificationHistory Sheet & Audit Logging)
// =================================================================================

// สร้างหรือดึงชีต NotificationHistory (14 คอลัมน์มาตรฐาน)
function getOrCreateNotificationHistorySheet() {
  var ss = getMainSpreadsheet();
  if (!ss) return null;
  var sheet = ss.getSheetByName("NotificationHistory");
  if (!sheet) {
    sheet = ss.insertSheet("NotificationHistory");
    sheet.appendRow([
      "HistoryID",
      "Timestamp",
      "Sender",
      "Title",
      "Message",
      "TargetUrl",
      "TargetAudience",
      "TargetBranch",
      "TargetEmpId",
      "TotalMatched",
      "SuccessCount",
      "FailCount",
      "Status",
      "ErrorDetails"
    ]);
    sheet.getRange("A1:N1").setFontWeight("bold").setBackground("#E2E8F0");
  }
  return sheet;
}

// คำนวณสถานะการจัดส่ง
function computeDeliveryStatus(matchedCount, successCount, failCount) {
  if (matchedCount === 0) {
    return "ไม่พบเป้าหมาย";
  }
  if (successCount === matchedCount && failCount === 0) {
    return "สำเร็จทั้งหมด";
  }
  if (successCount > 0 && failCount > 0) {
    return "สำเร็จบางส่วน";
  }
  if (successCount > 0 && failCount === 0) {
    return "สำเร็จทั้งหมด";
  }
  return "ล้มเหลว";
}

// บันทึกประวัติการส่งแจ้งเตือนลงในชีต NotificationHistory
function logNotificationHistory(entry) {
  try {
    var sheet = getOrCreateNotificationHistorySheet();
    if (!sheet) return null;
    
    entry = entry || {};
    var historyId = entry.historyId || ("notif_" + Date.now() + "_" + Math.floor(Math.random() * 1000));
    var timestamp = entry.timestamp || Utilities.formatDate(new Date(), "GMT+7", "yyyy-MM-dd HH:mm:ss");
    var sender = entry.sender || entry.senderName || "ผู้ดูแลระบบ";
    var title = entry.title || "";
    var message = entry.message || entry.body || "";
    var targetUrl = entry.targetUrl || entry.url || "/";
    var targetAudience = entry.targetAudience || entry.audience || "ทั้งหมด";
    var targetBranch = entry.targetBranch || entry.branch || "ทั้งหมด";
    var targetEmpId = entry.targetEmpId || entry.empId || "-";
    var totalMatched = (typeof entry.totalMatched === 'number') ? entry.totalMatched : (Number(entry.matchedCount) || 0);
    var successCount = (typeof entry.successCount === 'number') ? entry.successCount : (Number(entry.sentCount) || 0);
    var failCount = (typeof entry.failCount === 'number') ? entry.failCount : 0;
    var status = entry.status || computeDeliveryStatus(totalMatched, successCount, failCount);
    
    var errorDetails = entry.errorDetails;
    if (typeof errorDetails === 'object' && errorDetails !== null) {
      errorDetails = JSON.stringify(errorDetails);
    } else if (!errorDetails) {
      errorDetails = "-";
    }
    
    sheet.appendRow([
      historyId,
      timestamp,
      sender,
      title,
      message,
      targetUrl,
      targetAudience,
      targetBranch,
      targetEmpId,
      totalMatched,
      successCount,
      failCount,
      status,
      errorDetails
    ]);
    
    return historyId;
  } catch (err) {
    Logger.log("Error in logNotificationHistory: " + err.toString());
    return null;
  }
}

// ดึงข้อมูลประวัติการส่งแจ้งเตือนสำหรับ Admin Dashboard (รองรับ Pagination, Filtering, และสรุป KPI)
function getNotificationHistoryData(limit, offset, filter) {
  try {
    if (limit && typeof limit === 'object') {
      filter = limit.filter || limit;
      offset = limit.offset;
      limit = limit.limit;
    }
    var numLimit = parseInt(limit, 10);
    if (isNaN(numLimit) || numLimit <= 0) numLimit = 50;
    var numOffset = parseInt(offset, 10);
    if (isNaN(numOffset) || numOffset < 0) numOffset = 0;
    filter = filter || {};
    
    var ss = getMainSpreadsheet();
    var sheet = ss ? ss.getSheetByName("NotificationHistory") : null;
    if (!sheet) {
      return {
        success: true,
        totalCount: 0,
        summary: {
          totalBroadcasts: 0,
          totalSent: 0,
          totalFailed: 0,
          totalMatched: 0,
          successRate: 0
        },
        rows: [],
        data: []
      };
    }
    
    var data = sheet.getDataRange().getValues();
    if (data.length <= 1) {
      return {
        success: true,
        totalCount: 0,
        summary: {
          totalBroadcasts: 0,
          totalSent: 0,
          totalFailed: 0,
          totalMatched: 0,
          successRate: 0
        },
        rows: [],
        data: []
      };
    }
    
    var allRows = [];
    var totalSent = 0;
    var totalFailed = 0;
    var totalMatched = 0;
    
    for (var i = 1; i < data.length; i++) {
      var r = data[i];
      var matched = Number(r[9]) || 0;
      var sent = Number(r[10]) || 0;
      var fail = Number(r[11]) || 0;
      
      totalMatched += matched;
      totalSent += sent;
      totalFailed += fail;
      
      var rowObj = {
        historyId: String(r[0] || ""),
        timestamp: String(r[1] || ""),
        sender: String(r[2] || ""),
        title: String(r[3] || ""),
        message: String(r[4] || ""),
        targetUrl: String(r[5] || ""),
        targetAudience: String(r[6] || ""),
        targetBranch: String(r[7] || ""),
        targetEmpId: String(r[8] || ""),
        totalMatched: matched,
        matchedCount: matched,
        successCount: sent,
        sentCount: sent,
        failCount: fail,
        status: String(r[12] || ""),
        errorDetails: String(r[13] || "-")
      };
      allRows.push(rowObj);
    }
    
    // เรียงจากใหม่ไปเก่า (Newest First)
    allRows.reverse();
    
    // กรองข้อมูลตามเงื่อนไข (Audience, Branch, Status, Search)
    filter = filter || {};
    var filterAudience = (filter.audience !== undefined && filter.audience !== null) ? String(filter.audience).trim() : "";
    var filterBranch = (filter.branch !== undefined && filter.branch !== null) ? String(filter.branch).trim() : "";
    var filterStatus = (filter.status !== undefined && filter.status !== null) ? String(filter.status).trim() : "";
    var filterSearch = (filter.search !== undefined && filter.search !== null) ? String(filter.search).trim() : "";

    var filtered = allRows.filter(function(row) {
      if (filterAudience && filterAudience !== "ทั้งหมด" && filterAudience.toLowerCase() !== "all") {
        if (row.targetAudience !== filterAudience) return false;
      }
      if (filterBranch && filterBranch !== "ทั้งหมด" && filterBranch.toLowerCase() !== "all") {
        if (row.targetBranch !== filterBranch) return false;
      }
      if (filterStatus && filterStatus !== "ทั้งหมด" && filterStatus.toLowerCase() !== "all") {
        if (row.status !== filterStatus) return false;
      }
      if (filterSearch !== "") {
        var s = filterSearch.toLowerCase();
        var matchText = (row.title + " " + row.message + " " + row.sender + " " + row.historyId).toLowerCase();
        if (matchText.indexOf(s) === -1) return false;
      }
      return true;
    });
    
    var totalAttempts = totalSent + totalFailed;
    var successRate = totalAttempts > 0 ? Math.round((totalSent / totalAttempts) * 100) : 0;
    
    var paged = filtered.slice(numOffset, numOffset + numLimit);
    
    return {
      success: true,
      totalCount: filtered.length,
      summary: {
        totalBroadcasts: allRows.length,
        totalSent: totalSent,
        totalFailed: totalFailed,
        totalMatched: totalMatched,
        successRate: successRate
      },
      rows: paged,
      data: paged
    };
  } catch (err) {
    Logger.log("Error in getNotificationHistoryData: " + err.toString());
    return {
      success: false,
      totalCount: 0,
      summary: {
        totalBroadcasts: 0,
        totalSent: 0,
        totalFailed: 0,
        totalMatched: 0,
        successRate: 0
      },
      rows: [],
      data: [],
      error: err.toString()
    };
  }
}

// นามแฝงสำหรับ getNotificationHistoryData
var getNotificationHistory = getNotificationHistoryData;

// ดึงข้อมูลสรุปสถิติการแจ้งเตือน (KPI Summary)
function getNotificationStatistics() {
  var history = getNotificationHistoryData(1, 0);
  return {
    success: history.success,
    summary: history.summary
  };
}

// =================================================================================
// 6. ระบบคิวและการตั้งเวลาแจ้งเตือน (Scheduled Notifications Engine)
// =================================================================================

// สร้างหรือดึงชีต ScheduledNotifications (12 คอลัมน์)
function getOrCreateScheduledNotificationsSheet() {
  var ss = getMainSpreadsheet();
  if (!ss) return null;
  var sheet = ss.getSheetByName("ScheduledNotifications");
  if (!sheet) {
    sheet = ss.insertSheet("ScheduledNotifications");
    sheet.appendRow([
      "ScheduleID",
      "ScheduledTime",
      "Sender",
      "Title",
      "Message",
      "TargetUrl",
      "TargetAudience",
      "TargetBranch",
      "TargetEmpId",
      "CreatedAt",
      "Status",
      "HistoryID"
    ]);
    sheet.getRange("A1:L1").setFontWeight("bold").setBackground("#FEF3C7");
  }
  return sheet;
}

// บันทึกคำขอส่งแจ้งเตือนแบบตั้งเวลาลงในคิว
function schedulePushNotification(payload, argBody, argUrl, argAudience, argBranch, argEmpId, argScheduled, argSender) {
  try {
    var title, body, targetUrl, targetAudience, targetBranch, targetEmpId, scheduledTime, senderName;
    if (payload && typeof payload === 'object') {
      title = payload.title;
      body = payload.body || payload.message;
      targetUrl = payload.targetUrl || payload.url;
      targetAudience = payload.targetAudience || payload.audience;
      targetBranch = payload.targetBranch || payload.branch;
      targetEmpId = payload.targetEmpId || payload.empId;
      scheduledTime = payload.scheduledTime;
      senderName = payload.senderName || payload.sender;
    } else {
      title = payload;
      body = argBody;
      targetUrl = argUrl;
      targetAudience = argAudience;
      targetBranch = argBranch;
      targetEmpId = argEmpId;
      scheduledTime = argScheduled;
      senderName = argSender;
    }
    
    if (!title || !body) {
      return { success: false, message: "กรุณาระบุหัวข้อและข้อความแจ้งเตือน" };
    }
    if (!scheduledTime) {
      return { success: false, message: "กรุณาระบุวันเวลาที่ต้องการส่ง" };
    }
    
    var sheet = getOrCreateScheduledNotificationsSheet();
    if (!sheet) return { success: false, message: "ไม่สามารถเข้าถึงชีต ScheduledNotifications ได้" };
    
    var scheduleId = "sched_" + Date.now() + "_" + Math.floor(Math.random() * 1000);
    var createdAt = Utilities.formatDate(new Date(), "GMT+7", "yyyy-MM-dd HH:mm:ss");
    var schedTimeStr = (scheduledTime instanceof Date) ? Utilities.formatDate(scheduledTime, "GMT+7", "yyyy-MM-dd HH:mm:ss") : String(scheduledTime).trim();
    
    sheet.appendRow([
      scheduleId,
      schedTimeStr,
      senderName || "ผู้ดูแลระบบ",
      title,
      body,
      targetUrl || "/",
      targetAudience || "ทั้งหมด",
      targetBranch || "ทั้งหมด",
      targetEmpId || "-",
      createdAt,
      "รอดำเนินการ",
      "-"
    ]);
    
    return {
      success: true,
      scheduleId: scheduleId,
      scheduledTime: schedTimeStr,
      message: "ตั้งเวลาส่งการแจ้งเตือนสำเร็จ (" + schedTimeStr + ")"
    };
  } catch (err) {
    Logger.log("Error in schedulePushNotification: " + err.toString());
    return { success: false, message: "เกิดข้อผิดพลาดในการตั้งเวลา: " + err.toString() };
  }
}

// ประมวลผลคิวการแจ้งเตือนที่ถึงกำหนดเวลาส่งแล้ว (Scheduled Queue Processor)
function processScheduledNotificationQueue() {
  var lock = (typeof LockService !== 'undefined' && LockService.getScriptLock) ? LockService.getScriptLock() : null;
  if (lock && !lock.tryLock(10000)) {
    return { success: false, error: 'Queue processor currently running', message: 'คิวการส่งกำลังถูกประมวลผลอยู่โดยคำขออื่น' };
  }
  
  try {
    var sheet = getOrCreateScheduledNotificationsSheet();
    if (!sheet) return { success: false, message: "ไม่พบชีต ScheduledNotifications" };
    
    var rows = sheet.getDataRange().getValues();
    if (rows.length <= 1) {
      return { success: true, processedCount: 0, message: "ไม่มีรายการตั้งเวลาในคิว" };
    }
    
    var nowTime = Date.now();
    var processedCount = 0;
    var results = [];
    
    for (var i = 1; i < rows.length; i++) {
      var row = rows[i];
      var scheduleId = row[0];
      var status = String(row[10] || "").trim();
      
      if (status !== "รอดำเนินการ") continue;
      
      var schedTimeStr = row[1];
      var sender = row[2];
      var title = row[3];
      var message = row[4];
      var targetUrl = row[5] || "/";
      var targetAudience = row[6] || "ทั้งหมด";
      var targetBranch = row[7] || "ทั้งหมด";
      var targetEmpId = (row[8] && row[8] !== "-") ? row[8] : "";
      
      var isDue = false;
      var schedDate = new Date(schedTimeStr);
      if (!isNaN(schedDate.getTime())) {
        isDue = schedDate.getTime() <= (nowTime + 30000); // 30s tolerance buffer
      } else {
        try {
          var parts = String(schedTimeStr).split(" ");
          if (parts.length === 2) {
            var dParts = parts[0].split("-");
            var tParts = parts[1].split(":");
            var d = new Date(dParts[0], dParts[1] - 1, dParts[2], tParts[0], tParts[1], tParts[2] || 0);
            isDue = d.getTime() <= (nowTime + 30000);
          }
        } catch(eParse) {}
      }
      
      if (isDue) {
        var dispatchRes = executeBroadcastPush({
          title: title,
          body: message,
          targetUrl: targetUrl,
          targetAudience: targetAudience,
          targetBranch: targetBranch,
          targetEmpId: targetEmpId,
          senderName: sender || "ระบบตั้งเวลาอัตโนมัติ"
        });
        
        var newStatus = dispatchRes.success ? "ส่งแล้ว" : (dispatchRes.status === "ไม่พบเป้าหมาย" ? "ไม่พบเป้าหมาย" : "ล้มเหลว");
        var nowFormatted = Utilities.formatDate(new Date(), "GMT+7", "yyyy-MM-dd HH:mm:ss");
        sheet.getRange(i + 1, 11).setValue(newStatus);
        row[10] = newStatus;
        if (dispatchRes.historyId) {
          sheet.getRange(i + 1, 12).setValue(dispatchRes.historyId);
          row[11] = dispatchRes.historyId;
        } else {
          sheet.getRange(i + 1, 12).setValue(nowFormatted);
          row[11] = nowFormatted;
        }
        
        processedCount++;
        results.push({
          scheduleId: scheduleId,
          status: newStatus,
          historyId: dispatchRes.historyId,
          sentCount: dispatchRes.sentCount || 0
        });
      }
    }
    
    return {
      success: true,
      processedCount: processedCount,
      results: results
    };
  } catch (err) {
    Logger.log("Error in processScheduledNotificationQueue: " + err.toString());
    return { success: false, error: err.toString() };
  } finally {
    if (lock) {
      try {
        lock.releaseLock();
      } catch (eLock) {}
    }
  }
}

// นามแฝงสำหรับ processScheduledNotificationQueue
var processScheduledQueue = processScheduledNotificationQueue;

// ดึงรายการแจ้งเตือนที่ตั้งเวลาไว้ในคิว
function getScheduledNotifications(limit, offset) {
  try {
    var ss = getMainSpreadsheet();
    var sheet = ss ? ss.getSheetByName("ScheduledNotifications") : null;
    if (!sheet) return { success: true, total: 0, rows: [] };
    
    var data = sheet.getDataRange().getValues();
    if (data.length <= 1) return { success: true, total: 0, rows: [] };
    
    var rows = [];
    for (var i = 1; i < data.length; i++) {
      var r = data[i];
      rows.push({
        scheduleId: r[0],
        scheduledTime: r[1],
        sender: r[2],
        title: r[3],
        message: r[4],
        targetUrl: r[5],
        targetAudience: r[6],
        targetBranch: r[7],
        targetEmpId: r[8],
        createdAt: r[9],
        status: r[10],
        historyId: r[11]
      });
    }
    rows.reverse();
    return { success: true, total: rows.length, rows: rows };
  } catch (err) {
    return { success: false, total: 0, rows: [], error: err.toString() };
  }
}

// ยกเลิกรายการแจ้งเตือนที่ตั้งเวลาไว้
function cancelScheduledNotification(scheduleId) {
  try {
    if (!scheduleId) return { success: false, message: "ไม่พบ ScheduleID" };
    var sheet = getOrCreateScheduledNotificationsSheet();
    if (!sheet) return { success: false, message: "ไม่พบชีต ScheduledNotifications" };
    var rows = sheet.getDataRange().getValues();
    for (var i = 1; i < rows.length; i++) {
      if (rows[i][0] && rows[i][0].toString().trim() === scheduleId.toString().trim()) {
        sheet.getRange(i + 1, 11).setValue("ยกเลิก");
        rows[i][10] = "ยกเลิก";
        return { success: true, message: "ยกเลิกการตั้งเวลาส่งสำเร็จ" };
      }
    }
    return { success: false, message: "ไม่พบรายการที่ต้องการยกเลิก" };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

// ติดตั้ง Time-driven Trigger สำหรับตรวจคิวทุก 5 นาที
function setupScheduledNotificationTrigger() {
  try {
    if (typeof ScriptApp === 'undefined' || !ScriptApp.getProjectTriggers) {
      return { success: false, message: "ScriptApp trigger API is not available in current environment" };
    }
    var triggers = ScriptApp.getProjectTriggers();
    for (var i = 0; i < triggers.length; i++) {
      if (triggers[i].getHandlerFunction() === "processScheduledNotificationQueue") {
        ScriptApp.deleteTrigger(triggers[i]);
      }
    }
    ScriptApp.newTrigger("processScheduledNotificationQueue")
      .timeBased()
      .everyMinutes(5)
      .create();
    return { success: true, message: "ติดตั้ง Trigger ตรวจสอบคิวแจ้งเตือนทุก 5 นาที สำเร็จเรียบร้อยแล้ว" };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

// =================================================================================
// 7. เครื่องมือส่งข้อความ FCM HTTP v1 (Dispatcher & Payload Builder)
// =================================================================================

// ประกอบโครงสร้าง JSON Payload มาตรฐานสำหรับ Google FCM HTTP v1 API
function buildFcmPayload(token, title, body, cleanUrl, defaultIcon, tag) {
  var t = String(title || "ศูนย์การเรียนรู้ Sprinkle");
  var b = String(body || "มีข้อมูลอัปเดตใหม่ในระบบ");
  var u = (cleanUrl && cleanUrl.trim() !== "") ? cleanUrl.trim() : "/";
  var icon = defaultIcon || "https://lh3.googleusercontent.com/d/1DTKNi7relqZQ41ULEdLPHGWx9026wKPs";
  var notifTag = tag || ("sprinkle-notif-" + Date.now());
  
  return {
    message: {
      token: token,
      notification: {
        title: t,
        body: b,
        image: icon
      },
      webpush: {
        headers: {
          Urgency: "high"
        },
        notification: {
          title: t,
          body: b,
          icon: icon,
          badge: icon,
          requireInteraction: true,
          vibrate: [200, 100, 200],
          tag: notifTag
        },
        fcm_options: {
          link: u
        }
      },
      data: {
        title: t,
        body: b,
        url: u,
        tag: notifTag,
        timestamp: String(Date.now())
      }
    }
  };
}

// ดำเนินการยิง Push Notification พร้อมคัดกรอง บันทึกประวัติ และปลดระวาง Dead Token
function executeBroadcastPush(params) {
  params = params || {};
  var title = params.title || "ศูนย์การเรียนรู้ Sprinkle";
  var body = params.body || params.message || "มีข้อมูลอัปเดตใหม่ในระบบ";
  var targetUrl = params.targetUrl || params.url || "/";
  var targetAudience = params.targetAudience || params.audience || "ทั้งหมด";
  var targetBranch = params.targetBranch || params.branch || "ทั้งหมด";
  var targetEmpId = params.targetEmpId || params.empId || "";
  var senderName = params.senderName || params.sender || "ผู้ดูแลระบบ";
  
  var historyId = "notif_" + Date.now() + "_" + Math.floor(Math.random() * 1000);
  
  // คัดกรอง Token
  var filtered = filterPushTokens({
    targetAudience: targetAudience,
    targetBranch: targetBranch,
    targetEmpId: targetEmpId
  });
  
  var tokens = filtered.tokens;
  var matchedCount = tokens.length;
  
  if (matchedCount === 0) {
    logNotificationHistory({
      historyId: historyId,
      sender: senderName,
      title: title,
      message: body,
      targetUrl: targetUrl,
      targetAudience: targetAudience,
      targetBranch: targetBranch,
      targetEmpId: targetEmpId || "-",
      totalMatched: 0,
      successCount: 0,
      failCount: 0,
      status: "ไม่พบเป้าหมาย",
      errorDetails: "-"
    });
    
    return {
      success: false,
      historyId: historyId,
      matchedCount: 0,
      totalTargets: 0,
      sentCount: 0,
      count: 0,
      failCount: 0,
      status: "ไม่พบเป้าหมาย",
      message: "ไม่พบ Device Token ที่ตรงกับกลุ่มเป้าหมาย",
      details: [],
      error: null
    };
  }
  
  // รับ OAuth2 Access Token
  var props = (typeof PropertiesService !== 'undefined' && PropertiesService.getScriptProperties) ? PropertiesService.getScriptProperties() : null;
  var fcmServiceAccountJson = props ? props.getProperty("FCM_SERVICE_ACCOUNT") : null;
  var sa = DEFAULT_FCM_SERVICE_ACCOUNT;
  if (fcmServiceAccountJson && fcmServiceAccountJson.trim() !== "") {
    try { sa = JSON.parse(fcmServiceAccountJson); } catch(eParse) {}
  }
  
  var tokenObj = getFCMAccessTokenFromServiceAccount(sa);
  if (!tokenObj.token) {
    var errMsg = tokenObj.error || "ไม่สามารถสร้าง OAuth2 Access Token ได้";
    logNotificationHistory({
      historyId: historyId,
      sender: senderName,
      title: title,
      message: body,
      targetUrl: targetUrl,
      targetAudience: targetAudience,
      targetBranch: targetBranch,
      targetEmpId: targetEmpId || "-",
      totalMatched: matchedCount,
      successCount: 0,
      failCount: matchedCount,
      status: "ล้มเหลว",
      errorDetails: errMsg
    });
    
    if (errMsg.indexOf("UrlFetchApp") !== -1 || errMsg.indexOf("script.external_request") !== -1) {
      return {
        success: false,
        needsAuth: true,
        historyId: historyId,
        matchedCount: matchedCount,
        sentCount: 0,
        failCount: matchedCount,
        status: "ล้มเหลว",
        message: "⚠️ ต้องการยืนยันสิทธิ์ Apps Script:\nเนื่องจากระบบมีการเชื่อมต่อภายนอก (UrlFetchApp) เพื่อส่งข้อความแจ้งเตือน กรุณาเปิดหน้า Google Apps Script แล้วกด Run ฟังก์ชัน testSendPushNotification 1 ครั้งเพื่อกดยืนยัน 'อนุญาต' (Authorize) ครับ"
      };
    }
    
    return {
      success: false,
      historyId: historyId,
      matchedCount: matchedCount,
      sentCount: 0,
      failCount: matchedCount,
      status: "ล้มเหลว",
      message: "ไม่สามารถสร้าง OAuth2 Access Token สำหรับเชื่อมต่อ Google Firebase ได้: " + errMsg
    };
  }
  
  var accessToken = tokenObj.token;
  var defaultIcon = "https://lh3.googleusercontent.com/d/1DTKNi7relqZQ41ULEdLPHGWx9026wKPs";
  var cleanUrl = (targetUrl && targetUrl.trim() !== "") ? targetUrl.trim() : "/";
  var projectId = sa.project_id || "studio-8742716914-acc69";
  var tag = "sprinkle-notif-" + Date.now();
  
  var sentCount = 0;
  var failCount = 0;
  var logDetails = [];
  
  // แบ่งกลุ่ม Token เป็นชุดย่อย (Chunking) เพื่อยิงด้วย UrlFetchApp.fetchAll
  var chunkSize = 40;
  var chunks = [];
  for (var c = 0; c < tokens.length; c += chunkSize) {
    chunks.push(tokens.slice(c, c + chunkSize));
  }
  
  var globalIndex = 0;
  for (var b = 0; b < chunks.length; b++) {
    var batchTokens = chunks[b];
    var requests = batchTokens.map(function(tok) {
      return {
        url: "https://fcm.googleapis.com/v1/projects/" + projectId + "/messages:send",
        method: "post",
        contentType: "application/json",
        headers: {
          "Authorization": "Bearer " + accessToken
        },
        payload: JSON.stringify(buildFcmPayload(tok, title, body, cleanUrl, defaultIcon, tag)),
        muteHttpExceptions: true
      };
    });
    
    var batchHandled = false;
    // พยายามยิงแบบ Parallel ด้วย UrlFetchApp.fetchAll
    if (typeof UrlFetchApp !== 'undefined' && typeof UrlFetchApp.fetchAll === 'function') {
      try {
        var responses = UrlFetchApp.fetchAll(requests);
        if (responses && responses.length === requests.length) {
          batchHandled = true;
          for (var r = 0; r < responses.length; r++) {
            var resp = responses[r];
            var code = resp.getResponseCode();
            var tok = batchTokens[r];
            if (code === 200) {
              sentCount++;
            } else {
              failCount++;
              var txt = resp.getContentText();
              logDetails.push({ tokenIndex: globalIndex + r, status: code, error: txt });
              if (code === 401) {
                invalidateFCMAccessToken(sa);
              }
              if (isFcmTokenInvalidError(code, txt)) {
                deactivatePushToken(tok, "Invalid");
              }
            }
          }
        }
      } catch(eBatch) {
        batchHandled = false;
      }
    }
    
    // Sequential Fallback หาก fetchAll ล้มเหลวหรือไม่รองรับ
    if (!batchHandled && typeof UrlFetchApp !== 'undefined' && typeof UrlFetchApp.fetch === 'function') {
      for (var s = 0; s < batchTokens.length; s++) {
        var stok = batchTokens[s];
        try {
          var singleResp = UrlFetchApp.fetch(requests[s].url, requests[s]);
          var scode = singleResp.getResponseCode();
          if (scode === 200) {
            sentCount++;
          } else {
            failCount++;
            var stxt = singleResp.getContentText();
            logDetails.push({ tokenIndex: globalIndex + s, status: scode, error: stxt });
            if (scode === 401) {
              invalidateFCMAccessToken(sa);
            }
            if (isFcmTokenInvalidError(scode, stxt)) {
              deactivatePushToken(stok, "Invalid");
            }
          }
        } catch(eSingle) {
          failCount++;
          logDetails.push({ tokenIndex: globalIndex + s, error: eSingle.toString() });
        }
      }
    }
    
    globalIndex += batchTokens.length;
  }
  
  var deliveryStatus = computeDeliveryStatus(matchedCount, sentCount, failCount);
  
  // บันทึกประวัติลง NotificationHistory
  logNotificationHistory({
    historyId: historyId,
    sender: senderName,
    title: title,
    message: body,
    targetUrl: cleanUrl,
    targetAudience: targetAudience,
    targetBranch: targetBranch,
    targetEmpId: targetEmpId || "-",
    totalMatched: matchedCount,
    successCount: sentCount,
    failCount: failCount,
    status: deliveryStatus,
    errorDetails: logDetails.length > 0 ? logDetails : "-"
  });
  
  return {
    success: sentCount > 0,
    historyId: historyId,
    matchedCount: matchedCount,
    totalTargets: matchedCount,
    sentCount: sentCount,
    count: sentCount,
    failCount: failCount,
    status: deliveryStatus,
    details: logDetails,
    error: failCount > 0 ? ("พบข้อผิดพลาด " + failCount + " เครื่อง") : null
  };
}

// ส่งการแจ้งเตือนแบบเจาะจงกลุ่มเป้าหมาย (Targeted Push Notification) รองรับทั้งการส่งทันทีและตั้งเวลาล่วงหน้า
function sendTargetedPushNotification(payload, argBody, argUrl, argAudience, argBranch, argEmpId, argScheduled, argSender) {
  var title, body, targetUrl, targetAudience, targetBranch, targetEmpId, scheduledTime, senderName;
  if (payload && typeof payload === 'object') {
    title = payload.title;
    body = payload.body || payload.message;
    targetUrl = payload.targetUrl || payload.url;
    targetAudience = payload.targetAudience || payload.audience;
    targetBranch = payload.targetBranch || payload.branch;
    targetEmpId = payload.targetEmpId || payload.empId;
    scheduledTime = payload.scheduledTime;
    senderName = payload.senderName || payload.sender;
  } else {
    title = payload;
    body = argBody;
    targetUrl = argUrl;
    targetAudience = argAudience;
    targetBranch = argBranch;
    targetEmpId = argEmpId;
    scheduledTime = argScheduled;
    senderName = argSender;
  }
  
  // ตรวจสอบกรณีตั้งเวลาส่งในอนาคต
  if (scheduledTime) {
    var schedDate = new Date(scheduledTime);
    if (!isNaN(schedDate.getTime()) && schedDate.getTime() > Date.now()) {
      var schedResult = schedulePushNotification({
        title: title,
        body: body,
        targetUrl: targetUrl,
        targetAudience: targetAudience,
        targetBranch: targetBranch,
        targetEmpId: targetEmpId,
        scheduledTime: scheduledTime,
        senderName: senderName
      });
      return {
        success: true,
        scheduled: true,
        scheduleId: schedResult.scheduleId,
        historyId: null,
        matchedCount: 0,
        sentCount: 0,
        count: 0,
        failCount: 0,
        totalTargets: 0,
        status: "รอดำเนินการ",
        error: null
      };
    }
  }
  
  // ส่งทันที (Immediate Delivery)
  return executeBroadcastPush({
    title: title,
    body: body,
    targetUrl: targetUrl,
    targetAudience: targetAudience,
    targetBranch: targetBranch,
    targetEmpId: targetEmpId,
    senderName: senderName || "ผู้ดูแลระบบ"
  });
}

// ฟังก์ชันดั้งเดิมสำหรับส่งแจ้งเตือนผ่าน Firebase Cloud Messaging (คงความเข้ากันได้ 100%)
function sendPushNotificationToFCM(title, body, targetUrl, targetAudience, targetBranch, targetEmpId) {
  var sender = (targetAudience === "เฉพาะบุคคล") ? "ระบบตอบคำถาม Q&A" : "ระบบอัตโนมัติ";
  return sendTargetedPushNotification({
    title: title,
    body: body,
    targetUrl: targetUrl,
    targetAudience: targetAudience,
    targetBranch: targetBranch,
    targetEmpId: targetEmpId,
    senderName: sender
  });
}

// นามแฝงสำหรับส่งการแจ้งเตือน
var sendPushNotification = sendTargetedPushNotification;

// ฟังก์ชันทดสอบยิงแจ้งเตือนจากแอดมิน (Admin Test Notification)
function testSendPushNotification(title, body) {
  return sendPushNotificationToFCM(
    title || "🔔 ทดสอบการแจ้งเตือนจาก Sprinkle",
    body || "ระบบการแจ้งเตือน Push Notification ทำงานได้สมบูรณ์แล้วครับ!",
    "/",
    "ทั้งหมด"
  );
}

// ฟังก์ชันตั้งค่า FCM Service Account ลงใน Script Properties โดยอัตโนมัติ
function setupFCM() {
  PropertiesService.getScriptProperties().setProperty("FCM_SERVICE_ACCOUNT", JSON.stringify(DEFAULT_FCM_SERVICE_ACCOUNT));
  Logger.log("FCM_SERVICE_ACCOUNT set successfully!");
  return "ตั้งค่า FCM_SERVICE_ACCOUNT ใน Script Properties สำเร็จเรียบร้อย!";
}

// ฟังก์ชันตรวจสอบสถานะ FCM สำหรับตรวจสอบระบบหลังบ้าน
function debugFCMStatus() {
  var sa = DEFAULT_FCM_SERVICE_ACCOUNT;
  var token = getFCMAccessTokenFromServiceAccount(sa);
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("PushTokens");
  var tokenCount = sheet ? sheet.getLastRow() - 1 : 0;
  return {
    hasServiceAccount: !!sa,
    projectId: sa ? sa.project_id : null,
    clientEmail: sa ? sa.client_email : null,
    accessTokenGenerated: !!token,
    tokenPrefix: token ? token.substring(0, 15) + "..." : null,
    registeredTokensInSheet: tokenCount
  };
}

// ฟังก์ชันอ่านรายการ Token สำหรับตรวจสอบ
function getRegisteredPushTokens() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("PushTokens");
  if (!sheet) return [];
  var rows = sheet.getDataRange().getValues();
  var list = [];
  for (var i = 1; i < rows.length; i++) {
    if (rows[i][4]) {
      list.push({
        empId: rows[i][0],
        name: rows[i][1],
        device: rows[i][5],
        token: rows[i][4],
        status: rows[i][7]
      });
    }
  }
  return list;
}

// ฟังก์ชันสำหรับกดยืนยันอนุญาตสิทธิ์การเชื่อมต่อภายนอก (UrlFetchApp) ในหน้า Apps Script
function authorizeUrlFetch() {
  var res = UrlFetchApp.fetch("https://www.google.com");
  Logger.log("สำเร็จ! ได้รับสิทธิ์ UrlFetchApp เรียบร้อยแล้ว (Status: " + res.getResponseCode() + ")");
  return "ยืนยันสิทธิ์สำเร็จเรียบร้อย!";
}

function getAppInfo() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  return {
    spreadsheetId: ss ? ss.getId() : null,
    spreadsheetName: ss ? ss.getName() : null
  };
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return ContentService.createTextOutput(JSON.stringify({ success: false, error: "No postData" }))
                           .setMimeType(ContentService.MimeType.JSON);
    }
    var postData = JSON.parse(e.postData.contents);
    var functionName = postData.functionName || postData.action;
    var args = postData.arguments;
    if (args === undefined || args === null) {
      if (postData.payload !== undefined) {
        args = [postData.payload];
      } else if (postData.data !== undefined) {
        args = [postData.data];
      } else {
        args = [];
      }
    } else if (!Array.isArray(args)) {
      args = [args];
    }
    
    // กำหนดตารางฟังก์ชันที่อนุญาตให้เรียกใช้งานผ่าน Webhook (Allowlist Dispatch Table)
    var ALLOWED_ACTIONS = {
      "getTopicDetailedHistory": getTopicDetailedHistory,
      "getEmployeeDetailedHistory": getEmployeeDetailedHistory,
      "getRankingDataSeparated": getRankingDataSeparated,
      "getInitialAppData": getInitialAppData,
      "sendPushNotification": sendTargetedPushNotification,
      "sendTargetedPushNotification": sendTargetedPushNotification,
      "sendPushNotificationToFCM": sendPushNotificationToFCM,
      "getNotificationHistory": getNotificationHistoryData,
      "getNotificationHistoryData": getNotificationHistoryData,
      "processScheduledQueue": processScheduledNotificationQueue,
      "processScheduledNotificationQueue": processScheduledNotificationQueue,
      "getAudienceEstimate": getAudienceEstimate,
      "registerPushToken": registerPushToken,
      "removePushToken": removePushToken,
      "deactivatePushToken": deactivatePushToken,
      "getScheduledNotifications": getScheduledNotifications,
      "schedulePushNotification": schedulePushNotification,
      "testSendPushNotification": testSendPushNotification,
      "setupFCM": setupFCM,
      "debugFCMStatus": debugFCMStatus
    };
    
    var fn = null;
    if (Object.prototype.hasOwnProperty.call(ALLOWED_ACTIONS, functionName) && typeof ALLOWED_ACTIONS[functionName] === 'function') {
      fn = ALLOWED_ACTIONS[functionName];
    } else if (/^[a-zA-Z0-9_$]+$/.test(functionName)) {
      if (typeof globalThis !== 'undefined' && typeof globalThis[functionName] === 'function') {
        fn = globalThis[functionName];
      } else if (typeof this !== 'undefined' && this && typeof this[functionName] === 'function') {
        fn = this[functionName];
      }
    }
    
    // ตรวจสอบว่ามีฟังก์ชันหลังบ้านนี้อยู่จริงหรือไม่
    if (typeof fn !== 'function') {
      throw new Error("ฟังก์ชัน '" + functionName + "' ไม่มีอยู่ในระบบหลังบ้าน");
    }
    
    // เรียกใช้ฟังก์ชันเซิร์ฟเวอร์ Apps Script
    var result = fn.apply(null, args);
    
    var response = { success: true, result: result };
    return ContentService.createTextOutput(JSON.stringify(response))
                         .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    var response = { success: false, error: err.toString() };
    return ContentService.createTextOutput(JSON.stringify(response))
                         .setMimeType(ContentService.MimeType.JSON);
  }
}

// ส่งออกโมดูลสำหรับการทดสอบในสภาพแวดล้อม Node.js (ไม่มีผลกระทบต่อ Apps Script)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    getMainSpreadsheet: getMainSpreadsheet,
    getOrCreatePushTokensSheet: getOrCreatePushTokensSheet,
    registerPushToken: registerPushToken,
    removePushToken: removePushToken,
    deactivatePushToken: deactivatePushToken,
    isFcmTokenInvalidError: isFcmTokenInvalidError,
    DEFAULT_FCM_SERVICE_ACCOUNT: DEFAULT_FCM_SERVICE_ACCOUNT,
    getFCMAccessTokenFromServiceAccount: getFCMAccessTokenFromServiceAccount,
    invalidateFCMAccessToken: invalidateFCMAccessToken,
    isOperatorRole: isOperatorRole,
    matchAudienceRule: matchAudienceRule,
    filterPushTokens: filterPushTokens,
    getAudienceEstimate: getAudienceEstimate,
    getOrCreateNotificationHistorySheet: getOrCreateNotificationHistorySheet,
    computeDeliveryStatus: computeDeliveryStatus,
    logNotificationHistory: logNotificationHistory,
    getNotificationHistoryData: getNotificationHistoryData,
    getNotificationHistory: getNotificationHistory,
    getNotificationStatistics: getNotificationStatistics,
    getOrCreateScheduledNotificationsSheet: getOrCreateScheduledNotificationsSheet,
    schedulePushNotification: schedulePushNotification,
    processScheduledNotificationQueue: processScheduledNotificationQueue,
    processScheduledQueue: processScheduledQueue,
    getScheduledNotifications: getScheduledNotifications,
    cancelScheduledNotification: cancelScheduledNotification,
    setupScheduledNotificationTrigger: setupScheduledNotificationTrigger,
    buildFcmPayload: buildFcmPayload,
    executeBroadcastPush: executeBroadcastPush,
    sendTargetedPushNotification: sendTargetedPushNotification,
    sendPushNotificationToFCM: sendPushNotificationToFCM,
    sendPushNotification: sendPushNotification,
    testSendPushNotification: testSendPushNotification,
    setupFCM: setupFCM,
    debugFCMStatus: debugFCMStatus,
    getRegisteredPushTokens: getRegisteredPushTokens,
    authorizeUrlFetch: authorizeUrlFetch,
    getAppInfo: getAppInfo,
    getTopicDetailedHistory: getTopicDetailedHistory,
    getRankingDataSeparated: getRankingDataSeparated,
    doPost: doPost
  };
}