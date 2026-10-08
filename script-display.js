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
let tickerSequence = [];
let tickerSequenceIndex = 0;
let cachedRssItems = [];

// Helper: Convert Base64 / Data URI to Uint8Array for PDF.js
function base64ToUint8Array(base64) {
    const raw = atob(base64);
    const rawLength = raw.length;
    const array = new Uint8Array(new ArrayBuffer(rawLength));
    for (let i = 0; i < rawLength; i++) {
        array[i] = raw.charCodeAt(i);
    }
    return array;
}

// Helper: Render PDF using PDF.js with fallback to native embed
async function renderPDFJS(pdfSource, containerId, userScale = 1.0) {
    let container = document.getElementById(containerId);
    if (!container) {
        setTimeout(() => renderPDFJS(pdfSource, containerId, userScale), 80);
        return;
    }

    const fallback = () => {
        const scale = parseFloat(userScale) || 1.0;
        let scaleStyle = '';
        if (scale !== 1.0) {
            scaleStyle = `transform: scale(${scale}) !important; transform-origin: top center !important; width: ${100/scale}% !important; height: ${100/scale}% !important;`;
        }
        container.innerHTML = `
            <embed 
                src="${pdfSource}" 
                type="application/pdf" 
                style="width: 100%; height: 100%; max-width: 100%; max-height: 100%; border: none; display: block; ${scaleStyle}"
            />
        `;
    };

    try {
        if (typeof window.pdfjsLib === 'undefined') {
            console.warn("PDF.js library not loaded, using fallback");
            fallback();
            return;
        }

        const pdfjsLib = window.pdfjsLib;

        // Configure worker
        if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
            pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';
        }

        let pdfData = pdfSource;
        if (typeof pdfSource === 'string' && pdfSource.startsWith('data:')) {
            const base64Index = pdfSource.indexOf(';base64,');
            if (base64Index !== -1) {
                const base64Data = pdfSource.substring(base64Index + 8);
                pdfData = base64ToUint8Array(base64Data);
            }
        }

        const loadingTask = pdfjsLib.getDocument(pdfData instanceof Uint8Array ? { data: pdfData } : pdfData);
        const pdf = await loadingTask.promise;

        container.innerHTML = ''; // Clear loading message

        // Determine available dimensions robustly
        let w = container.clientWidth;
        let h = container.clientHeight;
        if (!w || !h) {
            const rect = container.getBoundingClientRect();
            w = rect.width;
            h = rect.height;
        }
        if (!w || !h) {
            const parentBox = container.closest('.zone-card') || container.closest('.photo-slideshow-container') || container.parentElement;
            if (parentBox) {
                const pRect = parentBox.getBoundingClientRect();
                w = pRect.width || parentBox.clientWidth;
                h = pRect.height || parentBox.clientHeight;
            }
        }
        const slideMain = document.getElementById('slideContainer');
        const safeW = slideMain ? slideMain.clientWidth : window.innerWidth;
        const safeH = slideMain ? slideMain.clientHeight : (window.innerHeight - 192);

        const availW = Math.max((w || safeW) - 16, 120);
        const availH = Math.max((h || safeH) - 16, 120);

        const userScaleNum = parseFloat(userScale) || 1.0;
        const dpr = Math.min(window.devicePixelRatio || 1, 2.0);

        // Helper: render a single PDF page to a canvas
        const renderPageCanvas = async (pageNum) => {
            const page = await pdf.getPage(pageNum);
            const unscaledViewport = page.getViewport({ scale: 1.0 });

            const scaleX = availW / unscaledViewport.width;
            const scaleY = availH / unscaledViewport.height;
            // Math.min strictly ensures the page fits BOTH width AND height
            const fitScale = Math.min(scaleX, scaleY);

            const displayW = Math.max(10, Math.round(unscaledViewport.width * fitScale * userScaleNum));
            const displayH = Math.max(10, Math.round(unscaledViewport.height * fitScale * userScaleNum));

            // High-DPI buffer for crisp text
            const renderScale = fitScale * userScaleNum * dpr;
            const renderViewport = page.getViewport({ scale: renderScale });

            const canvas = document.createElement('canvas');
            canvas.className = 'pdf-canvas';
            canvas.width = renderViewport.width;
            canvas.height = renderViewport.height;

            canvas.style.width = `${displayW}px`;
            canvas.style.height = `${displayH}px`;
            canvas.style.maxWidth = userScaleNum > 1.0 ? 'none' : '100%';
            canvas.style.maxHeight = userScaleNum > 1.0 ? 'none' : '100%';
            canvas.style.objectFit = 'contain';
            canvas.style.display = 'block';
            canvas.style.margin = 'auto';

            const context = canvas.getContext('2d');
            const renderContext = {
                canvasContext: context,
                viewport: renderViewport
            };
            try {
                await page.render(renderContext).promise;
            } catch (renderErr) {
                if (renderErr && renderErr.name !== 'RenderingCancelledException') {
                    console.warn("PDF page render warning:", renderErr);
                }
            }
            return canvas;
        };

        if (pdf.numPages === 1) {
            const canvas = await renderPageCanvas(1);
            container.appendChild(canvas);
        } else {
            // Multi-page PDF: cycle pages smoothly
            const pagesWrapper = document.createElement('div');
            pagesWrapper.className = 'pdf-pages-carousel';

            const pageCanvases = [];
            for (let p = 1; p <= pdf.numPages; p++) {
                const canvas = await renderPageCanvas(p);
                canvas.style.position = 'absolute';
                canvas.style.transition = 'opacity 0.6s ease';
                canvas.style.opacity = p === 1 ? '1' : '0';
                canvas.style.pointerEvents = p === 1 ? 'auto' : 'none';
                pagesWrapper.appendChild(canvas);
                pageCanvases.push(canvas);
            }

            const badge = document.createElement('div');
            badge.style.position = 'absolute';
            badge.style.bottom = '8px';
            badge.style.right = '8px';
            badge.style.background = 'rgba(15, 23, 42, 0.85)';
            badge.style.backdropFilter = 'blur(6px)';
            badge.style.color = '#fff';
            badge.style.padding = '4px 10px';
            badge.style.borderRadius = '12px';
            badge.style.fontSize = '0.8rem';
            badge.style.fontWeight = 'bold';
            badge.style.boxShadow = '0 2px 8px rgba(0,0,0,0.4)';
            badge.style.zIndex = '5';
            badge.textContent = `📄 Σελίδα 1 / ${pdf.numPages}`;
            pagesWrapper.appendChild(badge);

            container.appendChild(pagesWrapper);

            let curPage = 0;
            const pageInterval = setInterval(() => {
                if (!document.body.contains(container)) {
                    clearInterval(pageInterval);
                    return;
                }
                pageCanvases[curPage].style.opacity = '0';
                pageCanvases[curPage].style.pointerEvents = 'none';
                curPage = (curPage + 1) % pdf.numPages;
                pageCanvases[curPage].style.opacity = '1';
                pageCanvases[curPage].style.pointerEvents = 'auto';
                badge.textContent = `📄 Σελίδα ${curPage + 1} / ${pdf.numPages}`;
            }, 6000);
        }
    } catch (err) {
        console.error("PDF.js render failed, executing fallback:", err);
        fallback();
    }
}

// Helper: Extract icon/emoji from badge label so only the icon appears in the moving ticker
function getBadgeIcon(badgeText) {
    if (!badgeText) return '📢';
    const trimmed = badgeText.trim();
    const match = trimmed.match(/^([\p{Extended_Pictographic}\uFE0F\u200D\u2600-\u27BF\uE000-\uF8FF]+|[^\p{L}\p{N}\s]+)/u);
    if (match && match[0]) return match[0].trim();
    const firstWord = trimmed.split(/\s+/)[0];
    if (firstWord && !/^[A-Za-zΑ-Ωα-ω0-9]+$/.test(firstWord)) return firstWord;
    return '📢';
}

// Helper: Fetch RSS Feed reliably (with CORS proxy fallbacks)
async function fetchRSS(url) {
    if (!url) return;
    let items = [];

    // Method 1: rss2json API (CORS enabled, clean JSON)
    try {
        const proxyUrl = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(url)}&api_key=&nocache=${Date.now()}`;
        const res = await fetch(proxyUrl);
        const data = await res.json();
        if (data.status === 'ok' && data.items && data.items.length > 0) {
            items = data.items.slice(0, 7).map(i => i.title).filter(Boolean);
        }
    } catch (e1) {
        console.warn("rss2json attempt failed:", e1);
    }

    // Method 2: allorigins raw proxy (XML fallback)
    if (items.length === 0) {
        try {
            const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}&nocache=${Date.now()}`;
            const res = await fetch(proxyUrl);
            const xmlText = await res.text();
            const xmlDoc = new DOMParser().parseFromString(xmlText, "text/xml");
            const xmlItems = xmlDoc.querySelectorAll("item");
            xmlItems.forEach((it, idx) => {
                if (idx < 7) {
                    const t = it.querySelector("title")?.textContent;
                    if (t) items.push(t.trim());
                }
            });
        } catch (e2) {
            console.warn("allorigins fallback failed:", e2);
        }
    }

    // Method 3: Direct fetch (if server supports CORS)
    if (items.length === 0) {
        try {
            const res = await fetch(url);
            const xmlText = await res.text();
            const xmlDoc = new DOMParser().parseFromString(xmlText, "text/xml");
            const xmlItems = xmlDoc.querySelectorAll("item");
            xmlItems.forEach((it, idx) => {
                if (idx < 7) {
                    const t = it.querySelector("title")?.textContent;
                    if (t) items.push(t.trim());
                }
            });
        } catch (e3) {
            console.warn("Direct RSS fetch failed:", e3);
        }
    }

    if (items.length > 0) {
        cachedRssItems = items;
        updateTickerSequence();
    }
}

function setTickerTheme(labelText, styleClass) {
    const tickerContainer = document.getElementById('tickerContainer');
    if (!tickerContainer) return;
    const labelEl = tickerContainer.querySelector('.ticker-label');

    if (labelEl && labelText) {
        if (labelEl.innerHTML !== labelText) {
            labelEl.classList.add('label-switching');
            setTimeout(() => {
                labelEl.innerHTML = labelText;
                labelEl.classList.remove('label-switching');
            }, 220);
        }
    }

    tickerContainer.classList.remove('ticker-mode-director', 'ticker-mode-gold', 'ticker-mode-alert', 'ticker-mode-rss');
    if (styleClass === 'alert') tickerContainer.classList.add('ticker-mode-alert');
    else if (styleClass === 'rss') tickerContainer.classList.add('ticker-mode-rss');
    else tickerContainer.classList.add('ticker-mode-director');
}

function playTickerItem(item) {
    if (!item) return;

    const tickerContainer = document.getElementById('tickerContainer');
    const tickerContent = document.getElementById('tickerContent');
    if (!tickerContainer || !tickerContent) return;

    tickerContainer.style.display = 'flex';
    setTickerTheme(item.label, item.style);

    tickerContent.innerHTML = `<div class="ticker-text" id="movingTicker">${item.html}</div>`;
    const el = document.getElementById('movingTicker');
    if (el) startTickerAnim(el);
}

function showTickerText(htmlContent, labelText, styleClass = 'director') {
    playTickerItem({
        label: labelText || '📢 ΕΝΗΜΕΡΩΣΗ',
        style: styleClass || 'director',
        html: htmlContent
    });
}

function startTickerAnim(element) {
    if (tickerAnimId) cancelAnimationFrame(tickerAnimId);
    tickerOffset = window.innerWidth;
    let elementWidth = Math.max(element.scrollWidth || 0, element.offsetWidth || 0, 1200);

    function loop() {
        tickerOffset -= 1.8; // Smooth Speed

        // When content has completely scrolled off the screen to the left
        if (tickerOffset < -elementWidth) {
            if (tickerSequence.length > 1) {
                tickerSequenceIndex = (tickerSequenceIndex + 1) % tickerSequence.length;
                playTickerItem(tickerSequence[tickerSequenceIndex]);
                return;
            } else {
                tickerOffset = window.innerWidth;
                elementWidth = Math.max(element.scrollWidth || 0, element.offsetWidth || 0, 1200);
            }
        }

        element.style.transform = `translate3d(${tickerOffset}px, 0, 0)`;
        tickerAnimId = requestAnimationFrame(loop);
    }
    loop();
}

function updateTickerSequence() {
    const s = currentSettings || {};
    let mode = s.tickerMode;
    if (!mode) {
        if (s.tickerMessage && s.tickerMessage.trim() !== '') mode = 'director';
        else if (s.rssUrl && s.rssUrl.trim() !== '') mode = 'rss';
        else mode = 'none';
    }

    const dirMsg = s.tickerMessage ? s.tickerMessage.trim() : '';
    const dirBadge = s.tickerBadgeLabel || '🏛️ ΔΙΕΥΘΥΝΣΗ';
    const dirStyle = s.tickerStyle || 'gold';
    const badgeIcon = getBadgeIcon(dirBadge);

    const newSeq = [];

    // Director item (clean icon pill, no repeated text, no extra colon)
    const dirItem = dirMsg ? {
        type: 'director',
        label: dirBadge,
        style: dirStyle,
        html: `<span class="ticker-director-pill">${badgeIcon}</span> <span class="ticker-director-message">${dirMsg}</span>`
    } : null;

    // RSS item (clean news items with bullets)
    let rssItem = null;
    if (cachedRssItems && cachedRssItems.length > 0) {
        const rssSpans = cachedRssItems.map(title => `
            <span class="ticker-rss-item">
                <span class="ticker-rss-bullet">✦</span> ${title}
            </span>
        `).join('');
        rssItem = {
            type: 'rss',
            label: '🗞️ ΕΙΔΗΣΕΙΣ',
            style: 'rss',
            html: rssSpans
        };
    }

    if (mode === 'none') {
        tickerSequence = [];
    } else if (mode === 'director') {
        if (dirItem) newSeq.push(dirItem);
    } else if (mode === 'rss') {
        if (rssItem) newSeq.push(rssItem);
    } else if (mode === 'both') {
        if (dirItem) newSeq.push(dirItem);
        if (rssItem) newSeq.push(rssItem);
    }

    tickerSequence = newSeq;

    const tickerContainer = document.getElementById('tickerContainer');
    if (tickerSequence.length === 0) {
        if (tickerContainer) tickerContainer.style.display = 'none';
        document.body.classList.add('no-ticker');
        if (tickerAnimId) {
            cancelAnimationFrame(tickerAnimId);
            tickerAnimId = null;
        }
        return;
    } else {
        document.body.classList.remove('no-ticker');
    }

    // If ticker was not already playing, start it
    if (!tickerAnimId) {
        tickerSequenceIndex = 0;
        playTickerItem(tickerSequence[0]);
    } else {
        if (tickerSequenceIndex >= tickerSequence.length) {
            tickerSequenceIndex = 0;
            playTickerItem(tickerSequence[0]);
        }
    }
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
    const clockEl = document.getElementById('clock');
    const dateEl = document.getElementById('date');

    if (clockEl) {
        let h = now.getHours();
        const m = now.getMinutes();
        const ampm = h >= 12 ? 'μ.μ.' : 'π.μ.';
        h = h % 12;
        h = h ? h : 12;
        const mStr = m < 10 ? '0' + m : m;
        const newHtml = `${h}:${mStr}<span style="font-size:0.6em; margin-left:5px;">${ampm}</span>`;
        if (clockEl.innerHTML !== newHtml) {
            clockEl.innerHTML = newHtml;
        }
    }

    if (dateEl) {
        const options = { weekday: 'long', day: 'numeric', month: 'long' };
        const dateStr = now.toLocaleDateString('el-GR', options).toUpperCase();
        if (dateEl.innerText !== dateStr) {
            dateEl.innerText = dateStr;
        }
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

    // Ticker Logic (Modes: 'director', 'rss', 'both', 'none')
    if (rssInterval) {
        clearInterval(rssInterval);
        rssInterval = null;
    }

    const rssUrl = s.rssUrl ? s.rssUrl.trim() : '';
    const mode = s.tickerMode || (s.tickerMessage ? 'director' : (s.rssUrl ? 'rss' : 'none'));

    if (mode === 'rss' || mode === 'both') {
        if (rssUrl) {
            fetchRSS(rssUrl);
            rssInterval = setInterval(() => fetchRSS(rssUrl), 600000);
        }
    }

    updateTickerSequence();

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

let slideMediaInterval = null;

function startPhotoSlideshow(containerId, count, totalDurationSec = 10, effect = 'fade') {
    if (count <= 1) return;
    if (slideMediaInterval) clearInterval(slideMediaInterval);

    let activeIdx = 0;
    // Interval per slide: total duration divided by count, min 2500ms
    const stepMs = Math.max(2500, Math.floor((totalDurationSec * 1000) / count));

    slideMediaInterval = setInterval(() => {
        const container = document.getElementById(containerId);
        if (!container) {
            clearInterval(slideMediaInterval);
            slideMediaInterval = null;
            return;
        }

        const slides = container.querySelectorAll('.photo-slideshow-slide');
        const dots = container.querySelectorAll('.photo-dot');
        const counterCur = container.querySelector('.photo-slideshow-cur');

        if (!slides || slides.length === 0) return;

        slides[activeIdx]?.classList.remove('active');
        dots[activeIdx]?.classList.remove('active');

        activeIdx = (activeIdx + 1) % count;

        slides[activeIdx]?.classList.add('active');
        dots[activeIdx]?.classList.add('active');
        if (counterCur) counterCur.textContent = (activeIdx + 1);
    }, stepMs);
}

function renderTextBlock(item, compact = false) {
    const badgeHtml = `<div class="slide-card-badge">${getTypeIcon(item.type)} ${getTypeLabel(item.type)}</div>`;
    const titleHtml = `<h1 class="slide-card-title">${item.title}</h1>`;
    const dividerHtml = `<div class="slide-card-divider"></div>`;
    const bodyHtml = item.content ? `<div class="slide-card-body">${item.content}</div>` : '';

    return `
        <div class="zone-card zone-card-text">
            ${badgeHtml}
            ${titleHtml}
            ${dividerHtml}
            ${bodyHtml}
        </div>
    `;
}

function renderThirdZoneBlock(item) {
    let innerHtml = '';

    if (item.extraInfoText && item.extraInfoText.trim() !== '') {
        innerHtml += `
            <div class="zone-extra-title">📌 ΠΛΗΡΟΦΟΡΙΕΣ</div>
            <div class="zone-extra-text">${item.extraInfoText}</div>
        `;
    }

    if (item.showQrInThirdZone) {
        const qrTarget = item.mediaSource && (item.mediaSource.startsWith('http://') || item.mediaSource.startsWith('https://'))
            ? item.mediaSource
            : (currentSettings.hostUrl || window.location.href);
        const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=140x140&data=${encodeURIComponent(qrTarget)}`;
        innerHtml += `
            <div style="margin-top: 1rem; display: flex; flex-direction: column; align-items: center;">
                <div class="zone-qr-container">
                    <img src="${qrUrl}" alt="Scan QR" style="width: 120px; height: 120px; display: block;">
                </div>
                <div style="color: var(--text-secondary); font-size: 0.8rem; margin-top: 0.4rem; font-weight: 700; letter-spacing: 1px;">ΣΚΑΝΑΡΕΤΕ ΜΕ ΤΟ ΚΙΝΗΤΟ</div>
            </div>
        `;
    }

    if (!innerHtml) {
        const now = new Date();
        const dateStr = now.toLocaleDateString('el-GR', { weekday: 'long', day: 'numeric', month: 'long' });
        innerHtml = `
            <div class="zone-extra-title">🏫 ${currentSettings.schoolName || 'ΣΧΟΛΙΚΗ ΤΗΛΕΜΑΤΙΚΗ'}</div>
            <div class="zone-extra-text" style="font-size: 1.15rem; color: #cbd5e1; margin-top: 0.4rem;">${dateStr}</div>
            <div style="margin-top: 1.25rem; padding: 0.5rem 1rem; background: rgba(59,130,246,0.15); border: 1px solid rgba(59,130,246,0.3); border-radius: 2rem; color: #60a5fa; font-weight: 700; font-size: 0.85rem; display: inline-flex; align-items: center; gap: 0.4rem;">
                ⏱️ ${item.duration || 10} δευτερόλεπτα
            </div>
        `;
    }

    return `
        <div class="zone-card zone-card-extra">
            ${innerHtml}
        </div>
    `;
}

function renderMediaBlock(item, containerId) {
    const scale = parseFloat(item.mediaScale) || 1.0;
    let imgScale = scale !== 1.0 ? `transform: scale(${scale}); transform-origin: center center;` : '';

    if (item.mediaType === 'image' || item.mediaType === 'live_image') {
        const sources = item.mediaSources && item.mediaSources.length > 0 ? item.mediaSources : (item.mediaSource ? [item.mediaSource] : []);

        if (sources.length > 1) {
            if (item.multiDisplayMode === 'grid') {
                const n = sources.length;
                const cols = n <= 1 ? 1 : n <= 4 ? 2 : 3;
                const gap = 1;
                const maxW = `calc(${(100/cols).toFixed(2)}% - ${(gap*(cols-1)/cols).toFixed(2)}rem)`;
                const maxH = `calc(${(100 / Math.ceil(n/cols)).toFixed(2)}% - ${gap/2}rem)`;
                return `
                    <div style="width: 100%; height: 100%; display: flex; flex-wrap: wrap; gap: ${gap}rem; padding: 0.5rem; justify-content: center; align-items: center; overflow: hidden; box-sizing: border-box;">
                        ${sources.map(src => `
                            <img src="${src}" style="max-width: ${maxW}; max-height: ${maxH}; object-fit: contain; border-radius: 0.75rem; box-shadow: 0 8px 20px rgba(0,0,0,0.4); flex-shrink: 0; ${imgScale}">
                        `).join('')}
                    </div>
                `;
            } else {
                const effectClass = item.transitionEffect === 'zoom' ? 'effect-zoom' : (item.transitionEffect === 'slide' ? 'effect-slide' : 'effect-fade');
                setTimeout(() => {
                    startPhotoSlideshow(containerId, sources.length, item.duration || 10, item.transitionEffect || 'fade');
                }, 50);

                return `
                    <div class="photo-slideshow-container ${effectClass}" id="${containerId}">
                        ${sources.map((src, i) => `
                            <div class="photo-slideshow-slide ${i === 0 ? 'active' : ''}" data-index="${i}">
                                <img src="${src}" class="photo-slideshow-img" style="${imgScale}">
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
                    <img src="${sources[0]}" class="slide-image" style="max-width: 100%; max-height: 100%; object-fit: contain; border-radius: 1rem; box-shadow: 0 12px 30px rgba(0,0,0,0.5); ${imgScale}">
                </div>
            `;
        } else {
            return `<div style="color: #94a3b8; font-size: 1.3rem;">📁 Δεν έχει επιλεγεί αρχείο</div>`;
        }
    }
    else if (item.mediaType === 'youtube') {
        const vidId = item.mediaSource?.split('v=')[1]?.split('&')[0] || item.mediaSource?.split('/').pop();
        return `<iframe src="https://www.youtube.com/embed/${vidId}?autoplay=1&mute=1&controls=0&loop=1" class="slide-iframe" frameborder="0" style="width:100%; height:100%; border-radius: 1rem;"></iframe>`;
    }
    else if (item.mediaType === 'countdown') {
        const target = new Date(item.mediaSource).getTime();
        setTimeout(() => startCountdownTicker(item.id, target), 50);
        return `
            <div style="width: 100%; height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 1.5rem;">
                <div class="slide-card-badge">⏱️ ΑΝΤΙΣΤΡΟΦΗ ΜΕΤΡΗΣΗ</div>
                <div id="countdown-${item.id}" style="font-size: clamp(2.5rem, 5vw, 4.5rem); font-weight: 800; font-family: 'Inter', monospace; letter-spacing: 2px; color: #60a5fa; margin: 1.5rem 0; text-shadow: 0 0 30px rgba(59, 130, 246, 0.5);">Φόρτωση...</div>
            </div>
        `;
    }
    else if (item.mediaType === 'website') {
        let scaleStyle = '';
        if (scale !== 1.0) {
            const w = 100 / scale;
            const h = `calc((100vh - 190px) / ${scale})`;
            scaleStyle = `width: ${w}% !important; height: ${h} !important; transform: scale(${scale}) !important; transform-origin: 0 0 !important;`;
        }
        const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(item.mediaSource)}`;
        return `
            <div style="position: relative; width: 100%; height: 100%; overflow: hidden; border-radius: 1rem;">
                <iframe src="${item.mediaSource}" class="slide-iframe framed-web" frameborder="0" style="${scaleStyle}"></iframe>
                <div class="qr-box">
                    <img src="${qrUrl}" alt="Scan QR">
                    <div class="qr-label">SCAN ME</div>
                </div>
            </div>
        `;
    }
    else if (item.mediaType === 'google_slides') {
        return `
            <iframe src="${item.mediaSource}" frameborder="0" allowfullscreen="true" style="width: 100%; height: 100%; border: none; border-radius: 1rem; background: #000;"></iframe>
        `;
    }
    else if (item.mediaType === 'exam_calendar') {
        setTimeout(() => fetchAndRenderExamCalendar(item.id, item.mediaSource), 50);
        return `
            <div style="width: 100%; height: 100%; display: flex; flex-direction: column; background: #1e293b; border-radius: 1rem; overflow: hidden;">
                <div style="background: var(--accent-color); padding: 0.6rem 1.5rem; color: white; display: flex; justify-content: space-between; align-items: center;">
                    <h3 style="margin: 0; font-size: 1.2rem;">📅 ${item.title || 'Πρόγραμμα'}</h3>
                    <div id="exam-month-${item.id}" style="font-size: 1rem; font-weight: bold; text-transform: uppercase;"></div>
                </div>
                <div id="exam-grid-${item.id}" style="flex: 1; display: grid; grid-template-columns: repeat(5, 1fr); gap: 1px; background: #e2e8f0; overflow: hidden;">
                    <div style="grid-column: 1/-1; text-align: center; padding: 2rem; font-size: 1.3rem;">Φόρτωση... ⏳</div>
                </div>
            </div>
        `;
    }
    else if (item.mediaType === 'pdf' || item.mediaType === 'schedule') {
        const sources = item.mediaSources && item.mediaSources.length > 0 ? item.mediaSources : [item.mediaSource];
        const pdfSources = sources.filter(s => s && (s.startsWith('data:application/pdf') || s.toLowerCase().includes('.pdf')));
        const imageSources = sources.filter(s => s && (s.startsWith('data:image/') || s.match(/\.(jpeg|jpg|gif|png|webp)/i)));

        if (pdfSources.length > 1) {
            const isSlideMode = item.multiDisplayMode !== 'grid';
            if (isSlideMode) {
                setTimeout(() => {
                    startPhotoSlideshow(containerId, pdfSources.length, item.duration || 10, 'fade');
                    pdfSources.forEach((src, idx) => {
                        renderPDFJS(src, `pdf-container-${item.id}-${idx}`, item.mediaScale || 1.0);
                    });
                }, 50);

                return `
                    <div class="photo-slideshow-container" id="${containerId}">
                        ${pdfSources.map((src, i) => `
                            <div class="photo-slideshow-slide ${i === 0 ? 'active' : ''}" data-index="${i}">
                                <div id="pdf-container-${item.id}-${i}" class="pdf-display-wrapper">
                                    <div style="color: var(--text-primary); font-size: 1.1rem; margin: auto;">Φόρτωση Έγγραφο ${i + 1}... ⏳</div>
                                </div>
                            </div>
                        `).join('')}
                        <div class="photo-slideshow-counter">
                            <span>📄</span>
                            <span class="photo-slideshow-cur">1</span> / <span>${pdfSources.length}</span>
                        </div>
                        <div class="photo-slideshow-dots">
                            ${pdfSources.map((_, i) => `<span class="photo-dot ${i === 0 ? 'active' : ''}"></span>`).join('')}
                        </div>
                    </div>
                `;
            } else {
                pdfSources.forEach((src, idx) => {
                    setTimeout(() => renderPDFJS(src, `pdf-container-${item.id}-${idx}`, item.mediaScale || 1.0), 50 + (idx * 50));
                });
                return `
                    <div style="display: flex; gap: 1rem; width: 100%; height: 100%; justify-content: center; align-items: stretch; padding: 4px; overflow: hidden; box-sizing: border-box;">
                        ${pdfSources.map((src, idx) => `
                            <div id="pdf-container-${item.id}-${idx}" class="pdf-display-wrapper" style="flex: 1; height: 100%;">
                                <div style="color: var(--text-primary); font-size: 1.1rem; margin: auto;">Φόρτωση PDF ${idx + 1}... ⏳</div>
                            </div>
                        `).join("")}
                    </div>
                `;
            }
        } else if (pdfSources.length === 1) {
            setTimeout(() => renderPDFJS(pdfSources[0], `pdf-container-${item.id}-0`, item.mediaScale || 1.0), 50);
            return `
                <div id="pdf-container-${item.id}-0" class="pdf-display-wrapper">
                    <div style="color: var(--text-primary); font-size: 1.2rem; margin: auto;">Φόρτωση PDF... ⏳</div>
                </div>
            `;
        } else if (imageSources.length > 0) {
            item.mediaSources = imageSources;
            return renderMediaBlock(item, containerId);
        } else {
            return `<div style="color: #94a3b8; font-size: 1.3rem;">📁 Δεν έχει επιλεγεί αρχείο</div>`;
        }
    }
    else {
        return `
            <div style="width: 100%; height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 2rem; text-align: center;">
                <div style="font-size: 4rem; margin-bottom: 1rem; animation: pulse 2s infinite;">📢</div>
                <div style="font-size: 1.8rem; font-weight: 700; color: #f8fafc; line-height: 1.4;">${item.content || item.title}</div>
            </div>
        `;
    }
}

function renderSlide(item) {
    const container = document.getElementById('slideContainer');
    const layout = item.layout || 'fullscreen';

    // Clear any active slideshow or countdown tickers
    if (slideMediaInterval) {
        clearInterval(slideMediaInterval);
        slideMediaInterval = null;
    }
    if (countdownTimerId) {
        clearInterval(countdownTimerId);
        countdownTimerId = null;
    }

    // Auto-Fullscreen check (Hide Header only on fullscreen pure media)
    const isFullMedia = layout === 'fullscreen' && ['image', 'live_image', 'youtube'].includes(item.mediaType);
    if (isFullMedia) {
        document.body.classList.add('fullscreen-mode');
    } else {
        document.body.classList.remove('fullscreen-mode');
    }

    const slideshowId = `slideshow-${item.id || Date.now()}`;

    // 1. FULLSCREEN (1 Part)
    if (layout === 'fullscreen') {
        if (item.mediaType === 'text') {
            container.innerHTML = `
                <div class="slide active type-${item.type} layout-fullscreen">
                    <div class="slide-card-container">
                        <div class="slide-card">
                            <div class="slide-card-badge">${getTypeIcon(item.type)} ${getTypeLabel(item.type)}</div>
                            <h1 class="slide-card-title">${item.title}</h1>
                            <div class="slide-card-divider"></div>
                            <div class="slide-card-body">${item.content || ''}</div>
                        </div>
                    </div>
                </div>
            `;
        } else {
            const mediaHtml = renderMediaBlock(item, slideshowId);
            container.innerHTML = `
                <div class="slide active type-${item.type} layout-fullscreen media-${item.mediaType}" style="width:100%; height:100%; position:relative;">
                    ${mediaHtml}
                    ${item.content ? `<div class="slide-overlay"><h2>${item.title}</h2><div>${item.content}</div></div>` : ''}
                </div>
            `;
        }
    }
    // 2. TWO PARTS (Split Left, Split Right, Split Top, Split Bottom)
    else if (['split-left', 'split-right', 'split-top', 'split-bottom'].includes(layout)) {
        const textHtml = renderTextBlock(item);
        const mediaHtml = `<div class="zone-card zone-card-media">${renderMediaBlock(item, slideshowId)}</div>`;

        let part1 = textHtml;
        let part2 = mediaHtml;

        if (layout === 'split-right' || layout === 'split-bottom') {
            part1 = mediaHtml;
            part2 = textHtml;
        }

        container.innerHTML = `
            <div class="slide active type-${item.type} multi-zone-container layout-${layout}">
                ${part1}
                ${part2}
            </div>
        `;
    }
    // 3. THREE PARTS (split-3-col, split-3-focus, split-3-row)
    else if (['split-3-col', 'split-3-focus', 'split-3-row'].includes(layout)) {
        const textHtml = renderTextBlock(item, true);
        const mediaHtml = `<div class="zone-card zone-card-media ${layout === 'split-3-focus' ? 'zone-media-focus' : ''}">${renderMediaBlock(item, slideshowId)}</div>`;
        const thirdHtml = renderThirdZoneBlock(item);

        if (layout === 'split-3-focus') {
            container.innerHTML = `
                <div class="slide active type-${item.type} multi-zone-container layout-split-3-focus">
                    ${mediaHtml}
                    ${textHtml}
                    ${thirdHtml}
                </div>
            `;
        } else if (layout === 'split-3-col') {
            container.innerHTML = `
                <div class="slide active type-${item.type} multi-zone-container layout-split-3-col">
                    ${textHtml}
                    ${mediaHtml}
                    ${thirdHtml}
                </div>
            `;
        } else if (layout === 'split-3-row') {
            container.innerHTML = `
                <div class="slide active type-${item.type} multi-zone-container layout-split-3-row">
                    ${textHtml}
                    ${mediaHtml}
                    ${thirdHtml}
                </div>
            `;
        }
    }
}

let countdownTimerId = null;
function startCountdownTicker(id, targetTime) {
    if (countdownTimerId) clearInterval(countdownTimerId);

    const update = () => {
        const el = document.getElementById(`countdown-${id}`);
        if (!el) {
            if (countdownTimerId) clearInterval(countdownTimerId);
            return;
        }

        const now = new Date().getTime();
        const dist = targetTime - now;

        if (dist < 0) {
            el.innerText = "ΕΛΗΞΕ";
            if (countdownTimerId) clearInterval(countdownTimerId);
            return;
        }

        const days = Math.floor(dist / (1000 * 60 * 60 * 24));
        const hours = Math.floor((dist % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((dist % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((dist % (1000 * 60)) / 1000);

        el.innerText = `${days}ημ. ${hours}ωρ. ${minutes}λεπ. ${seconds}δευτ.`;
    };

    update();
    countdownTimerId = setInterval(update, 1000);
}

function getTypeIcon(type) {
    if (type === 'alert') return '🚨';
    if (type === 'event') return '🎉';
    return '📢';
}

function getTypeLabel(type) {
    const labels = { 'info': 'ΕΝΗΜΕΡΩΣΗ', 'alert': 'ΠΡΟΣΟΧΗ / ΕΠΕΙΓΟΝ', 'event': 'ΕΚΔΗΛΩΣΗ' };
    return labels[type] || 'ΑΝΑΚΟΙΝΩΣΗ';
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
