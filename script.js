/**
 * School Telematics Logic
 * Handles data persistence via localStorage and UI updates.
 */

const STORAGE_KEY = 'school_telematics_data';
const SETTINGS_KEY = 'school_telematics_settings';

// Initial Data
const defaultData = [
    {
        id: 1,
        title: 'Καλώς ήρθατε!',
        content: 'Καλώς ήρθατε στο νέο σύστημα ενημέρωσης του σχολείου μας.',
        type: 'info',
        mediaType: 'text',
        date: new Date().toISOString()
    }
];

const defaultSettings = {
    schoolName: '1ο Γενικό Λύκειο',
    logo: 'logo.png', // Default local file
    tickerMessage: '',
    hostUrl: '',
    rssUrl: '',
    weatherCity: '',
    weatherUrl: '',
    adminPin: '1234',
    theme: 'default',
    emergency: {
        enabled: false,
        message: ''
    },
    banner: {
        enabled: false,
        image: null,
        position: 'top'
    },
    autoSave: false
};

// Data Management
const DataManager = {
    getAll: () => {
        const data = localStorage.getItem(STORAGE_KEY);
        return data ? JSON.parse(data) : defaultData;
    },
    add: (announcement) => {
        const current = DataManager.getAll();
        const newAnnouncement = {
            id: Date.now(),
            date: new Date().toISOString(),
            ...announcement
        };
        const updated = [newAnnouncement, ...current];
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
        return updated;
    },
    delete: (id) => {
        const current = DataManager.getAll();
        const updated = current.filter(item => item.id != id);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
        return updated;
    },
    getSettings: () => {
        const data = localStorage.getItem(SETTINGS_KEY);
        return data ? JSON.parse(data) : defaultSettings;
    },
    saveSettings: (settings) => {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
        return settings;
    },
    update: (id, updatedFields) => {
        const current = DataManager.getAll();
        const index = current.findIndex(item => item.id === id);
        if (index !== -1) {
            current[index] = { ...current[index], ...updatedFields };
            localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
            return current;
        }
        return current;
    },
    getActive: () => {
        const all = DataManager.getAll();
        const now = new Date();
        return all.filter(item => {
            const start = item.startDate ? new Date(item.startDate) : null;
            const end = item.endDate ? new Date(item.endDate) : null;

            if (start && now < start) return false; // Future
            if (end && now > end) return false; // Expired
            return true;
        });
    },
    isActive: (item) => {
        const now = new Date();
        const start = item.startDate ? new Date(item.startDate) : null;
        const end = item.endDate ? new Date(item.endDate) : null;

        if (start && now < start) return false; // Future
        if (end && now > end) return false; // Expired
        return true;
    },
    getStatusBadge: (item) => {
        const now = new Date();
        const start = item.startDate ? new Date(item.startDate) : null;
        const end = item.endDate ? new Date(item.endDate) : null;

        if (end && now > end) return '<span style="color: #ef4444; font-weight: bold;">(ΛΗΞΕ)</span>';
        if (start && now < start) return '<span style="color: #eab308; font-weight: bold;">(ΠΡΟΓΡΑΜΜΑΤΙΣΜΕΝΟ)</span>';
        return '<span style="color: #22c55e; font-weight: bold;">(ΕΝΕΡΓΟ)</span>';
    }
};

// Helper to read file as Base64
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

// Admin UI Logic
const AdminApp = {
    editId: null,

    init: () => {
        AdminApp.checkAuth();
        AdminApp.initSettings();
        AdminApp.initForm();
        AdminApp.renderList(DataManager.getAll());
        DisplayApp.init(); // Initialize display logic (clock, etc)

        // Initialize theme button active state
        const settings = DataManager.getSettings();
        const currentTheme = settings.theme || 'default';
        const activeBtn = document.querySelector(`.theme-btn[data-theme="${currentTheme}"]`);
        if (activeBtn) activeBtn.classList.add('active');

        // Start Countdown Updater
        setInterval(DisplayApp.updateCountdown, 1000);

        // Event Delegation for List Items
        const list = document.getElementById('announcementList');
        if (list) {
            list.addEventListener('click', (e) => {
                // Handle Delete
                const deleteBtn = e.target.closest('.delete-btn');
                if (deleteBtn) {
                    const id = deleteBtn.dataset.id;
                    AdminApp.deleteItem(id);
                }

                // Handle Edit
                const editBtn = e.target.closest('.edit-btn');
                if (editBtn) {
                    const id = editBtn.dataset.id;
                    AdminApp.editItem(Number(id));
                }
            });
        }
    },

    checkAuth: () => {
        const settings = DataManager.getSettings(); // Get latest settings for PIN
        const currentPin = settings.adminPin || '1234';

        const isAuth = sessionStorage.getItem('admin_auth');
        if (!isAuth) {
            const pin = prompt('Εισάγετε PIN Διαχειριστή:');
            if (pin === currentPin) {
                sessionStorage.setItem('admin_auth', 'true');
            } else {
                alert('Λάθος PIN. Η σελίδα θα κλείσει.');
                window.location.href = 'display.html';
            }
        }
    },

    initSettings: () => {
        const settingsForm = document.getElementById('settingsForm');
        if (!settingsForm) return;

        const settings = DataManager.getSettings();
        document.getElementById('schoolName').value = settings.schoolName;
        if (document.getElementById('adminPin')) {
            document.getElementById('adminPin').value = settings.adminPin || '1234';
        }

        if (document.getElementById('tickerMessage')) {
            document.getElementById('tickerMessage').value = settings.tickerMessage || '';
        }

        if (document.getElementById('hostUrl')) {
            document.getElementById('hostUrl').value = settings.hostUrl || '';
        }

        const rssInput = document.getElementById('rssUrl');
        if (rssInput) {
            rssInput.value = settings.rssUrl || '';
        }

        const weatherInput = document.getElementById('weatherCity');
        if (document.getElementById('weatherCity')) {
            weatherInput.value = settings.weatherCity || '';
        }

        const weatherUrlInput = document.getElementById('weatherUrl');
        if (weatherUrlInput) {
            weatherUrlInput.value = settings.weatherUrl || '';
        }

        // Emergency Form
        const emergencyForm = document.getElementById('emergencyForm');
        if (emergencyForm) {
            const emergencySettings = settings.emergency || { enabled: false, message: '' };
            const msgInput = document.getElementById('emergencyMessage');
            const toggleBtn = document.getElementById('emergencyToggleBtn');

            msgInput.value = emergencySettings.message || '';

            const updateBtn = (enabled) => {
                if (enabled) {
                    toggleBtn.innerHTML = '⛔ ΑΠΕΝΕΡΓΟΠΟΙΗΣΗ ΣΥΝΑΓΕΡΜΟΥ';
                    toggleBtn.style.backgroundColor = '#ffffff';
                    toggleBtn.style.color = '#dc2626';
                    toggleBtn.style.border = '4px solid #dc2626';
                    msgInput.disabled = true;
                    toggleBtn.classList.add('loading'); // Pulse animation
                } else {
                    toggleBtn.innerHTML = '🚨 ΕΝΕΡΓΟΠΟΙΗΣΗ ΣΥΝΑΓΕΡΜΟΥ';
                    toggleBtn.style.backgroundColor = '#dc2626';
                    toggleBtn.style.color = '#ffffff';
                    toggleBtn.style.border = 'none';
                    msgInput.disabled = false;
                    toggleBtn.classList.remove('loading');
                }
            };

            updateBtn(emergencySettings.enabled);

            emergencyForm.addEventListener('submit', (e) => {
                e.preventDefault();
                const current = DataManager.getSettings();
                const isEnabled = current.emergency && current.emergency.enabled;
                const newEnabled = !isEnabled;

                if (newEnabled && !msgInput.value.trim()) {
                    alert('Παρακαλώ εισάγετε μήνυμα συναγερμού.');
                    return;
                }

                if (newEnabled && !confirm('ΠΡΟΣΟΧΗ: Αυτό θα διακόψει την προβολή σε ΟΛΕΣ τις οθόνες. Είστε σίγουροι;')) {
                    return;
                }

                const newSettings = {
                    ...current,
                    emergency: {
                        enabled: newEnabled,
                        message: msgInput.value.trim()
                    }
                };

                DataManager.saveSettings(newSettings);
                updateBtn(newEnabled);
                AdminApp.checkAutoSave();
            });
        }

        // AutoSave Toggle
        const autoSaveCheckbox = document.getElementById('autoSaveToggle');
        if (autoSaveCheckbox) {
            autoSaveCheckbox.checked = settings.autoSave || false;
            autoSaveCheckbox.addEventListener('change', (e) => {
                const currentSettings = DataManager.getSettings();
                currentSettings.autoSave = e.target.checked;
                DataManager.saveSettings(currentSettings);
            });
        }

        if (settings.logo) {
            const logoPreview = document.getElementById('logoPreview');
            if (logoPreview) {
                logoPreview.src = settings.logo;
                logoPreview.classList.add('active');
            }
        }

        settingsForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const formData = new FormData(settingsForm);
            const logoFile = formData.get('logoFile');

            let logoBase64 = settings.logo;
            if (logoFile && logoFile.size > 0) {
                try {
                    logoBase64 = await readFileAsBase64(logoFile);
                } catch (err) {
                    console.error("Error reading logo", err);
                    alert("Σφάλμα κατά την ανάγνωση του λογοτύπου.");
                    return;
                }
            }

            const newSettings = {
                ...DataManager.getSettings(),
                schoolName: formData.get('schoolName'),
                adminPin: formData.get('adminPin') || '1234',
                tickerMessage: formData.get('tickerMessage'),
                hostUrl: formData.get('hostUrl'),
                rssUrl: formData.get('rssUrl'),
                weatherCity: formData.get('weatherCity'),
                weatherUrl: formData.get('weatherUrl'),
                logo: logoBase64
            };

            DataManager.saveSettings(newSettings);
            alert('Οι ρυθμίσεις αποθηκεύτηκαν!');
            AdminApp.checkAutoSave();
            setTimeout(() => location.reload(), 1000);
        });

        // Banner form
        const bannerForm = document.getElementById('bannerForm');
        if (bannerForm) {
            const bannerSettings = settings.banner || defaultSettings.banner;
            document.getElementById('bannerPosition').value = bannerSettings.position || 'top';
            document.getElementById('bannerEnabled').checked = bannerSettings.enabled || false;

            if (bannerSettings.image) {
                const bannerPreview = document.getElementById('bannerPreview');
                if (bannerPreview) {
                    bannerPreview.src = bannerSettings.image;
                    bannerPreview.classList.add('active');
                }
            }

            bannerForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                const formData = new FormData(bannerForm);
                const bannerFile = formData.get('bannerFile');

                let bannerImage = settings.banner?.image || null;
                if (bannerFile && bannerFile.size > 0) {
                    try {
                        bannerImage = await readFileAsBase64(bannerFile);
                    } catch (err) {
                        console.error("Error reading banner", err);
                        alert("Σφάλμα κατά την ανάγνωση του banner.");
                        return;
                    }
                }

                const newBannerSettings = {
                    enabled: document.getElementById('bannerEnabled').checked,
                    image: bannerImage,
                    position: formData.get('bannerPosition')
                };

                const updatedSettings = {
                    ...settings,
                    banner: newBannerSettings
                };

                DataManager.saveSettings(updatedSettings);
                alert('Το banner αποθηκεύτηκε!');
                AdminApp.checkAutoSave();
                setTimeout(() => location.reload(), 1000);
            });
        }
    },

    setTheme: (themeName) => {
        const settings = DataManager.getSettings();
        const updatedSettings = {
            ...settings,
            theme: themeName
        };
        DataManager.saveSettings(updatedSettings);

        // Update active state on buttons
        document.querySelectorAll('.theme-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        const activeBtn = document.querySelector(`.theme-btn[data-theme="${themeName}"]`);
        if (activeBtn) activeBtn.classList.add('active');

        alert(`Θέμα "${themeName}" ενεργοποιήθηκε! Η οθόνη προβολής θα ενημερωθεί αυτόματα.`);
        AdminApp.checkAutoSave();
    },

    initForm: () => {
        const form = document.getElementById('announcementForm');
        if (!form) return;

        // Handle Media Type Change
        const mediaTypeSelect = document.getElementById('mediaType');
        const contentGroup = document.getElementById('contentGroup');
        const fileGroup = document.getElementById('fileGroup');
        const urlGroup = document.getElementById('urlGroup');
        const liveImageGroup = document.getElementById('liveImageGroup');
        const youtubeGroup = document.getElementById('youtubeGroup');
        const countdownGroup = document.getElementById('countdownGroup');
        const pollGroup = document.getElementById('pollGroup');

        const updateVisibility = () => {
            const type = mediaTypeSelect.value;
            contentGroup.style.display = (type === 'text' || type === 'image' || type === 'youtube' || type === 'countdown' || type === 'schedule') ? 'block' : 'none';
            fileGroup.style.display = (type === 'image' || type === 'pdf' || type === 'schedule') ? 'block' : 'none';
            urlGroup.style.display = (type === 'website') ? 'block' : 'none';
            if (liveImageGroup) liveImageGroup.style.display = (type === 'live_image') ? 'block' : 'none';
            if (youtubeGroup) youtubeGroup.style.display = (type === 'youtube') ? 'block' : 'none';
            if (countdownGroup) countdownGroup.style.display = (type === 'countdown') ? 'block' : 'none';
            if (pollGroup) pollGroup.style.display = (type === 'poll') ? 'block' : 'none';
        };

        mediaTypeSelect.addEventListener('change', updateVisibility);
        // Initial check
        updateVisibility();

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const formData = new FormData(form);
            const mediaType = formData.get('mediaType');
            const file = formData.get('file');

            let mediaContent = null;
            let mediaScale = 1.0;

            // Handle Media Content
            if (mediaType === 'image' || mediaType === 'pdf' || mediaType === 'schedule') {
                if (file && file.size > 0) {
                    try {
                        mediaContent = await readFileAsBase64(file);
                    } catch (err) {
                        alert("Σφάλμα στο αρχείο.");
                        return;
                    }
                } else if (AdminApp.editId) {
                    // If editing and no new file, keep existing
                    const oldItem = DataManager.getAll().find(i => i.id === AdminApp.editId);
                    if (oldItem) mediaContent = oldItem.mediaSource;
                } else {
                    // Creating new and no file, strictly validate
                    if (mediaType === 'pdf') { alert("Παρακαλώ επιλέξτε αρχείο PDF."); return; }
                    if (mediaType === 'schedule') { alert("Παρακαλώ επιλέξτε αρχείο Excel ή PDF."); return; }
                }
            } else if (mediaType === 'website') {
                mediaContent = formData.get('url');
                mediaScale = parseFloat(formData.get('iframeScale')) || 1.0;
            } else if (mediaType === 'live_image') {
                mediaContent = formData.get('liveImageUrl');
            } else if (mediaType === 'youtube') {
                mediaContent = formData.get('youtubeUrl');
            } else if (mediaType === 'countdown') {
                mediaContent = formData.get('countdownDate');
            } else if (mediaType === 'poll') {
                mediaContent = formData.get('pollQuestionText');
            }

            const announcement = {
                title: formData.get('title'),
                content: document.getElementById('contentEditor').innerHTML,
                type: formData.get('type'), // info, alert, event
                layout: formData.get('layout') || 'fullscreen',
                duration: parseInt(formData.get('duration')) || 10,
                startDate: formData.get('startDate') || null,
                endDate: formData.get('endDate') || null,
                mediaType: mediaType,
                mediaSource: mediaContent,
                mediaScale: mediaScale,
                extraData: mediaType === 'poll' ? JSON.stringify(formData.get('pollOptions').split(',').map(o => o.trim()).filter(o => o)) : null,
                id: AdminApp.editId || Date.now(),
                date: new Date().toISOString()
            };

            if (AdminApp.editId) {
                DataManager.update(AdminApp.editId, announcement);
                AdminApp.cancelEdit();
                alert('Η ανακοίνωση ενημερώθηκε επιτυχώς!');
            } else {
                DataManager.add(announcement);
                form.reset();
                document.getElementById('contentEditor').innerHTML = '';
                // Reset scale
                if (document.getElementById('iframeScale')) {
                    document.getElementById('iframeScale').value = 1.0;
                    document.getElementById('scaleValue').textContent = '100%';
                }
                updateVisibility();
                alert('Η ανακοίνωση προστέθηκε επιτυχώς!');
            }

            AdminApp.renderList(DataManager.getAll());
            AdminApp.checkAutoSave();
        });
    },

    renderList: (announcements) => {
        const list = document.getElementById('announcementList');
        if (!list) return;

        list.innerHTML = announcements.map(item => `
            <div class="announcement-item type-${item.type}" style="opacity: ${DataManager.isActive(item) ? '1' : '0.5'}">
                <div>
                    <div style="font-size: 0.8rem; opacity: 0.7; text-transform: uppercase; display: flex; gap: 0.5rem;">
                        <span>${item.mediaType}</span>
                        ${DataManager.getStatusBadge(item)}
                    </div>
                    <h3>${item.title}</h3>
                    <div style="color: var(--text-secondary); font-size: 0.9rem;">${item.content ? item.content.replace(/<[^>]*>/g, '').substring(0, 50) + '...' : ''}</div>
                    ${item.startDate || item.endDate ? `
                        <div style="font-size: 0.75rem; color: var(--text-secondary); margin-top: 0.2rem;">
                            ${item.startDate ? 'Από: ' + new Date(item.startDate).toLocaleString('el-GR') : ''}
                            ${item.endDate ? ' | Έως: ' + new Date(item.endDate).toLocaleString('el-GR') : ''}
                        </div>
                    ` : ''}
                </div>
                <div style="display: flex; gap: 0.5rem;">
                    <button class="btn edit-btn" data-id="${item.id}" style="padding: 0.5rem; background-color: var(--warning-color);" title="Επεξεργασία">
                        ✎
                    </button>
                    <button class="btn btn-danger delete-btn" data-id="${item.id}" style="padding: 0.5rem;" title="Διαγραφή">
                        &times;
                    </button>
                </div>
            </div>
        `).join('');
    },

    deleteItem: (id) => {
        if (confirm('Είστε σίγουροι ότι θέλετε να διαγράψετε αυτή την ανακοίνωση;')) {
            const updated = DataManager.delete(id);
            AdminApp.renderList(updated);
            AdminApp.checkAutoSave();
        }
    },

    editItem: (id) => {
        const item = DataManager.getAll().find(i => i.id === id);
        if (!item) return;

        AdminApp.editId = id;

        document.getElementById('title').value = item.title;
        document.getElementById('type').value = item.type;
        document.getElementById('layout').value = item.layout || 'fullscreen';
        document.getElementById('duration').value = item.duration || 10,
            document.getElementById('startDate').value = item.startDate || '';
        document.getElementById('endDate').value = item.endDate || '';
        document.getElementById('mediaType').value = item.mediaType;

        // Trigger media type update
        document.getElementById('mediaType').dispatchEvent(new Event('change'));

        document.getElementById('contentEditor').innerHTML = item.content || '';

        if (item.mediaType === 'website') {
            document.getElementById('url').value = item.mediaSource || '';
            const scale = item.mediaScale || 1.0;
            if (document.getElementById('iframeScale')) {
                document.getElementById('iframeScale').value = scale;
                document.getElementById('scaleValue').textContent = Math.round(scale * 100) + '%';
            }
        } else if (item.mediaType === 'live_image') {
            document.getElementById('liveImageUrl').value = item.mediaSource || '';
        } else if (item.mediaType === 'youtube') {
            document.getElementById('youtubeUrl').value = item.mediaSource || '';
        } else if (item.mediaType === 'countdown') {
            document.getElementById('countdownDate').value = item.mediaSource || '';
        } else if (item.mediaType === 'poll') {
            document.getElementById('pollQuestionText').value = item.mediaSource || '';
            try {
                const opts = JSON.parse(item.extraData || '[]');
                document.getElementById('pollOptions').value = opts.join(', ');
            } catch (e) { console.error(e); }
        }

        // Update UI logic
        const btn = document.querySelector('#formActions button[type="submit"]');
        btn.textContent = '💾 Αποθήκευση Αλλαγών';
        btn.style.backgroundColor = 'var(--warning-color)';

        let cancelBtn = document.getElementById('cancelEditBtn');
        if (!cancelBtn) {
            cancelBtn = document.createElement('button');
            cancelBtn.id = 'cancelEditBtn';
            cancelBtn.type = 'button';
            cancelBtn.textContent = 'Ακύρωση';
            cancelBtn.className = 'btn';
            cancelBtn.style.flex = '1';
            cancelBtn.style.backgroundColor = '#64748b'; // generic grey
            cancelBtn.onclick = AdminApp.cancelEdit;
            document.getElementById('formActions').appendChild(cancelBtn);
        }

        // Scroll to top
        document.getElementById('announcementForm').scrollIntoView({ behavior: 'smooth' });
    },

    cancelEdit: () => {
        AdminApp.editId = null;
        document.getElementById('announcementForm').reset();
        document.getElementById('contentEditor').innerHTML = '';
        document.getElementById('mediaType').dispatchEvent(new Event('change'));

        // Reset scale
        if (document.getElementById('iframeScale')) {
            document.getElementById('iframeScale').value = 1.0;
            document.getElementById('scaleValue').textContent = '100%';
        }

        const btn = document.querySelector('#formActions button[type="submit"]');
        btn.textContent = 'Δημοσίευση';
        btn.style.backgroundColor = ''; // Reset to default CSS

        const cancelBtn = document.getElementById('cancelEditBtn');
        if (cancelBtn) cancelBtn.remove();
    },

    exportData: () => {
        const data = {
            settings: DataManager.getSettings(),
            announcements: DataManager.getAll(),
            version: '1.0',
            timestamp: new Date().toISOString()
        };
        const jsonString = JSON.stringify(data, null, 2);
        const blob = new Blob([jsonString], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = `school_telematics_data.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    },

    checkAutoSave: () => {
        const settings = DataManager.getSettings();
        if (settings.autoSave) {
            console.log("Auto-saving data...");
            AdminApp.exportData();
        }
    },

    importData: async (file) => {
        if (!file) return;

        if (!confirm('ΠΡΟΣΟΧΗ: Η επαναφορά θα αντικαταστήσει όλες τις τρέχουσες ρυθμίσεις και ανακοινώσεις. Θέλετε να συνεχίσετε;')) {
            document.getElementById('importFile').value = ''; // Reset import
            return;
        }

        try {
            const text = await readFileAsText(file);
            const data = JSON.parse(text);

            if (data.settings && data.announcements) {
                DataManager.saveSettings(data.settings);
                localStorage.setItem(STORAGE_KEY, JSON.stringify(data.announcements));
                alert('Η επαναφορά ολοκληρώθηκε επιτυχώς! Η σελίδα θα ανανεωθεί.');
                location.reload();
            } else {
                throw new Error('Invalid data format');
            }
        } catch (err) {
            console.error(err);
            alert('Σφάλμα: Το αρχείο δεν είναι έγκυρο ή κατεστραμμένο.');
        }
        document.getElementById('importFile').value = ''; // Reset input
    }
};

// Display UI Logic
const DisplayApp = {
    currentIndex: 0,
    timer: null,

    init: () => {
        const container = document.getElementById('slideContainer');
        if (!container) return; // Not on display page

        DisplayApp.loadSettings();
        DisplayApp.startClock();

        // Call these explicitly and log for debugging
        console.log("Initializing Weather...");
        DisplayApp.initWeather();

        console.log("Initializing Ticker/RSS...");
        DisplayApp.updateTicker();

        DisplayApp.renderLoop();

        // Start Countdown Updater
        setInterval(DisplayApp.updateCountdown, 1000);

        // Live Poll Listener
        window.addEventListener('storage', (e) => {
            if (e.key && e.key.startsWith('poll_results_')) {
                const id = e.key.replace('poll_results_', '');
                DisplayApp.updatePollResults(id);
            }
        });
    },

    loadSettings: () => {
        const settings = DataManager.getSettings();
        const logoEl = document.getElementById('schoolLogo');
        const nameEl = document.getElementById('schoolNameDisplay');
        const tickerContainer = document.getElementById('tickerContainer');
        const tickerContent = document.getElementById('tickerContent');

        if (logoEl && settings.logo) logoEl.src = settings.logo;
        if (nameEl) nameEl.textContent = settings.schoolName;

        DisplayApp.updateTicker();

        // Apply Theme
        DisplayApp.applyTheme(settings.theme || 'default');

        // Setup banner
        const bannerContainer = document.getElementById('bannerContainer');
        if (bannerContainer && settings.banner) {
            if (settings.banner.enabled && settings.banner.image) {
                bannerContainer.innerHTML = `<img src="${settings.banner.image}" alt="Banner" class="banner-image">`;
                bannerContainer.className = 'banner-container banner-' + (settings.banner.position || 'top');
                bannerContainer.style.display = 'block';
            } else {
                bannerContainer.style.display = 'none';
            }
        }
    },

    startClock: () => {
        const updateTime = () => {
            const now = new Date();
            const timeString = now.toLocaleTimeString('el-GR', { hour: '2-digit', minute: '2-digit' });
            const dateString = now.toLocaleDateString('el-GR', { weekday: 'long', day: 'numeric', month: 'long' });
            const clockEl = document.getElementById('clock');
            const dateEl = document.getElementById('date');
            if (clockEl) clockEl.textContent = timeString;
            if (dateEl) dateEl.textContent = dateString;
        };
        updateTime();
        setInterval(updateTime, 1000);
    },

    playAlertSound: () => {
        try {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            if (!AudioContext) return;

            // Reuse context or create new
            if (!DisplayApp.audioCtx) {
                DisplayApp.audioCtx = new AudioContext();
            }

            const ctx = DisplayApp.audioCtx;

            // Browser policy: Resume if suspended
            if (ctx.state === 'suspended') {
                ctx.resume().then(() => {
                    console.log("AudioContext resumed!");
                    DisplayApp.playSiren(ctx);
                });
            } else {
                DisplayApp.playSiren(ctx);
            }

        } catch (e) {
            console.error("Audio play failed", e);
        }
    },

    playSiren: (ctx) => {
        // High-Low Siren Effect
        const now = ctx.currentTime;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'square';
        osc.frequency.setValueAtTime(800, now);
        osc.frequency.linearRampToValueAtTime(600, now + 0.3);
        osc.frequency.linearRampToValueAtTime(800, now + 0.6);

        gain.gain.setValueAtTime(0.3, now);
        gain.gain.linearRampToValueAtTime(0.3, now + 0.6);
        gain.gain.linearRampToValueAtTime(0, now + 0.7);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(now);
        osc.stop(now + 0.7);
    },

    initWeather: async () => {
        const settings = DataManager.getSettings();
        const city = settings.weatherCity;
        const customUrl = settings.weatherUrl;
        const weatherEl = document.getElementById('weather');

        if (!weatherEl) return;

        // Priority: Custom URL > City
        if (customUrl) {
            weatherEl.innerHTML = `
                <iframe src="${customUrl}" style="border:none; height:60px; width:200px; overflow:hidden;" scrolling="no"></iframe>
            `;
            return;
        }

        if (!city) {
            weatherEl.innerHTML = '';
            return;
        }

        const fetchWeather = async () => {
            try {
                console.log(`Fetching weather for: ${city}`);

                // 1. Geocoding
                const geoRes = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=el&format=json`);
                const geoData = await geoRes.json();

                if (!geoData.results || geoData.results.length === 0) {
                    console.error("City not found");
                    weatherEl.innerHTML = `⚠️ ${city} ?`;
                    return;
                }

                const { latitude, longitude, name } = geoData.results[0];

                // 2. Weather
                const weatherRes = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current_weather=true`);
                const weatherData = await weatherRes.json();

                if (weatherData.current_weather) {
                    const current = weatherData.current_weather;

                    // WMO Code Map (Full)
                    const getWeatherInfo = (code) => {
                        const codes = {
                            0: { desc: "Αίθριος", icon: "☀️" },
                            1: { desc: "Κυρίως Αίθριος", icon: "🌤️" },
                            2: { desc: "Λίγα Σύννεφα", icon: "⛅" },
                            3: { desc: "Συννεφιά", icon: "☁️" },
                            45: { desc: "Ομίχλη", icon: "🌫️" },
                            48: { desc: "Πάχνη", icon: "🌫️" },
                            51: { desc: "Ψιχάλες", icon: "🌦️" },
                            53: { desc: "Ψιχάλες", icon: "🌦️" },
                            55: { desc: "Ψιχάλες", icon: "🌦️" },
                            61: { desc: "Βροχή", icon: "🌧️" },
                            63: { desc: "Βροχή", icon: "🌧️" },
                            65: { desc: "Ισχυρή Βροχή", icon: "🌧️" },
                            71: { desc: "Χιόνι", icon: "🌨️" },
                            73: { desc: "Χιόνι", icon: "🌨️" },
                            75: { desc: "Ισχυρό Χιόνι", icon: "🌨️" },
                            80: { desc: "Μπόρες", icon: "🌦️" },
                            81: { desc: "Μπόρες", icon: "🌦️" },
                            82: { desc: "Ισχυρές Μπόρες", icon: "⛈️" },
                            95: { desc: "Καταιγίδα", icon: "⛈️" },
                            96: { desc: "Καταιγίδα με Χαλάζι", icon: "⛈️" },
                            99: { desc: "Καταιγίδα με Χαλάζι", icon: "⛈️" }
                        };
                        return codes[code] || { desc: "", icon: "🌡️" };
                    };

                    const info = getWeatherInfo(current.weathercode);

                    weatherEl.innerHTML = `
                        <div style="text-align: right;">
                            <div style="font-weight: 700;">${Math.round(current.temperature)}°C</div>
                            <div style="font-size: 0.8em; opacity: 0.8;">
                                ${name} ${info.icon} <span style="font-size:0.8em;">(${info.desc})</span>
                            </div>
                        </div>
                    `;
                }
            } catch (err) {
                console.error("Weather fetch failed", err);
                weatherEl.innerHTML = `❌ ${city}`;
            }
        };

        fetchWeather();
        // Update every 30 minutes
        if (DisplayApp.weatherInterval) clearInterval(DisplayApp.weatherInterval);
        DisplayApp.weatherInterval = setInterval(fetchWeather, 30 * 60 * 1000);
    },

    updateTicker: async () => {
        const settings = DataManager.getSettings();
        const tickerContainer = document.getElementById('tickerContainer');
        const tickerContent = document.getElementById('tickerContent');

        if (!tickerContainer || !tickerContent) return;

        let fullMessage = settings.tickerMessage || '';

        // If RSS provided, fetch it
        if (settings.rssUrl) {
            try {
                // Use rss2json to avoid CORS and XML parsing
                const res = await fetch(`https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(settings.rssUrl)}`);
                const data = await res.json();

                if (data.status === 'ok' && data.items) {
                    const headlines = data.items.map(item => item.title).slice(0, 5).join('  •  ');
                    if (fullMessage) fullMessage += '  •  ';
                    fullMessage += headlines;
                }
            } catch (err) {
                console.error("RSS fetch failed", err);
            }
        }

        if (fullMessage.trim() !== '') {
            tickerContent.textContent = fullMessage;
            tickerContainer.style.display = 'flex';

            // Adjust animation duration based on length to keep speed consistent
            // Approx 10s for short, more for long
            const duration = Math.max(20, fullMessage.length / 5);
            tickerContent.style.animationDuration = `${duration}s`;
        } else {
            tickerContainer.style.display = 'none';
        }

        // Refresh RSS every 10 mins
        setTimeout(DisplayApp.updateTicker, 10 * 60 * 1000);
    },

    renderLoop: () => {
        const container = document.getElementById('slideContainer');
        const settings = DataManager.getSettings();

        // CHECK EMERGENCY FIRST
        if (settings.emergency && settings.emergency.enabled) {
            if (DisplayApp.timer) clearTimeout(DisplayApp.timer);

            container.innerHTML = `
                <div class="slide active type-alert" style="background: var(--alert-color); z-index: 9999; display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center;">
                    <div style="font-size: 8rem; animation: pulse 0.5s infinite;">🚨</div>
                    <h1 style="font-size: 6rem; color: white; margin: 2rem 0; text-transform: uppercase; font-weight: 900; animation: pulse 1s infinite;">
                        ${settings.emergency.message || 'ΕΚΤΑΚΤΗ ΑΝΑΓΚΗ'}
                    </h1>
                </div>
            `;

            // Play Beep
            DisplayApp.playAlertSound();

            // Loop every 3 seconds to keep playing sound and checking status
            DisplayApp.timer = setTimeout(DisplayApp.renderLoop, 3000);
            return;
        }

        // Use getActive() only for display!
        const announcements = DataManager.getActive();

        if (announcements.length === 0) {
            container.innerHTML = '<div class="slide active"><h1>Αναμονή για ενημερώσεις...</h1></div>';
            return;
        }

        // Render all slides
        container.innerHTML = announcements.map((item, index) => {
            let contentHtml = '';

            // Generate Media HTML independently
            let mediaHtml = '';
            if (item.mediaType === 'image' && item.mediaSource) {
                mediaHtml = `<img src="${item.mediaSource}" class="${item.layout && item.layout !== 'fullscreen' ? '' : 'slide-image'}" alt="${item.title}">`;
            } else if (item.mediaType === 'live_image' && item.mediaSource) {
                mediaHtml = `<img src="${item.mediaSource}?t=${Date.now()}" class="${item.layout && item.layout !== 'fullscreen' ? '' : 'slide-image'}" alt="${item.title}">`;
            } else if (item.mediaType === 'website' && item.mediaSource) {
                const scale = item.mediaScale || 1.0;
                const dimPrecent = 100 / scale;
                mediaHtml = `
                    <div style="width: 100%; height: 100%; overflow: hidden;">
                        <iframe src="${item.mediaSource}" class="slide-iframe" frameborder="0"
                            style="width: ${dimPrecent}%; height: ${dimPrecent}%; transform: scale(${scale}); transform-origin: 0 0; border: none;">
                        </iframe>
                    </div>
                    <!-- QR Code Overlay for Website -->
                    <div style="position: absolute; bottom: 20px; right: 20px; background: white; padding: 10px; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.3); z-index: 50;">
                        <img src="https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(item.mediaSource)}" style="width: 120px; height: 120px; display: block;" alt="QR Code">
                        <div style="text-align: center; font-size: 0.8rem; color: #000; font-weight: bold; margin-top: 5px;">SCAN ME</div>
                    </div>`;
            } else if (item.mediaType === 'pdf' && item.mediaSource) {
                mediaHtml = `<embed src="${item.mediaSource}" type="application/pdf" width="100%" height="100%">`;
            } else if (item.mediaType === 'youtube' && item.mediaSource) {
                const videoId = DisplayApp.extractYoutubeId(item.mediaSource);
                if (videoId) {
                    // Autoplay, Mute, Loop, No Controls, Playlist (for loop to work)
                    const embedUrl = `https://www.youtube.com/embed/${videoId}?autoplay=1&mute=1&controls=0&loop=1&playlist=${videoId}`;
                    mediaHtml = `<iframe src="${embedUrl}" class="slide-iframe" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>`;
                } else {
                    mediaHtml = '<div style="display:flex;justify-content:center;align-items:center;height:100%;">Invalid YouTube URL</div>';
                }
            } else if (item.mediaType === 'countdown' && item.mediaSource) {
                mediaHtml = `
                    <div class="countdown-wrapper" data-target="${item.mediaSource}" style="display:flex; flex-direction:column; justify-content:center; align-items:center; height:100%; width:100%; color: var(--accent-color);">
                        <h1 style="font-size: 4rem; color: white; margin-bottom: 2rem; text-shadow: 0 4px 10px rgba(0,0,0,0.5);">${item.title}</h1>
                        <div class="countdown-timer" style="display: flex; gap: 2rem; text-align: center;">
                            <div><div class="cd-val cd-days" style="font-size: 6rem; font-weight: 900;">00</div><div style="font-size: 1.5rem; text-transform:uppercase;">ΗΜΕΡΕΣ</div></div>
                            <div style="font-size: 6rem;">:</div>
                            <div><div class="cd-val cd-hours" style="font-size: 6rem; font-weight: 900;">00</div><div style="font-size: 1.5rem; text-transform:uppercase;">ΩΡΕΣ</div></div>
                            <div style="font-size: 6rem;">:</div>
                            <div><div class="cd-val cd-mins" style="font-size: 6rem; font-weight: 900;">00</div><div style="font-size: 1.5rem; text-transform:uppercase;">ΛΕΠΤΑ</div></div>
                            <div style="font-size: 6rem;">:</div>
                            <div><div class="cd-val cd-secs" style="font-size: 6rem; font-weight: 900;">00</div><div style="font-size: 1.5rem; text-transform:uppercase;">ΔΕΥΤ/ΛΕΠΤΑ</div></div>
                        </div>
                    </div>
                 `;
            } else if (item.mediaType === 'poll') {
                mediaHtml = `
                    <div class="poll-wrapper" data-id="${item.id}" style="display:flex; width:100%; height:100%; gap:2rem;">
                        <div style="flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; background:rgba(0,0,0,0.2); border-radius:16px; padding:2rem;">
                            <h2 style="margin-bottom:1.5rem; color:var(--accent-color);">📷 Ψηφίστε Τώρα!</h2>
                            <div id="qrcode-${item.id}" style="background:white; padding:1.5rem; border-radius:12px; box-shadow:0 10px 25px rgba(0,0,0,0.3);"></div>
                            <p style="margin-top:1rem; opacity:0.7;">Σκανάρετε με το κινητό σας</p>
                        </div>
                        <div style="flex:2; display:flex; flex-direction:column; justify-content:center; padding:1rem;">
                            <h1 style="font-size:3rem; margin-bottom:2rem; line-height:1.2;">${item.mediaSource}</h1>
                            <div id="poll-results-${item.id}" class="poll-results-container" style="display:flex; flex-direction:column; gap:1.5rem;">
                                <!-- Bars will be injected/updated here -->
                            </div>
                        </div>
                    </div>
                `;
            } else if (item.mediaType === 'schedule') {
                if (item.mediaSource && item.mediaSource.startsWith('data:application/pdf')) {
                    // It's a PDF
                    mediaHtml = `<embed src="${item.mediaSource}" type="application/pdf" width="100%" height="100%">`;
                } else if (item.mediaSource) {
                    // It's likely an Excel file (base64)
                    try {
                        let base64Data = item.mediaSource;
                        if (item.mediaSource.includes('base64,')) {
                            base64Data = item.mediaSource.split('base64,')[1];
                        }

                        if (typeof XLSX !== 'undefined') {
                            const workbook = XLSX.read(base64Data, { type: 'base64' });
                            const firstSheetName = workbook.SheetNames[0];
                            const worksheet = workbook.Sheets[firstSheetName];
                            const htmlTable = XLSX.utils.sheet_to_html(worksheet, { id: `table-${item.id}`, editable: false });

                            mediaHtml = `
                                <div class="schedule-wrapper" style="width:100%; height:100%; overflow:auto; padding:2rem;">
                                    <div class="excel-table-container">
                                        ${htmlTable}
                                    </div>
                                </div>
                            `;
                        } else {
                            mediaHtml = '<div class="loading">Loading Schedule... (Library not ready)</div>';
                        }
                    } catch (e) {
                        console.error("Error parsing schedule", e);
                        mediaHtml = '<div style="color:red; font-size: 2rem;">Σφάλμα κατά την ανάγνωση του αρχείου.</div>';
                    }
                }
            }


            // Decide standard vs split render
            if (item.layout && (item.layout === 'split-left' || item.layout === 'split-right')) {
                // SPLIT VIEW
                contentHtml = `
                    <div class="split-media">
                        ${mediaHtml || '<div style="display:grid;place-items:center;height:100%;color:#666;">Χωρίς Πολυμέσα</div>'}
                    </div>
                    <div class="split-content">
                        <div class="slide-type" style="position:static; margin-bottom:1rem; display:inline-block;">${DisplayApp.getTypeLabel(item.type)}</div>
                        <h1 class="slide-title" style="font-size: 3rem; margin-bottom: 1.5rem;">${item.title}</h1>
                        <div class="slide-body" style="font-size: 1.5rem;">${item.content}</div>
                    </div>
                `;
            } else {
                // FULLSCREEN VIEW (Standard)
                if (mediaHtml) {
                    contentHtml = `
                        ${mediaHtml}
                        ${item.content ? `<div class="slide-overlay"><h2>${item.title}</h2><p>${item.content}</p></div>` : ''}
                    `;
                } else {
                    // Text Only
                    contentHtml = `
                        <div class="slide-type">${DisplayApp.getTypeLabel(item.type)}</div>
                        <h1 class="slide-title">${item.title}</h1>
                        <div class="slide-body">${item.content}</div>
                    `;
                }
            }

            return `
                <div class="slide ${index === 0 ? 'active' : ''} type-${item.type} type-${item.mediaType} layout-${item.layout || 'fullscreen'}"
                    data-index="${index}"
                    data-duration="${item.duration || 10}">
                    ${contentHtml}
                </div>
            `;
        }).join('');

        // Start rotation
        if (DisplayApp.timer) clearTimeout(DisplayApp.timer);
        DisplayApp.currentIndex = 0;

        const cycleSlides = () => {
            const slides = document.querySelectorAll('.slide');
            if (slides.length === 0) return;

            const currentSlide = slides[DisplayApp.currentIndex];
            let duration = parseInt(currentSlide.dataset.duration) || 10;
            // Double duration for Alerts
            if (currentSlide.classList.contains('type-alert')) duration *= 2;

            DisplayApp.timer = setTimeout(() => {
                const slides = document.querySelectorAll('.slide');
                if (slides.length === 0) return;

                slides[DisplayApp.currentIndex].classList.remove('active');
                DisplayApp.currentIndex = (DisplayApp.currentIndex + 1) % slides.length;
                slides[DisplayApp.currentIndex].classList.add('active');

                cycleSlides();
            }, duration * 1000);
        };

        cycleSlides();

        // Initialize QR Codes & Polls after DOM update
        setTimeout(() => {
            announcements.forEach(item => {
                if (item.mediaType === 'poll') {
                    const qrEl = document.getElementById(`qrcode-${item.id}`);
                    if (qrEl) {
                        qrEl.innerHTML = '';

                        // Use configured Host URL if available, otherwise fallback to current location
                        let baseUrl = settings.hostUrl;
                        if (!baseUrl || baseUrl.trim() === '') {
                            baseUrl = window.location.href.substring(0, window.location.href.lastIndexOf('/'));
                        } else {
                            // Ensure no trailing slash for consistency
                            baseUrl = baseUrl.replace(/\/$/, '');
                        }

                        let voteUrl = '';
                        if (baseUrl.includes('vote.html')) {
                            voteUrl = baseUrl;
                        } else {
                            voteUrl = `${baseUrl}/vote.html`;
                        }

                        const url = voteUrl + `?id=${item.id}`;

                        try {
                            new QRCode(qrEl, {
                                text: url,
                                width: 256,
                                height: 256,
                                colorDark: "#000000",
                                colorLight: "#ffffff",
                                correctLevel: QRCode.CorrectLevel.H
                            });
                        } catch (e) { console.error("QR Code Error:", e); }
                    }
                    DisplayApp.updatePollResults(item.id);
                }
            });
        }, 100);
    },

    getTypeLabel: (type) => {
        const labels = {
            'info': 'ΕΝΗΜΕΡΩΣΗ',
            'alert': 'ΠΡΟΣΟΧΗ',
            'event': 'ΕΚΔΗΛΩΣΗ',
            'countdown': 'ΑΝΤΙΣΤΡΟΦΗ ΜΕΤΡΗΣΗ'
        };
        return labels[type] || 'ANAKOINΩΣΗ';
    },

    updateCountdown: () => {
        const activeSlide = document.querySelector('.slide.active');
        if (!activeSlide) return;

        const wrapper = activeSlide.querySelector('.countdown-wrapper');
        if (!wrapper) return;

        const targetDate = new Date(wrapper.getAttribute('data-target')).getTime();
        const now = new Date().getTime();
        const distance = targetDate - now;

        const days = Math.floor(distance / (1000 * 60 * 60 * 24));
        const hours = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((distance % (1000 * 60)) / 1000);

        if (distance < 0) {
            wrapper.innerHTML = '<h1 style="font-size: 5rem;">ΕΦΤΑΣΕ Η ΩΡΑ!</h1>';
            return;
        }

        const dEl = wrapper.querySelector('.cd-days');
        const hEl = wrapper.querySelector('.cd-hours');
        const mEl = wrapper.querySelector('.cd-mins');
        const sEl = wrapper.querySelector('.cd-secs');

        if (dEl) dEl.innerText = days < 10 ? '0' + days : days;
        if (hEl) hEl.innerText = hours < 10 ? '0' + hours : hours;
        if (mEl) mEl.innerText = minutes < 10 ? '0' + minutes : minutes;
        if (sEl) sEl.innerText = seconds < 10 ? '0' + seconds : seconds;
    },

    extractYoutubeId: (url) => {
        if (!url) return null;
        const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
        const match = url.match(regExp);
        return (match && match[2].length === 11) ? match[2] : null;
    },

    updatePollResults: (pollId) => {
        const resultsContainer = document.getElementById(`poll-results-${pollId}`);
        if (!resultsContainer) return;

        // Get Poll Data
        const allData = DataManager.getAll();
        const poll = allData.find(i => i.id == pollId);
        if (!poll) return;

        let options = [];
        try { options = JSON.parse(poll.extraData || '[]'); } catch (e) { }
        if (options.length === 0) options = ['Yes', 'No'];

        // Get Votes
        const votes = JSON.parse(localStorage.getItem('poll_results_' + pollId) || '{}');
        const totalVotes = Object.values(votes).reduce((a, b) => a + b, 0);

        // Render Bars
        resultsContainer.innerHTML = options.map((opt, index) => {
            const count = votes[index] || 0;
            const percentage = totalVotes === 0 ? 0 : Math.round((count / totalVotes) * 100);

            return `
                <div style="background:rgba(255,255,255,0.05); padding:1rem; border-radius:8px;">
                     <div style="display:flex; justify-content:space-between; margin-bottom:0.5rem; font-size:1.2rem; font-weight:bold;">
                         <span>${opt}</span>
                         <span>${count} ψήφοι (${percentage}%)</span>
                     </div>
                     <div style="background:rgba(255,255,255,0.1); height:16px; border-radius:10px; overflow:hidden;">
                         <div style="background:var(--success-color); height:100%; width:${percentage}%; transition:width 0.5s cubic-bezier(0.4, 0, 0.2, 1);"></div>
                     </div>
                </div>
            `;
        }).join('');
    },

    applyTheme: (themeName) => {
        const themes = {
            default: {
                '--bg-color': '#0f172a',
                '--card-bg': '#1e293b',
                '--text-primary': '#f8fafc',
                '--text-secondary': '#94a3b8',
                '--accent-color': '#3b82f6',
                '--accent-hover': '#2563eb',
                '--success-color': '#22c55e',
                '--warning-color': '#eab308',
                '--alert-color': '#ef4444'
            },
            christmas: {
                '--bg-color': '#0a1628',
                '--card-bg': '#1a2942',
                '--text-primary': '#ffffff',
                '--text-secondary': '#cbd5e1',
                '--accent-color': '#dc2626',
                '--accent-hover': '#b91c1c',
                '--success-color': '#16a34a',
                '--warning-color': '#fbbf24',
                '--alert-color': '#dc2626'
            },
            easter: {
                '--bg-color': '#1e1b4b',
                '--card-bg': '#312e81',
                '--text-primary': '#fef3c7',
                '--text-secondary': '#fde68a',
                '--accent-color': '#a855f7',
                '--accent-hover': '#9333ea',
                '--success-color': '#84cc16',
                '--warning-color': '#fbbf24',
                '--alert-color': '#f59e0b'
            },
            national: {
                '--bg-color': '#0c1e3d',
                '--card-bg': '#1e3a5f',
                '--text-primary': '#ffffff',
                '--text-secondary': '#bfdbfe',
                '--accent-color': '#60a5fa',
                '--accent-hover': '#3b82f6',
                '--success-color': '#22c55e',
                '--warning-color': '#fbbf24',
                '--alert-color': '#ef4444'
            },
            celebration: {
                '--bg-color': '#18181b',
                '--card-bg': '#27272a',
                '--text-primary': '#fafafa',
                '--text-secondary': '#d4d4d8',
                '--accent-color': '#f59e0b',
                '--accent-hover': '#d97706',
                '--success-color': '#10b981',
                '--warning-color': '#fbbf24',
                '--alert-color': '#ef4444'
            },
            valentine: {
                '--bg-color': '#1a0a14',
                '--card-bg': '#2d1420',
                '--text-primary': '#fce7f3',
                '--text-secondary': '#fbcfe8',
                '--accent-color': '#ec4899',
                '--accent-hover': '#db2777',
                '--success-color': '#f472b6',
                '--warning-color': '#fbbf24',
                '--alert-color': '#f43f5e'
            },
            exams: {
                '--bg-color': '#1c1917',
                '--card-bg': '#292524',
                '--text-primary': '#fafaf9',
                '--text-secondary': '#a8a29e',
                '--accent-color': '#78716c',
                '--accent-hover': '#57534e',
                '--success-color': '#22c55e',
                '--warning-color': '#eab308',
                '--alert-color': '#dc2626'
            }
        };

        const theme = themes[themeName] || themes.default;
        const root = document.documentElement;

        Object.keys(theme).forEach(property => {
            root.style.setProperty(property, theme[property]);
        });

        // Add theme-specific body class for additional styling
        document.body.className = document.body.className.replace(/theme-\w+/g, '');
        document.body.classList.add(`theme-${themeName}`);

        // Add animated decorations
        DisplayApp.addThemeDecorations(themeName);
    },

    addThemeDecorations: (themeName) => {
        console.log('Adding decorations for theme:', themeName);

        // Remove existing decorations
        const existingDecorations = document.getElementById('theme-decorations');
        if (existingDecorations) existingDecorations.remove();

        // Create decorations container
        const decorationsContainer = document.createElement('div');
        decorationsContainer.id = 'theme-decorations';
        decorationsContainer.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; z-index: 50; overflow: hidden;';

        // Add inline animations
        const styleTag = document.createElement('style');
        styleTag.textContent = `
            @keyframes themeFall {
                0% { transform: translateY(-50px) rotate(0deg); }
                100% { transform: translateY(calc(100vh + 50px)) rotate(360deg); }
            }
            @keyframes themeRise {
                0% { transform: translateY(0) rotate(0deg); }
                100% { transform: translateY(-120vh) rotate(360deg); }
            }
            @keyframes themeWave {
                0%, 100% { transform: rotate(-5deg) scale(1); }
                50% { transform: rotate(5deg) scale(1.1); }
            }
            @keyframes themeConfettiFall {
                0% { transform: translateY(-50px) rotate(0deg) translateX(0); }
                50% { transform: translateY(50vh) rotate(180deg) translateX(50px); }
                100% { transform: translateY(calc(100vh + 50px)) rotate(360deg) translateX(0); }
            }
            @keyframes themeFloat {
                0% { transform: translateY(0) translateX(0) rotate(0deg); }
                50% { transform: translateY(-50vh) translateX(30px) rotate(180deg) scale(1.2); }
                100% { transform: translateY(-120vh) translateX(0) rotate(360deg); }
            }
        `;
        document.head.appendChild(styleTag);

        const decorations = {
            christmas: () => {
                // Snowflakes and Christmas elements
                for (let i = 0; i < 40; i++) {
                    const element = document.createElement('div');
                    const symbols = ['❄', '✦', '✧', '⛄', '🎄', '⭐', '❅', '❆'];
                    element.textContent = symbols[Math.floor(Math.random() * symbols.length)];
                    element.style.cssText = `
                        position: absolute;
                        top: -50px;
                        left: ${Math.random() * 100}%;
                        font-size: ${Math.random() * 30 + 25}px;
                        color: ${['#ffffff', '#e0f2fe', '#dbeafe', '#dc2626', '#16a34a'][Math.floor(Math.random() * 5)]};
                        animation: themeFall ${Math.random() * 10 + 10}s linear infinite;
                        animation-delay: ${Math.random() * 5}s;
                        opacity: ${Math.random() * 0.6 + 0.4};
                        text-shadow: 0 0 10px currentColor;
                        filter: drop-shadow(0 0 5px currentColor);
                    `;
                    decorationsContainer.appendChild(element);
                }
            },
            easter: () => {
                // Spring flowers and Easter elements
                for (let i = 0; i < 35; i++) {
                    const element = document.createElement('div');
                    const symbols = ['✿', '❀', '✾', '🌸', '🌺', '🌼', '🌷', '🥚', '🐰'];
                    element.textContent = symbols[Math.floor(Math.random() * symbols.length)];
                    element.style.cssText = `
                        position: absolute;
                        bottom: 0;
                        left: ${Math.random() * 100}%;
                        font-size: ${Math.random() * 35 + 30}px;
                        color: ${['#fde68a', '#fef3c7', '#a855f7', '#f472b6', '#84cc16'][Math.floor(Math.random() * 5)]};
                        animation: themeRise ${Math.random() * 15 + 15}s linear infinite;
                        animation-delay: ${Math.random() * 10}s;
                        opacity: ${Math.random() * 0.7 + 0.4};
                        text-shadow: 0 0 15px currentColor;
                        filter: drop-shadow(0 0 8px currentColor);
                    `;
                    decorationsContainer.appendChild(element);
                }
            },
            national: () => {
                // Greek flags - Simplified and larger
                for (let i = 0; i < 30; i++) {
                    const flagContainer = document.createElement('div');

                    // Create flag structure
                    let flagHTML = '';
                    // 9 stripes (5 blue, 4 white)
                    for (let stripe = 0; stripe < 9; stripe++) {
                        const color = stripe % 2 === 0 ? '#0D5EAF' : '#FFFFFF';
                        flagHTML += `<div style="width:100%; height:11.11%; background:${color};"></div>`;
                    }

                    flagContainer.innerHTML = `
                        <div style="
                            width: 90px;
                            height: 60px;
                            position: relative;
                            box-shadow: 0 4px 12px rgba(0,0,0,0.4);
                            border: 1px solid rgba(255,255,255,0.2);
                        ">
                            ${flagHTML}
                            <div style="
                                position: absolute;
                                top: 0;
                                left: 0;
                                width: 38%;
                                height: 54%;
                                background: #0D5EAF;
                            ">
                                <div style="
                                    position: absolute;
                                    top: 50%;
                                    left: 0;
                                    width: 100%;
                                    height: 18%;
                                    background: white;
                                    transform: translateY(-50%);
                                "></div>
                                <div style="
                                    position: absolute;
                                    left: 50%;
                                    top: 0;
                                    width: 18%;
                                    height: 100%;
                                    background: white;
                                    transform: translateX(-50%);
                                "></div>
                            </div>
                        </div>
                    `;

                    flagContainer.style.cssText = `
                        position: absolute;
                        top: ${Math.random() * 70 + 15}%;
                        left: ${Math.random() * 85 + 7.5}%;
                        animation: themeWave ${Math.random() * 2.5 + 1.5}s ease-in-out infinite;
                        animation-delay: ${Math.random() * 2}s;
                        opacity: ${Math.random() * 0.4 + 0.5};
                        transform-origin: left center;
                        filter: drop-shadow(0 0 10px rgba(13, 94, 175, 0.6));
                    `;
                    decorationsContainer.appendChild(flagContainer);
                }
            },
            celebration: () => {
                // Confetti and party elements
                for (let i = 0; i < 50; i++) {
                    const element = document.createElement('div');
                    const symbols = ['★', '✦', '✧', '◆', '●', '■', '▲', '�', '�', '✨'];
                    element.textContent = symbols[Math.floor(Math.random() * symbols.length)];
                    element.style.cssText = `
                        position: absolute;
                        top: -50px;
                        left: ${Math.random() * 100}%;
                        font-size: ${Math.random() * 30 + 20}px;
                        color: ${['#f59e0b', '#fbbf24', '#10b981', '#3b82f6', '#ec4899'][Math.floor(Math.random() * 5)]};
                        animation: themeConfettiFall ${Math.random() * 8 + 5}s linear infinite;
                        animation-delay: ${Math.random() * 3}s;
                        opacity: ${Math.random() * 0.8 + 0.3};
                        text-shadow: 0 0 12px currentColor;
                        filter: drop-shadow(0 0 6px currentColor);
                    `;
                    decorationsContainer.appendChild(element);
                }
            },
            valentine: () => {
                // Hearts and romantic elements
                for (let i = 0; i < 40; i++) {
                    const element = document.createElement('div');
                    const symbols = ['♥', '❤', '💕', '💖', '💗', '💝', '💘', '🌹'];
                    element.textContent = symbols[Math.floor(Math.random() * symbols.length)];
                    element.style.cssText = `
                        position: absolute;
                        bottom: 0;
                        left: ${Math.random() * 100}%;
                        font-size: ${Math.random() * 35 + 30}px;
                        color: ${['#ec4899', '#f472b6', '#db2777', '#fce7f3', '#fbcfe8'][Math.floor(Math.random() * 5)]};
                        animation: themeFloat ${Math.random() * 12 + 12}s ease-in-out infinite;
                        animation-delay: ${Math.random() * 8}s;
                        opacity: ${Math.random() * 0.7 + 0.4};
                        text-shadow: 0 0 15px currentColor;
                        filter: drop-shadow(0 0 10px currentColor);
                    `;
                    decorationsContainer.appendChild(element);
                }
            }
        };

        // Apply decorations for the current theme
        if (decorations[themeName]) {
            decorations[themeName]();
            document.body.appendChild(decorationsContainer);
        }
    }
};

// Global expose
window.AdminApp = AdminApp;
window.DisplayApp = DisplayApp;
window.DataManager = DataManager;

/* --- AUTO-INJECTED CSS FOR ALERTS --- */
(function () {
    const style = document.createElement('style');
    style.innerHTML = `
        /* Κόκκινο Εφέ Alerts */
        .type-alert .slide-type {
            background: rgba(220, 38, 38, 0.95) !important;
            color: #ffffff !important;
            font-weight: 900 !important;
            font-size: 1.5rem !important;
            padding: 0.8rem 2rem !important;
            border: 2px solid white !important;
            border-radius: 50px !important;
            box-shadow: 0 4px 15px rgba(0,0,0,0.5) !important;
            animation: alertBadgePulse 1s infinite alternate !important;
            z-index: 100 !important;
        }

        .slide.type-alert {
            border: 15px solid #dc2626 !important;
            box-shadow: inset 0 0 80px rgba(220, 38, 38, 0.6) !important;
            animation: alertBorderPulse 1s infinite alternate !important;
        }

        .slide.type-alert.active .slide-title {
            color: #ef4444 !important;
            text-shadow: 2px 2px 4px rgba(0,0,0,0.8) !important;
            font-size: 5rem !important;
            background: none !important;
            -webkit-text-fill-color: initial !important;
        }

        @keyframes alertBadgePulse {
            from { transform: scale(1); opacity: 0.9; }
            to { transform: scale(1.1); opacity: 1; box-shadow: 0 0 25px rgba(255,0,0,0.8); }
        }

        @keyframes alertBorderPulse {
            from { border-color: #dc2626; box-shadow: inset 0 0 50px rgba(220, 38, 38, 0.3); }
            to { border-color: #ff0000; box-shadow: inset 0 0 150px rgba(255, 0, 0, 0.6); }
        }
    `;
    document.head.appendChild(style);
})();
/* ----------------------------------- */
