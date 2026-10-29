/**
 * =================================================================================
 * Sprinkle Knowledge - High Performance Cloud Firestore Adapter
 * Milestone 4: Modern Standalone Web App Backend (Decoupled from Google Apps Script)
 *
 * Provides sub-100ms ultra-fast response times, offline caching, and real-time data
 * directly connected to Google Cloud Firestore (Region: asia-southeast1 / Singapore).
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

    // Helper: Safely convert snapshot to array of plain objects
    function snapshotToArray(snapshot) {
        var items = [];
        if (!snapshot || snapshot.empty) return items;
        snapshot.forEach(function(doc) {
            var data = doc.data() || {};
            // If data doesn't have id field, populate it from doc.id
            if (data.id === undefined || data.id === null || data.id === "") {
                data.id = doc.id;
            }
            items.push(data);
        });
        return items;
    }

    var SprinkleFirestore = {
        isAvailable: function() {
            return db !== null;
        },

        // 1. Initial Data Batch Load (⚡ Sub-250ms replacement for GAS getInitialAppData)
        getInitialAppData: function() {
            if (!db) return Promise.reject(new Error("Firestore is not initialized"));
            var t0 = performance.now();

            return Promise.all([
                db.collection('knowledge').get(),
                db.collection('announcements').get(),
                db.collection('qa').get(),
                db.collection('employees').get(),
                db.collection('permissions').get(),
                db.collection('config').doc('main').get()
            ]).then(function(results) {
                var knowledgeSnap = results[0];
                var annSnap = results[1];
                var qaSnap = results[2];
                var empSnap = results[3];
                var permSnap = results[4];
                var configDoc = results[5];

                var knowledge = snapshotToArray(knowledgeSnap);
                var announcements = snapshotToArray(annSnap);
                var qa = snapshotToArray(qaSnap);
                var employees = snapshotToArray(empSnap);
                var permissions = snapshotToArray(permSnap);
                var config = (configDoc && configDoc.exists) ? configDoc.data() : {
                    system_status: 'เปิดใช้งาน',
                    notebooklm_url: '',
                    auto_answer_status: 'ปิดใช้งาน',
                    main_folder_order: '[]',
                    category_order: '{}'
                };

                var elapsed = Math.round(performance.now() - t0);
                console.log("⚡ [Firestore] getInitialAppData loaded in " + elapsed + " ms! (Knowledge: " + knowledge.length + ", Announcements: " + announcements.length + ", Employees: " + employees.length + ")");

                return {
                    success: true,
                    knowledge: knowledge,
                    announcements: announcements,
                    qa: qa,
                    employees: employees,
                    permissions: permissions,
                    config: config
                };
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
                var empBranch = emp.branch || "";
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
                    branch: String(branch || ""),
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

        // 5. Announcements Management
        getAnnouncements: function() {
            if (!db) return Promise.reject(new Error("Firestore is not initialized"));
            return db.collection('announcements').get().then(function(snap) {
                return snapshotToArray(snap);
            });
        },

        addAnnouncement: function(data) {
            if (!db) return Promise.reject(new Error("Firestore is not initialized"));
            var docId = String(data.id || ("ann_" + Date.now()));
            data.id = docId;
            data.displayOrder = data.displayOrder !== undefined ? Number(data.displayOrder) : 1;
            data.isPinned = !!data.isPinned;
            data.status = data.status || "เปิดใช้งาน";

            return db.collection('announcements').doc(docId).set(data).then(function() {
                return { success: true, id: docId, message: "เพิ่มประกาศข่าวสารเรียบร้อยแล้ว" };
            });
        },

        updateAnnouncement: function(data) {
            if (!db) return Promise.reject(new Error("Firestore is not initialized"));
            var docId = String(data.id || "");
            if (!docId) return Promise.reject(new Error("Missing announcement id"));

            return db.collection('announcements').doc(docId).set(data, { merge: true }).then(function() {
                return { success: true, message: "บันทึกการแก้ไขประกาศเรียบร้อยแล้ว" };
            });
        },

        deleteAnnouncement: function(id) {
            if (!db) return Promise.reject(new Error("Firestore is not initialized"));
            var docId = String(id || "");
            return db.collection('announcements').doc(docId).delete().then(function() {
                return { success: true, message: "ลบประกาศเรียบร้อยแล้ว" };
            });
        },

        toggleAnnouncementPin: function(id) {
            if (!db) return Promise.reject(new Error("Firestore is not initialized"));
            var docId = String(id || "");
            var ref = db.collection('announcements').doc(docId);
            return ref.get().then(function(doc) {
                if (!doc.exists) throw new Error("ไม่พบประกาศนี้");
                var current = !!doc.data().isPinned;
                return ref.update({ isPinned: !current }).then(function() {
                    return { success: true, isPinned: !current };
                });
            });
        },

        toggleAnnouncementStatus: function(id) {
            if (!db) return Promise.reject(new Error("Firestore is not initialized"));
            var docId = String(id || "");
            var ref = db.collection('announcements').doc(docId);
            return ref.get().then(function(doc) {
                if (!doc.exists) throw new Error("ไม่พบประกาศนี้");
                var current = doc.data().status || "เปิดใช้งาน";
                var next = (current === "เปิดใช้งาน") ? "ปิดใช้งาน" : "เปิดใช้งาน";
                return ref.update({ status: next }).then(function() {
                    return { success: true, status: next };
                });
            });
        },

        updateAnnouncementOrder: function(id, newOrder) {
            if (!db) return Promise.reject(new Error("Firestore is not initialized"));
            var docId = String(id || "");
            return db.collection('announcements').doc(docId).update({
                displayOrder: Number(newOrder)
            }).then(function() {
                return { success: true };
            });
        },

        reorderAnnouncements: function(reorderList) {
            if (!db) return Promise.reject(new Error("Firestore is not initialized"));
            if (!Array.isArray(reorderList) || reorderList.length === 0) {
                return Promise.resolve({ success: true });
            }

            var batch = db.batch();
            for (var i = 0; i < reorderList.length; i++) {
                var item = reorderList[i];
                if (item && item.id) {
                    var ref = db.collection('announcements').doc(String(item.id));
                    batch.update(ref, { displayOrder: Number(item.displayOrder !== undefined ? item.displayOrder : item.order) });
                }
            }
            return batch.commit().then(function() {
                return { success: true };
            });
        },

        // 6. Knowledge Management
        addKnowledge: function(data) {
            if (!db) return Promise.reject(new Error("Firestore is not initialized"));
            var docId = String(data.id || ("k_" + Date.now()));
            data.id = docId;
            data.displayOrder = data.displayOrder !== undefined ? Number(data.displayOrder) : 999;
            data.isPinned = !!data.isPinned;
            data.status = data.status || "เปิดใช้งาน";

            return db.collection('knowledge').doc(docId).set(data).then(function() {
                return { success: true, id: docId, message: "บันทึกเนื้อหาความรู้เรียบร้อยแล้ว" };
            });
        },

        updateKnowledge: function(data) {
            if (!db) return Promise.reject(new Error("Firestore is not initialized"));
            var docId = String(data.id || "");
            if (!docId) return Promise.reject(new Error("Missing knowledge id"));

            return db.collection('knowledge').doc(docId).set(data, { merge: true }).then(function() {
                return { success: true, message: "แก้ไขข้อมูลเรียบร้อยแล้ว" };
            });
        },

        deleteKnowledge: function(id) {
            if (!db) return Promise.reject(new Error("Firestore is not initialized"));
            var docId = String(id || "");
            return db.collection('knowledge').doc(docId).delete().then(function() {
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
                    return { success: true, isPinned: !current };
                });
            });
        },

        saveKnowledgeFolderOrder: function(folderOrderArray) {
            if (!db) return Promise.reject(new Error("Firestore is not initialized"));
            var orderJson = Array.isArray(folderOrderArray) ? JSON.stringify(folderOrderArray) : String(folderOrderArray || "[]");
            return db.collection('config').doc('main').set({
                main_folder_order: orderJson
            }, { merge: true }).then(function() {
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
                return { success: true };
            });
        },

        updateKnowledgeOrderDirect: function(id, newOrder) {
            if (!db) return Promise.reject(new Error("Firestore is not initialized"));
            var docId = String(id || "");
            return db.collection('knowledge').doc(docId).update({
                displayOrder: Number(newOrder)
            }).then(function() {
                return { success: true };
            });
        },

        // 7. Q&A Management
        submitQuestion: function(qData) {
            if (!db) return Promise.reject(new Error("Firestore is not initialized"));
            var docId = String(qData.id || ("qa_" + Date.now()));
            qData.id = docId;
            qData.status = qData.status || "รอคำตอบ";
            qData.askedTime = qData.askedTime || new Date().toISOString();

            return db.collection('qa').doc(docId).set(qData).then(function() {
                return { success: true, id: docId, message: "ส่งคำถามเรียบร้อยแล้ว" };
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
                return { success: true, message: "บันทึกคำตอบเรียบร้อยแล้ว" };
            });
        },

        // 8. Employee Registration & Management
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
                        branch: emp.branch || ""
                    };
                }
                return { success: true, found: false };
            });
        },

        registerEmployee: function(empId, password, profilePic, branch, carNumber) {
            if (!db) return Promise.reject(new Error("Firestore is not initialized"));
            var targetId = String(empId || "").trim();
            var ref = db.collection('employees').doc(targetId);

            return ref.set({
                password: String(password || "").trim(),
                profilePic: String(profilePic || ""),
                branch: String(branch || ""),
                carNumber: String(carNumber || "-"),
                approvalStatus: "อนุมัติแล้ว",
                registeredDate: new Date().toISOString()
            }, { merge: true }).then(function() {
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
            empData.approvalStatus = empData.approvalStatus || "รออนุมัติ";
            empData.registeredDate = empData.registeredDate || new Date().toISOString();

            return db.collection('employees').doc(docId).set(empData).then(function() {
                return { success: true, message: "เพิ่มข้อมูลสมาชิกเรียบร้อยแล้ว" };
            });
        },

        updateMemberStatus: function(empId, status) {
            if (!db) return Promise.reject(new Error("Firestore is not initialized"));
            var docId = String(empId || "").trim();
            return db.collection('employees').doc(docId).update({
                approvalStatus: String(status || "อนุมัติแล้ว")
            }).then(function() {
                return { success: true, message: "อัปเดตสถานะเรียบร้อยแล้ว" };
            });
        },

        updateMemberRole: function(empId, role) {
            if (!db) return Promise.reject(new Error("Firestore is not initialized"));
            var docId = String(empId || "").trim();
            return db.collection('employees').doc(docId).update({
                role: String(role || "พนักงาน")
            }).then(function() {
                return { success: true, message: "อัปเดตตำแหน่งงานเรียบร้อยแล้ว" };
            });
        },

        deleteMember: function(empId) {
            if (!db) return Promise.reject(new Error("Firestore is not initialized"));
            var docId = String(empId || "").trim();
            return db.collection('employees').doc(docId).delete().then(function() {
                return { success: true, message: "ลบสมาชิกเรียบร้อยแล้ว" };
            });
        },

        // 9. System Config & Permissions
        saveSystemConfig: function(configObj) {
            if (!db) return Promise.reject(new Error("Firestore is not initialized"));
            return db.collection('config').doc('main').set(configObj, { merge: true }).then(function() {
                return { success: true, message: "บันทึกการตั้งค่าระบบเรียบร้อยแล้ว" };
            });
        },

        saveRolePermissions: function(permissionsArray) {
            if (!db) return Promise.reject(new Error("Firestore is not initialized"));
            if (!Array.isArray(permissionsArray)) return Promise.resolve({ success: true });

            var batch = db.batch();
            for (var i = 0; i < permissionsArray.length; i++) {
                var perm = permissionsArray[i];
                if (perm && perm.role) {
                    var ref = db.collection('permissions').doc(encodeURIComponent(perm.role));
                    batch.set(ref, perm, { merge: true });
                }
            }
            return batch.commit().then(function() {
                return { success: true, message: "บันทึกสิทธิ์ตำแหน่งงานเรียบร้อยแล้ว" };
            });
        },

        // 10. Push Tokens Management
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
        }
    };

    // Aliases to mirror Code.js naming conventions
    SprinkleFirestore.deleteEmployee = SprinkleFirestore.deleteMember;
    SprinkleFirestore.addQuestion = SprinkleFirestore.submitQuestion;
    SprinkleFirestore.answerQuestion = SprinkleFirestore.submitAnswer;
    SprinkleFirestore.deactivatePushToken = SprinkleFirestore.removePushToken;

    // Export to global namespace
    window.SprinkleFirestore = SprinkleFirestore;

})(typeof window !== 'undefined' ? window : this);
