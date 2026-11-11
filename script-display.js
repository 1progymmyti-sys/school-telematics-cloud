import { db, doc, onSnapshot, collection, query, orderBy, updateDoc, deleteDoc } from "./firebase-config.js";
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

// ===================================================
// GREEK OFFICIAL NETWORK TIME SYNCHRONIZATION ENGINE
// Solves TV clock/timezone drift (e.g. DST changes, un-synchronized TV clocks)
// by retrieving official time for Europe/Athens from external atomic time APIs.
// ===================================================

let greekTimeBaseWallMs = null;
let greekTimeBaseMonotonicMs = null;
let greekTimeSyncSource = 'pending';

// Official EU / Greek Daylight Saving Time rule:
// - Starts: Last Sunday of March at 01:00 UTC (clocks move forward to UTC+3)
// - Ends: Last Sunday of October at 01:00 UTC (clocks move back to UTC+2)
function getGreekUtcOffsetHours(utcMs) {
    const d = new Date(utcMs);
    const y = d.getUTCFullYear();
    const mar31 = new Date(Date.UTC(y, 2, 31, 1, 0, 0));
    const dstStart = new Date(Date.UTC(y, 2, 31 - mar31.getUTCDay(), 1, 0, 0));
    const oct31 = new Date(Date.UTC(y, 9, 31, 1, 0, 0));
    const dstEnd = new Date(Date.UTC(y, 9, 31 - oct31.getUTCDay(), 1, 0, 0));
    const isDst = (utcMs >= dstStart.getTime() && utcMs < dstEnd.getTime());
    return isDst ? 3 : 2;
}

function getMonotonicMs() {
    return (window.performance && performance.now) ? performance.now() : Date.now();
}

function utcMsToGreekWallMs(utcMs) {
    const offsetHours = getGreekUtcOffsetHours(utcMs);
    return utcMs + (offsetHours * 3600000);
}

// Custom Date wrapper representing official Greek time independently of TV's OS timezone/DST
class GreekDate extends Date {
    constructor(wallMs) {
        super(wallMs);
    }
    getHours() { return this.getUTCHours(); }
    getMinutes() { return this.getUTCMinutes(); }
    getSeconds() { return this.getUTCSeconds(); }
    getMilliseconds() { return this.getUTCMilliseconds(); }
    getFullYear() { return this.getUTCFullYear(); }
    getMonth() { return this.getUTCMonth(); }
    getDate() { return this.getUTCDate(); }
    getDay() { return this.getUTCDay(); }
    setDate(d) { return this.setUTCDate(d); }
    setHours(h, m = 0, s = 0, ms = 0) { return this.setUTCHours(h, m, s, ms); }
    setMonth(m, d) { return d !== undefined ? this.setUTCMonth(m, d) : this.setUTCMonth(m); }
    setFullYear(y, m, d) { return this.setUTCFullYear(y, m !== undefined ? m : this.getUTCMonth(), d !== undefined ? d : this.getUTCDate()); }
    
    toLocaleDateString(locale, options) {
        const days = ['Κυριακή', 'Δευτέρα', 'Τρίτη', 'Τετάρτη', 'Πέμπτη', 'Παρασκευή', 'Σάββατο'];
        const months = ['Ιανουαρίου', 'Φεβρουαρίου', 'Μαρτίου', 'Απριλίου', 'Μαΐου', 'Ιουνίου', 'Ιουλίου', 'Αυγούστου', 'Σεπτεμβρίου', 'Οκτωβρίου', 'Νοεμβρίου', 'Δεκεμβρίου'];
        const dayName = days[this.getDay()];
        const monthName = months[this.getMonth()];
        const d = this.getDate();
        const y = this.getFullYear();
        if (options && options.weekday === 'long') {
            return `${dayName}, ${d} ${monthName}`;
        }
        return `${d}/${this.getMonth() + 1}/${y}`;
    }
}

function getGreekNow() {
    if (greekTimeBaseWallMs === null) {
        // Immediate fallback before network sync responds
        return new GreekDate(utcMsToGreekWallMs(Date.now()));
    }
    const elapsed = getMonotonicMs() - greekTimeBaseMonotonicMs;
    return new GreekDate(greekTimeBaseWallMs + elapsed);
}

async function syncGreekNetworkTime() {
    const monoStart = getMonotonicMs();
    
    // Method 1: Dedicated Europe/Athens time API
    try {
        const ctrl = new AbortController();
        const tid = setTimeout(() => ctrl.abort(), 4000);
        const res = await fetch('https://timeapi.io/api/time/current/zone?timeZone=Europe/Athens', {
            signal: ctrl.signal,
            cache: 'no-store'
        });
        clearTimeout(tid);
        if (res.ok) {
            const data = await res.json();
            if (data && data.year && data.month && data.day && data.hour !== undefined) {
                const monoEnd = getMonotonicMs();
                const latency = Math.max(0, (monoEnd - monoStart) / 2);
                const wallMs = Date.UTC(
                    data.year,
                    data.month - 1,
                    data.day,
                    data.hour,
                    data.minute || 0,
                    data.seconds || 0,
                    data.milliSeconds || 0
                ) + latency;
                
                greekTimeBaseWallMs = wallMs;
                greekTimeBaseMonotonicMs = monoEnd;
                greekTimeSyncSource = 'timeapi.io (Europe/Athens)';
                console.log(`🕒 Greek official network time synchronized via ${greekTimeSyncSource}: ${data.hour}:${String(data.minute).padStart(2,'0')}:${String(data.seconds).padStart(2,'0')} (DST: ${data.dstActive})`);
                if (typeof updateClock === 'function') updateClock();
                return true;
            }
        }
    } catch (e) {
        // try Method 2
    }
    
    // Method 2: Server HTTP Date header (GitHub Pages / same-origin)
    try {
        const ctrl = new AbortController();
        const tid = setTimeout(() => ctrl.abort(), 4000);
        const res = await fetch(`version.json?t=${Date.now()}`, {
            signal: ctrl.signal,
            cache: 'no-store'
        });
        clearTimeout(tid);
        const serverDateHeader = res.headers.get('date');
        if (serverDateHeader) {
            const serverUtcMs = Date.parse(serverDateHeader);
            if (!isNaN(serverUtcMs)) {
                const monoEnd = getMonotonicMs();
                const latency = Math.max(0, (monoEnd - monoStart) / 2);
                const wallMs = utcMsToGreekWallMs(serverUtcMs + latency);
                
                greekTimeBaseWallMs = wallMs;
                greekTimeBaseMonotonicMs = monoEnd;
                greekTimeSyncSource = 'server_http_date';
                console.log(`🕒 Greek official network time synchronized via server HTTP Date: ${new Date(wallMs).toISOString()}`);
                if (typeof updateClock === 'function') updateClock();
                return true;
            }
        }
    } catch (e) {
        // Method 2 failed
    }
    
    // Fallback: If network unreachable, calculate from local hardware clock with Greek DST
    if (greekTimeBaseWallMs === null) {
        greekTimeBaseWallMs = utcMsToGreekWallMs(Date.now());
        greekTimeBaseMonotonicMs = getMonotonicMs();
        greekTimeSyncSource = 'local_dst_fallback';
    }
    return false;
}

// Initial sync on load
syncGreekNetworkTime();
// Re-sync every 10 minutes to prevent clock drift
setInterval(syncGreekNetworkTime, 10 * 60 * 1000);
// Re-sync on visibility change (e.g. TV wakes from standby or unfreezes)
document.addEventListener('visibilitychange', () => {
    if (!document.hidden) syncGreekNetworkTime();
});
// Expose debug accessor
window.getGreekTimeDebug = () => ({
    time: getGreekNow().toLocaleDateString('el-GR') + ' ' + getGreekNow().getHours() + ':' + String(getGreekNow().getMinutes()).padStart(2, '0') + ':' + String(getGreekNow().getSeconds()).padStart(2, '0'),
    source: greekTimeSyncSource,
    hours: getGreekNow().getHours(),
    minutes: getGreekNow().getMinutes()
});

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

// Helper: Turn the saved video value (filename, path or link) into a playable source.
// Keep in sync with resolveVideoSource() in script-admin.js.
function resolveVideoSource(raw) {
    let s = (raw || '').trim();
    if (!s) return null;
    // Google Drive -> embedded preview player
    const drive = s.match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:export=\w+&)?id=)([a-zA-Z0-9_-]+)/);
    if (drive) return { kind: 'iframe', src: `https://drive.google.com/file/d/${drive[1]}/preview`, fallback: null };
    // Dropbox share link -> direct stream
    if (/dropbox\.com/i.test(s)) {
        s = s.replace(/([?&])dl=0/, '$1raw=1');
        if (!/[?&](raw|dl)=1/.test(s)) s += (s.includes('?') ? '&' : '?') + 'raw=1';
        return { kind: 'video', src: s, fallback: null };
    }
    if (/^https?:\/\//i.test(s)) return { kind: 'video', src: s, fallback: null };
    // Plain filename or relative path -> videos/ folder on GitHub
    s = s.replace(/\\/g, '/').replace(/^\.?\//, '');
    if (!/^videos\//i.test(s)) s = 'videos/' + s;
    const cleanPath = s.split('/').map(encodeURIComponent).join('/');
    const fallbackUrl = `https://1progymmyti-sys.github.io/school-telematics-cloud/${cleanPath}`;
    return { kind: 'video', src: cleanPath, fallback: fallbackUrl };
}

// Resilient video error recovery with automatic fallback to GitHub Pages and retry logic
window.handleSlideVideoError = function(vid) {
    if (!vid) return;
    const fallback = vid.dataset.fallback;
    // Step 1: Try absolute GitHub Pages fallback if relative load failed
    if (fallback && !vid.dataset.triedFallback && vid.src !== fallback) {
        vid.dataset.triedFallback = 'true';
        console.warn('Primary video failed, falling back to absolute GitHub Pages URL:', fallback);
        vid.src = fallback;
        vid.load();
        const p = vid.play();
        if (p && p.catch) p.catch(() => {});
        return;
    }
    // Step 2: Retry up to 2 times after 3 seconds (handles in-progress GitHub Pages deployments)
    const retries = parseInt(vid.dataset.retries || '0', 10);
    if (retries < 2) {
        vid.dataset.retries = (retries + 1).toString();
        console.warn(`Video load retry ${retries + 1}/2 in 3 seconds...`);
        setTimeout(() => {
            vid.load();
            const p = vid.play();
            if (p && p.catch) p.catch(() => {});
        }, 3000);
        return;
    }
    // Step 3: All retries exhausted, show friendly error overlay
    vid.style.display = 'none';
    const errBox = vid.nextElementSibling;
    if (errBox) errBox.style.display = 'flex';
};

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

let normalTickerSequence = [];
let currentTickerMode = 'normal'; // 'normal' | 'schedule'
let lastScheduleTickerHtml = '';
let currentPlayingTickerKey = '';
let lastTickerSettingsKey = '';
let currentDisplayedSlideItem = null;
let labelSwitchTimer = null;
let currentTargetLabelText = '';

// Saved scroll states per mode so switching between normal slides ('schedule' ticker)
// and schedule-change slides ('normal' RSS/Director ticker) never loses progress
const savedTickerModeState = {
    normal: { index: 0, offset: null, seqKey: '' },
    schedule: { index: 0, offset: null, seqKey: '' }
};

function getTickerItemKey(item) {
    if (!item) return '';
    return `${item.label || ''}|${item.style || ''}|${item.html || ''}`;
}

function getSequenceKey(seq) {
    if (!seq || seq.length === 0) return '';
    return seq.map(getTickerItemKey).join('||');
}

function getFreshTickerStartOffset(immediateVisible = false) {
    const tickerContent = document.getElementById('tickerContent');
    const contentWidth = (tickerContent && tickerContent.clientWidth) ? tickerContent.clientWidth : window.innerWidth;
    if (immediateVisible) {
        return 48; // Immediately readable right next to the left pill badge
    }
    return Math.min(Math.max(contentWidth * 0.35, 220), 480);
}

function setTickerTheme(labelText, styleClass) {
    const tickerContainer = document.getElementById('tickerContainer');
    if (!tickerContainer) return;
    const labelEl = tickerContainer.querySelector('.ticker-label');

    if (labelEl && labelText) {
        if (currentTargetLabelText !== labelText || labelEl.innerHTML !== labelText) {
            currentTargetLabelText = labelText;
            if (labelSwitchTimer) {
                clearTimeout(labelSwitchTimer);
                labelSwitchTimer = null;
            }
            if (labelEl.innerHTML !== labelText) {
                labelEl.classList.add('label-switching');
                labelSwitchTimer = setTimeout(() => {
                    labelEl.innerHTML = currentTargetLabelText;
                    labelEl.classList.remove('label-switching');
                    labelSwitchTimer = null;
                }, 180);
            } else {
                labelEl.classList.remove('label-switching');
            }
        }
    }

    tickerContainer.classList.remove('ticker-mode-director', 'ticker-mode-gold', 'ticker-mode-alert', 'ticker-mode-rss', 'ticker-mode-schedule');
    if (styleClass === 'schedule' || styleClass === 'schedule_change') tickerContainer.classList.add('ticker-mode-schedule');
    else if (styleClass === 'alert') tickerContainer.classList.add('ticker-mode-alert');
    else if (styleClass === 'rss' || styleClass === 'blue') tickerContainer.classList.add('ticker-mode-rss');
    else tickerContainer.classList.add('ticker-mode-director');
}

function playTickerItem(item, customStartOffset = null) {
    if (!item) return;

    const tickerContainer = document.getElementById('tickerContainer');
    const tickerContent = document.getElementById('tickerContent');
    if (!tickerContainer || !tickerContent) return;

    currentPlayingTickerKey = getTickerItemKey(item);
    tickerContainer.style.display = 'flex';
    setTickerTheme(item.label, item.style);

    tickerContent.innerHTML = `<div class="ticker-text" id="movingTicker">${item.html}</div>`;
    const el = document.getElementById('movingTicker');
    if (el) startTickerAnim(el, customStartOffset);
}

function showTickerText(htmlContent, labelText, styleClass = 'director') {
    playTickerItem({
        label: labelText || '📢 ΕΝΗΜΕΡΩΣΗ',
        style: styleClass || 'director',
        html: htmlContent
    }, 48);
}

function startTickerAnim(element, customStartOffset = null) {
    if (tickerAnimId) cancelAnimationFrame(tickerAnimId);
    tickerOffset = (typeof customStartOffset === 'number' && !isNaN(customStartOffset))
        ? customStartOffset
        : getFreshTickerStartOffset(true);
    let elementWidth = Math.max(element.scrollWidth || 0, element.offsetWidth || 0, 300);

    function loop() {
        tickerOffset -= 1.8; // Smooth Speed
        elementWidth = Math.max(element.scrollWidth || 0, element.offsetWidth || 0, 300);

        // Save live progress for current mode
        if (savedTickerModeState[currentTickerMode]) {
            savedTickerModeState[currentTickerMode].index = tickerSequenceIndex;
            savedTickerModeState[currentTickerMode].offset = tickerOffset;
        }

        // When content has completely scrolled off the screen to the left
        if (tickerOffset < -elementWidth) {
            if (tickerSequence.length > 1) {
                tickerSequenceIndex = (tickerSequenceIndex + 1) % tickerSequence.length;
                if (savedTickerModeState[currentTickerMode]) {
                    savedTickerModeState[currentTickerMode].index = tickerSequenceIndex;
                    savedTickerModeState[currentTickerMode].offset = null;
                }
                playTickerItem(tickerSequence[tickerSequenceIndex], getFreshTickerStartOffset(false));
                return;
            } else if (tickerSequence.length === 1) {
                const onlyItem = tickerSequence[0];
                if (currentPlayingTickerKey !== getTickerItemKey(onlyItem)) {
                    tickerSequenceIndex = 0;
                    playTickerItem(onlyItem, getFreshTickerStartOffset(true));
                    return;
                }
                tickerOffset = getFreshTickerStartOffset(false);
            } else {
                tickerOffset = getFreshTickerStartOffset(false);
            }
        }

        element.style.transform = `translate3d(${tickerOffset}px, 0, 0)`;
        tickerAnimId = requestAnimationFrame(loop);
    }
    loop();
}

function getActiveDirectorTickerItem() {
    const s = currentSettings || {};
    let mode = s.tickerMode;
    if (!mode) {
        if (s.tickerMessage && s.tickerMessage.trim() !== '') mode = 'director';
        else if (s.rssUrl && s.rssUrl.trim() !== '') mode = 'rss';
        else mode = 'none';
    }
    if (mode !== 'director' && mode !== 'both') return null;

    const dirMsg = s.tickerMessage ? s.tickerMessage.trim() : '';
    if (!dirMsg) return null;

    const dirBadge = s.tickerBadgeLabel || '🏛️ ΔΙΕΥΘΥΝΣΗ';
    const dirStyle = s.tickerStyle || 'gold';
    const badgeIcon = getBadgeIcon(dirBadge);

    return {
        type: 'director',
        label: dirBadge,
        style: dirStyle,
        html: `<span class="ticker-director-pill">${badgeIcon}</span> <span class="ticker-director-message">${dirMsg}</span>`
    };
}

function buildNormalTickerSequence(forScheduleSlideOnScreen = false) {
    const s = currentSettings || {};
    let mode = s.tickerMode;
    if (!mode) {
        if (s.tickerMessage && s.tickerMessage.trim() !== '') mode = 'director';
        else if (s.rssUrl && s.rssUrl.trim() !== '') mode = 'rss';
        else mode = 'none';
    }

    const dirItem = getActiveDirectorTickerItem();

    let rssFullItem = null;
    const rssChunks = [];
    if (cachedRssItems && cachedRssItems.length > 0) {
        const buildRssHtml = (list) => list.map(title => `
            <span class="ticker-rss-item">
                <span class="ticker-rss-bullet">✦</span> ${title}
            </span>
        `).join('');

        rssFullItem = {
            type: 'rss',
            label: '🗞️ ΕΙΔΗΣΕΙΣ',
            style: 'rss',
            html: buildRssHtml(cachedRssItems)
        };

        const chunkSize = 3;
        for (let i = 0; i < cachedRssItems.length; i += chunkSize) {
            rssChunks.push({
                type: 'rss',
                label: '🗞️ ΕΙΔΗΣΕΙΣ',
                style: 'rss',
                html: buildRssHtml(cachedRssItems.slice(i, i + chunkSize))
            });
        }
    }

    const newSeq = [];

    if (mode === 'none' && !forScheduleSlideOnScreen) {
        return newSeq;
    }

    // Rule: When a Schedule Change slide is on screen, RSS must appear (alongside Director message if active, respecting priority)
    if (forScheduleSlideOnScreen) {
        if (dirItem && rssChunks.length > 0) {
            // Priority 1: Director's message, Priority 3: RSS chunks
            rssChunks.forEach(chunk => {
                newSeq.push(dirItem);
                newSeq.push(chunk);
            });
        } else if (rssFullItem) {
            newSeq.push(rssFullItem);
        } else if (dirItem) {
            newSeq.push(dirItem);
        }
        return newSeq;
    }

    // Standard normal mode (when no schedule changes exist)
    if (mode === 'director') {
        if (dirItem) newSeq.push(dirItem);
        else if (rssFullItem) newSeq.push(rssFullItem);
    } else if (mode === 'rss') {
        if (rssFullItem) newSeq.push(rssFullItem);
        else if (dirItem) newSeq.push(dirItem);
    } else if (mode === 'both') {
        if (dirItem && rssChunks.length > 0) {
            // Priority 1: Director's message first, then RSS chunk
            rssChunks.forEach(chunk => {
                newSeq.push(dirItem);
                newSeq.push(chunk);
            });
        } else if (dirItem) {
            newSeq.push(dirItem);
        } else if (rssFullItem) {
            newSeq.push(rssFullItem);
        }
    }

    return newSeq;
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

    const settingsKey = `${mode}|${dirMsg}|${dirBadge}|${dirStyle}|${s.rssUrl || ''}|${(cachedRssItems || []).length}`;
    lastTickerSettingsKey = settingsKey;

    const activeSlide = currentDisplayedSlideItem || ((slides && slides.length > 0) ? (slides[currentIndex] || slides[0]) : null);
    normalTickerSequence = buildNormalTickerSequence(isScheduleChangeSlide(activeSlide));

    // Always delegate to syncTickerWithCurrentSlide so it remains the single authority
    // deciding whether the bottom bar shows Schedule Changes (during normal slides) or RSS (during schedule slides)
    syncTickerWithCurrentSlide(activeSlide);
}

// ===================================================
// DYNAMIC SCHEDULE TICKER SYNC
// Strict Rule & Priority Hierarchy:
// - When NORMAL announcements are on the main screen (!isScheduleChangeSlide(item)) and schedule changes exist:
//   Urgent Schedule Changes (📅 ΑΛΛΑΓΕΣ ΠΡΟΓΡΑΜΜΑΤΟΣ) take the exact place of RSS News (🗞️ ΕΙΔΗΣΕΙΣ)
//   for the entire duration of the normal announcements so schedule changes are never lost!
//   (If Director's Message 🏛️ ΔΙΕΥΘΥΝΣΗ is also active, it alternates with 📅 ΑΛΛΑΓΕΣ ΠΡΟΓΡΑΜΜΑΤΟΣ).
// - When a SCHEDULE CHANGE announcement is on the main screen (isScheduleChangeSlide(item)):
//   RSS News (🗞️ ΕΙΔΗΣΕΙΣ) is displayed (alongside 🏛️ ΔΙΕΥΘΥΝΣΗ if active, with 🏛️ ΔΙΕΥΘΥΝΣΗ having 1st priority).
// ===================================================

// Mapping of Greek school periods to their end times (used for per-hour schedule change removal)
const SCHOOL_PERIOD_END_TIMES = {
    1: "08:45",
    2: "09:35",
    3: "10:30",
    4: "11:25",
    5: "12:20",
    6: "13:10",
    7: "13:55"
};

function isScheduleChangeSlide(item) {
    if (!item) return false;
    return item.mediaType === 'schedule_change' || item.isScheduleChange === true;
}

function normalizeScheduleSectionName(item) {
    const data = (item && item.scheduleData) || {};
    let sec = data.section || (item && item.title ? item.title.replace(/Αλλαγή\s+Προγράμματος\s*[-–]?\s*/i, '').replace(/Τμήμα\s*/i, '').trim() : '') || 'Τμήμα';
    sec = sec.replace(/[\s\-_\'\.]/g, '').toUpperCase();
    if (sec.startsWith('A')) sec = 'Α' + sec.slice(1);
    else if (sec.startsWith('B')) sec = 'Β' + sec.slice(1);
    else if (sec.startsWith('C')) sec = 'Γ' + sec.slice(1);
    return sec || 'Τμήμα';
}

function getScheduleTargetDate(item, fallbackDateStr = '') {
    let rawDate = (item && item.scheduleData && item.scheduleData.dateIso) || (item && item.endDate) || (item && item.startDate) || fallbackDateStr;
    if (rawDate && rawDate.includes('T')) rawDate = rawDate.split('T')[0];
    return (rawDate || '').trim();
}

function getRawChangesFromScheduleItem(item) {
    const data = (item && item.scheduleData) || {};
    let changes = Array.isArray(data.changes) ? data.changes.map(c => ({ ...c, hour: parseInt(c.hour, 10) || 1 })) : [];
    if (changes.length === 0 && item && item.content) {
        const text = `${item.title || ''} ${item.content || ''}`;
        const m = text.match(/([1-7])[ηή]?\s*(?:ώρα|ωρα)/i);
        const h = m ? parseInt(m[1], 10) : 1;
        changes = [{
            hour: h,
            detail: item.content,
            kind: 'substitution',
            badgeText: 'ΑΛΛΑΓΗ',
            badgeColor: '#10b981',
            icon: '⚡'
        }];
    }
    changes.sort((a, b) => (parseInt(a.hour, 10) || 0) - (parseInt(b.hour, 10) || 0));
    return changes;
}

// Returns ONLY the hour changes that have NOT yet been executed.
// As each lesson hour finishes (currentHHMM >= SCHOOL_PERIOD_END_TIMES[hour]),
// that change is automatically dropped from the card, leaving the remaining hours!
function getActiveChangesForScheduleItem(item) {
    if (!item) return [];
    const changes = getRawChangesFromScheduleItem(item);
    if (changes.length === 0) return [];

    const now = getGreekNow();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const currentHHMM = window._auroraSimulatedHHMM
        ? window._auroraSimulatedHHMM
        : (String(now.getHours()).padStart(2, '0') + ":" + String(now.getMinutes()).padStart(2, '0'));

    const targetDate = getScheduleTargetDate(item, '');

    if (!window._auroraSimulateSchoolHours && !window._auroraSimulatedHHMM && targetDate && targetDate < todayStr) {
        return [];
    }

    // Filter out completed hours on the day of the schedule change (or when simulating school time on localhost)
    if (targetDate === todayStr || !targetDate || window._auroraSimulatedHHMM) {
        return changes.filter(c => {
            const h = parseInt(c.hour, 10);
            const hourEnd = (h && SCHOOL_PERIOD_END_TIMES[h]) ? SCHOOL_PERIOD_END_TIMES[h] : "13:55";
            return currentHHMM < hourEnd;
        });
    }

    return changes;
}

// Consolidates schedule change items so that all active changes for the SAME section (Τμήμα)
// on the same date appear together on ONE single card, containing only remaining (unexecuted) hours!
function consolidateScheduleItemsBySection(items) {
    if (!items || items.length === 0) return [];
    const result = [];
    const sectionMap = new Map();

    for (const item of items) {
        if (!isScheduleChangeSlide(item)) {
            result.push(item);
            continue;
        }

        const activeChanges = getActiveChangesForScheduleItem(item);
        if (activeChanges.length === 0) continue; // All changes on this card have been executed

        const section = normalizeScheduleSectionName(item);
        const targetDate = getScheduleTargetDate(item, '');
        const groupKey = `${section}__${targetDate}`;

        const maxHour = Math.max(...activeChanges.map(c => parseInt(c.hour, 10) || 0));
        const computedEndTime = SCHOOL_PERIOD_END_TIMES[maxHour] || item.endTime || "13:55";

        if (!sectionMap.has(groupKey)) {
            const cloned = {
                ...item,
                title: `Αλλαγή Προγράμματος - Τμήμα ${section}`,
                endTime: computedEndTime,
                scheduleData: {
                    ...(item.scheduleData || {}),
                    section: section,
                    changes: [...activeChanges]
                }
            };
            sectionMap.set(groupKey, cloned);
            result.push(cloned);
        } else {
            // Merge into the existing card for the same section so all changes for a section appear on ONE card
            const existing = sectionMap.get(groupKey);
            const byHour = new Map();
            (existing.scheduleData.changes || []).forEach(c => byHour.set(parseInt(c.hour, 10), c));
            activeChanges.forEach(c => byHour.set(parseInt(c.hour, 10), c));
            const mergedChanges = Array.from(byHour.values()).sort((a, b) => (parseInt(a.hour, 10) || 0) - (parseInt(b.hour, 10) || 0));
            const mergedMaxHour = Math.max(...mergedChanges.map(c => parseInt(c.hour, 10) || 0));
            existing.scheduleData.changes = mergedChanges;
            existing.endTime = SCHOOL_PERIOD_END_TIMES[mergedMaxHour] || existing.endTime || "13:55";
        }
    }

    return result;
}

function getActiveScheduleAnnouncements() {
    if (window._auroraDemoScheduleItems && window._auroraDemoScheduleItems.length > 0) {
        return consolidateScheduleItemsBySection(window._auroraDemoScheduleItems);
    }
    // Only return schedule changes that are CURRENTLY ACTIVE as announcement slides
    // (valid for today, within school hours 07:45 - 13:55, not paused, not future, and not expired!)
    // If a schedule change is not currently active in the slides playlist, it MUST NOT appear in the ticker!
    const activeList = (slides && slides.length > 0) ? slides : getActiveSlides(allAnnouncements || []);
    return (activeList || []).filter(isScheduleChangeSlide);
}

function buildScheduleTickerItem(scheduleItems) {
    const consolidated = consolidateScheduleItemsBySection(scheduleItems || []);
    if (!consolidated || consolidated.length === 0) return null;

    const sectionsHtml = consolidated.map(item => {
        const section = normalizeScheduleSectionName(item);
        const changes = getActiveChangesForScheduleItem(item);
        if (!changes || changes.length === 0) return '';

        const changesHtml = changes.map(c => {
            const badgeColor = c.badgeColor || (c.kind === 'free' ? '#ef4444' : (c.kind === 'room' ? '#f59e0b' : '#10b981'));
            const icon = c.icon || (c.kind === 'free' ? '🛑' : (c.kind === 'room' ? '🚪' : '📚'));
            const badgeText = c.badgeText || (c.kind === 'free' ? 'ΚΕΝΟ / ΑΠΟΧΩΡΗΣΗ' : (c.kind === 'room' ? 'ΑΛΛΑΓΗ ΑΙΘΟΥΣΑΣ' : 'ΑΝΑΠΛΗΡΩΣΗ'));
            const kindClass = c.kind || 'substitution';

            return `
                <span class="ticker-sched-change ticker-sched-${kindClass}">
                    <span class="ticker-sched-hour">${c.hour}η</span>
                    <span class="ticker-sched-badge" style="background:${badgeColor};">${icon} ${badgeText}</span>
                    <span class="ticker-sched-detail">${c.detail}</span>
                </span>
            `;
        }).join('<span class="ticker-sched-subsep">•</span>');

        return `
            <span class="ticker-sched-section-block">
                <span class="ticker-sched-section-pill">🏫 Τμήμα ${section}</span>
                ${changesHtml}
            </span>
        `;
    }).filter(Boolean).join('<span class="ticker-sched-sep">✦</span>');

    if (!sectionsHtml) return null;

    const hasDirMsg = !!getActiveDirectorTickerItem();
    const fullHtml = hasDirMsg
        ? sectionsHtml
        : `${sectionsHtml} <span class="ticker-sched-sep" style="margin: 0 4rem;">✦✦✦</span> ${sectionsHtml}`;

    return {
        type: 'schedule',
        label: '📅 ΑΛΛΑΓΕΣ ΠΡΟΓΡΑΜΜΑΤΟΣ',
        style: 'schedule',
        html: fullHtml
    };
}

let hasShownInitialDirectorPriority = false;

function syncTickerWithCurrentSlide(item) {
    if (item !== undefined) {
        currentDisplayedSlideItem = item || null;
    }
    const isCurrentSlideSchedule = isScheduleChangeSlide(currentDisplayedSlideItem);
    const activeScheduleItems = getActiveScheduleAnnouncements();

    // STRICT RULE:
    // - When a NORMAL announcement is on screen (!isCurrentSlideSchedule) AND schedule changes exist -> 'schedule' mode
    //   (Schedule changes take the place of RSS news for the entire duration of the normal announcements!)
    // - When a SCHEDULE CHANGE announcement is on screen (isCurrentSlideSchedule) OR no schedule changes exist -> 'normal' mode (RSS / Director)
    const targetMode = (!isCurrentSlideSchedule && activeScheduleItems.length > 0) ? 'schedule' : 'normal';

    if (targetMode === 'schedule') {
        const schedItem = buildScheduleTickerItem(activeScheduleItems);
        if (!schedItem) return;

        const dirItem = getActiveDirectorTickerItem();
        // During normal announcements, Schedule Changes (schedItem) replace RSS news immediately
        // so they are never lost while normal announcements play on the main screen;
        // if Director's message (dirItem) is active, it alternates with schedItem.
        const newScheduleSeq = dirItem ? [schedItem, dirItem] : [schedItem];
        const seqKey = getSequenceKey(newScheduleSeq);

        if (currentTickerMode !== 'schedule' || lastScheduleTickerHtml !== seqKey || !tickerAnimId) {
            const wasAlreadyScheduleMode = (currentTickerMode === 'schedule');
            currentTickerMode = 'schedule';
            lastScheduleTickerHtml = seqKey;
            tickerSequence = newScheduleSeq;

            let resumeIdx = 0;
            let resumeOffset = getFreshTickerStartOffset(true);

            if (!wasAlreadyScheduleMode) {
                // Just switched onto a normal announcement: start immediately with 📅 ΑΛΛΑΓΕΣ ΠΡΟΓΡΑΜΜΑΤΟΣ (index 0)
                // or resume its scroll position if it was mid-scroll earlier
                resumeIdx = 0;
                if (savedTickerModeState.schedule.seqKey === seqKey &&
                    savedTickerModeState.schedule.index === 0 &&
                    typeof savedTickerModeState.schedule.offset === 'number' &&
                    savedTickerModeState.schedule.offset > -200) {
                    resumeOffset = savedTickerModeState.schedule.offset;
                }
            } else if (savedTickerModeState.schedule.seqKey === seqKey && savedTickerModeState.schedule.index < tickerSequence.length) {
                resumeIdx = savedTickerModeState.schedule.index;
                if (typeof savedTickerModeState.schedule.offset === 'number' && savedTickerModeState.schedule.offset > -200) {
                    resumeOffset = savedTickerModeState.schedule.offset;
                }
            }

            tickerSequenceIndex = resumeIdx;
            savedTickerModeState.schedule = { index: resumeIdx, offset: resumeOffset, seqKey };

            const tickerContainer = document.getElementById('tickerContainer');
            if (tickerContainer) tickerContainer.style.display = 'flex';
            document.body.classList.remove('no-ticker');

            playTickerItem(tickerSequence[tickerSequenceIndex], resumeOffset);
        }
    } else {
        normalTickerSequence = buildNormalTickerSequence(isCurrentSlideSchedule);
        const seqKey = getSequenceKey(normalTickerSequence);

        if (currentTickerMode !== 'normal' || getSequenceKey(tickerSequence) !== seqKey || !tickerAnimId) {
            currentTickerMode = 'normal';
            lastScheduleTickerHtml = '';
            tickerSequence = normalTickerSequence;

            const tickerContainer = document.getElementById('tickerContainer');
            if (tickerSequence.length === 0) {
                if (tickerContainer) tickerContainer.style.display = 'none';
                document.body.classList.add('no-ticker');
                if (tickerAnimId) {
                    cancelAnimationFrame(tickerAnimId);
                    tickerAnimId = null;
                }
                return;
            }

            if (tickerContainer) tickerContainer.style.display = 'flex';
            document.body.classList.remove('no-ticker');

            let resumeIdx = 0;
            let resumeOffset = getFreshTickerStartOffset(true);

            if (savedTickerModeState.normal.seqKey === seqKey && savedTickerModeState.normal.index < tickerSequence.length) {
                resumeIdx = savedTickerModeState.normal.index;
                if (typeof savedTickerModeState.normal.offset === 'number' && savedTickerModeState.normal.offset > -200) {
                    resumeOffset = savedTickerModeState.normal.offset;
                }
            }

            const dirItem = getActiveDirectorTickerItem();
            if (isCurrentSlideSchedule && tickerSequence.length > 1 && dirItem) {
                // Priority 1: Director's message plays first on initial schedule slide, then alternates with RSS (Priority 3)
                if (!hasShownInitialDirectorPriority) {
                    resumeIdx = 0;
                    resumeOffset = getFreshTickerStartOffset(true);
                    hasShownInitialDirectorPriority = true;
                }
            }

            tickerSequenceIndex = resumeIdx;
            savedTickerModeState.normal = { index: resumeIdx, offset: resumeOffset, seqKey };

            playTickerItem(tickerSequence[tickerSequenceIndex], resumeOffset);
        }
    }
}

function getScheduleChangeEndTime(item) {
    let maxHour = 0;

    // 1. Schedule changes: endTime always reflects the latest remaining hour in scheduleData.changes
    if (isScheduleChangeSlide(item)) {
        const changes = (item.scheduleData && Array.isArray(item.scheduleData.changes)) ? item.scheduleData.changes : [];
        for (let i = 0; i < changes.length; i++) {
            const h = parseInt(changes[i].hour, 10);
            if (h && h > maxHour) maxHour = h;
        }
        if (maxHour > 0 && SCHOOL_PERIOD_END_TIMES[maxHour]) {
            return SCHOOL_PERIOD_END_TIMES[maxHour];
        }
    }

    if (item.endTime && item.endTime.trim() !== "") return item.endTime.trim();

    // 2. Fallback: Scan title & content for hour numbers (e.g. "3η ώρα", "5η ώρα")
    const text = `${item.title || ''} ${item.content || ''}`;
    const matches = text.match(/([1-7])[ηή]?\s*(?:ώρα|ωρα)/gi);
    if (matches) {
        matches.forEach(m => {
            const h = parseInt(m, 10);
            if (h && h > maxHour) maxHour = h;
        });
    }

    if (maxHour > 0 && SCHOOL_PERIOD_END_TIMES[maxHour]) {
        return SCHOOL_PERIOD_END_TIMES[maxHour];
    }

    // Default to end of school day (13:55)
    return "13:55";
}

function isExpiredUrgentOrSchedule(item) {
    if (!item) return false;
    const isSchedule = isScheduleChangeSlide(item);
    const isAlertWithSchedule = item.type === 'alert' && (item.startDate || item.endDate || item.endTime);

    if (!isSchedule && !isAlertWithSchedule) {
        return false;
    }

    const now = getGreekNow();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const currentHHMM = window._auroraSimulatedHHMM
        ? window._auroraSimulatedHHMM
        : (String(now.getHours()).padStart(2, '0') + ":" + String(now.getMinutes()).padStart(2, '0'));

    const targetDate = getScheduleTargetDate(item, '');

    // 1. Target date is strictly in the past
    if (!window._auroraSimulateSchoolHours && !window._auroraSimulatedHHMM && targetDate && targetDate < todayStr) {
        return true;
    }

    // 2. For schedule changes on today's date: expired when ALL hours have been executed
    if (isSchedule && (targetDate === todayStr || !targetDate || window._auroraSimulatedHHMM)) {
        const raw = getRawChangesFromScheduleItem(item);
        if (raw.length > 0 && getActiveChangesForScheduleItem(item).length === 0) {
            return true;
        }
    }

    // 3. Target date is today and end time has passed
    if (targetDate === todayStr || (!targetDate && isSchedule)) {
        const endTime = getScheduleChangeEndTime(item);
        if (endTime && (isSchedule ? currentHHMM >= endTime : currentHHMM > endTime)) {
            return true;
        }
    }

    return false;
}

let isDisplayCleaningUp = false;

async function cleanupExpiredAnnouncementsFromDisplay(items) {
    // Never mutate live Firestore documents while testing local simulation modes
    if (window._auroraSimulateSchoolHours || window._auroraSimulatedHHMM) return;
    if (isDisplayCleaningUp || !items || items.length === 0) return;

    isDisplayCleaningUp = true;
    try {
        // 1. Consolidate duplicate schedule_change docs for the same (section, targetDate) in Firestore
        const scheduleGroups = new Map();
        for (const item of items) {
            if (!isScheduleChangeSlide(item) || item.isPaused) continue;
            const section = normalizeScheduleSectionName(item);
            const targetDate = getScheduleTargetDate(item, '');
            const key = `${section}__${targetDate}`;
            if (!scheduleGroups.has(key)) scheduleGroups.set(key, []);
            scheduleGroups.get(key).push(item);
        }

        let didMerge = false;
        for (const [, group] of scheduleGroups.entries()) {
            if (group.length > 1) {
                didMerge = true;
                const primary = group[0];
                const byHour = new Map();
                group.forEach(docItem => {
                    getRawChangesFromScheduleItem(docItem).forEach(c => {
                        byHour.set(parseInt(c.hour, 10), c);
                    });
                });
                const mergedChanges = Array.from(byHour.values()).sort((a, b) => (parseInt(a.hour, 10) || 0) - (parseInt(b.hour, 10) || 0));
                const maxHour = Math.max(...mergedChanges.map(c => parseInt(c.hour, 10) || 0));
                const newEndTime = SCHOOL_PERIOD_END_TIMES[maxHour] || primary.endTime || "13:55";
                const updatedScheduleData = {
                    ...(primary.scheduleData || {}),
                    section: normalizeScheduleSectionName(primary),
                    changes: mergedChanges
                };
                try {
                    await updateDoc(doc(db, "announcements", primary.id), {
                        title: `Αλλαγή Προγράμματος - Τμήμα ${updatedScheduleData.section}`,
                        scheduleData: updatedScheduleData,
                        endTime: newEndTime
                    });
                    for (let i = 1; i < group.length; i++) {
                        await deleteDoc(doc(db, "announcements", group[i].id));
                    }
                    console.log(`[Display Consolidate] Συγχωνεύτηκαν ${group.length} κάρτες του Τμήματος ${updatedScheduleData.section} σε 1 ενιαία κάρτα.`);
                } catch (mergeErr) {
                    console.error(`[Display Consolidate] Σφάλμα συγχώνευσης:`, mergeErr);
                }
            }
        }

        // If merges happened, the local list is stale; the next Firestore snapshot will run step 2 with fresh data
        if (didMerge) return;

        // 2. Delete completed individual hours from multi-hour cards, or delete fully expired cards
        for (const item of items) {
            if (isExpiredUrgentOrSchedule(item)) {
                try {
                    await deleteDoc(doc(db, "announcements", item.id));
                    console.log(`[Display Cleanup] Διαγράφηκε ληγμένη ανακοίνωση: ${item.title} (${item.id})`);
                } catch (err) {
                    console.error(`[Display Cleanup] Σφάλμα διαγραφής ${item.id}:`, err);
                }
                continue;
            }

            if (isScheduleChangeSlide(item)) {
                const rawChanges = getRawChangesFromScheduleItem(item);
                const activeChanges = getActiveChangesForScheduleItem(item);
                if (rawChanges.length > 1 && activeChanges.length > 0 && activeChanges.length < rawChanges.length) {
                    const maxHour = Math.max(...activeChanges.map(c => parseInt(c.hour, 10) || 0));
                    const newEndTime = SCHOOL_PERIOD_END_TIMES[maxHour] || item.endTime || "13:55";
                    const updatedScheduleData = {
                        ...(item.scheduleData || {}),
                        changes: activeChanges
                    };
                    try {
                        await updateDoc(doc(db, "announcements", item.id), {
                            scheduleData: updatedScheduleData,
                            endTime: newEndTime
                        });
                        console.log(`[Display Hour Cleanup] Αφαιρέθηκαν οι εκτελεσμένες ώρες από το ${item.title}. Παραμένουν: ${activeChanges.map(c => c.hour + 'η').join(', ')}`);
                    } catch (updateErr) {
                        console.error(`[Display Hour Cleanup] Σφάλμα ενημέρωσης ${item.id}:`, updateErr);
                    }
                }
            }
        }
    } finally {
        isDisplayCleaningUp = false;
    }
}

// Helper: Get Active Slides
const getActiveSlides = (list) => {
    const now = getGreekNow();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const currentHHMM = window._auroraSimulatedHHMM
        ? window._auroraSimulatedHHMM
        : (String(now.getHours()).padStart(2, '0') + ":" + String(now.getMinutes()).padStart(2, '0'));

    const filtered = (list || []).filter(item => {
        if (item.isPaused) return false; // Filter paused items
        if (isExpiredUrgentOrSchedule(item)) return false; // Filter expired urgent/schedule slides immediately

        // 1. Ειδικοί κανόνες για Αλλαγές Προγράμματος / Αναπληρώσεις
        if (isScheduleChangeSlide(item)) {
            const remainingChanges = getActiveChangesForScheduleItem(item);
            if (getRawChangesFromScheduleItem(item).length > 0 && remainingChanges.length === 0) return false;

            if (window._auroraSimulateSchoolHours || window._auroraSimulatedHHMM) return true;

            // Ημερομηνία στην οποία αναφέρεται η αλλαγή
            const targetDate = getScheduleTargetDate(item, todayStr);

            let startDateStr = (item.startDate || targetDate).trim();
            if (startDateStr.includes('T')) startDateStr = startDateStr.split('T')[0];

            // Εάν ο διαχειριστής επέλεξε «Άμεση προβολή από τώρα» (startDate <= todayStr <= targetDate)
            if (startDateStr < targetDate && todayStr >= startDateStr && todayStr < targetDate) {
                const startTime = (item.startTime && item.startTime.trim()) || "";
                if (startTime && todayStr === startDateStr && currentHHMM < startTime) return false;
                return true;
            }

            // Εμφανίζεται την ημέρα στην οποία αναφέρεται
            if (todayStr !== targetDate) return false;

            // Έναρξη εμφάνισης: 07:45 της ημέρας εκείνης (ή όποια ώρα ορίστηκε)
            const startTime = (item.startTime !== undefined && item.startTime !== null)
                ? item.startTime.trim()
                : "07:45";
            if (startTime && currentHHMM < startTime) return false;

            // Απομάκρυνση: μετά το πέρας της τελευταίας εναπομείνασας ώρας
            const endTime = getScheduleChangeEndTime(item);
            if (currentHHMM >= endTime) return false;

            return true;
        }

        // 2. Κανονικές Ανακοινώσεις
        if (item.startDate && todayStr < item.startDate) return false;
        if (item.endDate && todayStr > item.endDate) return false;

        // Daily Time Check (Advanced Scheduling)
        if (item.startTime || item.endTime) {
            if (item.startTime && currentHHMM < item.startTime) return false;
            if (item.endTime && currentHHMM > item.endTime) return false;
        }

        return true;
    });

    // Always consolidate schedule change slides so multiple changes for the same section
    // appear together on a single card with only the remaining (unexecuted) hours!
    return consolidateScheduleItemsBySection(filtered);
};

function getSlideHoursSignature(s) {
    if (!s) return '';
    if (!isScheduleChangeSlide(s)) return s.id || '';
    const hrs = (s.scheduleData && Array.isArray(s.scheduleData.changes))
        ? s.scheduleData.changes.map(c => `${c.hour}:${c.detail || ''}`).join('|')
        : '';
    return `${s.id || ''}[${hrs}]`;
}

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

        cleanupExpiredAnnouncementsFromDisplay(allAnnouncements);

        slides = getActiveSlides(allAnnouncements);

        if (!emergencyActive && slides.length > 0) {
            // Restart rotation if list changed
            startRotation();
        } else if (slides.length === 0 && !emergencyActive) {
            document.getElementById('slideContainer').innerHTML = '<div class="slide active"><h1>Αναμονή για ενημερώσεις...</h1></div>';
            syncTickerWithCurrentSlide(null);
        }
    });

    // Clock
    setInterval(updateClock, 1000);
    updateClock();

    // Periodic auto-cleanup & per-hour schedule refresh every 15 seconds
    setInterval(() => {
        if (allAnnouncements && allAnnouncements.length > 0) {
            cleanupExpiredAnnouncementsFromDisplay(allAnnouncements);
            const freshSlides = getActiveSlides(allAnnouncements);
            const hasChanged = freshSlides.length !== slides.length ||
                freshSlides.some((s, idx) => !slides[idx] || getSlideHoursSignature(s) !== getSlideHoursSignature(slides[idx]));
            if (hasChanged) {
                slides = freshSlides;
                if (!emergencyActive && slides.length > 0) {
                    startRotation();
                } else if (slides.length === 0 && !emergencyActive) {
                    document.getElementById('slideContainer').innerHTML = '<div class="slide active"><h1>Αναμονή για ενημερώσεις...</h1></div>';
                    syncTickerWithCurrentSlide(null);
                }
            }
        }
    }, 15000);

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
        const displayEl = document.getElementById('schoolScheduleStatus');
        if (!displayEl) return;

        if (window._auroraDemoScheduleHtml) {
            displayEl.style.display = 'flex';
            if (displayEl.innerHTML !== window._auroraDemoScheduleHtml) {
                displayEl.innerHTML = window._auroraDemoScheduleHtml;
            }
            return;
        }

        const now = getGreekNow();
        const currentTime = now.getHours() * 60 + now.getMinutes();
        const currentSec = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
        const dayOfWeek = now.getDay();
        const isWeekend = (dayOfWeek === 0 || dayOfWeek === 6);

        let activeSlot = null;
        let nextSlot = null;

        if (!isWeekend) {
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
        }

        let line1 = '';
        let line2 = '';
        let pct = 100;

        if (activeSlot) {
            const remaining = Math.max(1, activeSlot.endTotal - currentTime);
            const startSec = activeSlot.startTotal * 60;
            const endSec = activeSlot.endTotal * 60;
            pct = Math.min(100, Math.max(3, Math.round(((currentSec - startSec) / Math.max(1, endSec - startSec)) * 100)));

            const minWord = remaining === 1 ? 'λεπτό' : 'λεπτά';
            if (activeSlot.type === 'lesson') {
                const lessonTitle = activeSlot.name.replace('Ώρα', 'Διδακτική Ώρα');
                line1 = `🔔 ${lessonTitle} (${activeSlot.start} - ${activeSlot.end})`;
                if (nextSlot && nextSlot.type === 'break') {
                    line2 = `⏳ Λήξη &amp; Διάλειμμα σε ${remaining} ${minWord}`;
                } else if (nextSlot) {
                    line2 = `⏳ Ακολουθεί ${nextSlot.name} σε ${remaining} ${minWord}`;
                } else {
                    line2 = `⏳ Λήξη Μαθημάτων σε ${remaining} ${minWord}`;
                }
            } else {
                line1 = `☕ ${activeSlot.name} (${activeSlot.start} - ${activeSlot.end})`;
                if (nextSlot) {
                    line2 = `⏳ Έναρξη ${nextSlot.name.replace('Ώρα', 'Ώρας')} σε ${remaining} ${minWord}`;
                } else {
                    line2 = `⏳ Λήξη σε ${remaining} ${minWord}`;
                }
            }
        } else if (!isWeekend && currentTime >= 420 && currentTime < 480) {
            const remaining = 480 - currentTime;
            pct = Math.min(99, Math.max(5, Math.round(((currentTime - 420) / 60) * 100)));
            line1 = `🌅 Πρωινή Προσέλευση (07:00 - 08:00)`;
            line2 = `⏳ Έναρξη 1ης Διδακτικής Ώρας σε ${remaining} ${remaining === 1 ? 'λεπτό' : 'λεπτά'}`;
        } else {
            line1 = `🔔 Ωρολόγιο Πρόγραμμα (08:00 - 13:55)`;
            line2 = `⏳ Εκτός Διδακτικού Ωραρίου • Έναρξη: 08:00`;
            pct = 100;
        }

        const newHtml = `
            <div class="aurora-sched-line1">${line1}</div>
            <div class="aurora-sched-line2"><span class="aurora-sched-dot">•</span> ${line2}</div>
            <div class="aurora-sched-progress-row">
                <div class="aurora-sched-progress-track">
                    <div class="aurora-sched-progress-fill" style="width: ${pct}%;"></div>
                </div>
                <span class="aurora-sched-progress-pct">${pct}%</span>
            </div>
        `;

        displayEl.style.display = 'flex';
        if (displayEl.innerHTML !== newHtml) {
            displayEl.innerHTML = newHtml;
        }

    } catch (e) {
        console.error("Schedule Error", e);
    }
}

function updateClock() {
    if (window._auroraDemoClock) {
        const clockEl = document.getElementById('clock');
        const dateEl = document.getElementById('date');
        if (clockEl && clockEl.innerHTML !== window._auroraDemoClock.time) clockEl.innerHTML = window._auroraDemoClock.time;
        if (dateEl && dateEl.innerText !== window._auroraDemoClock.date) dateEl.innerText = window._auroraDemoClock.date;
        updateScheduleStatus();
        return;
    }

    const now = getGreekNow();
    const clockEl = document.getElementById('clock');
    const dateEl = document.getElementById('date');

    if (clockEl) {
        const hStr = String(now.getHours()).padStart(2, '0');
        const mStr = String(now.getMinutes()).padStart(2, '0');
        const newHtml = `${hStr}:${mStr}`;
        if (clockEl.innerHTML !== newHtml) {
            clockEl.innerHTML = newHtml;
        }
    }

    if (dateEl) {
        const days = ['Κυριακή', 'Δευτέρα', 'Τρίτη', 'Τετάρτη', 'Πέμπτη', 'Παρασκευή', 'Σάββατο'];
        const months = ['Ιανουαρίου', 'Φεβρουαρίου', 'Μαρτίου', 'Απριλίου', 'Μαΐου', 'Ιουνίου', 'Ιουλίου', 'Αυγούστου', 'Σεπτεμβρίου', 'Οκτωβρίου', 'Νοεμβρίου', 'Δεκεμβρίου'];
        const dateStr = `${days[now.getDay()]} ${now.getDate()} ${months[now.getMonth()]}`;
        if (dateEl.innerText !== dateStr) {
            dateEl.innerText = dateStr;
        }
    }

    updateScheduleStatus();
}

function formatSchoolTitleHtml(rawName) {
    const clean = (rawName || '').replace(/^1[ΟO]/g, '1ο').trim();
    if (!clean || /ΠΡΟΤΥΠΟ\s+ΓΥΜΝΑΣΙΟ/i.test(clean)) {
        return `
            <span class="school-title-line1">1ο ΠΡΟΤΥΠΟ ΓΥΜΝΑΣΙΟ</span>
            <span class="school-title-line2">ΜΥΤΙΛΗΝΗΣ</span>
            <span class="school-title-line3">"Βύρων Σιβολαπένκο"</span>
        `;
    }
    return `<span class="school-title-line1">${clean}</span>`;
}

function applySettings(s) {
    const titleEl = document.getElementById('schoolNameDisplay');
    if (titleEl) {
        titleEl.innerHTML = formatSchoolTitleHtml(s.schoolName);
    }
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

    if (mode !== 'none' && rssUrl) {
        fetchRSS(rssUrl);
        rssInterval = setInterval(() => fetchRSS(rssUrl), 600000);
    }

    updateTickerSequence();
    if (slides && slides.length > 0) {
        syncTickerWithCurrentSlide(slides[currentIndex] || slides[0]);
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

            if (!window._auroraDemoWeather) {
                weatherEl.innerHTML = `${name} ${temp}°C ${weatherInfo.icon}`;
            }
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
    syncTickerWithCurrentSlide(item);
    renderSlide(item);

    let duration = (item.duration || 10) * 1000;
    if (item.type === 'alert' && item.mediaType !== 'schedule_change') duration *= 2; // Double for alert, except schedule_change

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
        const now = getGreekNow();
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

function getLessonHourTime(hourNum) {
    const lessonSlots = schoolSchedule.filter(s => s.type === 'lesson');
    const slot = lessonSlots[hourNum - 1];
    return slot ? `${slot.start} - ${slot.end}` : '';
}

function renderScheduleChangeBlock(item) {
    const data = item.scheduleData || {};
    const section = normalizeScheduleSectionName(item);
    const dateFormatted = data.dateFormatted || data.dateIso || '';
    const dayName = data.dayName || '';
    let changes = getActiveChangesForScheduleItem(item);

    // Fallback if changes array is empty
    if (!changes || changes.length === 0) {
        changes = getRawChangesFromScheduleItem(item);
    }

    const hoursLabelList = changes.map(c => `${c.hour}ης`);
    const hoursJoined = hoursLabelList.length > 1
        ? `${hoursLabelList.slice(0, -1).join(', ')} & ${hoursLabelList[hoursLabelList.length - 1]}`
        : (hoursLabelList[0] || '');

    const headingText = changes.length === 1
        ? `Τμήμα ${section} — Τροποποίηση ${changes[0].hour}ης Ώρας`
        : (hoursJoined
            ? `Τμήμα ${section} — Τροποποίηση ${hoursJoined} Ώρας`
            : `Τμήμα ${section} — Τροποποίηση Προγράμματος`);

    const rowsHtml = changes.map(c => {
        const rawBadge = c.badgeText || (c.kind === 'free' ? 'ΚΕΝΟ' : (c.kind === 'room' ? 'ΑΛΛΑΓΗ ΑΙΘΟΥΣΑΣ' : 'ΑΝΑΠΛΗΡΩΣΗ'));
        const cleanBadge = rawBadge.replace('ΚΕΝΟ / ΑΠΟΧΩΡΗΣΗ', 'ΚΕΝΟ');
        const detailText = (c.detail || '').replace(/\n/g, '<br>');
        const hTime = getLessonHourTime(c.hour);
        const timeTag = (changes.length > 1 && hTime)
            ? ` <span class="aurora-schedule-ice-time">(${hTime})</span>`
            : '';
        return `
            <div class="aurora-schedule-ice-row ${changes.length > 1 ? 'aurora-schedule-ice-row-multi' : ''}">
                <span class="aurora-schedule-ice-lead">${c.hour}η Ώρα${timeTag}: ${cleanBadge} —</span>
                <span class="aurora-schedule-ice-detail">${detailText}</span>
            </div>
        `;
    }).join('');

    let bottomTimeLabel = '';
    if (changes.length === 1) {
        const t = getLessonHourTime(changes[0].hour);
        bottomTimeLabel = t ? `Σήμερα: ${t}` : (dateFormatted ? `${dayName} ${dateFormatted}` : 'Σήμερα');
    } else if (changes.length === 2) {
        bottomTimeLabel = `Σήμερα: ${changes.map(c => {
            const t = getLessonHourTime(c.hour);
            return t ? `${c.hour}η Ώρα (${t})` : `${c.hour}η Ώρα`;
        }).join(' • ')}`;
    } else if (changes.length > 2) {
        const firstT = getLessonHourTime(changes[0].hour).split(' - ')[0] || '';
        const lastT = (getLessonHourTime(changes[changes.length - 1].hour).split(' - ')[1]) || '';
        bottomTimeLabel = (firstT && lastT)
            ? `Σήμερα: ${firstT} - ${lastT} (${changes.map(c => c.hour + 'η').join(', ')} Ώρα)`
            : `Σήμερα (${changes.map(c => c.hour + 'η').join(', ')} Ώρα)`;
    } else {
        bottomTimeLabel = dateFormatted ? `${dayName} ${dateFormatted}` : 'Σήμερα';
    }

    return `
        <div class="aurora-schedule-wrapper">
            <div class="aurora-schedule-card-outer">
                <div class="aurora-schedule-top-pill">
                    🚨 ΕΠΕΙΓΟΥΣΑ ΑΝΑΚΟΙΝΩΣΗ • ΑΛΛΑΓΗ ΠΡΟΓΡΑΜΜΑΤΟΣ
                </div>

                <h1 class="aurora-schedule-main-title">${headingText}</h1>

                <div class="aurora-schedule-inner-ice">
                    <div class="aurora-schedule-ice-content">
                        ${rowsHtml || '<div class="aurora-schedule-ice-row">Δεν έχουν οριστεί ώρες.</div>'}
                    </div>
                    <div class="aurora-schedule-bottom-pill">${bottomTimeLabel}</div>
                </div>
            </div>
        </div>
    `;
}

function renderMediaBlock(item, containerId) {
    const scale = parseFloat(item.mediaScale) || 1.0;
    const isSplitLayout = item.layout && item.layout !== 'fullscreen';
    let imgScale = (!isSplitLayout && scale !== 1.0) ? `transform: scale(${scale}); transform-origin: center center;` : '';

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
                            <img src="${src}" style="width: auto; height: auto; max-width: ${maxW}; max-height: ${maxH}; object-fit: contain; border-radius: 0.75rem; box-shadow: 0 8px 20px rgba(0,0,0,0.4); flex-shrink: 0;">
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
                <div class="aurora-media-fit-box" style="width: 100%; height: 100%; min-width: 0; min-height: 0; display: flex; align-items: center; justify-content: center; padding: 0.5rem; overflow: hidden; box-sizing: border-box;">
                    <img src="${sources[0]}" class="slide-image" style="width: auto !important; height: auto !important; max-width: 100% !important; max-height: 100% !important; object-fit: contain !important; border-radius: 1rem; ${imgScale}">
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
    else if (item.mediaType === 'video') {
        const v = resolveVideoSource(item.mediaSource);
        if (!v) return `<div style="color: #94a3b8; font-size: 1.3rem;">🎬 Δεν έχει οριστεί βίντεο</div>`;
        if (v.kind === 'iframe') {
            return `<iframe src="${v.src}" allow="autoplay" frameborder="0" style="width:100%; height:100%; border:none; border-radius: 1rem; background:#000;"></iframe>`;
        }
        // Some TV browsers ignore the autoplay attribute: force muted play() after insertion
        setTimeout(() => {
            document.querySelectorAll('video.slide-video').forEach(vid => {
                vid.muted = true;
                const p = vid.play();
                if (p && p.catch) p.catch(() => {});
            });
        }, 100);
        const fallbackAttr = v.fallback ? `data-fallback="${v.fallback}"` : '';
        return `
            <div style="width:100%; height:100%; position:relative; display:flex; align-items:center; justify-content:center; overflow:hidden;">
                <video class="slide-video" src="${v.src}" ${fallbackAttr} autoplay muted loop playsinline preload="auto" disablepictureinpicture
                    style="width:100%; height:100%; max-width:100%; max-height:100%; object-fit:contain; background:#000; border-radius:1rem; display:block;"
                    onerror="window.handleSlideVideoError && window.handleSlideVideoError(this)"></video>
                <div style="display:none; position:absolute; inset:0; flex-direction:column; align-items:center; justify-content:center; text-align:center; color:#fca5a5; font-size:1.4rem; padding:2rem; background:rgba(15,23,42,0.95); border-radius:1rem;">
                    ⚠️ Το βίντεο δεν βρέθηκε
                    <small style="color:#94a3b8; font-size:1rem; margin-top:0.5rem;">${(item.mediaSource || '').replace(/</g, '&lt;')}</small>
                    <span style="font-size:0.85rem; color:#64748b; margin-top:0.6rem; max-width:480px;">Εάν το ανεβάσατε πρόσφατα στο GitHub, ενδέχεται να χρειάζεται 1-2 λεπτά για να ολοκληρωθεί η δημοσίευση. Η αναπαραγωγή θα ξεκινήσει αυτόματα.</span>
                </div>
            </div>
        `;
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
    else if (item.mediaType === 'schedule_change' || item.isScheduleChange) {
        return renderScheduleChangeBlock(item);
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
    const isFullMedia = layout === 'fullscreen' && ['image', 'live_image', 'youtube', 'video'].includes(item.mediaType);
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
            const hasOverlay = item.content && item.mediaType !== 'schedule_change';
            container.innerHTML = `
                <div class="slide active type-${item.type} layout-fullscreen media-${item.mediaType}" style="width:100%; height:100%; position:relative;">
                    ${mediaHtml}
                    ${hasOverlay ? `<div class="slide-overlay"><h2>${item.title}</h2><div>${item.content}</div></div>` : ''}
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

        const isUnifiedGlass = ['split-left', 'split-right'].includes(layout) && ['image', 'live_image', 'text'].includes(item.mediaType);

        container.innerHTML = `
            <div class="slide active type-${item.type} multi-zone-container layout-${layout} ${isUnifiedGlass ? 'aurora-unified-split' : ''}">
                ${isUnifiedGlass ? `<div class="aurora-unified-glass-card">${part1}${part2}</div>` : `${part1}${part2}`}
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

    // Automatically fit text so titles and descriptions never get clipped at the bottom
    autoFitSlideText();
    requestAnimationFrame(() => autoFitSlideText());
    setTimeout(() => autoFitSlideText(), 80);
}

function autoFitSlideText() {
    const container = document.getElementById('slideContainer');
    if (!container) return;

    const cards = container.querySelectorAll('.zone-card-text, .slide-card');
    cards.forEach(card => {
        const titleEl = card.querySelector('.slide-card-title');
        const bodyEl = card.querySelector('.slide-card-body');
        const badgeEl = card.querySelector('.slide-card-badge');
        const dividerEl = card.querySelector('.slide-card-divider');

        if (!titleEl && !bodyEl) return;

        // Reset any previous inline adjustments before measuring fresh
        if (titleEl) {
            titleEl.style.removeProperty('font-size');
            titleEl.style.removeProperty('line-height');
            titleEl.style.removeProperty('margin-bottom');
        }
        if (bodyEl) {
            bodyEl.style.removeProperty('font-size');
            bodyEl.style.removeProperty('line-height');
        }
        if (badgeEl) badgeEl.style.removeProperty('margin-bottom');
        if (dividerEl) dividerEl.style.removeProperty('margin-bottom');

        // Align to top during measurement so scrollHeight reflects 100% of children height
        card.style.setProperty('justify-content', 'flex-start', 'important');

        // Normalize any hardcoded inline font sizes inside .slide-card-body to relative em
        if (bodyEl) {
            const baseBodyPx = parseFloat(window.getComputedStyle(bodyEl).fontSize) || 22;
            bodyEl.querySelectorAll('[style*="font-size"], font[size]').forEach(child => {
                if (!child.dataset.origEmRatio) {
                    const childPx = parseFloat(window.getComputedStyle(child).fontSize) || baseBodyPx;
                    const ratio = Math.min(1.25, Math.max(0.75, childPx / baseBodyPx));
                    child.dataset.origEmRatio = ratio.toFixed(3);
                }
                child.style.setProperty('font-size', `${child.dataset.origEmRatio}em`, 'important');
                child.style.setProperty('line-height', 'inherit', 'important');
            });
        }

        let titleSize = titleEl ? (parseFloat(window.getComputedStyle(titleEl).fontSize) || 32) : 32;
        let bodySize = bodyEl ? (parseFloat(window.getComputedStyle(bodyEl).fontSize) || 22) : 22;
        let bodyLineHeight = 1.42;

        const isOverflowing = () => card.scrollHeight > (card.clientHeight + 1);

        let step = 0;
        while (isOverflowing() && step < 32) {
            step++;
            bodySize = Math.max(12, bodySize * 0.94);
            titleSize = Math.max(16, titleSize * 0.94);
            bodyLineHeight = Math.max(1.22, bodyLineHeight - 0.01);

            if (bodyEl) {
                bodyEl.style.setProperty('font-size', `${bodySize.toFixed(1)}px`, 'important');
                bodyEl.style.setProperty('line-height', `${bodyLineHeight.toFixed(2)}`, 'important');
            }
            if (titleEl) {
                titleEl.style.setProperty('font-size', `${titleSize.toFixed(1)}px`, 'important');
                titleEl.style.setProperty('line-height', '1.12', 'important');
            }

            if (step >= 4) {
                if (badgeEl) badgeEl.style.setProperty('margin-bottom', '0.3rem', 'important');
                if (titleEl) titleEl.style.setProperty('margin-bottom', '0.3rem', 'important');
                if (dividerEl) dividerEl.style.setProperty('margin-bottom', '0.35rem', 'important');
            }
        }

        // Re-center vertically once content fits inside the card
        if (!isOverflowing()) {
            card.style.setProperty('justify-content', 'center', 'important');
        }
    });
}

window.addEventListener('resize', () => {
    autoFitSlideText();
});

let countdownTimerId = null;
function startCountdownTicker(id, targetTime) {
    if (countdownTimerId) clearInterval(countdownTimerId);

    const update = () => {
        const el = document.getElementById(`countdown-${id}`);
        if (!el) {
            if (countdownTimerId) clearInterval(countdownTimerId);
            return;
        }

        const now = getGreekNow().getTime();
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

        const now = getGreekNow();

        // Find the Monday of the current week
        const currentDay = now.getDay() || 7; // 1-7
        const monday = new GreekDate(now.getTime());
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
            const date = new GreekDate(monday.getTime());
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

// ===================================================
// AUTO-UPDATE: Screens (TVs) reload themselves when a new version is published.
// Checks version.json every 5 minutes. If its version differs from APP_VERSION,
// the page reloads with a cache-busting URL. A localStorage guard prevents
// repeated reloads if version.json was updated but script files were not.
// ===================================================
const APP_VERSION = '2026_AURORA_V28';

async function checkForAppUpdate() {
    try {
        const res = await fetch(`version.json?t=${Date.now()}`, { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        const remote = data && data.version ? String(data.version).trim() : '';
        if (!remote || remote === APP_VERSION) return;

        if (localStorage.getItem('stc_reloaded_for') === remote) return; // already tried once
        localStorage.setItem('stc_reloaded_for', remote);

        console.log(`🔄 New version ${remote} found (running ${APP_VERSION}). Reloading...`);
        const url = new URL(window.location.href);
        url.searchParams.set('v', remote);
        window.location.replace(url.toString());
    } catch (e) {
        // Offline or version.json missing: ignore silently
    }
}

setTimeout(checkForAppUpdate, 30000);
setInterval(checkForAppUpdate, 5 * 60 * 1000);

// ===================================================
// LOCAL TESTING PREVIEW BAR (Only visible on localhost)
// Lets the user test the exact scenarios from Mockup 1 & Mockup 2
// alongside their real live Firebase school stream!
// ===================================================
if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
    window.addEventListener('DOMContentLoaded', () => {
        const bar = document.createElement('div');
        bar.id = 'auroraLocalTestBar';
        bar.innerHTML = `
            <span style="font-weight:800; color:#67e8f9; margin-right:4px;">🎛️ Δοκιμή Aurora:</span>
            <button type="button" data-demo="live" class="aurora-demo-btn active">🔄 Ζωντανή Ροή</button>
            <button type="button" data-demo="rotation" class="aurora-demo-btn">🔁 Ροή Σχολείου (09:50 • Β3: 3η &amp; 6η μαζί)</button>
            <button type="button" data-demo="after_hour3" class="aurora-demo-btn">🕚 Μετά την 3η Ώρα (10:45 • Διαγράφεται η 3η από Β3!)</button>
            <button type="button" data-demo="mockup2" class="aurora-demo-btn">🚨 Δείγμα 2 (Κάρτα Αλλαγής → RSS κάτω)</button>
            <button type="button" data-demo="mockup1" class="aurora-demo-btn">🏰 Δείγμα 1 (Κανονική → Αλλαγές κάτω)</button>
            <button type="button" id="closeAuroraTestBar" title="Απόκρυψη μπάρας δοκιμής" style="background:transparent;border:none;color:#94a3b8;cursor:pointer;font-size:1rem;padding:0 6px;">✕</button>
        `;
        document.body.appendChild(bar);

        document.getElementById('closeAuroraTestBar')?.addEventListener('click', () => {
            bar.style.display = 'none';
        });

        const fallbackDemoScheduleItems = [{
            id: 'demo-b1',
            type: 'alert',
            layout: 'fullscreen',
            mediaType: 'schedule_change',
            isScheduleChange: true,
            title: 'Τμήμα Β1 — Τροποποίηση 3ης Ώρας',
            scheduleData: {
                section: 'Β1',
                changes: [{
                    hour: 3,
                    kind: 'free',
                    badgeText: 'ΚΕΝΟ',
                    detail: 'Απουσία διδάσκοντος — Οι μαθητές παραμένουν στο χώρο της Βιβλιοθήκης'
                }]
            }
        }];

        bar.querySelectorAll('.aurora-demo-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                bar.querySelectorAll('.aurora-demo-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const mode = btn.getAttribute('data-demo');

                if (mode === 'live') {
                    window._auroraSimulateSchoolHours = false;
                    window._auroraSimulatedHHMM = null;
                    window._auroraDemoScheduleItems = null;
                    window._auroraDemoScheduleHtml = null;
                    window._auroraDemoClock = null;
                    window._auroraDemoWeather = false;
                    updateClock();
                    if (currentSettings && currentSettings.weatherCity) updateWeather(currentSettings.weatherCity);
                    currentIndex = 0;
                    startRotation();
                } else if (mode === 'rotation') {
                    window._auroraSimulateSchoolHours = true;
                    window._auroraSimulatedHHMM = '09:50';
                    window._auroraDemoScheduleItems = null;
                    window._auroraDemoScheduleHtml = null;
                    window._auroraDemoClock = { time: '09:50', date: 'Τρίτη 10 Νοεμβρίου' };
                    window._auroraDemoWeather = false;
                    updateClock();
                    slides = getActiveSlides(allAnnouncements);
                    const b3Idx = slides.findIndex(s => isScheduleChangeSlide(s) && normalizeScheduleSectionName(s) === 'Β3');
                    currentIndex = b3Idx !== -1 ? b3Idx : 0;
                    startRotation();
                } else if (mode === 'after_hour3') {
                    window._auroraSimulateSchoolHours = true;
                    window._auroraSimulatedHHMM = '10:45';
                    window._auroraDemoScheduleItems = null;
                    window._auroraDemoScheduleHtml = null;
                    window._auroraDemoClock = { time: '10:45', date: 'Τρίτη 10 Νοεμβρίου' };
                    window._auroraDemoWeather = false;
                    updateClock();
                    slides = getActiveSlides(allAnnouncements);
                    const b3Idx = slides.findIndex(s => isScheduleChangeSlide(s) && normalizeScheduleSectionName(s) === 'Β3');
                    currentIndex = b3Idx !== -1 ? b3Idx : 0;
                    startRotation();
                } else if (mode === 'mockup2') {
                    if (timer) clearTimeout(timer);
                    window._auroraSimulateSchoolHours = false;
                    window._auroraSimulatedHHMM = null;
                    window._auroraDemoScheduleItems = null;
                    window._auroraDemoClock = { time: '10:16', date: 'Τετάρτη 5 Νοεμβρίου' };
                    window._auroraDemoWeather = true;
                    const wEl = document.getElementById('weather');
                    if (wEl) wEl.innerHTML = `Μυτιλήνη 21°C ☀️`;
                    window._auroraDemoScheduleHtml = `
                        <div class="aurora-sched-line1">🔔 3η Διδακτική Ώρα (09:45 - 10:30)</div>
                        <div class="aurora-sched-line2"><span class="aurora-sched-dot">•</span> ⏳ Λήξη &amp; Διάλειμμα σε 14 λεπτά</div>
                        <div class="aurora-sched-progress-row">
                            <div class="aurora-sched-progress-track">
                                <div class="aurora-sched-progress-fill" style="width: 70%;"></div>
                            </div>
                            <span class="aurora-sched-progress-pct">70%</span>
                        </div>
                    `;
                    updateClock();
                    const demoSchedSlide = {
                        id: 'demo-b1',
                        type: 'alert',
                        layout: 'fullscreen',
                        mediaType: 'schedule_change',
                        isScheduleChange: true,
                        title: 'Τμήμα Β1 — Τροποποίηση 3ης Ώρας',
                        scheduleData: {
                            section: 'Β1',
                            changes: [{
                                hour: 3,
                                kind: 'free',
                                badgeText: 'ΚΕΝΟ',
                                detail: 'Απουσία διδάσκοντος.\nΟι μαθητές παραμένουν στο χώρο της Βιβλιοθήκης'
                            }]
                        }
                    };
                    syncTickerWithCurrentSlide(demoSchedSlide);
                    renderSlide(demoSchedSlide);
                } else if (mode === 'mockup1') {
                    if (timer) clearTimeout(timer);
                    window._auroraSimulateSchoolHours = false;
                    window._auroraSimulatedHHMM = null;
                    const realSched = getActiveScheduleAnnouncements();
                    window._auroraDemoScheduleItems = (realSched && realSched.length > 0) ? null : fallbackDemoScheduleItems;
                    window._auroraDemoClock = { time: '10:15', date: 'Πέμπτη, 24 Οκτ' };
                    window._auroraDemoWeather = true;
                    const wEl = document.getElementById('weather');
                    if (wEl) wEl.innerHTML = `ΜΥΤΙΛΗΝΗ | 21°C`;
                    window._auroraDemoScheduleHtml = `
                        <div class="aurora-sched-line1">🔔 3η Διδακτική Ώρα (09:45 - 10:30)</div>
                        <div class="aurora-sched-line2"><span class="aurora-sched-dot">•</span> ⏳ Λήξη &amp; Διάλειμμα σε 15 λεπτά</div>
                        <div class="aurora-sched-progress-row">
                            <div class="aurora-sched-progress-track">
                                <div class="aurora-sched-progress-fill" style="width: 67%;"></div>
                            </div>
                            <span class="aurora-sched-progress-pct">67%</span>
                        </div>
                    `;
                    updateClock();
                    const demoNormalSlide = {
                        id: 'demo-visit',
                        type: 'event',
                        layout: 'split-left',
                        mediaType: 'image',
                        mediaSource: 'https://images.unsplash.com/photo-1523240795612-9a054b0db644?auto=format&fit=crop&w=1000&q=80',
                        title: 'ΕΚΠΑΙΔΕΥΤΙΚΗ ΕΠΙΣΚΕΨΗ',
                        content: `<div style="font-weight:700; color:#fff; font-size:1.45rem; margin-bottom:0.6rem;">1ο Πρότυπο Γυμνάσιο Μυτιλήνης<br>Πέμπτη, 24 Οκτωβρίου | 09:30<br>Προορισμός: Αρχαιολογικό Μουσείο</div><div style="font-size:1.15rem; color:rgba(226,232,240,0.9);">Συμμετοχή: Τμήματα Α1, Α2. Οι μαθητές θα ξεναγηθούν στις μόνιμες εκθέσεις του Αρχαιολογικού Μουσείου Μυτιλήνης με τη συνοδεία των υπεύθυνων καθηγητών.</div>`
                    };
                    syncTickerWithCurrentSlide(demoNormalSlide);
                    renderSlide(demoNormalSlide);
                }
            });
        });
    });
}
