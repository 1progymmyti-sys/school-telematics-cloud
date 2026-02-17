import { db, doc, onSnapshot, collection, query, orderBy } from "./firebase-config.js";
import ParticleEngine from "./canvas-particles.js";

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

// Helper: Fetch RSS Feed via Proxy (CORS fix)
// Helper: Fetch RSS Feed via Proxy
async function fetchRSS(url) {
    if (!url) return;
    try {
        const proxy = 'https://api.rss2json.com/v1/api.json?rss_url=' + encodeURIComponent(url);
        const res = await fetch(proxy);
        const data = await res.json();

        if (data.status === 'ok') {
            const items = data.items.map(i => `<span style="margin-right: 150px; font-weight:800; text-shadow: 2px 2px 4px rgba(0,0,0,0.5);">📰 ${i.title}</span>`).join('');
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

    // Debug Log
    console.log("Showing Ticker:", htmlContent);

    if (tickerContainer && tickerContent) {
        tickerContainer.style.display = 'flex';
        // Use clean class based logic
        tickerContent.innerHTML = `<div class="ticker-text">${htmlContent}</div>`;
    }
}

// Helper: Get Active Slides
const getActiveSlides = (list) => {
    const now = new Date();
    return list.filter(item => {
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

function updateClock() {
    const now = new Date();
    document.getElementById('clock').innerText = now.toLocaleTimeString('el-GR', { hour: '2-digit', minute: '2-digit' });
    document.getElementById('date').innerText = now.toLocaleDateString('el-GR', { weekday: 'long', day: 'numeric', month: 'long' });
}

function applySettings(s) {
    if (s.schoolName) document.getElementById('schoolNameDisplay').innerText = s.schoolName;
    if (s.logo) document.getElementById('schoolLogo').src = s.logo;

    // Weather
    if (s.weatherCity) updateWeather(s.weatherCity);

    // Ticker (Unified Logic)
    if (s.tickerMessage && s.tickerMessage.trim() !== "") {
        // Clear any old interval
        if (rssInterval) clearInterval(rssInterval);

        if (s.tickerMessage.startsWith('http')) {
            // RSS URL
            fetchRSS(s.tickerMessage);
            rssInterval = setInterval(() => fetchRSS(s.tickerMessage), 600000);
        } else {
            // Plain Text
            showTickerText(`<span>📢 ${s.tickerMessage}</span>`);
        }
    } else {
        // No ticker
        const tc = document.getElementById('tickerContainer');
        if (tc) tc.style.display = 'none';
        if (rssInterval) clearInterval(rssInterval);
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

function updateWeather(city) {
    // Mock weather for now to avoid complexity without API Key
    // You can add OpenWeatherMap logic here later
    const weatherEl = document.getElementById('weather');
    weatherEl.innerHTML = `☁️ ${city} 18°C`;
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
    const isFullMedia = (item.layout === 'fullscreen' || !item.layout) &&
        ['website', 'image', 'live_image', 'youtube'].includes(item.mediaType);

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
        let style = 'position: absolute; top: 0; left: 0; border: none;';

        if (scale === 1) {
            style += 'width: 100vw; height: 100vh;';
        } else {
            // For scaling: we make it huge/small based on scale, then transform it
            style += `width: ${100 / scale}vw; height: ${100 / scale}vh; transform: scale(${scale}); transform-origin: 0 0;`;
        }

        contentHtml = `<iframe src="${item.mediaSource}" class="slide-iframe" style="${style}"></iframe>`;
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
