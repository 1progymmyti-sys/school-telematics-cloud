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
                    // Corrected the style string based on the user's intent to modify font-size and ensure valid HTML/CSS
                    htmlItems.push(`<span style="margin-right: 120px; font-family: 'Playfair Display', serif; font-size: 2.6rem; font-weight:700; text-shadow: 1px 1px 2px rgba(0,0,0,0.3); display:inline-flex; align-items:center;"><span style="color:#fbbf24; font-size:1.5em; margin-right:15px;">&bull;</span> ${title}</span>`);
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

        // Apply transform (0 for Y so flex centering from CSS takes over)
        element.style.transform = `translate3d(${tickerOffset}px, 0, 0)`;

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
    { name: "7η Ώρα", type: "lesson", start: "13:15", end: "13:55" },
    { name: "ΔΟΚΙΜΗ (Τεστ)", type: "lesson", start: "23:00", end: "23:59" }
];

function updateScheduleStatus() {
    try {
        const now = new Date();
        const currentTime = now.getHours() * 60 + now.getMinutes();
        const displayEl = document.getElementById('schoolScheduleStatus');
        const progressEl = document.getElementById('headerProgressBar');

        if (!displayEl) return;

        // Hide during weekends (0 = Sunday, 6 = Saturday)
        const dayOfWeek = now.getDay();
        if (dayOfWeek === 0 || dayOfWeek === 6) {
            displayEl.style.display = 'none';
            if (progressEl) progressEl.style.width = '0%';
            return;
        }

        let activeSlot = null;
        let nextSlot = null;

        for (let i = 0; i < schoolSchedule.length; i++) {
            const slot = schoolSchedule[i];
            const [sH, sM] = slot.start.split(':').map(Number);
            const [eH, eM] = slot.end.split(':').map(Number);

            const startTotal = sH * 60 + sM;
            const endTotal = eH * 60 + eM;

            if (currentTime >= startTotal && currentTime < endTotal) {
                activeSlot = { ...slot, startTotal, endTotal };
                nextSlot = schoolSchedule[i + 1];
                break;
            }
        }

        if (activeSlot) {
            const totalDuration = activeSlot.endTotal - activeSlot.startTotal;
            const elapsed = currentTime - activeSlot.startTotal;
            const percentage = (elapsed / totalDuration) * 100;
            const remaining = activeSlot.endTotal - currentTime;

            // Update Text
            let text = `${activeSlot.name} (Λήξη σε ${remaining}')`;
            displayEl.textContent = text;
            displayEl.style.display = 'inline-flex';

            // Update Progress Bar using CSS Variables for theme compatibility
            if (progressEl) {
                progressEl.style.width = `${percentage}%`;
                if (remaining <= 5) {
                    // Alert state: uses slightly different gradient but respects theme accents
                    progressEl.style.background = 'linear-gradient(to right, #ef4444, #f87171)';
                    progressEl.style.boxShadow = '0 0 20px rgba(239, 68, 68, 0.8)';
                } else {
                    // Normal state: uses CSS variable
                    progressEl.style.background = `linear-gradient(to right, transparent, var(--accent-color))`;
                    progressEl.style.boxShadow = `0 0 10px var(--accent-glow)`;
                }
            }
        } else {
            displayEl.style.display = 'none';
            if (progressEl) progressEl.style.width = '0%';
        }

    } catch (e) {
        console.error("Schedule Error", e);
    }
}

function updateClock() {
    const now = new Date();
    
    // Date update
    const dEl = document.getElementById('date');
    const options = { weekday: 'long', day: 'numeric', month: 'long' };
    const dateStr = now.toLocaleDateString('el-GR', options).toUpperCase();
    if (dEl && dEl.innerText !== dateStr) dEl.innerText = dateStr;

    // Time update (Forced 24h)
    const h = now.getHours().toString().padStart(2, '0');
    const m = now.getMinutes().toString().padStart(2, '0');
    const timeStr = `${h}:${m}`;
    const cEl = document.getElementById('clock');
    if (cEl && cEl.innerText !== timeStr) cEl.innerText = timeStr;

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

            // Update UI
            // Format: Icon | City | Temp | Description
            weatherEl.innerHTML = `${weatherInfo.icon} ${name} ${temp}°C <span style="font-size:0.85em; opacity:0.8; margin-left:8px; font-weight:400;">(${weatherInfo.desc})</span>`;
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
        62: { desc: "Βροχή", icon: "🌧️" },
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

    const finalScale = () => {
        const slide = document.querySelector('.slide.active');
        if (slide) autoScaleText(slide);
    };
    setTimeout(finalScale, 100);

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
    setTimeout(() => {
        const slide = document.querySelector('.slide.active');
        if (slide) autoScaleText(slide);
    }, 50);

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
    let extraStyles = '';

    // Layout Checks (Header Visibility)
    document.body.classList.remove('fullscreen-mode');

    // Handle Layout-Specific Content Construction
    if (item.layout === 'split-left' || item.layout === 'split-right') {
        const orderText = item.layout === 'split-left' ? 2 : 1;
        const orderMedia = item.layout === 'split-left' ? 1 : 2;
        contentHtml = `
            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:2rem; padding:2rem; width:100%; height:100%;">
                <div style="order:${orderText}; display:flex; flex-direction:column; justify-content:center; text-align: left;">
                    <h1 style="font-size:3.5rem;" class="slide-title">${item.title}</h1>
                    <div style="font-size:1.8rem;" class="slide-body">${item.content}</div>
                </div>
                <div style="order:${orderMedia};">
                    <img src="${item.mediaSource}" style="width:100%; height:100%; object-fit:cover; border-radius:1.5rem; box-shadow: 0 20px 50px rgba(0,0,0,0.5);">
                </div>
            </div>
        `;
    }
    else if (item.layout === 'split-top' || item.layout === 'split-bottom') {
        const orderMedia = item.layout === 'split-top' ? 1 : 2;
        const orderText = item.layout === 'split-top' ? 2 : 1;
        contentHtml = `
            <div style="display:grid; grid-template-rows: 1fr 1fr; gap:1.5rem; padding:1.5rem; width:100%; height:100%;">
                <div style="order:${orderMedia}; height: 100%; overflow: hidden;">
                    <img src="${item.mediaSource}" style="width:100%; height:100%; object-fit:cover; border-radius:1.5rem;">
                </div>
                <div style="order:${orderText}; display:flex; flex-direction:column; justify-content:center; text-align: center;">
                    <h1 style="font-size:3rem; margin-bottom:0.5rem;" class="slide-title">${item.title}</h1>
                    <div style="font-size:1.6rem;" class="slide-body">${item.content}</div>
                </div>
            </div>
        `;
    }
    else if (item.layout === 'sidebar-right') {
        contentHtml = `
            <div style="display:grid; grid-template-columns: 7fr 3fr; gap:2rem; padding:2.5rem; width:100%; height:100%;">
                <div style="display:flex; flex-direction:column; justify-content:center; text-align: left;">
                    <h1 style="font-size:4rem;" class="slide-title">${item.title}</h1>
                    <div style="font-size:2rem;" class="slide-body">${item.content}</div>
                </div>
                <div>
                    <img src="${item.mediaSource}" style="width:100%; height:100%; object-fit:cover; border-radius:1.5rem; box-shadow: 0 10px 30px rgba(0,0,0,0.3);">
                </div>
            </div>
        `;
    }
    else if (item.layout === 'no-title') {
        contentHtml = `<div class="slide-body" style="font-size: 3.5rem; max-width: 90%; width: 100%;">${item.content}</div>`;
    }
    else if (item.layout === 'title-only') {
        contentHtml = `<h1 style="font-size: 6rem; line-height: 1.1;" class="slide-title">${item.title}</h1>`;
    }
    else {
        // Default / Media Logic
        if (item.mediaType === 'image' || item.mediaType === 'live_image') {
            const url = item.mediaType === 'live_image' ? `${item.mediaSource}?t=${Date.now()}` : item.mediaSource;
            contentHtml = `<img src="${url}" class="slide-image">`;
            if (item.content) contentHtml += `<div class="slide-overlay"><h2>${item.title}</h2><div>${item.content}</div></div>`;
        }
        else if (item.mediaType === 'youtube') {
            const vidId = item.mediaSource.split('v=')[1] || item.mediaSource.split('/').pop();
            contentHtml = `<iframe src="https://www.youtube.com/embed/${vidId}?autoplay=1&mute=1&controls=0&loop=1" class="slide-iframe" frameborder="0"></iframe>`;
        }
        else if (item.mediaType === 'website') {
            const scale = parseFloat(item.mediaScale) || 1.0;
            let scaleStyle = '';
            if (scale !== 1.0) {
                const w = 100 / scale;
                const h = `calc((100vh - 12vh - 8vh) / ${scale})`; // Correct for glass header/ticker
                scaleStyle = `width: ${w}% !important; height: ${h} !important; transform: scale(${scale}) !important; transform-origin: 0 0 !important;`;
            }
            const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(item.mediaSource)}`;
            contentHtml = `
                <iframe src="${item.mediaSource}" class="slide-iframe framed-web" frameborder="0" style="${scaleStyle}"></iframe>
                <div class="qr-box">
                    <img src="${qrUrl}" alt="Scan QR">
                    <div class="qr-label">SCAN ME</div>
                </div>
            `;
        }
        else if (item.mediaType === 'countdown') {
            const target = new Date(item.mediaSource).getTime();
            contentHtml = `
                <div style="text-align:center;">
                    <h1 class="slide-title">${item.title}</h1>
                    <div id="countdown-${item.id}" style="font-size:6rem; font-weight:900; font-family:monospace; color:var(--accent-color); text-shadow: 0 0 30px var(--accent-glow);">Loading...</div>
                    <div class="slide-body" style="margin-top:2rem;">${item.content || ''}</div>
                </div>
            `;
            startCountdownTicker(item.id, target);
        }
        else if (item.mediaType === 'exam_calendar') {
            contentHtml = `
                <div style="width:100%; height:82vh; display:flex; flex-direction:column; background:var(--glass-bg); backdrop-filter:blur(20px); border-radius:1.5rem; overflow:hidden; border:1px solid var(--glass-border); box-shadow:0 30px 60px rgba(0,0,0,0.4);">
                    <div style="background:var(--accent-color); padding:1rem 2rem; color:white; display:flex; justify-content:space-between; align-items:center;">
                        <h1 style="margin:0; font-size:1.8rem;">📅 ${item.title || 'Πρόγραμμα'}</h1>
                        <div id="exam-month-${item.id}" style="font-size:1.4rem; font-weight:bold; text-transform:uppercase;"></div>
                    </div>
                    <div id="exam-grid-${item.id}" style="flex:1; display:grid; grid-template-columns:repeat(5, 1fr); gap:1px; background:rgba(255,255,255,0.1); overflow:hidden;">
                        <div style="grid-column:1/-1; text-align:center; padding:3rem; font-size:2rem;">Φόρτωση... ⏳</div>
                    </div>
                </div>
            `;
            setTimeout(() => fetchAndRenderExamCalendar(item.id, item.mediaSource), 50);
        }
        else if (item.mediaType === 'google_slides' || item.mediaType === 'pdf') {
            let src = item.mediaSource;
            if (item.mediaType === 'pdf' && !src.includes('data:application/pdf')) {
                src = `https://docs.google.com/viewer?url=${encodeURIComponent(src)}&embedded=true`;
            }
            contentHtml = `<iframe src="${src}" class="slide-iframe" frameborder="0" allowfullscreen></iframe>`;
        }
        else {
            contentHtml = `
                <div class="slide-type">${getTypeLabel(item.type)}</div>
                <h1 class="slide-title">${item.title}</h1>
                <div class="slide-body">${item.content}</div>
            `;
        }
    }

    // TRANSITION ENGINE
    const oldSlide = container.querySelector('.slide.active');
    if (oldSlide) {
        oldSlide.classList.remove('active');
        oldSlide.style.transform = 'scale(0.95) translateY(-20px)';
        oldSlide.style.opacity = '0';
        setTimeout(() => { if (oldSlide.parentNode) oldSlide.remove(); }, 800);
    }

    const newSlide = document.createElement('div');
    newSlide.className = `slide type-${item.type} ${layoutClass} media-${item.mediaType}`;
    newSlide.innerHTML = contentHtml;
    container.appendChild(newSlide);

    // Trigger Entrance
    setTimeout(() => {
        newSlide.classList.add('active');
    }, 50);
}

/**
 * Automatically scales font size of title and body to fit within the slide container
 * @param {HTMLElement} slideEl 
 */
function autoScaleText(slideEl) {
    if (!slideEl) return;
    
    // Skip for these types as they are iframes/media handled separately
    if (slideEl.classList.contains('media-website') || 
        slideEl.classList.contains('media-pdf') || 
        slideEl.classList.contains('media-google_slides') || 
        slideEl.classList.contains('media-exam_calendar')) {
        return;
    }

    const title = slideEl.querySelector('h1, .slide-title');
    const body = slideEl.querySelector('.slide-body');
    
    // Safety check - avoid infinite loops
    let maxIterations = 30;
    
    // Check for overflow specifically in terms of scroll height vs client height
    // Add small buffer to avoid scrollbars
    const hasOverflow = () => slideEl.scrollHeight > slideEl.clientHeight + 5;
    
    // If no specific elements found, try the first level of content
    if (!title && !body && hasOverflow()) {
        const content = slideEl.querySelector('div');
        if (content) {
             let curFs = parseFloat(window.getComputedStyle(content).fontSize);
             while (hasOverflow() && maxIterations > 0 && curFs > 12) {
                 curFs *= 0.95;
                 content.style.fontSize = curFs + 'px';
                 maxIterations--;
             }
        }
    }

    // Main scaling loop for title and body
    while (hasOverflow() && maxIterations > 0) {
        let changed = false;
        
        if (title) {
            const currentTitleFs = parseFloat(window.getComputedStyle(title).fontSize);
            if (currentTitleFs > 24) {
                title.style.fontSize = (currentTitleFs * 0.94) + 'px';
                title.style.lineHeight = "1.05";
                title.style.marginBottom = (parseFloat(window.getComputedStyle(title).marginBottom) * 0.9) + 'px';
                changed = true;
            }
        }
        
        if (body) {
            const currentBodyFs = parseFloat(window.getComputedStyle(body).fontSize);
            if (currentBodyFs > 16) {
                body.style.fontSize = (currentBodyFs * 0.94) + 'px';
                body.style.lineHeight = "1.2";
                changed = true;
            }
        }
        
        if (!changed) break; // Reached floor for both
        maxIterations--;
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
