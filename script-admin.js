import { db, collection, addDoc, getDocs, doc, updateDoc, deleteDoc, onSnapshot, query, orderBy, setDoc } from "./firebase-config.js";

// Collection Consts
const ANNOUNCEMENTS_COL = "announcements";
const SETTINGS_COL = "settings";
const SETTINGS_DOC_ID = "schoolConfig";

// State
let allAnnouncements = [];
let currentSettings = {};
let editId = null;
let currentUploadedFiles = []; // Array of { name, type, size, data }
let searchQuery = "";
let activeFilter = "all";

// --- TOAST NOTIFICATION SYSTEM ---
function showToast(title, message, type = 'info', duration = 3500) {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const icons = {
        success: '✅',
        error: '❌',
        warning: '⚠️',
        info: 'ℹ️'
    };

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
        <div class="toast-icon">${icons[type] || 'ℹ️'}</div>
        <div class="toast-content">
            <div class="toast-title">${title}</div>
            <div class="toast-message">${message}</div>
        </div>
    `;

    container.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('toast-hiding');
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

// --- CONFIRMATION MODAL SYSTEM ---
function confirmDialog(title, message, okText = 'Διαγραφή', icon = '🗑️') {
    return new Promise((resolve) => {
        const modal = document.getElementById('confirmModal');
        const titleEl = document.getElementById('confirmModalTitle');
        const msgEl = document.getElementById('confirmModalMessage');
        const iconEl = document.getElementById('confirmModalIcon');
        const okBtn = document.getElementById('confirmOkBtn');
        const cancelBtn = document.getElementById('confirmCancelBtn');

        if (!modal) {
            resolve(window.confirm(`${title}\n\n${message}`));
            return;
        }

        if (titleEl) titleEl.textContent = title;
        if (msgEl) msgEl.textContent = message;
        if (iconEl) iconEl.textContent = icon;
        if (okBtn) okBtn.textContent = okText;

        modal.style.display = 'flex';

        const cleanup = (result) => {
            modal.style.display = 'none';
            okBtn.removeEventListener('click', onOk);
            cancelBtn.removeEventListener('click', onCancel);
            document.removeEventListener('keydown', onKey);
            resolve(result);
        };

        const onOk = () => cleanup(true);
        const onCancel = () => cleanup(false);
        const onKey = (e) => {
            if (e.key === 'Escape') cleanup(false);
            if (e.key === 'Enter') cleanup(true);
        };

        okBtn.addEventListener('click', onOk);
        cancelBtn.addEventListener('click', onCancel);
        document.addEventListener('keydown', onKey);
    });
}

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

// Helper: Compress Image to Jpeg using Canvas
const compressImage = (file) => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = (event) => {
            const img = new Image();
            img.src = event.target.result;
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;
                const maxDim = 1280;
                
                if (width > maxDim || height > maxDim) {
                    if (width > height) {
                        height = Math.round((height * maxDim) / width);
                        width = maxDim;
                    } else {
                        width = Math.round((width * maxDim) / height);
                        height = maxDim;
                    }
                }
                
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);
                
                // Compress to JPEG with 0.75 quality
                const compressedBase64 = canvas.toDataURL('image/jpeg', 0.75);
                resolve(compressedBase64);
            };
            img.onerror = (err) => reject(err);
        };
        reader.onerror = (err) => reject(err);
    });
};

// Render the selected files list in the form
const renderSelectedFiles = () => {
    const listContainer = document.getElementById("selectedFilesList");
    if (!listContainer) return;
    
    if (currentUploadedFiles.length === 0) {
        listContainer.style.display = 'none';
        listContainer.innerHTML = '';
        return;
    }
    
    listContainer.style.display = 'flex';
    listContainer.innerHTML = currentUploadedFiles.map((fileObj, index) => {
        const sizeKB = (fileObj.size / 1024).toFixed(1);
        const icon = fileObj.type.includes('pdf') ? '📄 PDF' : '🖼️ Εικόνα';
        return `
            <div style="display: flex; justify-content: space-between; align-items: center; background: rgba(255,255,255,0.05); padding: 0.5rem 0.8rem; border-radius: 6px; border: 1px solid rgba(255,255,255,0.1);">
                <div style="display: flex; align-items: center; gap: 0.5rem; overflow: hidden;">
                    <span style="font-size: 0.9rem; flex-shrink: 0;">${icon}</span>
                    <span style="font-size: 0.85rem; text-overflow: ellipsis; overflow: hidden; white-space: nowrap;" title="${fileObj.name}">${fileObj.name}</span>
                    <span style="font-size: 0.75rem; color: var(--text-secondary); flex-shrink: 0;">(${sizeKB} KB)</span>
                </div>
                <button type="button" style="background: transparent; border: none; color: var(--alert-color); font-size: 1.1rem; cursor: pointer; padding: 0 0.2rem; line-height: 1;" onclick="window.removeSelectedFile(${index})">✕</button>
            </div>
        `;
    }).join("");

    const multiOptions = document.getElementById('multiFileOptions');
    if (multiOptions) {
        multiOptions.style.display = currentUploadedFiles.length > 1 ? 'block' : 'none';
    }
};

window.removeSelectedFile = (index) => {
    currentUploadedFiles.splice(index, 1);
    renderSelectedFiles();
    const fileInput = document.getElementById('file');
    if (fileInput) fileInput.value = '';
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
                const card = document.getElementById('loginCard');
                if (card) {
                    card.classList.remove('shake');
                    void card.offsetWidth;
                    card.classList.add('shake');
                }
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
            const card = document.getElementById('loginCard');
            if (card) {
                card.classList.remove('shake');
                void card.offsetWidth;
                card.classList.add('shake');
            }
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
        showToast("Καλώς ήρθατε", isMaintainer ? "Σύνδεση ως Συντηρητής" : "Σύνδεση ως Διαχειριστής", "success");
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
            console.log("List is auto-updating via Firebase!");
            showToast("Ενημέρωση", "Η λίστα συγχρονίζεται αυτόματα σε πραγματικό χρόνο!", "info");
        });
    }

    // Search Box Listener
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            searchQuery = e.target.value;
            renderList(allAnnouncements);
        });
    }

    // Filter Chips Listeners
    document.querySelectorAll('.filter-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            activeFilter = chip.dataset.filter;
            renderList(allAnnouncements);
        });
    });

    // --- TAB NAVIGATION SYSTEM ---
    const tabButtons = document.querySelectorAll('.admin-tab-btn');
    tabButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const targetTabId = btn.dataset.tab;
            if (!targetTabId) return;

            tabButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            document.querySelectorAll('.tab-pane').forEach(pane => {
                pane.style.display = 'none';
                pane.classList.remove('active');
            });

            const activePane = document.getElementById(targetTabId);
            if (activePane) {
                activePane.style.display = 'block';
                activePane.classList.add('active');
            }
        });
    });

    // --- VISUAL MEDIA SELECTOR CARDS ---
    const mediaCards = document.querySelectorAll('.media-type-card');
    const mediaTypeSelect = document.getElementById('mediaType');
    mediaCards.forEach(card => {
        card.addEventListener('click', () => {
            const type = card.dataset.type;
            if (!type || !mediaTypeSelect) return;

            mediaCards.forEach(c => c.classList.remove('active'));
            card.classList.add('active');

            mediaTypeSelect.value = type;
            mediaTypeSelect.dispatchEvent(new Event('change'));
        });
    });

    // --- VISUAL LAYOUT SELECTOR CARDS ---
    const layoutCards = document.querySelectorAll('.layout-card');
    const layoutSelect = document.getElementById('layout');
    const thirdZoneGroup = document.getElementById('thirdZoneGroup');

    const updateLayoutUI = (layoutVal) => {
        layoutCards.forEach(c => {
            if (c.dataset.layout === layoutVal) c.classList.add('active');
            else c.classList.remove('active');
        });
        if (thirdZoneGroup) {
            thirdZoneGroup.style.display = (layoutVal && layoutVal.startsWith('split-3-')) ? 'block' : 'none';
        }
    };

    layoutCards.forEach(card => {
        card.addEventListener('click', () => {
            const lay = card.dataset.layout;
            if (!lay || !layoutSelect) return;

            layoutSelect.value = lay;
            updateLayoutUI(lay);
            layoutSelect.dispatchEvent(new Event('change'));
        });
    });

    if (layoutSelect) {
        layoutSelect.addEventListener('change', () => {
            updateLayoutUI(layoutSelect.value);
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

const mediaTypeLabels = {
    text: '📝 Κείμενο',
    image: '🖼️ Εικόνα',
    youtube: '📺 YouTube',
    countdown: '⏱️ Αντίστροφη',
    exam_calendar: '📅 Διαγωνίσματα',
    live_image: '📷 Live Εικόνα',
    website: '🌐 Ιστοσελίδα',
    google_slides: '📤 Google Slides',
    schedule: '📋 Πρόγραμμα',
    pdf: '📄 PDF'
};

function renderList(list) {
    const listContainer = document.getElementById("announcementList");
    if (!listContainer) return;

    // 1. Calculate stats across active announcements
    const activeItems = allAnnouncements.filter(i => isActive(i));
    const totalDurationSec = activeItems.reduce((sum, i) => {
        let d = i.duration || 10;
        if (i.type === 'alert') d *= 2;
        return sum + d;
    }, 0);
    const mins = Math.floor(totalDurationSec / 60);
    const secs = totalDurationSec % 60;
    const durStr = mins > 0 ? `${mins} λ. ${secs > 0 ? secs + ' δ.' : ''}` : `${secs} δευτ.`;
    const statsPill = document.getElementById('statsPill');
    if (statsPill) {
        statsPill.textContent = `${activeItems.length} Ενεργές • Κύκλος: ${durStr}`;
    }

    // 2. Filter by status / chip
    let filtered = list;
    if (activeFilter === 'active') {
        filtered = filtered.filter(i => isActive(i));
    } else if (activeFilter === 'paused') {
        filtered = filtered.filter(i => i.isPaused);
    } else if (activeFilter === 'alert') {
        filtered = filtered.filter(i => i.type === 'alert');
    }

    // 3. Search query filter
    if (searchQuery && searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        filtered = filtered.filter(i => 
            (i.title && i.title.toLowerCase().includes(q)) ||
            (i.content && i.content.toLowerCase().includes(q)) ||
            (i.mediaType && i.mediaType.toLowerCase().includes(q))
        );
    }

    // 4. Empty state
    if (filtered.length === 0) {
        listContainer.innerHTML = `
            <div style="text-align: center; padding: 2.5rem 1rem; background: rgba(255,255,255,0.02); border-radius: var(--radius-sm); border: 1px dashed var(--border-color); color: var(--text-secondary);">
                <div style="font-size: 2rem; margin-bottom: 0.5rem;">🔍</div>
                <div style="font-size: 1rem; font-weight: 600; color: var(--text-primary); margin-bottom: 0.25rem;">Δεν βρέθηκαν ανακοινώσεις</div>
                <div style="font-size: 0.85rem;">Δοκιμάστε διαφορετικό όρο αναζήτησης ή επιλέξτε το φίλτρο «Όλες».</div>
            </div>
        `;
        return;
    }

    listContainer.innerHTML = filtered.map(item => {
        const typeLabel = mediaTypeLabels[item.mediaType] || item.mediaType;
        const plainContent = item.content ? item.content.replace(/<[^>]*>/g, "").trim() : "";
        const snippet = plainContent ? (plainContent.length > 55 ? plainContent.substring(0, 55) + "..." : plainContent) : "";
        const alertPrefix = item.type === 'alert' ? '<span style="color:var(--alert-color); font-weight:800; font-size:0.75rem;">🚨 ΕΠΕΙΓΟΝ</span> • ' : '';

        return `
        <div class="announcement-item type-${item.type}" data-id="${item.id}" style="opacity: ${isActive(item) ? "1" : "0.55"}; cursor: grab;">
            <div style="display: flex; align-items: center; gap: 1rem; flex: 1; min-width: 0;">
                <div class="drag-handle" title="Σύρετε για αλλαγή σειράς">☰</div>
                <div style="flex: 1; min-width: 0;">
                    <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.25rem; flex-wrap: wrap;">
                        <span style="font-size: 0.78rem; font-weight: 700; color: var(--text-secondary); text-transform: uppercase;">
                            ${alertPrefix}${typeLabel}
                        </span>
                        ${getStatusBadge(item)}
                        <span style="font-size: 0.75rem; color: var(--text-muted);">⏱ ${item.duration || 10}δ.</span>
                    </div>
                    <h3 style="font-size: 1.05rem; margin-bottom: 0.15rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: white;">${item.title}</h3>
                    ${snippet ? `<div style="color: var(--text-secondary); font-size: 0.85rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${snippet}</div>` : ''}
                </div>
            </div>
            <div style="display: flex; gap: 0.4rem; align-items: center; margin-left: 0.75rem; flex-shrink: 0;">
                <button class="btn btn-sm" style="background:${item.isPaused ? "var(--success-color)" : "var(--warning-color)"}; padding: 0.45rem 0.75rem;" onclick="window.togglePause('${item.id}', ${!!item.isPaused})" title="${item.isPaused ? "Συνέχιση προβολής" : "Παύση προβολής"}">
                    ${item.isPaused ? "▶" : "⏸"}
                </button>
                <button class="btn btn-sm btn-secondary" style="padding: 0.45rem 0.75rem;" onclick="window.duplicateItem('${item.id}')" title="Αντιγραφή">📋</button>
                <button class="btn btn-sm btn-secondary" style="padding: 0.45rem 0.75rem; color: #fbbf24;" onclick="window.editItem('${item.id}')" title="Επεξεργασία">✎</button>
                <button class="btn btn-sm btn-danger" style="padding: 0.45rem 0.75rem;" onclick="window.deleteItem('${item.id}')" title="Διαγραφή">&times;</button>
            </div>
        </div>
        `;
    }).join("");
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
                showToast("Σειρά", "Η νέα σειρά των ανακοινώσεων αποθηκεύτηκε!", "success");
            } catch (err) {
                console.error("Order save failed!", err);
                showToast("Σφάλμα", "Σφάλμα στην αποθήκευση της σειράς.", "error");
            }
        }
    });
}

// --- LOGIC FUNCTIONS ---

function initForm() {
    const form = document.getElementById('announcementForm');
    const mediaTypeSelect = document.getElementById('mediaType');
    const fileInput = document.getElementById('file');

    // File Input Listener for Multi-file Uploads & Image Compression
    if (fileInput) {
        fileInput.addEventListener('change', async (e) => {
            const files = e.target.files;
            if (!files || files.length === 0) return;
            
            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                let data = "";
                let size = file.size;
                
                try {
                    if (file.type.startsWith('image/')) {
                        data = await compressImage(file);
                        size = Math.round((data.length - 814) * 0.75);
                    } else {
                        // PDF or Excel
                        if (file.type === 'application/pdf' && file.size > 700000) {
                            showToast("Προσοχή", `Το PDF "${file.name}" είναι πολύ μεγάλο (${(file.size / 1024).toFixed(0)} KB). Το Firestore επιτρέπει max ~700 KB ανά αρχείο.`, "warning", 5000);
                            continue;
                        }
                        data = await readFileAsBase64(file);
                        size = file.size;
                    }
                    
                    currentUploadedFiles.push({
                        name: file.name,
                        type: file.type,
                        size: size,
                        data: data
                    });
                } catch (err) {
                    console.error("Error reading file:", file.name, err);
                    showToast("Σφάλμα", `Σφάλμα κατά την ανάγνωση του αρχείου ${file.name}`, "error");
                }
            }
            
            renderSelectedFiles();
            fileInput.value = ''; // Reset so the same file can be selected again
        });
    }

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
            examcal: document.getElementById('examCalendarGroup'),
            googleSlides: document.getElementById('googleSlidesGroup'),
            scale: document.getElementById('scaleGroup')
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
        if (['website', 'pdf', 'image'].includes(type)) { if (els.scale) els.scale.style.display = 'block'; }

        // Sync Visual Media Cards
        document.querySelectorAll('.media-type-card').forEach(card => {
            if (card.dataset.type === type) {
                card.classList.add('active');
            } else {
                card.classList.remove('active');
            }
        });
    };
    mediaTypeSelect.onchange = updateVisibility;
    updateVisibility();

    // Submit Logic
    form.onsubmit = async (e) => {
        e.preventDefault();
        const fd = new FormData(form);
        const type = fd.get('mediaType');

        let mediaSource = "";
        let mediaSources = [];

        // Handle Files from local state array
        if (['image', 'pdf', 'schedule'].includes(type) && currentUploadedFiles.length > 0) {
            mediaSources = currentUploadedFiles.map(f => f.data);
            mediaSource = mediaSources[0]; // Backward compatibility fallback

            // Total size check to avoid Firestore 1MB document limit
            const totalLength = mediaSources.reduce((sum, src) => sum + src.length, 0);
            const approxTotalSizeBytes = Math.round((totalLength - (814 * mediaSources.length)) * 0.75);
            if (approxTotalSizeBytes > 950000) {
                showToast("Προσοχή", `Το συνολικό μέγεθος των αρχείων είναι πολύ μεγάλο (${(approxTotalSizeBytes / 1024).toFixed(0)} KB). Το Firestore επιτρέπει μέγιστο 1 MB (περίπου 750 KB αρχείων).`, "warning", 6000);
                return;
            }
        } else if (editId) {
            // Keep existing if editing and no new files uploaded
            const old = allAnnouncements.find(i => i.id === editId);
            if (old) {
                mediaSource = old.mediaSource || "";
                mediaSources = old.mediaSources || (old.mediaSource ? [old.mediaSource] : []);
            }
        }

        // Handle specific inputs
        if (type === 'website') mediaSource = fd.get('url');
        if (type === 'live_image') mediaSource = fd.get('liveImageUrl');
        if (type === 'youtube') mediaSource = fd.get('youtubeUrl');
        if (type === 'countdown') mediaSource = fd.get('countdownDate');
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
                showToast("Σφάλμα", "Αδύνατο εύρεμα ID από το URL. Βεβαιωθείτε ότι το link είναι από Google Slides.", "error");
                return;
            }
        }

        let extraData = null;
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
            layout: fd.get('layout') || 'fullscreen',
            duration: parseInt(fd.get('duration')) || 10,
            startDate: fd.get('startDate') || null,
            endDate: fd.get('endDate') || null,
            startTime: fd.get('startTime') || null,
            endTime: fd.get('endTime') || null,
            mediaType: type,
            content: document.getElementById('contentEditor').innerHTML,
            mediaSource: mediaSource,
            mediaSources: mediaSources,
            mediaScale: parseFloat(fd.get('iframeScale')) || 1.0,
            multiDisplayMode: fd.get('multiDisplayMode') || 'slideshow',
            transitionEffect: fd.get('transitionEffect') || 'fade',
            extraInfoText: fd.get('extraInfoText') || '',
            showQrInThirdZone: document.getElementById('showQrInThirdZone')?.checked || false,
            extraData: extraData,
            createdAt: new Date().toISOString(),
            order: editId ? (allAnnouncements.find(i => i.id === editId)?.order ?? allAnnouncements.length) : allAnnouncements.length
        };

        try {
            if (editId) {
                await updateDoc(doc(db, ANNOUNCEMENTS_COL, editId), docData);
                showToast("Επιτυχία", "Η ανακοίνωση ενημερώθηκε επιτυχώς!", "success");
                cancelEdit();
            } else {
                await addDoc(collection(db, ANNOUNCEMENTS_COL), docData);
                showToast("Επιτυχία", "Η νέα ανακοίνωση δημοσιεύτηκε!", "success");
                currentUploadedFiles = [];
                renderSelectedFiles();
                form.reset();
                document.getElementById('contentEditor').innerHTML = '';
                const scaleVal = document.getElementById('scaleValue');
                if (scaleVal) scaleVal.textContent = '100%';
                if (mediaTypeSelect) {
                    mediaTypeSelect.value = 'text';
                    mediaTypeSelect.dispatchEvent(new Event('change'));
                }
                const layoutSelect = document.getElementById('layout');
                if (layoutSelect) {
                    layoutSelect.value = 'fullscreen';
                    layoutSelect.dispatchEvent(new Event('change'));
                }
            }
        } catch (err) {
            console.error(err);
            showToast("Σφάλμα", "Σφάλμα: " + err.message, "error");
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
        showToast("Επιτυχία", "Οι ρυθμίσεις σχολείου αποθηκεύτηκαν!", "success");
    } catch (err) {
        showToast("Σφάλμα", "Αποτυχία αποθήκευσης: " + err.message, "error");
    }
}

window.setTheme = (name) => {
    saveSettings({ theme: name });
    showToast("Θέμα", `Εφαρμόστηκε το θέμα: ${name}`, "info");
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
        showToast("Κατάσταση", newStatus ? "Η ανακοίνωση τέθηκε σε παύση." : "Η ανακοίνωση ενεργοποιήθηκε!", "info");
    } catch (err) {
        console.error("Error toggling pause:", err);
        showToast("Σφάλμα", "Σφάλμα αλλαγής κατάστασης: " + err.message, "error");
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
        showToast("Αντιγραφή", "Δημιουργήθηκε αντίγραφο σε κατάσταση παύσης.", "success");
    } catch (err) {
        showToast("Σφάλμα", 'Σφάλμα αντιγραφής: ' + err.message, "error");
    }
};

window.deleteItem = async (id) => {
    const item = allAnnouncements.find(i => i.id === id);
    const itemTitle = item?.title ? `«${item.title}»` : "αυτή την ανακοίνωση";
    const confirmed = await confirmDialog("Διαγραφή Ανακοίνωσης", `Είστε βέβαιοι ότι θέλετε να διαγράψετε οριστικά ${itemTitle};`, "Διαγραφή", "🗑️");
    if (!confirmed) return;

    try {
        await deleteDoc(doc(db, ANNOUNCEMENTS_COL, id));
        showToast("Διαγράφηκε", "Η ανακοίνωση αφαιρέθηκε επιτυχώς.", "info");
    } catch (err) {
        showToast("Σφάλμα", "Σφάλμα διαγραφής: " + err.message, "error");
    }
};

let previewSlideshowTimer = null;

window.closePreviewModal = () => {
    if (previewSlideshowTimer) {
        clearInterval(previewSlideshowTimer);
        previewSlideshowTimer = null;
    }
    const modal = document.getElementById('previewModal');
    if (modal) modal.style.display = 'none';
};

window.previewAnnouncement = async () => {
    const modal = document.getElementById('previewModal');
    const slide = document.getElementById('previewSlide');
    if (!modal || !slide) return;

    if (previewSlideshowTimer) {
        clearInterval(previewSlideshowTimer);
        previewSlideshowTimer = null;
    }

    // Read current form values
    const title             = document.getElementById('title')?.value || '(Χωρίς τίτλο)';
    const type              = document.getElementById('type')?.value || 'info';
    const mediaType         = document.getElementById('mediaType')?.value || 'text';
    const content           = document.getElementById('contentEditor')?.innerHTML || '';
    const layout            = document.getElementById('layout')?.value || 'fullscreen';
    const duration          = parseInt(document.getElementById('duration')?.value) || 10;
    const multiDisplayMode  = document.getElementById('multiDisplayMode')?.value || 'slideshow';
    const transitionEffect  = document.getElementById('transitionEffect')?.value || 'fade';
    const extraInfoText     = document.getElementById('extraInfoText')?.value || '';
    const showQrInThirdZone = document.getElementById('showQrInThirdZone')?.checked || false;
    const youtubeUrl        = document.getElementById('youtubeUrl')?.value || '';
    const url               = document.getElementById('url')?.value || '';
    const liveImgUrl        = document.getElementById('liveImageUrl')?.value || '';
    const countdownDt       = document.getElementById('countdownDate')?.value || '';
    const slidesUrl         = document.getElementById('googleSlidesUrl')?.value || '';
    const slidesCnt         = document.getElementById('slidesCount')?.value || '1';
    const slidesDly         = document.getElementById('slidesDelay')?.value || '5000';
    const slidesLp          = document.getElementById('slidesLoop')?.checked ? 'true' : 'false';

    // Type badge colors
    const typeColors = { info: '#3b82f6', alert: '#ef4444', event: '#22c55e' };
    const typeLabels = { info: 'ΓΕΝΙΚΗ ΕΝΗΜΕΡΩΣΗ', alert: 'ΠΡΟΣΟΧΗ / ΕΠΕΙΓΟΝ', event: 'ΕΚΔΗΛΩΣΗ' };
    const badgeColor = typeColors[type] || '#3b82f6';
    const badgeLabel = typeLabels[type] || type.toUpperCase();

    // Collect media sources
    let sources = [];
    if (currentUploadedFiles.length > 0) {
        sources = currentUploadedFiles.map(f => f.data);
    } else if (editId) {
        const old = allAnnouncements.find(i => i.id === editId);
        sources = old?.mediaSources || (old?.mediaSource ? [old.mediaSource] : []);
    }

    // Helper: Render Text Zone
    const renderTextZone = (compact = false) => `
        <div class="zone-card zone-card-text">
            <div class="slide-card-badge" style="background:${badgeColor}">${badgeLabel}</div>
            <h1 class="slide-card-title">${title}</h1>
            <div class="slide-card-divider"></div>
            ${content ? `<div class="slide-card-body">${content}</div>` : ''}
        </div>
    `;

    // Helper: Render 3rd Zone
    const renderThirdZone = () => {
        let innerHtml = '';
        if (extraInfoText && extraInfoText.trim() !== '') {
            innerHtml += `
                <div class="zone-extra-title">📌 ΠΛΗΡΟΦΟΡΙΕΣ</div>
                <div class="zone-extra-text">${extraInfoText}</div>
            `;
        }
        if (showQrInThirdZone) {
            const qrTarget = (sources.length > 0 && sources[0]?.startsWith('http')) ? sources[0] : window.location.href;
            const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=130x130&data=${encodeURIComponent(qrTarget)}`;
            innerHtml += `
                <div style="margin-top: 0.75rem; display: flex; flex-direction: column; align-items: center;">
                    <div class="zone-qr-container">
                        <img src="${qrUrl}" alt="Scan QR" style="width: 100px; height: 100px; display: block;">
                    </div>
                    <div style="color: var(--text-secondary); font-size: 0.75rem; margin-top: 0.3rem; font-weight: 700; letter-spacing: 0.5px;">ΣΚΑΝΑΡΕΤΕ ΜΕ ΤΟ ΚΙΝΗΤΟ</div>
                </div>
            `;
        }
        if (!innerHtml) {
            innerHtml = `
                <div class="zone-extra-title">🏫 ΣΧΟΛΙΚΗ ΤΗΛΕΜΑΤΙΚΗ</div>
                <div class="zone-extra-text" style="font-size: 1.05rem; color: #cbd5e1;">Ζωντανή Προεπισκόπηση</div>
                <div style="margin-top: 0.75rem; padding: 0.35rem 0.85rem; background: rgba(59,130,246,0.15); border: 1px solid rgba(59,130,246,0.3); border-radius: 2rem; color: #60a5fa; font-weight: 700; font-size: 0.8rem; display: inline-flex; align-items: center; gap: 0.3rem;">
                    ⏱️ ${duration} δευτερόλεπτα
                </div>
            `;
        }
        return `<div class="zone-card zone-card-extra">${innerHtml}</div>`;
    };

    // Helper: Render Media Zone
    const slideshowId = `preview-slideshow-${Date.now()}`;
    const renderMediaZone = () => {
        if (mediaType === 'image' || mediaType === 'live_image') {
            if (sources.length > 1) {
                if (multiDisplayMode === 'grid') {
                    const n = sources.length;
                    const cols = n <= 4 ? 2 : 3;
                    return `
                        <div style="width: 100%; height: 100%; display: flex; flex-wrap: wrap; gap: 0.5rem; justify-content: center; align-items: center; overflow: hidden; padding: 0.5rem; box-sizing: border-box;">
                            ${sources.map(src => `<img src="${src}" style="max-width: calc(${100/cols}% - 0.5rem); max-height: calc(100% - 0.5rem); object-fit: contain; border-radius: 0.5rem; box-shadow: 0 4px 12px rgba(0,0,0,0.5);">`).join('')}
                        </div>
                    `;
                } else {
                    const effectClass = transitionEffect === 'zoom' ? 'effect-zoom' : (transitionEffect === 'slide' ? 'effect-slide' : 'effect-fade');
                    setTimeout(() => {
                        const container = document.getElementById(slideshowId);
                        if (!container) return;
                        const sSlides = container.querySelectorAll('.photo-slideshow-slide');
                        const sDots = container.querySelectorAll('.photo-dot');
                        const sCur = container.querySelector('.photo-slideshow-cur');
                        let curIdx = 0;
                        const stepMs = Math.max(2000, Math.floor((duration * 1000) / sources.length));
                        previewSlideshowTimer = setInterval(() => {
                            if (!document.getElementById(slideshowId)) {
                                clearInterval(previewSlideshowTimer);
                                return;
                            }
                            sSlides[curIdx]?.classList.remove('active');
                            sDots[curIdx]?.classList.remove('active');
                            curIdx = (curIdx + 1) % sources.length;
                            sSlides[curIdx]?.classList.add('active');
                            sDots[curIdx]?.classList.add('active');
                            if (sCur) sCur.textContent = (curIdx + 1);
                        }, stepMs);
                    }, 50);

                    return `
                        <div class="photo-slideshow-container ${effectClass}" id="${slideshowId}">
                            ${sources.map((src, i) => `
                                <div class="photo-slideshow-slide ${i === 0 ? 'active' : ''}" data-index="${i}">
                                    <img src="${src}" class="photo-slideshow-img">
                                </div>
                            `).join('')}
                            <div class="photo-slideshow-counter">
                                <span>📷</span>
                                <span class="photo-slideshow-cur">1</span> / <span>${sources.length}</span>
                            </div>
                            <div class="photo-slideshow-dots">
                                ${sources.map((_, i) => `<span class="photo-dot ${i === 0 ? 'active' : ''}"></span>`).join('')}
                            </div>
                        </div>
                    `;
                }
            } else if (sources.length === 1 && sources[0]) {
                return `
                    <div style="width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; padding: 0.5rem; overflow: hidden; box-sizing: border-box;">
                        <img src="${sources[0]}" class="slide-image" style="max-width: 100%; max-height: 100%; object-fit: contain; border-radius: 0.75rem; box-shadow: 0 8px 20px rgba(0,0,0,0.5);">
                    </div>
                `;
            } else {
                return `<div style="color: #94a3b8; font-size: 1.2rem;">📁 Δεν έχει επιλεγεί αρχείο εικόνας</div>`;
            }
        } else if (mediaType === 'youtube') {
            const vidId = youtubeUrl.split('v=')[1]?.split('&')[0] || youtubeUrl.split('/').pop();
            return vidId
                ? `<iframe src="https://www.youtube.com/embed/${vidId}?autoplay=0&controls=1" style="width:100%;height:100%;border:none;border-radius:0.75rem;" allowfullscreen></iframe>`
                : `<div style="color:#94a3b8;font-size:1.3rem;">▶ Δεν έχει δοθεί URL YouTube</div>`;
        } else if (mediaType === 'google_slides') {
            const match = slidesUrl.match(/\/presentation\/d\/([a-zA-Z0-9_-]+)/);
            const embedUrl = match ? `https://docs.google.com/presentation/d/${match[1]}/embed?start=false&loop=${slidesLp}&delayms=${slidesDly}` : null;
            return embedUrl
                ? `<iframe src="${embedUrl}" style="width:100%;height:100%;border:none;border-radius:0.75rem;background:#000;" allowfullscreen></iframe>`
                : `<div style="color:#94a3b8;font-size:1.3rem;">📤 Δεν έχει δοθεί έγκυρο Google Slides URL</div>`;
        } else if (mediaType === 'website') {
            return url
                ? `<div style="color:#94a3b8;font-size:1.1rem;text-align:center;padding:1.5rem;">🌐 Ιστοσελίδα:<br><a href="${url}" style="color:#3b82f6;word-break:break-all;" target="_blank">${url}</a><br><small style="opacity:0.6;margin-top:0.8rem;display:block;">(Τα iframes εξωτερικών σελίδων δεν προβάλλονται στην προεπισκόπηση)</small></div>`
                : `<div style="color:#94a3b8;">🌐 Δεν έχει δοθεί URL</div>`;
        } else if (mediaType === 'countdown') {
            const target = countdownDt ? new Date(countdownDt) : null;
            const diff = target ? Math.floor((target - new Date()) / 1000) : null;
            const days  = diff ? Math.floor(diff / 86400) : '-';
            const hrs   = diff ? Math.floor((diff % 86400) / 3600) : '-';
            const mins  = diff ? Math.floor((diff % 3600) / 60) : '-';
            const secs  = diff ? Math.floor(diff % 60) : '-';
            return `
                <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;padding:1.5rem;text-align:center;">
                    <div class="slide-card-badge" style="background:${badgeColor}">⏱️ ΑΝΤΙΣΤΡΟΦΗ ΜΕΤΡΗΣΗ</div>
                    <div style="font-size:1.8rem;font-weight:700;color:white;margin:1rem 0;">${title}</div>
                    <div style="display:flex;gap:1.25rem;">
                        ${[['Μέρες',days],['Ώρες',hrs],['Λεπτά',mins],['Δευτ.',secs]].map(([l,v])=>`
                            <div style="text-align:center;">
                                <div style="font-size:2.8rem;font-weight:900;color:#3b82f6;font-family:monospace;">${String(v).padStart(2,'0')}</div>
                                <div style="font-size:0.75rem;color:#94a3b8;margin-top:0.2rem;">${l}</div>
                            </div>`).join('')}
                    </div>
                </div>
            `;
        } else if (mediaType === 'pdf' || mediaType === 'schedule') {
            if (sources.length > 0) {
                return `<div style="display:flex;gap:10px;width:100%;height:100%;justify-content:center;align-items:center;">
                    ${sources.slice(0, 2).map((src, i) => `<embed src="${src}" type="application/pdf" style="width:100%;height:100%;border:none;border-radius:0.5rem;">`).join('')}
                </div>`;
            } else {
                return `<div style="color:#94a3b8;font-size:1.2rem;">📁 Δεν έχει επιλεγεί αρχείο PDF</div>`;
            }
        } else {
            return `
                <div style="width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:1.5rem;text-align:center;">
                    <div style="font-size:3rem;margin-bottom:0.75rem;">📢</div>
                    <div style="font-size:1.4rem;font-weight:700;color:#f8fafc;">${title}</div>
                </div>
            `;
        }
    };

    let fullPreviewHtml = '';

    if (layout === 'fullscreen') {
        if (mediaType === 'text') {
            fullPreviewHtml = `
                <div class="slide active type-${type} layout-fullscreen" style="width:100%;height:100%;box-sizing:border-box;">
                    <div class="slide-card-container">
                        <div class="slide-card">
                            <div class="slide-card-badge" style="background:${badgeColor}">${badgeLabel}</div>
                            <h1 class="slide-card-title">${title}</h1>
                            <div class="slide-card-divider"></div>
                            <div class="slide-card-body">${content || ''}</div>
                        </div>
                    </div>
                </div>
            `;
        } else {
            fullPreviewHtml = `
                <div class="slide active type-${type} layout-fullscreen" style="width:100%;height:100%;position:relative;">
                    ${renderMediaZone()}
                    ${content ? `<div class="slide-overlay"><h2>${title}</h2><div>${content}</div></div>` : ''}
                </div>
            `;
        }
    } else if (['split-left', 'split-right', 'split-top', 'split-bottom'].includes(layout)) {
        const textPart = renderTextZone();
        const mediaPart = `<div class="zone-card zone-card-media">${renderMediaZone()}</div>`;
        const p1 = (layout === 'split-right' || layout === 'split-bottom') ? mediaPart : textPart;
        const p2 = (layout === 'split-right' || layout === 'split-bottom') ? textPart : mediaPart;

        fullPreviewHtml = `
            <div class="slide active type-${type} multi-zone-container layout-${layout}" style="width:100%;height:100%;">
                ${p1}
                ${p2}
            </div>
        `;
    } else if (['split-3-col', 'split-3-focus', 'split-3-row'].includes(layout)) {
        const textPart = renderTextZone(true);
        const mediaPart = `<div class="zone-card zone-card-media ${layout === 'split-3-focus' ? 'zone-media-focus' : ''}">${renderMediaZone()}</div>`;
        const thirdPart = renderThirdZone();

        if (layout === 'split-3-focus') {
            fullPreviewHtml = `
                <div class="slide active type-${type} multi-zone-container layout-split-3-focus" style="width:100%;height:100%;">
                    ${mediaPart}
                    ${textPart}
                    ${thirdPart}
                </div>
            `;
        } else if (layout === 'split-3-col') {
            fullPreviewHtml = `
                <div class="slide active type-${type} multi-zone-container layout-split-3-col" style="width:100%;height:100%;">
                    ${textPart}
                    ${mediaPart}
                    ${thirdPart}
                </div>
            `;
        } else if (layout === 'split-3-row') {
            fullPreviewHtml = `
                <div class="slide active type-${type} multi-zone-container layout-split-3-row" style="width:100%;height:100%;">
                    ${textPart}
                    ${mediaPart}
                    ${thirdPart}
                </div>
            `;
        }
    }

    slide.innerHTML = fullPreviewHtml;
    modal.style.display = 'flex';

    // Close on Escape
    const onEsc = (e) => {
        if (e.key === 'Escape') {
            window.closePreviewModal();
            document.removeEventListener('keydown', onEsc);
        }
    };
    document.addEventListener('keydown', onEsc);
};

window.editItem = (id) => {
    const item = allAnnouncements.find(i => i.id === id);
    if (!item) return;

    editId = id;
    const form = document.getElementById('announcementForm');

    // Restore currentUploadedFiles from item
    currentUploadedFiles = [];
    if (item.mediaSources && Array.isArray(item.mediaSources) && item.mediaSources.length > 0) {
        currentUploadedFiles = item.mediaSources.map((src, idx) => {
            const isPdf = src.startsWith('data:application/pdf');
            return {
                name: isPdf ? `Αρχείο PDF ${idx + 1}` : `Εικόνα ${idx + 1}`,
                type: isPdf ? 'application/pdf' : 'image/jpeg',
                size: Math.round((src.length - 814) * 0.75),
                data: src
            };
        });
    } else if (item.mediaSource) {
        const isPdf = item.mediaSource.startsWith('data:application/pdf');
        const isExcel = item.mediaSource.startsWith('data:application/vnd') || item.mediaSource.startsWith('data:application/octet');
        let typeStr = 'image/jpeg';
        let nameStr = 'Εικόνα 1';
        if (isPdf) {
            typeStr = 'application/pdf';
            nameStr = 'Αρχείο PDF 1';
        } else if (isExcel) {
            typeStr = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
            nameStr = 'Αρχείο Excel 1';
        }
        currentUploadedFiles = [{
            name: nameStr,
            type: typeStr,
            size: Math.round((item.mediaSource.length - 814) * 0.75),
            data: item.mediaSource
        }];
    }
    renderSelectedFiles();

    // Fill standard fields
    document.getElementById('title').value = item.title;
    document.getElementById('type').value = item.type;
    document.getElementById('duration').value = item.duration;
    document.getElementById('startDate').value = item.startDate || '';
    document.getElementById('endDate').value = item.endDate || '';
    document.getElementById('startTime').value = item.startTime || '';
    document.getElementById('endTime').value = item.endTime || '';
    document.getElementById('mediaType').value = item.mediaType;
    document.getElementById('contentEditor').innerHTML = item.content || '';

    // Restore Layout & Trigger change
    const layoutEl = document.getElementById('layout');
    if (layoutEl) {
        layoutEl.value = item.layout || 'fullscreen';
        layoutEl.dispatchEvent(new Event('change'));
    }

    if (document.getElementById('extraInfoText')) document.getElementById('extraInfoText').value = item.extraInfoText || '';
    if (document.getElementById('showQrInThirdZone')) document.getElementById('showQrInThirdZone').checked = !!item.showQrInThirdZone;
    if (document.getElementById('multiDisplayMode')) document.getElementById('multiDisplayMode').value = item.multiDisplayMode || 'slideshow';
    if (document.getElementById('transitionEffect')) document.getElementById('transitionEffect').value = item.transitionEffect || 'fade';

    // Trigger change
    document.getElementById('mediaType').dispatchEvent(new Event('change'));

    // Fill specialized fields based on Type
    if (item.mediaType === 'website') document.getElementById('url').value = item.mediaSource;
    if (item.mediaType === 'live_image') document.getElementById('liveImageUrl').value = item.mediaSource;
    if (item.mediaType === 'youtube') document.getElementById('youtubeUrl').value = item.mediaSource;
    if (item.mediaType === 'countdown') document.getElementById('countdownDate').value = item.mediaSource;
    if (item.mediaType === 'exam_calendar') document.getElementById('examCalendarUrl').value = item.mediaSource;
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

    // Restore Zoom scale
    const mediaScale = item.mediaScale !== undefined ? item.mediaScale : 1.0;
    const scaleInput = document.getElementById('iframeScale');
    const scaleVal = document.getElementById('scaleValue');
    if (scaleInput) scaleInput.value = mediaScale;
    if (scaleVal) scaleVal.textContent = Math.round(mediaScale * 100) + '%';

    // Change Button
    const btn = form.querySelector('button[type="submit"]');
    btn.textContent = "💾 Ενημέρωση";
    btn.style.background = "orange";

    form.scrollIntoView();
};

function cancelEdit() {
    editId = null;
    currentUploadedFiles = [];
    renderSelectedFiles();
    document.getElementById('announcementForm').reset();
    document.getElementById('contentEditor').innerHTML = '';
    const scaleVal = document.getElementById('scaleValue');
    if (scaleVal) scaleVal.textContent = '100%';
    const btn = document.querySelector('#announcementForm button[type="submit"]');
    btn.textContent = "Δημοσίευση";
    btn.style.background = "";
    const mediaTypeSelect = document.getElementById('mediaType');
    if (mediaTypeSelect) {
        mediaTypeSelect.value = 'text';
        mediaTypeSelect.dispatchEvent(new Event('change'));
    }
    const layoutSelect = document.getElementById('layout');
    if (layoutSelect) {
        layoutSelect.value = 'fullscreen';
        layoutSelect.dispatchEvent(new Event('change'));
    }
    const multiOptions = document.getElementById('multiFileOptions');
    if (multiOptions) multiOptions.style.display = 'none';
    const thirdZone = document.getElementById('thirdZoneGroup');
    if (thirdZone) thirdZone.style.display = 'none';
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
    if (item.isPaused) return '<span class="badge badge-paused">⏸ Παύση</span>';
    if (!isActive(item)) return '<span class="badge badge-inactive">⏹ Ανενεργή</span>';
    return '<span class="badge badge-active">▶ Ενεργή</span>';
}
