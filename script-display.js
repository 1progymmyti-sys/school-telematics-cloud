import { db, doc, onSnapshot, collection, query, orderBy } from "./firebase-config.js";
import ParticleEngine from "./canvas-particles.js?v=exams_fix2";

// Global State
let allAnnouncements = [];
let slides = [];
let currentIndex = 0;
let timer = null;
let currentSettings = {};
let emergencyActive = false;
let audioCtx = null;
let weatherInterval = null;
const particleEngine = new ParticleEngine();
let rssInterval = null;
let tickerAnimId = null;
let tickerOffset = window.innerWidth;
let lastTickerContent = '';

// Helper: Fetch RSS Feed directly (now that CORS is enabled)
async function fetchRSS(url) {
    if (!url) return;
    try {
        const res = await fetch(url);
        const xmlText = await res.text();

        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xmlText, "text/xml");
        const items = xmlDoc.querySelectorAll("item");

        if (items && items.length > 0) {
            let htmlItems = [];
            items.forEach((item, index) => {
                if (index >= 5) return; // Keep only the latest 5 to avoid enormous text
                const title = item.querySelector("title")?.textContent;
                if (title) {
                    htmlItems.push(`<span style="margin-right: 100px; font-family: 'Playfair Display', serif; font-size: 1.6rem; font-weight:600; text-shadow: 1px 1px 2px rgba(0,0,0,0.3); display:inline-flex; align-items:center;"><span style="color:#fbbf24; font-size:1.5em; margin-right:10px;">&bull;</span> ${title}</span>`);
                }
            });
            showTickerText(htmlItems.join(''), "ΕΝΗΜΕΡΩΣΗ");
        } else {
            console.warn("No items found in RSS feed");
        }
    } catch (e) {
        console.error("RSS Error:", e);
    }
}


function showTickerText(htmlContent, labelText) {
    const tickerContainer = document.getElementById('tickerContainer');
    const tickerContent = document.getElementById('tickerContent');

    // Update label if provided
    if (tickerContainer && labelText) {
        const labelEl = tickerContainer.querySelector('.ticker-label');
        if (labelEl) labelEl.innerText = labelText;
    }

    // Check if changed to avoid reset
    if (lastTickerContent === htmlContent && tickerAnimId) return;
    lastTickerContent = htmlContent;

    console.log("Showing New Ticker Content");

    if (tickerContainer && tickerContent) {
        tickerContainer.style.display = 'flex';
        // Use clean class based logic
        tickerContent.innerHTML = `<div class="ticker-text" id="movingTicker">${htmlContent}</div>`;

        // Start JS Animation
        const el = document.getElementById('movingTicker');
        if (el) startTickerAnim(el);
    }
}

function startTickerAnim(element) {
    if (tickerAnimId) cancelAnimationFrame(tickerAnimId);
    tickerOffset = window.innerWidth; // Reset start pos

    function loop() {
        tickerOffset -= 1.8; // Faster Speed (requested slightly faster)

        // If fully off-screen left, reset to right
        if (tickerOffset < -element.offsetWidth) {
            tickerOffset = window.innerWidth;
        }

        // Apply transform (maintain Y centering)
        element.style.transform = `translate3d(${tickerOffset}px, -50%, 0)`;

        tickerAnimId = requestAnimationFrame(loop);
    }
    loop();
}

// Helper: Get Active Slides
const getActiveSlides = (list) => {
    const now = new Date();
    return list.filter(item => {
        if (item.isPaused) return false; // Filter paused items
        const start = item.startDate ? new Date(item.startDate) : null;
        const end = item.endDate ? new Date(item.endDate) : null;
        if (start && now < start) return false;
        if (end && now > end) return false;

        // Daily Time Check (Advanced Scheduling)
        if (item.startTime || item.endTime) {
            const currentHHMM = now.getHours().toString().padStart(2, '0') + ":" + now.getMinutes().toString().padStart(2, '0');
            if (item.startTime && currentHHMM < item.startTime) return false;
            if (item.endTime && currentHHMM > item.endTime) return false;
        }

        return true;
    });
};

window.onload = () => {
    console.log("Display Cloud App Starting...");
    showTickerText("⏳ Φόρτωση ενημερώσεων...", "ΕΝΗΜΕΡΩΣΗ"); // Initial debug text

    // 1. Settings Listener
    onSnapshot(doc(db, "settings", "schoolConfig"), (docSnap) => {
        if (docSnap.exists()) {
            const data = docSnap.data();
            currentSettings = data;
            applySettings(data);

            if (data.emergency && data.emergency.enabled) {
                activateEmergency(data.emergency.message);
            } else {
                if (emergencyActive) {
                    emergencyActive = false;
                    document.getElementById('slideContainer').innerHTML = ''; // Clear emergency
                    startRotation();
                }
            }
        }
    });

    // 2. Announcements Listener
    const q = query(collection(db, "announcements"));
    onSnapshot(q, (snapshot) => {
        allAnnouncements = [];
        snapshot.forEach(doc => {
            const d = doc.data();
            d.id = doc.id;
            allAnnouncements.push(d);
        });

        // Sort client-side
        allAnnouncements.sort((a, b) => {
            const aHasOrder = a.order !== undefined && a.order !== null;
            const bHasOrder = b.order !== undefined && b.order !== null;
            if (aHasOrder && bHasOrder) return a.order - b.order;
            if (aHasOrder) return -1;
            if (bHasOrder) return 1;
            // Both legacy: sort newest first
            return (b.createdAt || '') > (a.createdAt || '') ? 1 : -1;
        });

        slides = getActiveSlides(allAnnouncements);
        updateSidebarUpcoming(allAnnouncements); // NEW: Update the sidebar list

        if (!emergencyActive && slides.length > 0) {
            // Restart rotation if list changed
            startRotation();
        } else if (slides.length === 0 && !emergencyActive) {
            document.getElementById('slideContainer').innerHTML = '<div class="slide active"><h1>Αναμονή για ενημερώσεις...</h1></div>';
        }
    });

    // Clock
    setInterval(updateClock, 1000);
    updateClock();

    // Audio Unlock
    document.body.addEventListener('click', () => {
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (audioCtx.state === 'suspended') audioCtx.resume();
    });
};

// Schedule Data
const schoolSchedule = [
    { name: "1η Ώρα", type: "lesson", start: "08:00", end: "08:45" },
    { name: "1ο Διάλειμμα", type: "break", start: "08:45", end: "08:50" },
    { name: "2η Ώρα", type: "lesson", start: "08:50", end: "09:35" },
    { name: "2ο Διάλειμμα", type: "break", start: "09:35", end: "09:45" },
    { name: "3η Ώρα", type: "lesson", start: "09:45", end: "10:30" },
    { name: "3ο Διάλειμμα", type: "break", start: "10:30", end: "10:40" },
    { name: "4η Ώρα", type: "lesson", start: "10:40", end: "11:25" },
    { name: "4ο Διάλειμμα", type: "break", start: "11:25", end: "11:35" },
    { name: "5η Ώρα", type: "lesson", start: "11:35", end: "12:20" },
    { name: "5ο Διάλειμμα", type: "break", start: "12:20", end: "12:25" },
    { name: "6η Ώρα", type: "lesson", start: "12:25", end: "13:10" },
    { name: "6ο Διάλειμμα", type: "break", start: "13:10", end: "13:15" },
    { name: "7η Ώρα", type: "lesson", start: "13:15", end: "13:55" }
];

function updateScheduleStatus() {
    try {
        const now = new Date();
        const currentTime = now.getHours() * 60 + now.getMinutes();
        const displayEl = document.getElementById('schoolScheduleStatus');

        if (!displayEl) return;

        // Hide during weekends (0 = Sunday, 6 = Saturday)
        const dayOfWeek = now.getDay();
        if (dayOfWeek === 0 || dayOfWeek === 6) {
            displayEl.style.display = 'none';
            return;
        }

        let activeSlot = null;
        let nextSlot = null;

        for (let i = 0; i < schoolSchedule.length; i++) {
            const slot = schoolSchedule[i];
            const [sH, sM] = slot.start.split(':').map(Number);
            const [eH, eM] = slot.end.split(':').map(Number);

            // Convert to minutes
            const startTotal = sH * 60 + sM;
            const endTotal = eH * 60 + eM;

            if (currentTime >= startTotal && currentTime < endTotal) {
                activeSlot = { ...slot, endTotal };
                nextSlot = schoolSchedule[i + 1];
                break;
            }
        }

        if (activeSlot) {
            const remaining = activeSlot.endTotal - currentTime;
            let text = `${activeSlot.name} (Λήξη σε ${remaining}')`;

            if (nextSlot) {
                text += ` -> Ακολουθεί: ${nextSlot.name}`;
            } else {
                text += ` -> Ακολουθεί: Λήξη Μαθημάτων`;
            }

            displayEl.textContent = text;
            displayEl.style.display = 'block';
        } else {
            displayEl.style.display = 'none';
        }

    } catch (e) {
        console.error("Schedule Error", e);
    }
}

function updateClock() {
    const now = new Date();
    const isDashboard = document.body.classList.contains('dashboard-mode');

    if (isDashboard) {
        // Dashboard Format (09:45 AM)
        let h = now.getHours();
        const m = now.getMinutes().toString().padStart(2, '0');
        const ampm = h >= 12 ? 'PM' : 'AM';
        h = h % 12;
        h = h ? h : 12; // 0 should be 12
        const hStr = h.toString().padStart(2, '0');
        
        document.getElementById('clock').innerHTML = `${hStr}:${m}<span style="font-size:0.4em; margin-left:10px; opacity:0.8; vertical-align:middle; text-transform:uppercase;">${ampm}</span>`;
        
        // Full Date: Monday, September 9, 2024
        const opts = { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' };
        document.getElementById('date').innerText = now.toLocaleDateString('en-US', opts);
    } else {
        // Legacy format (24h)
        document.getElementById('clock').innerText = now.toLocaleTimeString('el-GR', { hour: '2-digit', minute: '2-digit' });
        document.getElementById('date').innerText = now.toLocaleDateString('el-GR', { weekday: 'long', day: 'numeric', month: 'long' });
    }
    
    updateScheduleStatus();
}

function applySettings(s) {
    if (s.schoolName) document.getElementById('schoolNameDisplay').innerText = s.schoolName;
    if (s.logo) document.getElementById('schoolLogo').src = s.logo;

    // Weather
    if (s.weatherCity) {
        updateWeather(s.weatherCity); // Initial Call
        if (weatherInterval) clearInterval(weatherInterval);
        weatherInterval = setInterval(() => {
            updateWeather(s.weatherCity).catch(err => {
                console.error("Weather Interval Error:", err);
                // Retry in 1 minute if failed
                setTimeout(() => updateWeather(s.weatherCity), 60000);
            });
        }, 1800000); // 30 mins
    }

    // Ticker Logic (Text Priority, then RSS)
    const tickerContainer = document.getElementById('tickerContainer');

    // Clear previous interval
    if (rssInterval) {
        clearInterval(rssInterval);
        rssInterval = null;
    }

    if (s.tickerMessage && s.tickerMessage.trim() !== "") {
        // 1. Text Message (Highest Priority)
        showTickerText(`<span>📢 ${s.tickerMessage}</span>`, "ΔΙΕΥΘΥΝΣΗ");
    }
    else if (s.rssUrl && s.rssUrl.trim() !== "") {
        // 2. RSS Feed (If text is empty)
        fetchRSS(s.rssUrl);
        rssInterval = setInterval(() => fetchRSS(s.rssUrl), 600000);
    }
    else {
        // 3. Nothing -> Hide
        if (tickerContainer) tickerContainer.style.display = 'none';
    }

    // Theme - Remove old theme classes first
    document.body.classList.forEach(cls => {
        if (cls.startsWith('theme-')) document.body.classList.remove(cls);
    });
    document.body.classList.add(`theme-${s.theme || 'default'}`);

    // Start Particles
    particleEngine.start(s.theme || 'default');

    // Banner
    const banner = document.getElementById('bannerContainer');
    if (s.banner && s.banner.enabled && s.banner.image) {
        banner.style.display = 'block';
        banner.innerHTML = `<img src="${s.banner.image}" class="banner-image">`;
        banner.className = `banner-container banner-${s.banner.position}`;
    } else {
        banner.style.display = 'none';
    }
}

async function updateWeather(city) {
    if (!city) return;
    const weatherEl = document.getElementById('weather');

    // Check if we have cached coordinates to avoid excessive geocoding calls
    // For simplicity in this version, we will fetch every time or rely on browser caching of the fetch request

    try {
        console.log(`Fetching weather for: ${city}`);

        // 1. Geocoding: Get Lat/Lon for the city
        // We add 'Greece' to context if possible, but searching by name usually works fine
        const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=el&format=json`;
        const geoRes = await fetch(geoUrl);
        const geoData = await geoRes.json();

        if (!geoData.results || geoData.results.length === 0) {
            console.warn("Weather: City not found");
            weatherEl.innerHTML = `⚠️ ${city} ?`;
            return;
        }

        const location = geoData.results[0];
        const { latitude, longitude, name } = location;

        // 2. Weather: Get current weather
        // Add timestamp to prevent caching
        const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current_weather=true&_t=${Date.now()}`;
        const weatherRes = await fetch(weatherUrl);
        const weatherData = await weatherRes.json();

        if (weatherData.current_weather) {
            const temp = Math.round(weatherData.current_weather.temperature);
            const wmoCode = weatherData.current_weather.weathercode;
            const weatherInfo = getWeatherDescription(wmoCode);

            // Update UI to match reference image
            weatherEl.innerHTML = `
                <div style="display:flex; align-items:center; justify-content:space-around; width:100%;">
                    <div style="font-size:3.5rem;">${weatherInfo.icon}</div>
                    <div style="text-align:right;">
                        <div style="font-size:1.1rem; color:var(--text-secondary); text-transform:capitalize;">${weatherInfo.desc}</div>
                        <div style="font-size:3.4rem; font-weight:800; color:white;">${temp}°C</div>
                    </div>
                </div>
                <div style="width:100%; font-size:0.9rem; color:#94a3b8; display:flex; gap:0.5rem; justify-content:center; border-top:1px solid rgba(255,255,255,0.1); padding-top:1rem; margin-top:1rem;">
                    <span style="border-right:1px solid #475569; padding-right:0.5rem;">${name || city}</span>
                    <span style="border-right:1px solid #475569; padding-right:0.5rem;">Wind: 10 km/h</span>
                    <span>Humid: 65%</span>
                </div>
            `;
        }
    } catch (error) {
        console.error("Weather Error:", error);
        weatherEl.innerHTML = `❌ ${city}`;
    }
}

// Helper: Map WMO codes to Greek descriptions and Icons
function getWeatherDescription(code) {
    // WMO Weather interpretation codes (WW)
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
}

function activateEmergency(msg) {
    emergencyActive = true;
    if (timer) clearTimeout(timer);

    const container = document.getElementById('slideContainer');
    container.innerHTML = `
        <div class="slide active type-alert" style="background:#dc2626; color:white; z-index:9999; display:flex; flex-direction:column; justify-content:center; align-items:center;">
            <div style="font-size:8rem; animation:pulse 0.5s infinite;">🚨</div>
            <h1 style="font-size:5vw; margin:2rem 0; font-weight:900; text-align:center;">${msg || 'ΕΚΤΑΚΤΗ ΑΝΑΓΚΗ'}</h1>
        </div>
    `;

    playSirenLoop();
}

function playSirenLoop() {
    if (!emergencyActive) return;
    if (audioCtx) {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);

        osc.type = 'square';
        osc.frequency.setValueAtTime(800, audioCtx.currentTime);
        osc.frequency.linearRampToValueAtTime(600, audioCtx.currentTime + 0.5);

        gain.gain.setValueAtTime(0.5, audioCtx.currentTime);
        gain.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 1);

        osc.start();
        osc.stop(audioCtx.currentTime + 1);
    }
    setTimeout(playSirenLoop, 3000);
}

function startRotation() {
    if (emergencyActive) return;
    if (timer) clearTimeout(timer); // Clear previous

    // Re-filter slides in case time-based constraints changed
    slides = getActiveSlides(allAnnouncements);

    if (slides.length === 0) return;
    if (currentIndex >= slides.length) currentIndex = 0;

    const item = slides[currentIndex];
    renderSlide(item);

    let duration = (item.duration || 10) * 1000;
    if (item.type === 'alert') duration *= 2; // Double for alert

    timer = setTimeout(() => {
        currentIndex++;
        startRotation();
    }, duration);
}

function renderSlide(item) {
    const container = document.getElementById('slideContainer');
    let contentHtml = '';
    const layoutClass = `layout-${item.layout || 'fullscreen'}`;

    // Layout Checks (Disabled in Dashboard Mode to keep sidebar visible)
    /*
    const isFullMedia = (item.layout === 'fullscreen' || !item.layout) &&
        ['image', 'live_image', 'youtube'].includes(item.mediaType);

    if (isFullMedia) {
        document.body.classList.add('fullscreen-mode');
    } else {
        document.body.classList.remove('fullscreen-mode');
    }
    */


    const isDashboard = document.body.classList.contains('dashboard-mode');

    // Media Logic
    if (item.mediaType === 'image' || item.mediaType === 'live_image') {
        const url = item.mediaType === 'live_image' ? `${item.mediaSource}?t=${Date.now()}` : item.mediaSource;
        
        if (isDashboard) {
            contentHtml = `
                <h1 class="slide-title" style="text-align:center;">${item.title}</h1>
                <img src="${url}" class="slide-image" style="width: auto; max-width: 90%; height: auto; max-height: 55vh; margin: 0 auto;">
                ${item.content ? `<div style="margin-top: 1.5rem; color:#94a3b8; font-size:1.4rem; text-align:center; max-width:80%;">${item.content}</div>` : ''}
                <div style="margin-top: 1rem; color: var(--accent-color); font-weight:700; font-size:1.1rem; opacity:0.8;">#SchoolName #Updated</div>
            `;
        } else {
            contentHtml = `<img src="${url}" class="slide-image">`;
            if (item.content) contentHtml += `<div class="slide-overlay"><h2>${item.title}</h2><div>${item.content}</div></div>`;
        }
    }
    else if (item.mediaType === 'youtube') {
        const vidId = item.mediaSource.split('v=')[1] || item.mediaSource.split('/').pop();
        contentHtml = `<iframe src="https://www.youtube.com/embed/${vidId}?autoplay=1&mute=1&controls=0&loop=1" class="slide-iframe" frameborder="0"></iframe>`;
    }
    else if (item.mediaType === 'website') {
        const scale = parseFloat(item.mediaScale) || 1.0;
        let scaleStyle = '';

        // Apply Zoom (Scale) Logic
        if (scale !== 1.0) {
            const w = 100 / scale;
            const h = `calc((100vh - 120px) / ${scale})`; // Adjusted for dashboard height roughly
            scaleStyle = `width: ${w}% !important; height: ${h} !important; transform: scale(${scale}) !important; transform-origin: 0 0 !important;`;
        } else {
            // Default (Fit container) - handled by CSS class .framed-web
            // CSS: width: 100%, height: calc(100vh - 190px)
        }

        const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(item.mediaSource)}`;
        // Add style attribute to iframe if zoomed
        contentHtml = `
            <iframe src="${item.mediaSource}" class="slide-iframe framed-web" frameborder="0" style="${scaleStyle}"></iframe>
            <div class="qr-box">
                <img src="${qrUrl}" alt="Scan QR">
                <div class="qr-label">SCAN ME</div>
            </div>
        `;
    }
    else if (item.mediaType === 'countdown') {
        // Countdown Logic
        const target = new Date(item.mediaSource).getTime();
        contentHtml = `
            <div style="text-align:center;">
                <h1>${item.title}</h1>
                <div id="countdown-${item.id}" style="font-size:5rem; font-weight:bold; font-family:monospace;">Loading...</div>
                <div style="font-size:2rem;">${item.content || ''}</div>
            </div>
        `;
        // Start detailed ticker for this slide
        startCountdownTicker(item.id, target);
    }
    else if (item.mediaType === 'exam_calendar') {
        contentHtml = `
            <div style="width:100%; height:88vh; display:flex; flex-direction:column; background:var(--bg-secondary); border-radius:0.5rem; overflow:hidden; box-shadow:0 10px 30px rgba(0,0,0,0.2);">
                <div style="background:var(--primary); padding:0.5rem 1.5rem; color:white; display:flex; justify-content:space-between; align-items:center;">
                    <h1 style="margin:0; font-size:1.4rem; font-family:sans-serif;">📅 ${item.title || 'Πρόγραμμα'}</h1>
                    <div id="exam-month-${item.id}" style="font-size:1.2rem; font-weight:bold; text-transform:uppercase;"></div>
                </div>
                <div id="exam-grid-${item.id}" style="flex:1; display:grid; grid-template-columns:repeat(5, 1fr); gap:1px; background:#e2e8f0; overflow:hidden;">
                    <div style="grid-column:1/-1; text-align:center; padding:2rem; font-size:1.5rem;">Φόρτωση... ⏳</div>
                </div>
            </div>
        `;
        setTimeout(() => fetchAndRenderExamCalendar(item.id, item.mediaSource), 50);
    }
    else if (item.mediaType === 'google_slides') {
        contentHtml = `
            <iframe
                src="${item.mediaSource}"
                frameborder="0"
                allowfullscreen="true"
                mozallowfullscreen="true"
                webkitallowfullscreen="true"
                style="width:100%; height:100%; border:none; display:block; background:#000;"
            ></iframe>
        `;
    }
    else if (item.mediaType === 'pdf') {
        contentHtml = `
            <embed
                src="${item.mediaSource}"
                type="application/pdf"
                style="width:100%; height:100%; border:none; display:block;"
            >
        `;
    }
    else {
        // Text / Default
        contentHtml = `
            <div class="slide-type">${getTypeLabel(item.type)}</div>
            <h1 class="slide-title">${item.title}</h1>
            <div class="slide-body">${item.content}</div>
        `;
    }

    // Wrap in Slide Div
    container.innerHTML = `
        <div class="slide active type-${item.type} ${layoutClass} media-${item.mediaType}">
            ${contentHtml}
        </div>
    `;

    // Layout Splits
    if (item.layout === 'split-left' || item.layout === 'split-right') {
        // Re-arrange for split
        if (item.mediaType === 'image') {
            container.innerHTML = `
                <div class="slide active type-${item.type} ${layoutClass}" style="display:grid; grid-template-columns: 1fr 1fr; gap:2rem; padding:2rem;">
                    <div style="order:${item.layout === 'split-left' ? 1 : 2}; display:flex; flex-direction:column; justify-content:center;">
                        <h1>${item.title}</h1>
                        <div>${item.content}</div>
                    </div>
                    <div style="order:${item.layout === 'split-left' ? 2 : 1};">
                        <img src="${item.mediaSource}" style="width:100%; height:100%; object-fit:cover; border-radius:1rem;">
                    </div>
                </div>
            `;
        }
    }
}

function startCountdownTicker(id, targetTime) {
    const update = () => {
        const el = document.getElementById(`countdown-${id}`);
        if (!el) return; // Slide gone

        const now = new Date().getTime();
        const dist = targetTime - now;

        if (dist < 0) {
            el.innerText = "ΕΛΗΞΕ";
            return;
        }

        const days = Math.floor(dist / (1000 * 60 * 60 * 24));
        const hours = Math.floor((dist % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((dist % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((dist % (1000 * 60)) / 1000);

        el.innerText = `${days}d ${hours}h ${minutes}m ${seconds}s`;
        requestAnimationFrame(update);
    };
    update();
}


function getTypeLabel(type) {
    const labels = { 'info': 'ENHΜΕΡΩΣΗ', 'alert': 'ΠΡΟΣΟΧΗ', 'event': 'ΕΚΔΗΛΩΣΗ' };
    return labels[type] || 'ANAKOINΩΣΗ';
}

async function fetchAndRenderExamCalendar(slideId, apiUrl) {
    const gridEl = document.getElementById(`exam-grid-${slideId}`);
    const monthEl = document.getElementById(`exam-month-${slideId}`);
    if (!gridEl || !apiUrl) return;

    try {
        const fetchUrl = apiUrl + (apiUrl.includes('?') ? '&api=true' : '?api=true') + '&nocache=' + new Date().getTime();
        const res = await fetch(fetchUrl);
        const data = await res.json();
        
        if (!data || !data.exams) {
            gridEl.innerHTML = '<div style="grid-column:1/-1; text-align:center; padding:3rem; font-size:2rem; color:red;">Σφάλμα Μορφής Δεδομένων</div>';
            return;
        }

        const now = new Date();

        // Find the Monday of the current week
        const currentDay = now.getDay() || 7; // 1-7
        const monday = new Date(now);
        monday.setDate(now.getDate() - (currentDay - 1));

        const months = ["Ιανουάριος", "Φεβρουάριος", "Μάρτιος", "Απρίλιος", "Μάιος", "Ιούνιος", "Ιούλιος", "Αύγουστος", "Σεπτέμβριος", "Οκτώβριος", "Νοέμβριος", "Δεκέμβριος"];

        // Build ordered day slots: future/today first, then past days (with +7) at the end
        let html = '';
        const daysOfWeekShort = ['ΔΕΥ', 'ΤΡΙ', 'ΤΕΤ', 'ΠΕΜ', 'ΠΑΡ'];

        const classMap = {};
        if (data.classes) data.classes.forEach(c => classMap[c.id] = c.name);

        const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        const currentHour = now.getHours();
        const currentDayIndex = (now.getDay() || 7) - 1; // 0-indexed Mon-Sun

        const futureDays = [], pastDays = [];
        for (let i = 0; i < 5; i++) {
            const date = new Date(monday);
            date.setDate(monday.getDate() + i);
            const isPast = currentDayIndex > i || (currentDayIndex === i && currentHour >= 15);
            if (isPast) {
                date.setDate(date.getDate() + 7);
                pastDays.push({ dayIndex: i, date });
            } else {
                futureDays.push({ dayIndex: i, date });
            }
        }
        const orderedSlots = [...futureDays, ...pastDays];

        // Dynamic header row matching column order
        orderedSlots.forEach(slot => {
            html += `<div style="background:#f1f5f9; color:#1e293b; text-align:center; padding:0.5rem 0.2rem; font-weight:900; font-size:1.2rem; border-bottom:2px solid #cbd5e1;">${daysOfWeekShort[slot.dayIndex]}</div>`;
        });

        // Update date-range label to reflect actual displayed dates
        const firstDate = orderedSlots[0]?.date;
        const lastDate  = orderedSlots[orderedSlots.length - 1]?.date;
        if (monthEl && firstDate && lastDate) {
            const sameMonth = firstDate.getMonth() === lastDate.getMonth();
            monthEl.innerText = sameMonth
                ? `Εβδομάδα: ${firstDate.getDate()} - ${lastDate.getDate()} ${months[lastDate.getMonth()]} ${lastDate.getFullYear()}`
                : `Εβδομάδα: ${firstDate.getDate()} ${months[firstDate.getMonth()]} - ${lastDate.getDate()} ${months[lastDate.getMonth()]} ${lastDate.getFullYear()}`;
        }

        // 1. Calculate Max Exams across displayed dates
        let maxDailyItems = 0;
        orderedSlots.forEach(slot => {
            const iso = `${slot.date.getFullYear()}-${String(slot.date.getMonth() + 1).padStart(2, '0')}-${String(slot.date.getDate()).padStart(2, '0')}`;
            const count = data.exams.filter(e => e.date === iso).length + (data.schoolSettings?.lockedPeriods || []).filter(lp => iso >= lp.start && iso <= lp.end).length;
            if (count > maxDailyItems) maxDailyItems = count;
        });

        // 2. Define scaling factors
        let scale = 1.0;
        if (maxDailyItems > 5) scale = 0.82;
        if (maxDailyItems > 8) scale = 0.68;
        if (maxDailyItems > 12) scale = 0.52;
        if (maxDailyItems > 16) scale = 0.42;

        const s = (val, min = 0.45) => Math.max(min, val * scale).toFixed(2) + 'rem';
        const sp = (val) => (val * scale).toFixed(2) + 'rem';

        // Render columns in new order
        for (const slot of orderedSlots) {
            const date = slot.date;

            const isoDate = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
            const isToday = (isoDate === todayStr);

            const dailyExams = data.exams.filter(e => e.date === isoDate);
            const dailyLocks = (data.schoolSettings?.lockedPeriods || []).filter(lp => isoDate >= lp.start && isoDate <= lp.end);

            let bg = isToday ? '#ebf8ff' : 'white';
            if (dailyLocks.length > 0) bg = '#fff5f5';

            html += `<div style="background:${bg}; padding:${sp(0.4)}; display:flex; flex-direction:column; gap:${sp(0.3)}; min-height:60vh; border-right:1px solid #e2e8f0; overflow:hidden;">
                <div style="font-size:${s(1.2, 0.85)}; font-weight:900; color:${isToday ? '#2b6cb0' : '#64748b'}; border-bottom:2px solid ${isToday ? '#bee3f8' : '#f1f5f9'}; padding-bottom:${sp(0.2)}; margin-bottom:${sp(0.1)}; display:flex; justify-content:space-between; align-items:center;">
                    <span style="display:flex; flex-direction:column; line-height:1;">
                        <span>${date.getDate()}</span>
                        <small style="font-size:${s(0.6, 0.42)}; color:#94a3b8; font-weight:normal; margin-top:1px;">${months[date.getMonth()]}</small>
                    </span>
                    ${isToday ? `<span style="font-size:${s(0.65, 0.45)}; background:#3182ce; color:white; padding:1px 4px; border-radius:5px;">ΣΗΜΕΡΑ</span>` : ''}
                </div>`;
            
            dailyLocks.forEach(lp => {
               html += `<div style="background:#fed7d7; color:#c53030; padding:${sp(0.4)}; border-radius:0.3rem; font-size:${s(0.85, 0.58)}; font-weight:bold; border:1px solid #feb2b2; line-height:1.1;">🔒 ${lp.reason}</div>`;
            });
            
            dailyExams.sort((a, b) => (a.time || "").localeCompare(b.time || "")).forEach(e => {
               const cName = classMap[e.classId] || 'Τμήμα';
               html += `<div style="background:white; border-left:3px solid #3182ce; padding:${sp(0.3)}; border-radius:0.2rem; box-shadow:0 1px 2px rgba(0,0,0,0.03); border-top:1px solid #f1f5f9; border-right:1px solid #f1f5f9; border-bottom:1px solid #f1f5f9; position:relative;">
                   <div style="font-weight:900; font-size:${s(0.82, 0.6)}; color:#0f172a; line-height:1; overflow:hidden; white-space:nowrap; text-overflow:ellipsis;">${e.subject}</div>
                   <div style="display:flex; justify-content:space-between; margin-top:2px; font-weight:bold; border-top:1px solid #f1f5f9; padding-top:1px;">
                       <span style="font-size:${s(0.72, 0.5)}; color:#334155;">${cName}</span>
                       <span style="font-size:${s(0.7, 0.45)}; color:#64748b; font-family:monospace;">${e.time.replace('Ώρα', 'Ω')}</span>
                   </div>
               </div>`;
            });

            html += `</div>`;
        }
        
        gridEl.innerHTML = html;

    } catch(err) {
        console.error("Exam Calendar Error:", err);
        gridEl.innerHTML = `<div style="grid-column:1/-1; text-align:center; padding:3rem; font-size:2rem; color:red;">Αποτυχία Απεικόνισης Δεδομένων 🤔<br><small>${err.message}</small></div>`;
    }
}



function updateSidebarUpcoming(list) {
    const upcomingEl = document.getElementById('upcomingEvents');
    if (!upcomingEl) return;

    const now = new Date();
    // Filter items that are future events or active events with specific dates
    const upcoming = list
        .filter(item => {
            const end = item.endDate ? new Date(item.endDate) : null;
            return item.type === 'event' && (!end || end > now);
        })
        .sort((a,b) => (a.startDate || '') > (b.startDate || '') ? 1 : -1)
        .slice(0, 4); // Top 4

    if (upcoming.length === 0) {
        upcomingEl.innerHTML = '<div style="color: var(--text-secondary); padding: 1rem; text-align: center; font-size: 0.9rem;">Δεν υπάρχουν επερχόμενες εκδηλώσεις</div>';
        return;
    }

    upcomingEl.innerHTML = upcoming.map(item => {
        let day = '??';
        let month = 'EVT';
        let timeText = 'All Day';

        if (item.startDate) {
            const d = new Date(item.startDate);
            day = d.getDate();
            month = getMonthShort(d.getMonth());
            timeText = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
        }

        return `
            <div class="event-item">
                <div class="event-date-box">
                    <span class="month">${month}</span>
                    <span class="day">${day}</span>
                </div>
                <div class="event-details">
                    <div class="event-title">${item.title}</div>
                    <div class="event-meta">
                        <span style="display:flex; align-items:center; gap:3px;">📍 Auditorium</span>
                        <span style="display:flex; align-items:center; gap:3px;">🕒 ${timeText}</span>
                    </div>
                </div>
            </div>
        `;
    }).join("");
}

function getMonthShort(m) {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return months[m] || 'EVT';
}
