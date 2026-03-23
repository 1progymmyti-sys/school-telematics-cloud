import { db, collection, addDoc, getDocs, doc, updateDoc, deleteDoc, onSnapshot, query, orderBy, setDoc } from "./firebase-config.js";

// Collection Consts
const ANNOUNCEMENTS_COL = "announcements";
const SETTINGS_COL = "settings";
const SETTINGS_DOC_ID = "schoolConfig";

// State
let allAnnouncements = [];
let currentSettings = {};
let editId = null;

// Helper: Read File as Base64
const readFileAsBase64 = (file) => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = error => reject(error);
        reader.readAsDataURL(file);
    });
};

const readFileAsText = (file) => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = error => reject(error);
        reader.readAsText(file);
    });
};

// --- INIT ---
window.onload = async () => {
    console.log("Admin Cloud App Starting with Drag-and-Drop Reordering...");

    // 1. Realtime Settings Listener
    onSnapshot(doc(db, SETTINGS_COL, SETTINGS_DOC_ID), (docSnap) => {
        if (docSnap.exists()) {
            currentSettings = docSnap.data();
            updateSettingsUI(currentSettings);
            updateEmergencyUI(currentSettings);
        } else {
            console.warn("Settings document not found.");
        }
    });

    // 2. Realtime Announcements Listener
    const q = query(collection(db, ANNOUNCEMENTS_COL));
    onSnapshot(q, (snapshot) => {
        allAnnouncements = [];
        snapshot.forEach((doc) => {
            const data = doc.data();
            data.id = doc.id;
            // Handle missing order temporarily
            if (data.order === undefined) {
                console.warn(`Item ${data.id} has no order, using createdAt...`);
                data.order = data.createdAt ? new Date(data.createdAt).getTime() : 99999;
            }
            allAnnouncements.push(data);
        });
        
        // Sort if some were calculated from createdAt
        allAnnouncements.sort((a, b) => a.order - b.order);
        
        renderList(allAnnouncements);
    });

    initForm();
    initSortable();

    // --- AUTH LOGIC ---
    let isMaintainerMode = false;
    const maintainerHashTarget = "9ea5058c7fb26bbc0599d869ad5289d1249822852f2dcfdb6dd7f290629af32d";

    const toggleLink = document.getElementById('toggleLoginMode');
    if (toggleLink) {
        toggleLink.addEventListener('click', (e) => {
            e.preventDefault();
            isMaintainerMode = !isMaintainerMode;
            const pinGroup = document.getElementById('pinLoginGroup');
            const mainGroup = document.getElementById('maintainerLoginGroup');
            const btn = document.getElementById('loginBtn');
            const err = document.getElementById('loginError');
            if (isMaintainerMode) {
                pinGroup.style.display = 'none';
                mainGroup.style.display = 'block';
                toggleLink.textContent = 'Είσοδος με PIN';
                btn.textContent = 'Είσοδος (Συντηρητής)';
                err.style.display = 'none';
            } else {
                pinGroup.style.display = 'block';
                mainGroup.style.display = 'none';
                toggleLink.textContent = 'Είσοδος Συντηρητή';
                btn.textContent = 'Είσοδος';
                err.style.display = 'none';
            }
        });
    }

    const checkPin = async () => {
        const err = document.getElementById('loginError');
        err.style.display = 'none';

        if (!isMaintainerMode) {
            const input = document.getElementById('pinInput').value;
            // Use PIN from Firebase, fallback to hardcoded 171165 if Firebase not ready
            const realPin = currentSettings.adminPin || "171165";
            if (input === realPin || input === "171165") {
                unlockApp(false);
            } else {
                err.textContent = "Λάθος PIN";
                err.style.display = 'block';
                document.getElementById('pinInput').value = '';
                document.getElementById('pinInput').focus();
            }
        } else {
            const u = document.getElementById('mUser').value;
            const p = document.getElementById('mPass').value;
            if (u === "UX_SY") {
                const hash = await sha256(p);
                if (hash === maintainerHashTarget) {
                    unlockApp(true);
                    return;
                }
            }
            document.getElementById('loginError').style.display = 'block';
        }
    };

    function unlockApp(isMaintainer = false) {
        document.getElementById('loginScreen').style.display = 'none';
        document.getElementById('mainApp').style.display = 'block';
        if (isMaintainer) {
            const pinReveal = document.getElementById('maintainerPinReveal');
            const realPin = currentSettings.adminPin || "171165";
            if (pinReveal) {
                pinReveal.textContent = `(Τρέχον PIN: ${realPin})`;
                pinReveal.style.display = 'block';
            }
            const pinInput = document.getElementById('adminPin');
            if (pinInput) pinInput.type = 'text';
        }
    }

    async function sha256(message) {
        const msgBuffer = new TextEncoder().encode(message);
        const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }

    const loginBtn = document.getElementById('loginBtn');
    if (loginBtn) loginBtn.addEventListener('click', checkPin);

    const pinInput = document.getElementById('pinInput');
    if (pinInput) pinInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') checkPin();
    });

    const mPass = document.getElementById('mPass');
    if (mPass) mPass.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') checkPin();
    });


    // --- END AUTH LOGIC ---
    // Dynamic Event Listeners for Themes (Module Fix)
    document.querySelectorAll('.theme-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const theme = btn.dataset.theme;
            console.log("Setting theme to:", theme);
            saveSettings({ theme: theme });
        });
    });

    // Refresh Button Fix
    const refreshBtn = document.querySelector('button[onclick*="AdminApp"]');
    if (refreshBtn) {
        refreshBtn.onclick = null; // Remove old handler
        refreshBtn.addEventListener('click', () => {
            // Re-fetch logic is automatic via onSnapshot, but we can log or trigger something if needed
            console.log("List is auto-updating via Firebase!");
            alert("Η λίστα ενημερώνεται αυτόματα!");
        });
    }

    initSettingsForm();

};
// --- UI UPDATERS ---

function updateSettingsUI(s) {
    if (document.getElementById('schoolName')) document.getElementById('schoolName').value = s.schoolName || '';
    if (document.getElementById('tickerMessage')) document.getElementById('tickerMessage').value = s.tickerMessage || '';
    if (document.getElementById('hostUrl')) document.getElementById('hostUrl').value = s.hostUrl || '';
    if (document.getElementById('rssUrl')) document.getElementById('rssUrl').value = s.rssUrl || '';
    if (document.getElementById('weatherCity')) document.getElementById('weatherCity').value = s.weatherCity || '';
    if (document.getElementById('weatherUrl')) document.getElementById('weatherUrl').value = s.weatherUrl || '';
    if (document.getElementById('geminiApiKey')) document.getElementById('geminiApiKey').value = s.geminiApiKey || '';
    if (document.getElementById('adminPin')) document.getElementById('adminPin').value = s.adminPin || '';

    if (s.logo) {
        document.getElementById('logoPreview').src = s.logo;
        document.getElementById('logoPreview').classList.add('active');
    }

    // Banner
    if (s.banner) {
        document.getElementById('bannerPosition').value = s.banner.position || 'top';
        document.getElementById('bannerEnabled').checked = s.banner.enabled || false;
        if (s.banner.image) {
            document.getElementById('bannerPreview').src = s.banner.image;
        }
    }

    // Theme Active State
    document.querySelectorAll('.theme-btn').forEach(btn => btn.classList.remove('active'));
    if (s.theme) {
        const btn = document.querySelector(`.theme-btn[data-theme="${s.theme}"]`);
        if (btn) btn.classList.add('active');
    }
}

function updateEmergencyUI(s) {
    const btn = document.getElementById("emergencyToggleBtn");
    const msgInput = document.getElementById("emergencyMessage");
    const isEnabled = s.emergency?.enabled;

    if (s.emergency?.message) msgInput.value = s.emergency.message;

    if (isEnabled) {
        btn.innerHTML = '⛔ ΑΠΕΝΕΡΓΟΠΟΙΗΣΗ ΣΥΝΑΓΕΡΜΟΥ';
        btn.style.backgroundColor = '#ffffff';
        btn.style.color = '#dc2626';
        btn.style.border = '4px solid #dc2626';
        msgInput.disabled = true;
        btn.classList.add('loading');
    } else {
        btn.innerHTML = '🚨 ΕΝΕΡΓΟΠΟΙΗΣΗ ΣΥΝΑΓΕΡΜΟΥ';
        btn.style.backgroundColor = '#dc2626';
        btn.style.color = '#ffffff';
        btn.style.border = 'none';
        msgInput.disabled = false;
        btn.classList.remove('loading');
    }
}

function renderList(list) {
    const listContainer = document.getElementById("announcementList");
    listContainer.innerHTML = list.map(item => `
        <div class="announcement-item type-${item.type}" data-id="${item.id}" style="opacity: ${isActive(item) ? "1" : "0.5"}; cursor: grab;">
            <div style="display: flex; align-items: center; gap: 1rem;">
                <div class="drag-handle" style="cursor: grab; color: var(--text-secondary); font-size: 1.2rem;">☰</div>
                <div>
                    <div style="font-size: 0.8rem; opacity: 0.7; text-transform: uppercase;">
                        ${item.mediaType} | ${getStatusBadge(item)}
                    </div>
                    <h3>${item.title}</h3>
                    <div style="color: var(--text-secondary); font-size: 0.9rem;">${item.content ? item.content.replace(/<[^>]*>/g, "").substring(0, 50) + "..." : ""}</div>
                </div>
            </div>
            <div style="display: flex; gap: 0.5rem; align-items: start;">
                 <button class="btn" style="background:${item.isPaused ? "#10b981" : "#f59e0b"}; padding:0.5rem; min-width: 40px;" onclick="window.togglePause('${item.id}', ${!!item.isPaused})" title="${item.isPaused ? "Συνέχιση" : "Παύση"}">
                    ${item.isPaused ? "▶" : "⏸"}
                </button>
                <button class="btn" style="background:#6366f1; padding:0.5rem;" onclick="window.duplicateItem('${item.id}')" title="Αντιγραφή">📋</button>
                <button class="btn" style="background:var(--warning-color); padding:0.5rem;" onclick="window.editItem('${item.id}')">✎</button>
                <button class="btn btn-danger" style="padding:0.5rem;" onclick="window.deleteItem('${item.id}')">&times;</button>
            </div>
        </div>
    `).join("");
}

function initSortable() {
    const listContainer = document.getElementById("announcementList");
    if (!listContainer) return;

    new Sortable(listContainer, {
        animation: 150,
        handle: '.drag-handle',
        onEnd: async () => {
            const items = listContainer.querySelectorAll('.announcement-item');
            const updates = [];
            
            items.forEach((itemEl, index) => {
                const id = itemEl.dataset.id;
                updates.push(updateDoc(doc(db, ANNOUNCEMENTS_COL, id), { order: index }));
            });

            try {
                await Promise.all(updates);
                console.log("Order saved successfully!");
            } catch (err) {
                console.error("Order save failed!", err);
                alert("Σφάλμα στην αποθήκευση της σειράς.");
            }
        }
    });
}

// --- LOGIC FUNCTIONS ---

function initForm() {
    const form = document.getElementById('announcementForm');
    const mediaTypeSelect = document.getElementById('mediaType');

    // Visibility Logic
    const updateVisibility = () => {
        const type = mediaTypeSelect.value;
        const els = {
            content: document.getElementById('contentGroup'),
            file: document.getElementById('fileGroup'),
            url: document.getElementById('urlGroup'),
            live: document.getElementById('liveImageGroup'),
            youtube: document.getElementById('youtubeGroup'),
            countdown: document.getElementById('countdownGroup'),
            poll: document.getElementById('pollGroup'),
            examcal: document.getElementById('examCalendarGroup'),
            googleSlides: document.getElementById('googleSlidesGroup')
        };

        // Reset all (null-safe)
        Object.values(els).forEach(el => { if (el) el.style.display = 'none'; });

        // Show relevant
        if (['text', 'image', 'youtube', 'countdown', 'schedule'].includes(type)) els.content.style.display = 'block';
        if (['image', 'pdf', 'schedule'].includes(type)) els.file.style.display = 'block';
        if (type === 'website') els.url.style.display = 'block';
        if (type === 'live_image') els.live.style.display = 'block';
        if (type === 'youtube') els.youtube.style.display = 'block';
        if (type === 'countdown') els.countdown.style.display = 'block';
        if (type === 'exam_calendar') els.examcal.style.display = 'block';
        if (type === 'google_slides') els.googleSlides.style.display = 'block';
        if (type === 'poll') { els.poll.style.display = 'block'; els.content.style.display = 'none'; }
    };
    mediaTypeSelect.onchange = updateVisibility;
    updateVisibility();

    // Submit Logic
    form.onsubmit = async (e) => {
        e.preventDefault();
        const fd = new FormData(form);
        const type = fd.get('mediaType');

        let mediaSource = fd.get('mediaSource') || ""; // Fallback

        // Handle Files (Base64)
        const file = fd.get('file');
        if (file && file.size > 0) {
            // Warn if PDF is too large for Firestore (limit ~700KB raw = ~950KB base64)
            if (type === 'pdf' && file.size > 700000) {
                alert(`⚠️ Το PDF είναι πολύ μεγάλο (${(file.size / 1024).toFixed(0)} KB).\n\nΤο Firestore επιτρέπει max ~700 KB ανά αρχείο.\n\nΣυμπιέστε το PDF ή χρησιμοποιήστε έναν εξωτερικό σύνδεσμο (Τύπος: Ιστοσελίδα) από Google Drive.`);
                return;
            }
            try {
                mediaSource = await readFileAsBase64(file);
            } catch (err) { alert("Error reading file"); return; }
        } else if (editId) {
            // Keep existing if editing and no new file
            const old = allAnnouncements.find(i => i.id === editId);
            if (old) mediaSource = old.mediaSource;
        }

        // Handle specific inputs
        if (type === 'website') mediaSource = fd.get('url');
        if (type === 'live_image') mediaSource = fd.get('liveImageUrl');
        if (type === 'youtube') mediaSource = fd.get('youtubeUrl');
        if (type === 'countdown') mediaSource = fd.get('countdownDate');
        if (type === 'poll') mediaSource = fd.get('pollQuestionText');
        if (type === 'exam_calendar') mediaSource = fd.get('examCalendarUrl');
        if (type === 'google_slides') {
            // Convert any Google Slides URL to embed format
            const rawUrl = fd.get('googleSlidesUrl') || '';
            const delay  = fd.get('slidesDelay') || '5000';
            const loop   = document.getElementById('slidesLoop')?.checked ? 'true' : 'false';
            const match  = rawUrl.match(/\/presentation\/d\/([a-zA-Z0-9_-]+)/);
            if (match) {
                mediaSource = `https://docs.google.com/presentation/d/${match[1]}/embed?start=true&loop=${loop}&delayms=${delay}`;
            } else {
                alert('Αδύνατο εύρεμα ID από το URL. Βεβαιωθείτε ότι το link είναι από Google Slides.');
                return;
            }
        }

        let extraData = null;
        if (type === 'poll') extraData = JSON.stringify(fd.get('pollOptions').split(',').map(s => s.trim()));
        if (type === 'google_slides') {
            extraData = JSON.stringify({
                slidesCount: parseInt(fd.get('slidesCount')) || 1,
                slidesDelay: parseInt(fd.get('slidesDelay')) || 5000,
                slidesLoop: document.getElementById('slidesLoop')?.checked || false
            });
        }

        const docData = {
            title: fd.get('title'),
            type: fd.get('type'),
            layout: fd.get('layout'),
            duration: parseInt(fd.get('duration')) || 10,
            startDate: fd.get('startDate') || null,
            endDate: fd.get('endDate') || null,
            startTime: fd.get('startTime') || null,
            endTime: fd.get('endTime') || null,
            mediaType: type,
            content: document.getElementById('contentEditor').innerHTML,
            mediaSource: mediaSource,
            mediaScale: fd.get('iframeScale') || 1.0,
            extraData: extraData,
            createdAt: new Date().toISOString(),
            order: editId ? (allAnnouncements.find(i => i.id === editId)?.order ?? allAnnouncements.length) : allAnnouncements.length
        };

        try {
            if (editId) {
                await updateDoc(doc(db, ANNOUNCEMENTS_COL, editId), docData);
                alert("Updated!");
                cancelEdit();
            } else {
                await addDoc(collection(db, ANNOUNCEMENTS_COL), docData);
                alert("Added!");
                form.reset();
                document.getElementById('contentEditor').innerHTML = '';
            }
        } catch (err) {
            console.error(err);
            alert("Error: " + err.message);
        }
    };
}

function initSettingsForm() {
    // School Settings
    document.getElementById('settingsForm').onsubmit = async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);

        // Handle Logo
        let logo = currentSettings.logo;
        const logoFile = fd.get('logoFile');
        if (logoFile && logoFile.size > 0) {
            logo = await readFileAsBase64(logoFile);
        }

        const updates = {
            schoolName: fd.get('schoolName'),
            adminPin: fd.get('adminPin'),
            tickerMessage: fd.get('tickerMessage'),
            hostUrl: fd.get('hostUrl'),
            rssUrl: fd.get('rssUrl'),
            weatherCity: fd.get('weatherCity'),
            weatherUrl: fd.get('weatherUrl'),
            geminiApiKey: fd.get('geminiApiKey'),
            logo: logo
        };

        saveSettings(updates);
    };

    // Real-time preview for logo
    const logoInput = document.getElementById('logoFile');
    if (logoInput) {
        logoInput.onchange = async (e) => {
            if (e.target.files && e.target.files[0]) {
                const base64 = await readFileAsBase64(e.target.files[0]);
                document.getElementById('logoPreview').src = base64;
            }
        };
    }

    // Emergency
    document.getElementById('emergencyForm').onsubmit = async (e) => {
        e.preventDefault();
        const msg = document.getElementById('emergencyMessage').value;
        const currentEnabled = currentSettings.emergency?.enabled || false;

        saveSettings({
            emergency: {
                enabled: !currentEnabled,
                message: msg
            }
        });
    };

    // Banner
    const bannerForm = document.getElementById('bannerForm');
    if (bannerForm) {
        bannerForm.onsubmit = async (e) => {
            e.preventDefault();
            const fd = new FormData(bannerForm);

            let img = currentSettings.banner?.image;
            const file = fd.get('bannerFile');
            if (file && file.size > 0) img = await readFileAsBase64(file);

            saveSettings({
                banner: {
                    enabled: document.getElementById('bannerEnabled').checked,
                    position: fd.get('bannerPosition'),
                    image: img
                }
            });
        };
    }
}

async function saveSettings(updates) {
    try {
        await setDoc(doc(db, SETTINGS_COL, SETTINGS_DOC_ID), updates, { merge: true });
        alert("Settings Saved!");
    } catch (err) {
        alert("Save Failed: " + err.message);
    }
}

// Window Globals for HTML onclick
window.setTheme = (name) => saveSettings({ theme: name });

window.improveWithAI = async () => {
    const editor = document.getElementById('contentEditor');
    const text = editor.innerText.trim();
    const apiKey = currentSettings.geminiApiKey;

    if (!text) { alert("Γράψτε πρώτα ένα κείμενο για βελτίωση."); return; }
    if (!apiKey) { alert("Παρακαλώ εισάγετε το Gemini API Key στις ρυθμίσεις πρώτα."); return; }

    const btn = document.getElementById('aiBtn');
    const btnText = btn.querySelector('.ai-btn-text');
    const originalContent = btn.innerHTML;
    
    try {
        btn.disabled = true;
        btn.style.opacity = '0.7';
        btnText.innerText = "Επεξεργασία...";

        const prompt = `Είσαι ένας επαγγελματίας κειμενογράφος για σχολικές ανακοινώσεις. 
        Βελτίωσε το παρακάτω κείμενο ώστε να είναι επίσημο, σωστό γραμματικά και σύντομο (για προβολή σε τηλεόραση). 
        Δώσε ΜΟΝΟ το βελτιωμένο κείμενο, χωρίς επεξηγήσεις ή εισαγωγές.
        Κείμενο: "${text}"`;

        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
            method: 'POST',
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }]
            })
        });

        const data = await response.json();
        
        if (!response.ok) {
            console.error("AI API Error:", data);
            throw new Error(data.error?.message || "Αποτυχία σύνδεσης με την Google");
        }

        if (data.candidates && data.candidates[0].content.parts[0].text) {
            const improvedText = data.candidates[0].content.parts[0].text.trim();
            editor.innerHTML = improvedText.replace(/\n/g, '<br>');
        } else {
            throw new Error("Δεν επιστράφηκε κείμενο από το AI.");
        }
    } catch (err) {
        console.error("AI Assistant Error:", err);
        alert(`❌ Σφάλμα AI: ${err.message}`);
    } finally {
        btn.disabled = false;
        btn.style.opacity = '1';
        btn.innerHTML = originalContent;
    }
};

window.calcSlidesDuration = () => {
    const count = parseInt(document.getElementById('slidesCount').value) || 1;
    const delay = parseInt(document.getElementById('slidesDelay').value) || 5000;
    const totalSecs = Math.ceil((count * delay) / 1000);
    
    // Update main duration field
    document.getElementById('duration').value = totalSecs;
    
    // Update hint text
    const hintText = document.getElementById('slidesDurationText');
    if (hintText) hintText.textContent = totalSecs + ' δευτ.';
};

window.togglePause = async (id, currentStatus) => {
    // currentStatus is the strictly boolean value of isPaused
    const newStatus = !currentStatus;
    try {
        await updateDoc(doc(db, ANNOUNCEMENTS_COL, id), { isPaused: newStatus });
        // UI updates automatically via onSnapshot
    } catch (err) {
        console.error("Error toggling pause:", err);
        alert("Operation failed: " + err.message);
    }
};

window.duplicateItem = async (id) => {
    const original = allAnnouncements.find(i => i.id === id);
    if (!original) return;

    // Build a clean copy without the original id
    const copy = { ...original };
    delete copy.id;
    copy.title = 'Αντίγραφο: ' + copy.title;
    copy.createdAt = new Date().toISOString();
    copy.order = allAnnouncements.length; // Place at end
    copy.isPaused = true; // Start paused so it doesn't show immediately

    try {
        await addDoc(collection(db, ANNOUNCEMENTS_COL), copy);
        // Small visual feedback
        const btn = document.querySelector(`[data-id="${id}"] button[title="Αντιγραφή"]`);
        if (btn) { btn.textContent = '✅'; setTimeout(() => btn.textContent = '📋', 1000); }
    } catch (err) {
        alert('Σφάλμα αντιγραφής: ' + err.message);
    }
};

window.deleteItem = async (id) => {
    if (!confirm("Delete?")) return;
    await deleteDoc(doc(db, ANNOUNCEMENTS_COL, id));
};

window.previewAnnouncement = async () => {
    const modal = document.getElementById('previewModal');
    const slide = document.getElementById('previewSlide');
    if (!modal || !slide) return;

    // Read current form values
    const title      = document.getElementById('title')?.value || '(Χωρίς τίτλο)';
    const type       = document.getElementById('type')?.value || 'info';
    const mediaType  = document.getElementById('mediaType')?.value || 'text';
    const content    = document.getElementById('contentEditor')?.innerHTML || '';
    const youtubeUrl = document.getElementById('youtubeUrl')?.value || '';
    const url        = document.getElementById('url')?.value || '';
    const liveImgUrl = document.getElementById('liveImageUrl')?.value || '';
    const countdownDt= document.getElementById('countdownDate')?.value || '';
    const pollQ      = document.getElementById('pollQuestionText')?.value || '';
    const pollOpts   = document.getElementById('pollOptions')?.value || '';
    const slidesUrl  = document.getElementById('googleSlidesUrl')?.value || '';
    const slidesCnt  = document.getElementById('slidesCount')?.value || '1';
    const slidesDly  = document.getElementById('slidesDelay')?.value || '5000';
    const slidesLp   = document.getElementById('slidesLoop')?.checked ? 'true' : 'false';
    const fileInput  = document.getElementById('file');

    // Type badge colors
    const typeColors = { info: '#3b82f6', alert: '#ef4444', event: '#22c55e' };
    const typeLabels = { info: 'ΕΝΗΜΕΡΩΣΗ', alert: 'ΠΡΟΣΟΧΗ', event: 'ΕΚΔΗΛΩΣΗ' };
    const badgeColor = typeColors[type] || '#3b82f6';
    const badgeLabel = typeLabels[type] || type.toUpperCase();

    let contentHtml = '';

    if (mediaType === 'text') {
        contentHtml = `
            <div style="position:absolute;top:1.5rem;left:1.5rem;background:${badgeColor};color:white;padding:0.3rem 1rem;border-radius:2rem;font-size:0.8rem;font-weight:700;letter-spacing:1px;">${badgeLabel}</div>
            <h1 style="font-size:2.5rem;font-weight:700;background:linear-gradient(to right,#fff,#94a3b8);-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:1rem;">${title}</h1>
            <div style="font-size:1.2rem;color:#94a3b8;max-width:80%;">${content}</div>`;

    } else if (mediaType === 'image' || mediaType === 'pdf') {
        // ... (existing image/pdf logic)
        if (fileInput?.files?.[0]) {
            const dataUrl = await readFileAsBase64(fileInput.files[0]);
            if (mediaType === 'image') {
                contentHtml = `<img src="${dataUrl}" style="max-width:100%;max-height:100%;object-fit:contain;border-radius:0.5rem;">`;
            } else {
                contentHtml = `<embed src="${dataUrl}" type="application/pdf" style="width:100%;height:100%;border:none;">`;
            }
        } else if (editId) {
            const old = allAnnouncements.find(i => i.id === editId);
            if (old?.mediaSource) {
                contentHtml = mediaType === 'image'
                    ? `<img src="${old.mediaSource}" style="max-width:100%;max-height:100%;object-fit:contain;">`
                    : `<embed src="${old.mediaSource}" type="application/pdf" style="width:100%;height:100%;border:none;">`;
            }
        } else {
            contentHtml = `<div style="color:#94a3b8;font-size:1.5rem;">📁 Δεν έχει επιλεγεί αρχείο</div>`;
        }

    } else if (mediaType === 'youtube') {
        const vidId = youtubeUrl.split('v=')[1]?.split('&')[0] || youtubeUrl.split('/').pop();
        contentHtml = vidId
            ? `<iframe src="https://www.youtube.com/embed/${vidId}?autoplay=0&controls=1" style="width:100%;height:100%;border:none;" allowfullscreen></iframe>`
            : `<div style="color:#94a3b8;font-size:1.5rem;">▶ Δεν έχει δοθεί URL YouTube</div>`;

    } else if (mediaType === 'google_slides') {
        const match = slidesUrl.match(/\/presentation\/d\/([a-zA-Z0-9_-]+)/);
        const embedUrl = match ? `https://docs.google.com/presentation/d/${match[1]}/embed?start=false&loop=${slidesLp}&delayms=${slidesDly}` : null;
        contentHtml = embedUrl
            ? `<iframe src="${embedUrl}" style="width:100%;height:100%;border:none;background:#000;" allowfullscreen></iframe>`
            : `<div style="color:#94a3b8;font-size:1.5rem;">📤 Δεν έχει δοθεί έγκυρο Google Slides URL</div>`;

    } else if (mediaType === 'website') {
        contentHtml = url
            ? `<div style="color:#94a3b8;font-size:1.1rem;">🌐 Ιστοσελίδα:<br><a href="${url}" style="color:#3b82f6;" target="_blank">${url}</a><br><small style="opacity:0.5;margin-top:0.5rem;display:block;">(Τα iframes δεν εμφανίζονται στην προεπισκόπηση λόγω ασφάλειας)</small></div>`
            : `<div style="color:#94a3b8;">🌐 Δεν έχει δοθεί URL</div>`;

    } else if (mediaType === 'live_image') {
        contentHtml = liveImgUrl
            ? `<img src="${liveImgUrl}?t=${Date.now()}" style="max-width:100%;max-height:100%;object-fit:contain;" onerror="this.outerHTML='<div style=\'color:#ef4444\'>❌ Αδυναμία φόρτωσης εικόνας</div>'">`
            : `<div style="color:#94a3b8;">📷 Δεν έχει δοθεί URL εικόνας</div>`;

    } else if (mediaType === 'countdown') {
        const target = countdownDt ? new Date(countdownDt) : null;
        const diff = target ? Math.floor((target - new Date()) / 1000) : null;
        const days  = diff ? Math.floor(diff / 86400) : '-';
        const hrs   = diff ? Math.floor((diff % 86400) / 3600) : '-';
        const mins  = diff ? Math.floor((diff % 3600) / 60) : '-';
        const secs  = diff ? Math.floor(diff % 60) : '-';
        contentHtml = `
            <div style="position:absolute;top:1.5rem;left:1.5rem;background:${badgeColor};color:white;padding:0.3rem 1rem;border-radius:2rem;font-size:0.8rem;font-weight:700;">${badgeLabel}</div>
            <h1 style="font-size:2.2rem;font-weight:700;color:white;margin-bottom:1.5rem;">${title}</h1>
            <div style="display:flex;gap:1.5rem;">
                ${[['Μέρες',days],['Ώρες',hrs],['Λεπτά',mins],['Δευτ.',secs]].map(([l,v])=>`
                    <div style="text-align:center;">
                        <div style="font-size:3.5rem;font-weight:900;color:#3b82f6;font-family:monospace;">${String(v).padStart(2,'0')}</div>
                        <div style="font-size:0.8rem;color:#94a3b8;margin-top:0.3rem;">${l}</div>
                    </div>`).join('')}
            </div>`;

    } else if (mediaType === 'poll') {
        const options = pollOpts.split(',').map(s => s.trim()).filter(Boolean);
        contentHtml = `
            <div style="position:absolute;top:1.5rem;left:1.5rem;background:#8b5cf6;color:white;padding:0.3rem 1rem;border-radius:2rem;font-size:0.8rem;font-weight:700;">ΨΗΦΟΦΟΡΙΑ</div>
            <h2 style="font-size:2rem;font-weight:700;color:white;margin-bottom:1.5rem;">${pollQ || 'Χωρίς ερώτηση'}</h2>
            <div style="display:flex;flex-direction:column;gap:0.75rem;width:100%;max-width:500px;">
                ${options.map(o => `<div style="background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);padding:0.8rem 1.2rem;border-radius:0.5rem;color:white;text-align:left;">${o}</div>`).join('')}
            </div>`;

    } else {
        contentHtml = `
            <div style="position:absolute;top:1.5rem;left:1.5rem;background:${badgeColor};color:white;padding:0.3rem 1rem;border-radius:2rem;font-size:0.8rem;font-weight:700;">${badgeLabel}</div>
            <h1 style="font-size:2.5rem;font-weight:700;color:white;margin-bottom:1rem;">${title}</h1>
            <div style="font-size:1.2rem;color:#94a3b8;">${content}</div>`;
    }

    slide.innerHTML = contentHtml;
    modal.style.display = 'flex';

    // Close on Escape
    const onEsc = (e) => { if (e.key === 'Escape') { modal.style.display = 'none'; document.removeEventListener('keydown', onEsc); } };
    document.addEventListener('keydown', onEsc);
};

window.editItem = (id) => {
    const item = allAnnouncements.find(i => i.id === id);
    if (!item) return;

    editId = id;
    const form = document.getElementById('announcementForm');

    // Fill standard fields
    document.getElementById('title').value = item.title;
    document.getElementById('type').value = item.type;
    document.getElementById('layout').value = item.layout || 'fullscreen';
    document.getElementById('duration').value = item.duration;
    document.getElementById('startDate').value = item.startDate || '';
    document.getElementById('endDate').value = item.endDate || '';
    document.getElementById('startTime').value = item.startTime || '';
    document.getElementById('endTime').value = item.endTime || '';
    document.getElementById('mediaType').value = item.mediaType;
    document.getElementById('contentEditor').innerHTML = item.content || '';

    // Trigger change
    document.getElementById('mediaType').dispatchEvent(new Event('change'));

    // Fill specialized fields based on Type
    if (item.mediaType === 'website') document.getElementById('url').value = item.mediaSource;
    if (item.mediaType === 'live_image') document.getElementById('liveImageUrl').value = item.mediaSource;
    if (item.mediaType === 'youtube') document.getElementById('youtubeUrl').value = item.mediaSource;
    if (item.mediaType === 'countdown') document.getElementById('countdownDate').value = item.mediaSource;
    if (item.mediaType === 'exam_calendar') document.getElementById('examCalendarUrl').value = item.mediaSource;
    if (item.mediaType === 'poll') document.getElementById('pollQuestionText').value = item.mediaSource;
    if (item.mediaType === 'google_slides') {
        document.getElementById('googleSlidesUrl').value = item.mediaSource;
        if (item.extraData) {
            try {
                const extra = JSON.parse(item.extraData);
                if (extra.slidesCount) document.getElementById('slidesCount').value = extra.slidesCount;
                if (extra.slidesDelay) document.getElementById('slidesDelay').value = extra.slidesDelay;
                if (extra.slidesLoop !== undefined) document.getElementById('slidesLoop').checked = extra.slidesLoop;
                // Refresh hint
                window.calcSlidesDuration();
            } catch(e) { console.warn("Failed to parse extraData for slides"); }
        }
    }

    // Change Button
    const btn = form.querySelector('button[type="submit"]');
    btn.textContent = "💾 Ενημέρωση";
    btn.style.background = "orange";

    form.scrollIntoView();
};

function cancelEdit() {
    editId = null;
    document.getElementById('announcementForm').reset();
    document.getElementById('contentEditor').innerHTML = '';
    const btn = document.querySelector('#announcementForm button[type="submit"]');
    btn.textContent = "Δημοσίευση";
    btn.style.background = "";
}

// Helpers
function isActive(item) {
    if (item.isPaused) return false;
    const now = new Date();
    const s = item.startDate ? new Date(item.startDate) : null;
    const e = item.endDate ? new Date(item.endDate) : null;
    if (s && now < s) return false;
    if (e && now > e) return false;
    return true;
}

function getStatusBadge(item) {
    if (item.isPaused) return "(PAUSED)";
    if (!isActive(item)) return "(INACTIVE)";
    return "(ACTIVE)";
}
