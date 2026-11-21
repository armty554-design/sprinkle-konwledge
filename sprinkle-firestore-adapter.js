/**
 * =================================================================================
 * Sprinkle Knowledge - High Performance Cloud Firestore Adapter with Dual-Sync
 * Milestone 4: Modern Standalone Web App Backend with Google Sheets Dual-Sync
 *
 * Provides sub-100ms ultra-fast response times, offline caching, and real-time data
 * directly connected to Google Cloud Firestore (Region: asia-southeast1 / Singapore),
 * with non-blocking background synchronization to Google Sheets.
 * =================================================================================
 */

(function(window) {
    'use strict';

    // 1. Firebase Project Configuration
    var firebaseConfig = {
        apiKey: "AIzaSyCHxAVoOSdNoBS9HaISnWodE5vYxscMJK4",
        authDomain: "studio-8742716914-acc69.firebaseapp.com",
        databaseURL: "https://studio-8742716914-acc69-default-rtdb.asia-southeast1.firebasedatabase.app",
        projectId: "studio-8742716914-acc69",
        storageBucket: "studio-8742716914-acc69.firebasestorage.app",
        messagingSenderId: "537794597030",
        appId: "1:537794597030:web:583288d5edd4fa8c6a2467"
    };

    var db = null;
    try {
        if (typeof firebase !== 'undefined') {
            if (!firebase.apps || !firebase.apps.length) {
                firebase.initializeApp(firebaseConfig);
            }
            if (typeof firebase.firestore === 'function') {
                db = firebase.firestore();
                // Enable multi-tab offline persistence
                db.enablePersistence({ synchronizeTabs: true }).catch(function(err) {
                    if (err.code !== 'unimplemented' && err.code !== 'failed-precondition') {
                        console.warn("[Firestore] Persistence warning:", err.message);
                    }
                });
                console.log("⚡ [Sprinkle Knowledge] Cloud Firestore Native Adapter Ready (asia-southeast1)");
            }
        }
    } catch (e) {
        console.warn("[Firestore] Init warning:", e);
    }

    // 2. Dual-Sync Configuration & Background Dispatcher
    var GAS_API_URL = "https://script.google.com/macros/s/AKfycbw8005H1Go8ygULx_eni6Vrk4UmrodioiI6KQm99jh4epcaQKrmT9IylpjLFvKLMZQw/exec";
    var isDualSyncEnabled = true;

    function syncToGoogleSheets(functionName, args) {
        if (!isDualSyncEnabled || !GAS_API_URL) return;
        try {
            var payload = {
                functionName: functionName,
                arguments: Array.isArray(args) ? args : [args]
            };
            fetch(GAS_API_URL, {
                method: 'POST',
                mode: 'cors',
                credentials: 'omit',
                cache: 'no-store',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify(payload)
            })
            .then(function(res) { return res.json(); })
            .then(function(data) {
                if (data && data.success) {
                    console.log("📊 [Dual-Sync ✅] Synced '" + functionName + "' to Google Sheets successfully.");
                } else {
                    console.warn("⚠️ [Dual-Sync ⚠️] Google Sheets response:", data);
                }
            })
            .catch(function(err) {
                console.warn("⚠️ [Dual-Sync Warning] Google Sheets sync failed in background:", err.message);
            });
        } catch (e) {
            console.warn("⚠️ [Dual-Sync Error]:", e);
        }
    }

    // Helper: Standardize branch names (including ดอนเมือง -> ปทุมธานี 2, ปทุมธานี -> ปทุมธานี 1)
    function normalizeBranch(rawBranch) {
        if (rawBranch === null || rawBranch === undefined) return "";
        var b = String(rawBranch).trim();
        if (!b || b === "-" || b === "ไม่ระบุสาขา" || b === "ไม่ระบุ" || b === "undefined" || b === "null") {
            return b;
        }
        var cleaned = b.replace(/\s+/g, '');
        if (cleaned === "ดอนเมือง") return "ปทุมธานี 2";
        if (cleaned === "ปทุมธานี" || cleaned === "ปทุมธานี1") return "ปทุมธานี 1";
        if (cleaned === "ปทุมธานี2") return "ปทุมธานี 2";
        if (cleaned === "พุทธมณฑลสาย1") return "พุทธมณฑล สาย 1";
        if (cleaned === "สุขุมวิท50") return "สุขุมวิท 50";
        if (cleaned === "พระราม2") return "พระราม 2";
        if (cleaned === "พระราม3") return "พระราม 3";
        return b;
    }

    // Helper: Safely convert snapshot to array of plain objects with auto-healing for Thai encoding
    function snapshotToArray(snapshot) {
        var items = [];
        if (!snapshot || snapshot.empty) return items;
        snapshot.forEach(function(doc) {
            var data = doc.data() || {};
            // If data doesn't have id field, populate it from doc.id
            if (data.id === undefined || data.id === null || data.id === "") {
                data.id = doc.id;
            }
            // Auto-heal legacy corrupted mainFolder strings
            if (data.mainFolder && typeof data.mainFolder === 'string') {
                var mf = data.mainFolder.trim();
                if (mf.indexOf('\uFFFD') !== -1 || mf.indexOf('') !== -1 || mf.length < 3) {
                    if (mf.indexOf('กาศ') !== -1 || mf.indexOf('ประก') !== -1) data.mainFolder = 'ประกาศ';
                    else if (mf.indexOf('นโยบาย') !== -1) data.mainFolder = 'นโยบาย';
                    else if (mf.indexOf('คนดี') !== -1) data.mainFolder = 'คนดีสปริงเคิล';
                    else if (mf.indexOf('ลด') !== -1) data.mainFolder = 'โครงการ 3 ลด';
                    else if (mf.indexOf('รวมภาพ') !== -1) data.mainFolder = 'รวมภาพสื่อประชาสัมพันธ์';
                    else if (mf.indexOf('สัมพันธ์') !== -1 || mf.indexOf('แฟ้ม') !== -1) data.mainFolder = 'แฟ้มประชาสัมพันธ์';
                    else if (mf.indexOf('Training') !== -1) data.mainFolder = 'Sprinkle Training';
                    else data.mainFolder = 'ขั้นตอนการทำงาน';
                }
            }
            // Auto-heal legacy corrupted category strings
            if (data.category && typeof data.category === 'string' && (data.category.indexOf('\uFFFD') !== -1 || data.category.indexOf('') !== -1)) {
                var cat = data.category;
                if (cat.indexOf('ขั้นตอน') !== -1 || cat.indexOf('ปฎิบัติ') !== -1) data.category = 'ขั้นตอนปฎิบัติงาน';
                else if (cat.indexOf('2568') !== -1) data.category = 'ประกาศฝ่ายบริการจัดส่ง ประจำปี 2568';
                else if (cat.indexOf('2569') !== -1) data.category = 'ประกาศฝ่ายบริการจัดส่ง ประจำปี 2569';
                else if (cat.indexOf('2567') !== -1) data.category = 'ประกาศฝ่ายบริการจัดส่ง ประจำปี 2567';
                else if (cat.indexOf('2566') !== -1) data.category = 'ประกาศฝ่ายบริการจัดส่ง ประจำปี 2566';
                else if (cat.indexOf('2560') !== -1) data.category = 'ประกาศฝ่ายบริการจัดส่ง ประจำปี 2560';
                else if (cat.indexOf('คู่มือ') !== -1) data.category = 'คู่มือผู้ประกอบการ';
                else if (cat.indexOf('รับสมัคร') !== -1) data.category = 'รับสมัครผู้ประกอบการ';
                else if (cat.indexOf('ปลอดภัย') !== -1) data.category = 'โครงการ คลังปลอดฝุ่น และปลอดภัย';
                else if (cat.indexOf('อื่น') !== -1) data.category = 'ประกาศอื่นๆ';
            }
            items.push(data);
        });
        return items;
    }

    // Helper: Normalize employee role & branch consistently
    function normalizeEmployeeObj(emp, fallbackId) {
        if (!emp || typeof emp !== 'object') return emp;
        if ((emp.empId === undefined || emp.empId === null || emp.empId === "") && fallbackId) {
            emp.empId = fallbackId;
        }
        if (emp.role === "ผู้ประกอบการ" || emp.role === "ผปก.") {
            emp.role = "พี่สปริงเคิล";
        }
        if (emp.branch) {
            emp.branch = normalizeBranch(emp.branch);
        }
        return emp;
    }

    // Local dirty flags to eliminate 50ms race conditions right after an admin writes data
    var _localContentDirty = false;
    var _localEmployeesDirty = false;
    var _pendingDataVersion = null;
    var _pendingEmployeesVersion = null;

    // Helper: Bump lightweight version token in config/main (enables 1-read cache validation)
    function bumpDataVersion(kind) {
        if (!db) return;
        try {
            var ver = String(Date.now());
            var patch = {};
            if (kind === 'employees') {
                _localEmployeesDirty = true;
                _pendingEmployeesVersion = ver;
                patch.employeesVersion = ver;
            } else if (kind === 'all') {
                _localContentDirty = true;
                _localEmployeesDirty = true;
                _pendingDataVersion = ver;
                _pendingEmployeesVersion = ver;
                patch.dataVersion = ver;
                patch.employeesVersion = ver;
            } else {
                _localContentDirty = true;
                _pendingDataVersion = ver;
                patch.dataVersion = ver;
            }
            db.collection('config').doc('main').set(patch, { merge: true }).catch(function(err) {
                console.warn("[Firestore] bumpDataVersion warning:", err && err.message ? err.message : err);
            });
        } catch (e) {}
    }

    var SprinkleFirestore = {
        isAvailable: function() {
            return db !== null;
        },

        isDualSyncActive: function() {
            return isDualSyncEnabled;
        },

        setDualSync: function(enabled) {
            isDualSyncEnabled = !!enabled;
            console.log("📊 [Dual-Sync] Status changed to:", isDualSyncEnabled);
        },

        // 1. Smart Initial Data Load (Option 2.1: 1-Read dataVersion check + Option 2.2: Skip 513-doc employees collection)
        getInitialAppData: function(options) {
            if (!db) return Promise.reject(new Error("Firestore is not initialized"));
            var opts = (options && typeof options === 'object') ? options : {};
            var t0 = performance.now();

            // Step 1: Read ONLY config/main first (1 single Firestore Read!)
            return db.collection('config').doc('main').get().then(function(configDoc) {
                var config = (configDoc && configDoc.exists) ? configDoc.data() : {
                    system_status: 'เปิดใช้งาน',
                    notebooklm_url: '',
                    auto_answer_status: 'เปิดใช้งาน',
                    main_folder_order: '[]',
                    category_order: '{}'
                };

                var remoteDataVersion = String(_pendingDataVersion || config.dataVersion || 'v17_content_init');
                var remoteEmployeesVersion = String(_pendingEmployeesVersion || config.employeesVersion || 'v17_emp_init');
                var isDirty = _localContentDirty;
                _localContentDirty = false;
                _pendingDataVersion = null;

                // Cache Hit Check: If client already has valid content cache matching remote dataVersion -> 1 Read total!
                if (!opts.forceRefresh && !isDirty && opts.hasCachedContent && opts.cachedDataVersion && String(opts.cachedDataVersion) === remoteDataVersion) {
                    var hitElapsed = Math.round(performance.now() - t0);
                    console.log("⚡ [Firestore Cache-Hit] Verified dataVersion=" + remoteDataVersion + " in " + hitElapsed + " ms (1 Read only — saved ~1,007 Reads!)");
                    return {
                        success: true,
                        notModified: true,
                        config: config,
                        dataVersion: remoteDataVersion,
                        employeesVersion: remoteEmployeesVersion
                    };
                }

                // Step 2 (Cache Miss): Load ONLY content collections (NO full 513-doc employees scan!)
                var fetches = [
                    db.collection('knowledge').get(),
                    db.collection('announcements').get(),
                    db.collection('qa').get(),
                    db.collection('permissions').get()
                ];

                // Optionally refresh ONLY the logged-in user's own 1 document (1 Read instead of 513!)
                var hasSingleUser = !!(opts.currentUserId && String(opts.currentUserId).trim() !== "" && String(opts.currentUserId).trim() !== "admin999");
                if (hasSingleUser) {
                    fetches.push(
                        db.collection('employees').doc(String(opts.currentUserId).trim()).get().catch(function() { return null; })
                    );
                }

                return Promise.all(fetches).then(function(results) {
                    var knowledge = snapshotToArray(results[0]);
                    var announcements = snapshotToArray(results[1]);
                    var qa = snapshotToArray(results[2]);
                    var rawPerms = snapshotToArray(results[3]);
                    var userDoc = hasSingleUser ? results[4] : null;

                    var permissions = [];
                    var seenRoles = {};
                    for (var p = 0; p < rawPerms.length; p++) {
                        var item = rawPerms[p];
                        if (item.role === "ผู้ประกอบการ") item.role = "พี่สปริงเคิล";
                        if (!seenRoles[item.role]) {
                            seenRoles[item.role] = true;
                            permissions.push(item);
                        }
                    }

                    var currentUserRecord = null;
                    if (userDoc && userDoc.exists) {
                        currentUserRecord = normalizeEmployeeObj(Object.assign({}, userDoc.data()), userDoc.id);
                    }

                    var elapsed = Math.round(performance.now() - t0);
                    console.log("⚡ [Firestore] Content loaded in " + elapsed + " ms (Knowledge: " + knowledge.length + ", Announcements: " + announcements.length + ", QA: " + qa.length + ", Skipped full employees scan!)");

                    return {
                        success: true,
                        notModified: false,
                        knowledge: knowledge,
                        announcements: announcements,
                        qa: qa,
                        permissions: permissions,
                        config: config,
                        currentUserRecord: currentUserRecord,
                        dataVersion: remoteDataVersion,
                        employeesVersion: remoteEmployeesVersion
                    };
                });
            });
        },

        // 1.1 On-demand Lazy-Load for Employees (Admin/Manager tabs only, version-checked!)
        getEmployeesIfChanged: function(options) {
            if (!db) return Promise.reject(new Error("Firestore is not initialized"));
            var opts = (options && typeof options === 'object') ? options : {};
            var t0 = performance.now();

            var versionPromise = opts.knownRemoteVersion
                ? Promise.resolve(String(opts.knownRemoteVersion))
                : db.collection('config').doc('main').get().then(function(doc) {
                    var cfg = (doc && doc.exists) ? doc.data() : {};
                    return String(cfg.employeesVersion || 'v17_emp_init');
                });

            return versionPromise.then(function(remoteEmpVer) {
                var effectiveEmpVer = String(_pendingEmployeesVersion || remoteEmpVer);
                var isEmpDirty = _localEmployeesDirty;
                _localEmployeesDirty = false;
                _pendingEmployeesVersion = null;

                if (!opts.forceRefresh && !isEmpDirty && opts.hasCachedEmployees && opts.cachedEmployeesVersion && String(opts.cachedEmployeesVersion) === effectiveEmpVer) {
                    console.log("⚡ [Firestore Employees Cache-Hit] employeesVersion=" + effectiveEmpVer + " (0 extra Reads!)");
                    return {
                        success: true,
                        notModified: true,
                        employeesVersion: effectiveEmpVer
                    };
                }

                return db.collection('employees').get().then(function(snap) {
                    var employees = snapshotToArray(snap).map(function(emp) {
                        return normalizeEmployeeObj(emp, emp.id);
                    });
                    var elapsed = Math.round(performance.now() - t0);
                    console.log("⚡ [Firestore] Lazy-loaded " + employees.length + " employees in " + elapsed + " ms");
                    return {
                        success: true,
                        notModified: false,
                        employees: employees,
                        employeesVersion: effectiveEmpVer
                    };
                });
            });
        },

        // 1.2 Single Employee Profile Refresh (1 Read only)
        getSingleEmployee: function(empId) {
            if (!db) return Promise.reject(new Error("Firestore is not initialized"));
            var targetId = String(empId || "").trim();
            if (!targetId || targetId === "admin999") return Promise.resolve(null);
            return db.collection('employees').doc(targetId).get().then(function(doc) {
                if (!doc.exists) return null;
                return normalizeEmployeeObj(Object.assign({}, doc.data()), doc.id);
            });
        },

        // Read helpers for specific collections
        getKnowledgeData: function() {
            if (!db) return Promise.reject(new Error("Firestore is not initialized"));
            return db.collection('knowledge').get().then(snapshotToArray);
        },

        getAnnouncements: function() {
            if (!db) return Promise.reject(new Error("Firestore is not initialized"));
            return db.collection('announcements').get().then(snapshotToArray);
        },

        getQAData: function() {
            if (!db) return Promise.reject(new Error("Firestore is not initialized"));
            return db.collection('qa').get().then(snapshotToArray);
        },

        getAllEmployees: function() {
            if (!db) return Promise.reject(new Error("Firestore is not initialized"));
            return db.collection('employees').get().then(function(snap) {
                return snapshotToArray(snap).map(function(emp) {
                    if (emp && (emp.role === "ผู้ประกอบการ" || emp.role === "ผปก.")) {
                        emp.role = "พี่สปริงเคิล";
                    }
                    if (emp && emp.branch) {
                        emp.branch = normalizeBranch(emp.branch);
                    }
                    return emp;
                });
            });
        },

        getAllRolePermissions: function() {
            if (!db) return Promise.reject(new Error("Firestore is not initialized"));
            return db.collection('permissions').get().then(snapshotToArray);
        },

        getSystemConfig: function() {
            if (!db) return Promise.reject(new Error("Firestore is not initialized"));
            return db.collection('config').doc('main').get().then(function(doc) {
                return doc.exists ? doc.data() : {};
            });
        },

        // 2. Verify Employee & Login (⚡ Instant ~50ms verification)
        verifyEmployee: function(empId, password) {
            if (!db) return Promise.reject(new Error("Firestore is not initialized"));
            var targetId = String(empId || "").trim();
            var targetPassword = String(password !== undefined ? password : "").trim();

            if (!targetId) {
                return Promise.resolve({ success: false, message: "กรุณาระบุรหัสพนักงาน" });
            }

            // Special Admin Account
            if (targetId === "admin999") {
                if (targetPassword !== "admin999" && targetPassword !== "1111") {
                    return Promise.resolve({ success: false, message: "รหัสผ่านไม่ถูกต้อง" });
                }
                SprinkleFirestore.logLogin(targetId, "ผู้ดูแลระบบ", "แอดมิน", "");
                return Promise.resolve({
                    success: true,
                    name: "ผู้ดูแลระบบ",
                    role: "แอดมิน",
                    branch: "",
                    canEdit: true,
                    canToggle: true,
                    canAnswerQA: true,
                    profilePic: ""
                });
            }

            return db.collection('employees').doc(targetId).get().then(function(doc) {
                if (!doc.exists) {
                    return { success: false, message: "ไม่พบรหัสพนักงานนี้ในระบบ" };
                }

                var emp = doc.data() || {};
                var dbPassword = String(emp.password !== undefined && emp.password !== null && String(emp.password).trim() !== "" ? emp.password : "1234").trim();

                if (targetPassword !== dbPassword) {
                    return { success: false, message: "รหัสผ่านไม่ถูกต้องสำหรับรหัสพนักงานนี้" };
                }

                var approvalStatus = String(emp.approvalStatus || "อนุมัติแล้ว").trim();
                if (approvalStatus === "รออนุมัติ" || approvalStatus.toLowerCase() === "pending") {
                    return { success: false, isPending: true, message: "⏳ บัญชีของคุณอยู่ระหว่างรอแอดมินอนุมัติการเข้าใช้งาน กรุณารอการอนุมัติหรือติดต่อแอดมินครับ" };
                }
                if (approvalStatus === "ไม่อนุมัติ" || approvalStatus.toLowerCase() === "rejected") {
                    return { success: false, message: "❌ คำขอลงทะเบียนของคุณไม่ได้รับการอนุมัติ กรุณาติดต่อแอดมินครับ" };
                }

                var empName = emp.name || "คุณพนักงาน";
                var empRole = emp.role || "พนักงาน";
                if (empRole === "ผู้ประกอบการ" || empRole === "ผปก.") empRole = "พี่สปริงเคิล";
                var empBranch = normalizeBranch(emp.branch || "");
                var canAnswerQA = emp.canAnswerQA;

                // Lookup Role Permissions
                return db.collection('permissions').doc(encodeURIComponent(empRole)).get().then(function(pDoc) {
                    var perms = pDoc.exists ? pDoc.data() : { canEdit: false, canToggle: false };
                    var finalCanEdit = !!perms.canEdit;
                    var finalCanToggle = !!perms.canToggle;
                    var finalCanAnswerQA = (canAnswerQA !== undefined && canAnswerQA !== null) ? !!canAnswerQA : finalCanEdit;

                    // Log login event asynchronously
                    SprinkleFirestore.logLogin(targetId, empName, empRole, empBranch);

                    return {
                        success: true,
                        name: empName,
                        role: empRole,
                        branch: empBranch,
                        canEdit: finalCanEdit,
                        canToggle: finalCanToggle,
                        canAnswerQA: finalCanAnswerQA,
                        profilePic: emp.profilePic || ""
                    };
                });
            });
        },

        // 3. Log user login
        logLogin: function(empId, empName, role, branch) {
            if (!db) return Promise.resolve();
            try {
                return db.collection('loginLogs').add({
                    empId: String(empId || ""),
                    name: String(empName || ""),
                    role: String(role || ""),
                    branch: normalizeBranch(branch || ""),
                    timestamp: new Date().toISOString()
                }).catch(function(err) {
                    console.warn("logLogin warning:", err);
                });
            } catch (e) {
                return Promise.resolve();
            }
        },

        // 4. Record Topic View Log
        recordViewLog: function(topicId, empId) {
            if (!db) return Promise.resolve({ success: false });
            try {
                return db.collection('viewLogs').add({
                    topicId: String(topicId || ""),
                    empId: String(empId || ""),
                    timestamp: new Date().toISOString()
                }).then(function() {
                    return { success: true };
                }).catch(function(err) {
                    console.warn("recordViewLog warning:", err);
                    return { success: false, error: err.message };
                });
            } catch (e) {
                return Promise.resolve({ success: false });
            }
        },

        // 5. Announcements Management with Dual-Sync
        addAnnouncement: function() {
            if (!db) return Promise.reject(new Error("Firestore is not initialized"));
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

            var docId = String(annObj.id || ("ann_" + Date.now()));
            annObj.id = docId;
            annObj.displayOrder = (annObj.displayOrder !== undefined && !isNaN(annObj.displayOrder) && annObj.displayOrder > 0) ? Number(annObj.displayOrder) : 1;
            annObj.isPinned = !!annObj.isPinned;
            annObj.status = annObj.status || "เปิดใช้งาน";
            if (!annObj.date) {
                annObj.date = new Date().toISOString();
            }

            return db.collection('announcements').doc(docId).set(annObj).then(function() {
                bumpDataVersion('content');
                // Dual-Sync to Google Sheets with positional arguments as expected by Code.js
                syncToGoogleSheets('addAnnouncement', [
                    annObj.title,
                    annObj.content,
                    annObj.imageUrl,
                    annObj.createdBy,
                    annObj.linkUrl,
                    annObj.targetAudience,
                    annObj.autoCloseDate,
                    annObj.date,
                    annObj.displayOrder,
                    annObj.isPinned,
                    skipNotif
                ]);
                return "บันทึกประกาศข่าวสารเรียบร้อยแล้ว!";
            });
        },

        updateAnnouncement: function() {
            if (!db) return Promise.reject(new Error("Firestore is not initialized"));
            var annObj = {};
            var docId = "";
            if (arguments.length === 1 && typeof arguments[0] === 'object' && arguments[0] !== null) {
                annObj = Object.assign({}, arguments[0]);
                docId = String(annObj.id || "");
            } else {
                docId = String(arguments[0] || "");
                annObj = {
                    id: docId,
                    title: String(arguments[1] || "").trim(),
                    content: String(arguments[2] || "").trim(),
                    imageUrl: String(arguments[3] || "").trim(),
                    linkUrl: String(arguments[4] || "").trim(),
                    targetAudience: String(arguments[5] || "ทั้งหมด").trim(),
                    autoCloseDate: String(arguments[6] || "").trim(),
                    displayOrder: (arguments[8] !== undefined && arguments[8] !== "") ? Number(arguments[8]) : 1,
                    isPinned: !!arguments[9]
                };
                if (arguments[7]) {
                    annObj.date = String(arguments[7]).trim();
                }
            }
            if (!docId) return Promise.reject(new Error("Missing announcement id"));

            return db.collection('announcements').doc(docId).set(annObj, { merge: true }).then(function() {
                bumpDataVersion('content');
                syncToGoogleSheets('updateAnnouncement', [
                    docId,
                    annObj.title,
                    annObj.content,
                    annObj.imageUrl,
                    annObj.linkUrl,
                    annObj.targetAudience,
                    annObj.autoCloseDate,
                    annObj.date || "",
                    annObj.displayOrder,
                    annObj.isPinned
                ]);
                return "บันทึกการแก้ไขประกาศเรียบร้อยแล้ว!";
            });
        },

        deleteAnnouncement: function(id) {
            if (!db) return Promise.reject(new Error("Firestore is not initialized"));
            var docId = String(id || "");
            return db.collection('announcements').doc(docId).delete().then(function() {
                bumpDataVersion('content');
                syncToGoogleSheets('deleteAnnouncement', [docId]);
                return "ลบประกาศเรียบร้อยแล้ว!";
            });
        },

        toggleAnnouncementPin: function(id, explicitPin) {
            if (!db) return Promise.reject(new Error("Firestore is not initialized"));
            var docId = String(id || "");
            var ref = db.collection('announcements').doc(docId);
            return ref.get().then(function(doc) {
                if (!doc.exists) throw new Error("ไม่พบประกาศนี้");
                var nextPin = (explicitPin !== undefined && explicitPin !== null) ? !!explicitPin : !doc.data().isPinned;
                return ref.update({ isPinned: nextPin }).then(function() {
                    bumpDataVersion('content');
                    syncToGoogleSheets('toggleAnnouncementPin', [docId, nextPin]);
                    return { success: true, isPinned: nextPin };
                });
            });
        },

        toggleAnnouncementStatus: function(id, explicitStatus) {
            if (!db) return Promise.reject(new Error("Firestore is not initialized"));
            var docId = String(id || "");
            var ref = db.collection('announcements').doc(docId);
            return ref.get().then(function(doc) {
                if (!doc.exists) throw new Error("ไม่พบประกาศนี้");
                var current = doc.data().status || "เปิดใช้งาน";
                var next = explicitStatus || ((current === "เปิดใช้งาน") ? "ปิดใช้งาน" : "เปิดใช้งาน");
                return ref.update({ status: next }).then(function() {
                    bumpDataVersion('content');
                    syncToGoogleSheets('toggleAnnouncementStatus', [docId, next]);
                    return { success: true, status: next };
                });
            });
        },

        updateAnnouncementOrder: function(id, newOrder) {
            if (!db) return Promise.reject(new Error("Firestore is not initialized"));
            var docId = String(id || "");
            var orderNum = Number(newOrder);
            return db.collection('announcements').doc(docId).update({
                displayOrder: orderNum
            }).then(function() {
                bumpDataVersion('content');
                syncToGoogleSheets('updateAnnouncementOrder', [docId, orderNum]);
                return { success: true };
            });
        },

        reorderAnnouncements: function(reorderList) {
            if (!db) return Promise.reject(new Error("Firestore is not initialized"));
            if (!Array.isArray(reorderList) || reorderList.length === 0) {
                return Promise.resolve("บันทึกลำดับประกาศเรียบร้อยแล้ว!");
            }

            var batch = db.batch();
            for (var i = 0; i < reorderList.length; i++) {
                var item = reorderList[i];
                var itemId = "";
                var itemOrder = i + 1;
                if (typeof item === 'object' && item !== null) {
                    itemId = String(item.id || "");
                    itemOrder = Number(item.displayOrder !== undefined ? item.displayOrder : (item.order !== undefined ? item.order : (i + 1)));
                } else {
                    itemId = String(item || "");
                }
                if (itemId) {
                    var ref = db.collection('announcements').doc(itemId);
                    batch.update(ref, { displayOrder: itemOrder });
                }
            }
            return batch.commit().then(function() {
                bumpDataVersion('content');
                syncToGoogleSheets('reorderAnnouncements', [reorderList]);
                return "บันทึกลำดับประกาศเรียบร้อยแล้ว!";
            });
        },

        // 6. Knowledge Management with Dual-Sync
        addKnowledge: function(data) {
            if (!db) return Promise.reject(new Error("Firestore is not initialized"));
            var docId = String(data.id || ("k_" + Date.now()));
            data.id = docId;
            data.displayOrder = data.displayOrder !== undefined ? Number(data.displayOrder) : 999;
            data.isPinned = !!data.isPinned;
            data.status = data.status || "เปิดใช้งาน";

            return db.collection('knowledge').doc(docId).set(data).then(function() {
                bumpDataVersion('content');
                syncToGoogleSheets('addKnowledge', [data]);
                return { success: true, id: docId, message: "บันทึกเนื้อหาความรู้เรียบร้อยแล้ว" };
            });
        },

        updateKnowledge: function(data) {
            if (!db) return Promise.reject(new Error("Firestore is not initialized"));
            var docId = String(data.id || "");
            if (!docId) return Promise.reject(new Error("Missing knowledge id"));

            return db.collection('knowledge').doc(docId).set(data, { merge: true }).then(function() {
                bumpDataVersion('content');
                syncToGoogleSheets('updateKnowledge', [data]);
                return { success: true, message: "แก้ไขข้อมูลเรียบร้อยแล้ว" };
            });
        },

        deleteKnowledge: function(id) {
            if (!db) return Promise.reject(new Error("Firestore is not initialized"));
            var docId = String(id || "");
            return db.collection('knowledge').doc(docId).delete().then(function() {
                bumpDataVersion('content');
                syncToGoogleSheets('deleteKnowledge', [docId]);
                return { success: true, message: "ลบข้อมูลเรียบร้อยแล้ว" };
            });
        },

        toggleKnowledgePin: function(id) {
            if (!db) return Promise.reject(new Error("Firestore is not initialized"));
            var docId = String(id || "");
            var ref = db.collection('knowledge').doc(docId);
            return ref.get().then(function(doc) {
                if (!doc.exists) throw new Error("ไม่พบเนื้อหาความรู้นี้");
                var current = !!doc.data().isPinned;
                return ref.update({ isPinned: !current }).then(function() {
                    bumpDataVersion('content');
                    syncToGoogleSheets('toggleKnowledgePin', [docId]);
                    return { success: true, isPinned: !current };
                });
            });
        },

        saveKnowledgeFolderOrder: function(folderOrderArray) {
            if (!db) return Promise.reject(new Error("Firestore is not initialized"));
            var orderJson = Array.isArray(folderOrderArray) ? JSON.stringify(folderOrderArray) : String(folderOrderArray || "[]");
            return db.collection('config').doc('main').set({
                main_folder_order: orderJson,
                dataVersion: String(Date.now())
            }, { merge: true }).then(function() {
                syncToGoogleSheets('saveKnowledgeFolderOrder', [folderOrderArray]);
                return { success: true, message: "บันทึกลำดับโฟลเดอร์เรียบร้อยแล้ว" };
            });
        },

        updateKnowledgeOrdersBulk: function(ordersList) {
            if (!db) return Promise.reject(new Error("Firestore is not initialized"));
            if (!Array.isArray(ordersList) || ordersList.length === 0) {
                return Promise.resolve({ success: true });
            }

            var batch = db.batch();
            for (var i = 0; i < ordersList.length; i++) {
                var item = ordersList[i];
                if (item && item.id) {
                    var ref = db.collection('knowledge').doc(String(item.id));
                    batch.update(ref, { displayOrder: Number(item.displayOrder !== undefined ? item.displayOrder : item.order) });
                }
            }
            return batch.commit().then(function() {
                bumpDataVersion('content');
                syncToGoogleSheets('updateKnowledgeOrdersBulk', [ordersList]);
                return { success: true };
            });
        },

        updateKnowledgeOrderDirect: function(id, newOrder) {
            if (!db) return Promise.reject(new Error("Firestore is not initialized"));
            var docId = String(id || "");
            return db.collection('knowledge').doc(docId).update({
                displayOrder: Number(newOrder)
            }).then(function() {
                bumpDataVersion('content');
                syncToGoogleSheets('updateKnowledgeOrderDirect', [docId, Number(newOrder)]);
                return { success: true };
            });
        },

        // 7. Q&A Management with Dual-Sync
        submitQuestion: function(qData) {
            if (!db) return Promise.reject(new Error("Firestore is not initialized"));
            var qObj = {};
            if (typeof qData === 'object' && qData !== null) {
                qObj = Object.assign({}, qData);
            } else {
                qObj = {
                    category: String(arguments[0] || "").trim(),
                    question: String(arguments[1] || "").trim(),
                    askedBy: String(arguments[2] || "").trim(),
                    askedFileUrl: String(arguments[3] || "").trim()
                };
            }
            var docId = String(qObj.id || ("qa_" + Date.now()));
            qObj.id = docId;
            qObj.status = qObj.status || (qObj.answer ? "ตอบแล้ว" : "รอคำตอบ");
            qObj.askedTime = qObj.askedTime || new Date().toISOString();

            return db.collection('qa').doc(docId).set(qObj).then(function() {
                bumpDataVersion('content');
                if (qObj.status === "ตอบแล้ว" && qObj.answer) {
                    syncToGoogleSheets('addAndAnswerQuestion', [docId, qObj.category, qObj.question, qObj.askedBy, qObj.answer, qObj.answeredBy || "ระบบตอบอัตโนมัติ (AI Bot)", qObj.askedFileUrl || ""]);
                } else {
                    syncToGoogleSheets('addQuestion', [qObj.category, qObj.question, qObj.askedBy, qObj.askedFileUrl || ""]);
                }
                return (qObj.status === "ตอบแล้ว" || qObj.isAutoAnswer) ? "🤖 ระบบได้ตอบคำถามของคุณโดยอัตโนมัติเรียบร้อยแล้ว!" : "ส่งคำถามเรียบร้อยแล้ว!";
            });
        },

        submitAnswer: function(id, answer, answeredBy) {
            if (!db) return Promise.reject(new Error("Firestore is not initialized"));
            var docId = String(id || "");
            return db.collection('qa').doc(docId).update({
                answer: String(answer || ""),
                answeredBy: String(answeredBy || ""),
                answeredTime: new Date().toISOString(),
                status: "ตอบแล้ว"
            }).then(function() {
                bumpDataVersion('content');
                syncToGoogleSheets('answerQuestion', [docId, String(answer || ""), String(answeredBy || "")]);
                return { success: true, message: "บันทึกคำตอบเรียบร้อยแล้ว" };
            });
        },

        // 8. Employee Registration & Management with Dual-Sync
        checkRegisterEmpId: function(empId) {
            if (!db) return Promise.reject(new Error("Firestore is not initialized"));
            var targetId = String(empId || "").trim();
            return db.collection('employees').doc(targetId).get().then(function(doc) {
                if (doc.exists) {
                    var emp = doc.data();
                    return {
                        success: true,
                        found: true,
                        empId: emp.empId || doc.id,
                        name: emp.name || "",
                        role: emp.role || "",
                        branch: normalizeBranch(emp.branch || "")
                    };
                }
                return { success: true, found: false };
            });
        },

        getEmployeeInfoForRegistration: function(empId) {
            if (!db) return Promise.reject(new Error("Firestore is not initialized"));
            var targetId = String(empId || "").trim();
            if (!targetId) return Promise.resolve({ success: false, message: "กรุณาระบุรหัสเพื่อค้นหา" });

            return db.collection('employees').doc(targetId).get().then(function(doc) {
                if (doc.exists) {
                    var emp = doc.data() || {};
                    var name = emp.name || "คุณพนักงาน";
                    var role = emp.role || "พนักงาน";
                    if (role === "ผู้ประกอบการ" || role === "ผปก.") role = "พี่สปริงเคิล";
                    var branch = normalizeBranch(emp.branch || "");
                    var carNumber = emp.carNumber || "-";
                    var approvalStatus = emp.approvalStatus || "อนุมัติแล้ว";
                    var currentPwd = String(emp.password !== undefined && emp.password !== null ? emp.password : "").trim();
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
                return { success: false, notFound: true, message: "ไม่พบรหัส " + targetId + " ในฐานข้อมูลพนักงาน" };
            });
        },

        resetUserPassword: function(empId, newPassword) {
            if (!db) return Promise.reject(new Error("Firestore is not initialized"));
            var targetId = String(empId || "").trim();
            var newPwd = String(newPassword || "").trim();

            if (!targetId) return Promise.resolve({ success: false, message: "กรุณาระบุรหัสพนักงาน" });
            if (!newPwd || newPwd === "1234") return Promise.resolve({ success: false, message: "กรุณาระบุรหัสผ่านใหม่ (ไม่สามารถใช้ 1234 ได้)" });

            var ref = db.collection('employees').doc(targetId);
            return ref.get().then(function(doc) {
                if (!doc.exists) return { success: false, message: "ไม่พบรหัสพนักงานนี้ในระบบ" };
                return ref.update({
                    password: newPwd,
                    passwordUpdatedAt: new Date().toISOString()
                }).then(function() {
                    bumpDataVersion('employees');
                    syncToGoogleSheets('changeUserPassword', [targetId, newPwd]);
                    return { success: true, message: "ตั้งรหัสผ่านใหม่สำเร็จเรียบร้อยแล้ว!" };
                });
            });
        },

        resetEmployeePassword: function(empId) {
            if (!db) return Promise.reject(new Error("Firestore is not initialized"));
            var targetId = String(empId || "").trim();
            if (!targetId) return Promise.resolve({ success: false, message: "กรุณาระบุรหัสพนักงาน" });
            return db.collection('employees').doc(targetId).update({
                password: "1234",
                passwordUpdatedAt: new Date().toISOString()
            }).then(function() {
                bumpDataVersion('employees');
                syncToGoogleSheets('resetEmployeePassword', [targetId]);
                return { success: true, message: "รีเซ็ตรหัสผ่านของพนักงานรหัส " + targetId + " เป็น 1234 เรียบร้อยแล้ว!" };
            });
        },

        updateEmployeeProfilePicOnly: function(empId, profilePicUrl) {
            if (!db) return Promise.reject(new Error("Firestore is not initialized"));
            var targetId = String(empId || "").trim();
            var pPic = String(profilePicUrl || "").trim();
            if (!targetId) return Promise.resolve({ success: false, message: "ไม่พบรหัสพนักงาน" });
            return db.collection('employees').doc(targetId).set({
                profilePic: pPic
            }, { merge: true }).then(function() {
                bumpDataVersion('employees');
                syncToGoogleSheets('updateEmployeeProfilePicOnly', [targetId, pPic]);
                return { success: true, message: "อัปเดตรูปประจำตัวสำเร็จแล้ว!" };
            });
        },

        updateEmployee: function(empId, name, role, canAnswerQA, password, profilePic, branch, carNumber, approvalStatus) {
            if (!db) return Promise.reject(new Error("Firestore is not initialized"));
            var targetId = String(empId || "").trim();
            if (!targetId) return Promise.reject(new Error("Missing employee id"));
            var finalRole = String(role || "พนักงาน").trim();
            if (finalRole === "ผู้ประกอบการ" || finalRole === "ผปก.") finalRole = "พี่สปริงเคิล";
            var normalizedBranch = normalizeBranch(branch || "");
            var pwd = (password !== undefined && password !== null && String(password).trim() !== "") ? String(password).trim() : "1234";
            var pPic = (profilePic !== undefined && profilePic !== null) ? String(profilePic).trim() : "";
            var carNo = (carNumber !== undefined && carNumber !== null && String(carNumber).trim() !== "") ? String(carNumber).trim() : "-";
            var appStatus = (approvalStatus !== undefined && approvalStatus !== null && String(approvalStatus).trim() !== "") ? String(approvalStatus).trim() : "อนุมัติแล้ว";

            var empDoc = {
                empId: targetId,
                name: String(name || "").trim(),
                role: finalRole,
                canAnswerQA: !!canAnswerQA,
                password: pwd,
                profilePic: pPic,
                branch: normalizedBranch,
                carNumber: carNo,
                approvalStatus: appStatus
            };

            return db.collection('employees').doc(targetId).set(empDoc, { merge: true }).then(function() {
                bumpDataVersion('employees');
                syncToGoogleSheets('updateEmployee', [targetId, empDoc.name, finalRole, !!canAnswerQA, pwd, pPic, normalizedBranch, carNo, appStatus]);
                return "บันทึกข้อมูลพนักงานเรียบร้อยแล้ว!";
            });
        },

        registerEmployee: function(empId, password, profilePic, branch, carNumber) {
            if (!db) return Promise.reject(new Error("Firestore is not initialized"));
            var targetId = String(empId || "").trim();
            var normalizedBranch = normalizeBranch(branch || "");
            var ref = db.collection('employees').doc(targetId);

            return ref.set({
                password: String(password || "").trim(),
                profilePic: String(profilePic || ""),
                branch: normalizedBranch,
                carNumber: String(carNumber || "-"),
                approvalStatus: "อนุมัติแล้ว",
                registeredDate: new Date().toISOString()
            }, { merge: true }).then(function() {
                bumpDataVersion('employees');
                syncToGoogleSheets('registerEmployee', [targetId, password, profilePic, normalizedBranch, carNumber]);
                return { success: true, message: "ลงทะเบียนและเปิดใช้งานบัญชีสำเร็จ" };
            });
        },

        loadRegistrationRoles: function() {
            if (!db) return Promise.reject(new Error("Firestore is not initialized"));
            return db.collection('permissions').get().then(function(snap) {
                var roles = [];
                snap.forEach(function(doc) {
                    var data = doc.data() || {};
                    if (data.role) roles.push(data.role);
                });
                return roles;
            });
        },

        addNewMember: function(empData) {
            if (!db) return Promise.reject(new Error("Firestore is not initialized"));
            var docId = String(empData.empId || empData.id || "").trim();
            if (!docId) return Promise.reject(new Error("Missing employee id"));

            empData.empId = docId;
            if (empData.role === "ผู้ประกอบการ" || empData.role === "ผปก.") empData.role = "พี่สปริงเคิล";
            if (empData.branch) empData.branch = normalizeBranch(empData.branch);
            empData.approvalStatus = empData.approvalStatus || "รออนุมัติ";
            empData.registeredDate = empData.registeredDate || new Date().toISOString();

            return db.collection('employees').doc(docId).set(empData).then(function() {
                bumpDataVersion('employees');
                syncToGoogleSheets('registerNewMember', [empData]);
                return { success: true, message: "เพิ่มข้อมูลสมาชิกเรียบร้อยแล้ว" };
            });
        },

        updateMemberStatus: function(empId, status) {
            if (!db) return Promise.reject(new Error("Firestore is not initialized"));
            var docId = String(empId || "").trim();
            return db.collection('employees').doc(docId).update({
                approvalStatus: String(status || "อนุมัติแล้ว")
            }).then(function() {
                bumpDataVersion('employees');
                if (status === "อนุมัติแล้ว") {
                    syncToGoogleSheets('approveEmployee', [docId]);
                } else if (status === "ไม่อนุมัติ") {
                    syncToGoogleSheets('rejectEmployee', [docId]);
                }
                return { success: true, message: "อัปเดตสถานะเรียบร้อยแล้ว" };
            });
        },

        updateMemberRole: function(empId, role) {
            if (!db) return Promise.reject(new Error("Firestore is not initialized"));
            var docId = String(empId || "").trim();
            var finalRole = String(role || "พนักงาน");
            if (finalRole === "ผู้ประกอบการ" || finalRole === "ผปก.") finalRole = "พี่สปริงเคิล";
            return db.collection('employees').doc(docId).update({
                role: finalRole
            }).then(function() {
                bumpDataVersion('employees');
                syncToGoogleSheets('updateEmployee', [{ empId: docId, role: finalRole }]);
                return { success: true, message: "อัปเดตตำแหน่งงานเรียบร้อยแล้ว" };
            });
        },

        deleteMember: function(empId) {
            if (!db) return Promise.reject(new Error("Firestore is not initialized"));
            var docId = String(empId || "").trim();
            return db.collection('employees').doc(docId).delete().then(function() {
                bumpDataVersion('employees');
                syncToGoogleSheets('deleteEmployee', [docId]);
                return { success: true, message: "ลบสมาชิกเรียบร้อยแล้ว" };
            });
        },

        // 9. System Config & Permissions with Dual-Sync
        saveSystemConfig: function(systemStatus, notebooklmUrl, autoAnswerStatus) {
            if (!db) return Promise.reject(new Error("Firestore is not initialized"));
            var configObj = {};
            if (typeof systemStatus === 'object' && systemStatus !== null) {
                configObj = Object.assign({}, systemStatus);
            } else {
                if (systemStatus !== undefined) configObj.system_status = systemStatus;
                if (notebooklmUrl !== undefined) configObj.notebooklm_url = notebooklmUrl;
                if (autoAnswerStatus !== undefined) configObj.auto_answer_status = autoAnswerStatus;
            }
            configObj.dataVersion = String(Date.now());
            return db.collection('config').doc('main').set(configObj, { merge: true }).then(function() {
                syncToGoogleSheets('saveSystemConfig', [systemStatus, notebooklmUrl, autoAnswerStatus]);
                return "บันทึกการตั้งค่าระบบหลักเรียบร้อยแล้ว";
            });
        },

        saveRolePermissions: function(role, canEdit, canToggle) {
            if (!db) return Promise.reject(new Error("Firestore is not initialized"));
            if (Array.isArray(role)) {
                // Bulk array of permissions
                var batch = db.batch();
                for (var i = 0; i < role.length; i++) {
                    var perm = role[i];
                    if (perm && perm.role) {
                        var ref = db.collection('permissions').doc(encodeURIComponent(perm.role));
                        batch.set(ref, perm, { merge: true });
                    }
                }
                return batch.commit().then(function() {
                    bumpDataVersion('content');
                    syncToGoogleSheets('saveRolePermissions', [role]);
                    return "บันทึกสิทธิ์ตำแหน่งงานเรียบร้อยแล้ว";
                });
            }

            // Single role signature: (role, canEdit, canToggle)
            var roleStr = String(role || "").trim();
            var roleRef = db.collection('permissions').doc(encodeURIComponent(roleStr));
            return roleRef.set({
                role: roleStr,
                canEdit: !!canEdit,
                canToggle: !!canToggle
            }, { merge: true }).then(function() {
                bumpDataVersion('content');
                syncToGoogleSheets('saveRolePermissions', [roleStr, !!canEdit, !!canToggle]);
                return "บันทึกสิทธิ์ตำแหน่งงานเรียบร้อยแล้ว";
            });
        },

        // 10. Push Tokens Management with Dual-Sync
        registerPushToken: function(token, empId, deviceInfo) {
            if (!db) return Promise.resolve({ success: false });
            var tok = String(token || "").trim();
            if (!tok) return Promise.resolve({ success: false });

            var docId = encodeURIComponent(tok.slice(0, 100));
            return db.collection('pushTokens').doc(docId).set({
                token: tok,
                empId: String(empId || ""),
                deviceInfo: String(deviceInfo || ""),
                status: "active",
                updatedAt: new Date().toISOString()
            }, { merge: true }).then(function() {
                syncToGoogleSheets('registerPushToken', [tok, String(empId || ""), String(deviceInfo || "")]);
                return { success: true };
            }).catch(function(err) {
                console.warn("registerPushToken warning:", err);
                return { success: false, error: err.message };
            });
        },

        removePushToken: function(token) {
            if (!db) return Promise.resolve({ success: false });
            var tok = String(token || "").trim();
            if (!tok) return Promise.resolve({ success: false });

            var docId = encodeURIComponent(tok.slice(0, 100));
            return db.collection('pushTokens').doc(docId).delete().then(function() {
                syncToGoogleSheets('removePushToken', [tok]);
                return { success: true };
            }).catch(function() {
                return { success: false };
            });
        },

        getAudienceEstimate: function(audience, branch) {
            if (!db) return Promise.reject(new Error("Firestore is not initialized"));
            return db.collection('pushTokens').where('status', '==', 'active').get().then(function(snap) {
                var count = snap.size;
                return {
                    success: true,
                    count: count,
                    matchedCount: count
                };
            }).catch(function() {
                return { success: true, count: 0, matchedCount: 0 };
            });
        },

        getRegisteredPushTokens: function() {
            function fallbackGAS() {
                if (!GAS_API_URL) return Promise.resolve({ success: false, rows: [], data: [] });
                return fetch(GAS_API_URL, {
                    method: 'POST',
                    mode: 'cors',
                    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                    body: JSON.stringify({ functionName: 'getRegisteredPushTokens', arguments: [] })
                }).then(function(res) {
                    return res.json();
                }).then(function(resData) {
                    if (resData && (resData.rows || resData.data)) {
                        return {
                            success: true,
                            count: (resData.rows || resData.data).length,
                            rows: resData.rows || resData.data,
                            data: resData.rows || resData.data
                        };
                    }
                    if (Array.isArray(resData)) {
                        return { success: true, count: resData.length, rows: resData, data: resData };
                    }
                    return { success: true, count: 0, rows: [], data: [] };
                }).catch(function(err) {
                    console.warn("[Adapter] getRegisteredPushTokens fallback error:", err);
                    return { success: false, rows: [], data: [], error: err.message };
                });
            }

            if (!db) return fallbackGAS();

            return db.collection('pushTokens').get().then(function(snap) {
                if (snap.empty) {
                    return fallbackGAS();
                }
                var list = [];
                snap.forEach(function(doc) {
                    var d = doc.data() || {};
                    list.push({
                        empId: d.empId || "-",
                        name: d.name || "-",
                        role: d.role || "-",
                        branch: normalizeBranch(d.branch || "-") || "-",
                        carNumber: d.carNumber || "-",
                        device: d.deviceInfo || d.device || "-",
                        token: d.token || doc.id,
                        lastUpdated: d.updatedAt || "-",
                        status: d.status === "active" ? "เปิดใช้งาน" : (d.status || "เปิดใช้งาน")
                    });
                });
                return {
                    success: true,
                    count: list.length,
                    rows: list,
                    data: list
                };
            }).catch(function() {
                return fallbackGAS();
            });
        },

        // 11. Manual Bidirectional Sync from Google Sheets to Firestore
        syncFromGoogleSheets: function() {
            if (!GAS_API_URL) return Promise.reject(new Error("Missing GAS API URL"));
            if (typeof showLoading === 'function') showLoading("กำลังดึงข้อมูลล่าสุดจาก Google Sheets...");

            return fetch(GAS_API_URL, {
                method: 'POST',
                mode: 'cors',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify({ functionName: 'getInitialAppData', arguments: [] })
            })
            .then(function(res) { return res.json(); })
            .then(function(resData) {
                if (!resData || !resData.success || !resData.result) {
                    throw new Error(resData && resData.error ? resData.error : "Failed to fetch from Google Sheets");
                }
                var fresh = resData.result;
                
                // Batch update Firestore collections
                var batchPromises = [];
                if (fresh.config) {
                    batchPromises.push(db.collection('config').doc('main').set(fresh.config, { merge: true }));
                }

                return Promise.all(batchPromises).then(function() {
                    try {
                        localStorage.removeItem('sprinkle_cached_app_data');
                        localStorage.removeItem('sprinkle_cached_app_data_v1');
                        localStorage.removeItem('sprinkle_cached_app_data_v2');
                        localStorage.removeItem('sprinkle_cached_app_data_v3');
                        localStorage.removeItem('sprinkle_cached_app_data_v4');
                    } catch(e) {}
                    if (typeof applyInitialData === 'function') {
                        applyInitialData(fresh);
                    }
                    if (typeof hideLoading === 'function') hideLoading();
                    return { success: true, message: "ซิงค์ข้อมูลจาก Google Sheets เข้าสู่ระบบเรียบร้อยแล้ว!" };
                });
            })
            .catch(function(err) {
                if (typeof hideLoading === 'function') hideLoading();
                throw err;
            });
        }
    };

    // Aliases to mirror Code.js naming conventions
    SprinkleFirestore.deleteEmployee = SprinkleFirestore.deleteMember;
    SprinkleFirestore.addQuestion = SprinkleFirestore.submitQuestion;
    SprinkleFirestore.answerQuestion = SprinkleFirestore.submitAnswer;
    SprinkleFirestore.deactivatePushToken = SprinkleFirestore.removePushToken;
    SprinkleFirestore.registerNewMember = SprinkleFirestore.addNewMember;
    SprinkleFirestore.approveEmployee = function(empId) {
        return SprinkleFirestore.updateMemberStatus(empId, "อนุมัติแล้ว");
    };
    SprinkleFirestore.rejectEmployee = function(empId) {
        return SprinkleFirestore.updateMemberStatus(empId, "ไม่อนุมัติ");
    };
    SprinkleFirestore.changeUserPassword = SprinkleFirestore.resetUserPassword;
    SprinkleFirestore.changePassword = SprinkleFirestore.resetUserPassword;

    // Export to global namespace
    window.SprinkleFirestore = SprinkleFirestore;

})(typeof window !== 'undefined' ? window : this);
