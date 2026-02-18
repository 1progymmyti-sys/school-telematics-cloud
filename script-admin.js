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
    console.log("Admin Cloud App Starting...");

    // 1. Realtime Settings Listener
    onSnapshot(doc(db, SETTINGS_COL, SETTINGS_DOC_ID), (docSnap) => {
        if (docSnap.exists()) {
            currentSettings = docSnap.data();
            updateSettingsUI(currentSettings);
            updateEmergencyUI(currentSettings);
        } else {
            console.log("Creating default settings...");
            // Create default settings if not exists
            setDoc(doc(db, SETTINGS_COL, SETTINGS_DOC_ID), { schoolName: 'New Cloud School' }, { merge: true })
                .catch((err) => console.error("Init Error", err));
        }
    });

    // 2. Realtime Announcements Listener
    const q = query(collection(db, ANNOUNCEMENTS_COL), orderBy("createdAt", "desc"));
    onSnapshot(q, (snapshot) => {
        allAnnouncements = [];
        snapshot.forEach((doc) => {
            const data = doc.data();
            data.id = doc.id; // Map Firestore ID to local ID
            allAnnouncements.push(data);
        });
        renderList(allAnnouncements);
    });

    initForm();
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

    // Auth Handler
    // Auth Handler
    let isMaintainerMode = false;

    // Toggle Mode
    const toggleLink = document.getElementById('toggleLoginMode');
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

    const checkPin = async () => {
        const err = document.getElementById('loginError');
        err.style.display = 'none';

        const login = (maintainer = false) => {
            unlockApp(maintainer);
        };

        if (!isMaintainerMode) {
            // Normal PIN Login
            const input = document.getElementById('pinInput').value;
            const realPin = currentSettings.adminPin || "1234";

            if (input === realPin) {
                login(false);
            } else {
                err.style.display = 'block';
                document.getElementById('pinInput').value = '';
                document.getElementById('pinInput').focus();
            }
        } else {
            // Maintainer Login
            const u = document.getElementById('mUser').value;
            const p = document.getElementById('mPass').value;

            // SHA-256 of "65NovM@y68"
            // Note: This hash is calculated via Utility
            const targetHash = "9ea5058c7fb26bbc0599d869ad5289d1249822852f2dcfdb6dd7f290629af32d";

            if (u === "UX_SY") {
                const hash = await sha256(p);
                // Check against target hash from certutil or similar tool
                // If the hash from browser differs slightly due to encoding, we might need to adjust.
                if (hash === targetHash) {
                    login(true);
                    return;
                }
            }
            err.style.display = 'block';
        }
    };

    function unlockApp(isMaintainer = false) {
        document.getElementById('loginScreen').style.display = 'none';
        document.getElementById('mainApp').style.display = 'block';

        if (isMaintainer) {
            // Reveal PIN
            const pinReveal = document.getElementById('maintainerPinReveal');
            const realPin = currentSettings.adminPin || "1234";
            pinReveal.textContent = `(Τρέχον PIN: ${realPin})`;
            pinReveal.style.display = 'block';

            // Also unmask the input for convenience
            const pinInput = document.getElementById('adminPin');
            if (pinInput) pinInput.type = 'text';

            // alert("Καλωσήρθατε, Συντηρητή!");
        }
    }

    // Hash Helper
    async function sha256(message) {
        // encode as UTF-8
        const msgBuffer = new TextEncoder().encode(message);
        // hash the message
        const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
        // convert ArrayBuffer to Array
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        // convert bytes to hex string                  
        const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        return hashHex;
    }

    document.getElementById('loginBtn').addEventListener('click', checkPin);
    document.getElementById('pinInput').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') checkPin();
    });
    // Add enter listener for maintainer password
    const mPass = document.getElementById('mPass');
    if (mPass) mPass.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') checkPin();
    });
};

// --- UI UPDATERS ---

function updateSettingsUI(s) {
    if (document.getElementById('schoolName')) document.getElementById('schoolName').value = s.schoolName || '';
    if (document.getElementById('tickerMessage')) document.getElementById('tickerMessage').value = s.tickerMessage || '';
    if (document.getElementById('hostUrl')) document.getElementById('hostUrl').value = s.hostUrl || '';
    if (document.getElementById('rssUrl')) document.getElementById('rssUrl').value = s.rssUrl || '';
    if (document.getElementById('weatherCity')) document.getElementById('weatherCity').value = s.weatherCity || '';
    if (document.getElementById('weatherUrl')) document.getElementById('weatherUrl').value = s.weatherUrl || '';
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
    const listContainer = document.getElementById('announcementList');
    listContainer.innerHTML = list.map(item => `
        <div class="announcement-item type-${item.type}" style="opacity: ${isActive(item) ? '1' : '0.5'}">
            <div>
                <div style="font-size: 0.8rem; opacity: 0.7; text-transform: uppercase;">
                    ${item.mediaType} | ${getStatusBadge(item)}
                </div>
                <h3>${item.title}</h3>
                <div style="color: var(--text-secondary); font-size: 0.9rem;">${item.content ? item.content.replace(/<[^>]*>/g, '').substring(0, 50) + '...' : ''}</div>
            </div>
            <div style="display: flex; gap: 0.5rem;">
                <button class="btn" style="background:var(--warning-color); padding:0.5rem;" onclick="window.editItem('${item.id}')">✎</button>
                <button class="btn btn-danger" style="padding:0.5rem;" onclick="window.deleteItem('${item.id}')">&times;</button>
            </div>
        </div>
    `).join('');
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
            poll: document.getElementById('pollGroup')
        };

        // Reset all
        Object.values(els).forEach(el => el.style.display = 'none');

        // Show relevant
        if (['text', 'image', 'youtube', 'countdown', 'schedule'].includes(type)) els.content.style.display = 'block';
        if (['image', 'pdf', 'schedule'].includes(type)) els.file.style.display = 'block';
        if (type === 'website') els.url.style.display = 'block';
        if (type === 'live_image') els.live.style.display = 'block';
        if (type === 'youtube') els.youtube.style.display = 'block';
        if (type === 'countdown') els.countdown.style.display = 'block';
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

        const docData = {
            title: fd.get('title'),
            type: fd.get('type'),
            layout: fd.get('layout'),
            duration: parseInt(fd.get('duration')) || 10,
            startDate: fd.get('startDate') || null,
            endDate: fd.get('endDate') || null,
            mediaType: type,
            content: document.getElementById('contentEditor').innerHTML,
            mediaSource: mediaSource,
            mediaScale: fd.get('iframeScale') || 1.0,
            extraData: type === 'poll' ? JSON.stringify(fd.get('pollOptions').split(',').map(s => s.trim())) : null,
            createdAt: new Date().toISOString()
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
            logo: logo
        };

        saveSettings(updates);
    };

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

window.deleteItem = async (id) => {
    if (!confirm("Delete?")) return;
    await deleteDoc(doc(db, ANNOUNCEMENTS_COL, id));
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
    document.getElementById('mediaType').value = item.mediaType;
    document.getElementById('contentEditor').innerHTML = item.content || '';

    // Trigger change
    document.getElementById('mediaType').dispatchEvent(new Event('change'));

    // Fill specialized fields based on Type
    if (item.mediaType === 'website') document.getElementById('url').value = item.mediaSource;
    if (item.mediaType === 'live_image') document.getElementById('liveImageUrl').value = item.mediaSource;
    if (item.mediaType === 'youtube') document.getElementById('youtubeUrl').value = item.mediaSource;
    if (item.mediaType === 'countdown') document.getElementById('countdownDate').value = item.mediaSource;
    if (item.mediaType === 'poll') document.getElementById('pollQuestionText').value = item.mediaSource;

    // Change Button
    const btn = form.querySelector('button[type="submit"]');
    btn.textContent = "💾 Update";
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
    const now = new Date();
    const s = item.startDate ? new Date(item.startDate) : null;
    const e = item.endDate ? new Date(item.endDate) : null;
    if (s && now < s) return false;
    if (e && now > e) return false;
    return true;
}

function getStatusBadge(item) {
    if (!isActive(item)) return "(INACTIVE)";
    return "(ACTIVE)";
}
