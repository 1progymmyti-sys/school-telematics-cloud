import { db, doc, onSnapshot, collection, query, orderBy } from "./firebase-config.js";
import ParticleEngine from "./canvas-particles.js?v=exams_fix2";

// Global State
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

// Helper: Fetch RSS Feed via Proxy
async function fetchRSS(url) {
    if (!url) return;
    try {
        const proxy = 'https://api.rss2json.com/v1/api.json?rss_url=' + encodeURIComponent(url);
        const res = await fetch(proxy);
        const data = await res.json();

        if (data.status === 'ok') {
            const items = data.items.map(i => `<span style="margin-right: 100px; font-family: 'Playfair Display', serif; font-size: 1.6rem; font-weight:600; text-shadow: 1px 1px 2px rgba(0,0,0,0.3); display:inline-flex; align-items:center;"><span style="color:#fbbf24; font-size:1.5em; margin-right:10px;">&bull;</span> ${i.title}</span>`).join('');
            showTickerText(items);
        } else {
            console.warn("RSS Feed status error");
            // Don't show URL to user on error, just hide or show generic
            // showTickerText("⚠️ Μη διαθέσιμες ειδήσεις");
        }
    } catch (e) {
        console.error("RSS Error:", e);
    }
}


function showTickerText(htmlContent) {
    const tickerContainer = document.getElementById('tickerContainer');
    const tickerContent = document.getElementById('tickerContent');

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
        tickerOffset -= 1.2; // Slower Speed (was 2.5)

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
        return true;
    });
};

window.onload = () => {
    console.log("Display Cloud App Starting...");
    showTickerText("⏳ Φόρτωση ενημερώσεων..."); // Initial debug text

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
    const q = query(collection(db, "announcements"), orderBy("createdAt", "desc"));
    onSnapshot(q, (snapshot) => {
        const all = [];
        snapshot.forEach(doc => {
            const d = doc.data();
            d.id = doc.id;
            all.push(d);
        });
        slides = getActiveSlides(all);

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
    document.getElementById('clock').innerText = now.toLocaleTimeString('el-GR', { hour: '2-digit', minute: '2-digit' });
    document.getElementById('date').innerText = now.toLocaleDateString('el-GR', { weekday: 'long', day: 'numeric', month: 'long' });
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
        showTickerText(`<span>📢 ${s.tickerMessage}</span>`);
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
            weatherEl.innerHTML = `${weatherInfo.icon} ${name} ${temp}°C <span style="font-size:0.6em; opacity:0.8; margin-left:5px;">(${weatherInfo.desc})</span>`;
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

    // Layout Checks for Auto-Fullscreen (Hide Header)
    // NOTE: Removed 'website' so header stays visible for sites!
    const isFullMedia = (item.layout === 'fullscreen' || !item.layout) &&
        ['image', 'live_image', 'youtube'].includes(item.mediaType);

    if (isFullMedia) {
        document.body.classList.add('fullscreen-mode');
    } else {
        document.body.classList.remove('fullscreen-mode');
    }

    // Media Logic
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

        // Apply Zoom (Scale) Logic
        if (scale !== 1.0) {
            const w = 100 / scale;
            const h = `calc((100vh - 190px) / ${scale})`;
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
