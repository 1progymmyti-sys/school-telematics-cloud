/**
 * ═════════════════════════════════════════════════════════════════════════════════
 * 1ο ΠΡΟΤΥΠΟ ΓΥΜΝΑΣΙΟ ΜΥΤΙΛΗΝΗΣ - ΣΧΟΛΙΚΗ ΤΗΛΕΜΑΤΙΚΗ CLOUD
 * ΑΥΤΟΜΑΤΙΣΜΟΣ GMAIL -> FIRESTORE ΓΙΑ ΑΛΛΑΓΕΣ ΠΡΟΓΡΑΜΜΑΤΟΣ
 * 
 * Λογαριασμός παραλαβής: 1progymmyti@gmail.com
 * Αποστολέας: kmichalakis@gmail.com (ή διεύθυνση σχολείου)
 * Firebase: school-telematics (collection: announcements)
 * 
 * ΚΑΤΑΣΚΕΥΗ: Ε. ΒΑΛΑΚΟΣ with Antigravity
 * ═════════════════════════════════════════════════════════════════════════════════
 */

const FIREBASE_API_KEY = "AIzaSyDP79ROPAP81q_0KlIfrQLXbc7d35n7jXg";
const FIRESTORE_URL = "https://firestore.googleapis.com/v1/projects/school-telematics/databases/(default)/documents/announcements?key=" + FIREBASE_API_KEY;
const PROCESSED_LABEL = "TelematicsProcessed";

/**
 * Κεντρική συνάρτηση που εκτελείται αυτόματα (π.χ. κάθε 5 λεπτά με Χρονοδιακόπτη / Trigger)
 */
function processScheduleEmails() {
  const query = 'to:1progymmyti@gmail.com ("αλλαγή προγράμματος" OR "αλλαγές προγράμματος" OR "Αλλαγή Προγράμματος") -label:' + PROCESSED_LABEL;
  const threads = GmailApp.search(query, 0, 10);
  
  if (threads.length === 0) {
    Logger.log("Δεν βρέθηκαν νέα emails για επεξεργασία.");
    return;
  }
  
  let label = GmailApp.getUserLabelByName(PROCESSED_LABEL);
  if (!label) {
    label = GmailApp.createLabel(PROCESSED_LABEL);
  }
  
  for (let t = 0; t < threads.length; t++) {
    const thread = threads[t];
    const messages = thread.getMessages();
    
    for (let m = 0; m < messages.length; m++) {
      const msg = messages[m];
      const body = msg.getPlainBody();
      const subject = msg.getSubject();
      
      Logger.log("Επεξεργασία email: " + subject + " (" + msg.getDate() + ")");
      
      const parsed = parseScheduleChangeEmailText(body, subject);
      if (parsed && parsed.sections && parsed.sections.length > 0) {
        publishSectionsToFirestore(parsed);
        Logger.log("Επιτυχής ανάρτηση " + parsed.sections.length + " τμημάτων στο Firestore!");
      } else {
        Logger.log("Το email δεν περιείχε αναγνωρίσιμη αλλαγή προγράμματος.");
      }
    }
    
    // Σημείωση ως επεξεργασμένο
    thread.addLabel(label);
    thread.markRead();
  }
}

/**
 * Ανάλυση κειμένου email (Υποστηρίζει 1 ή ΠΟΛΛΑΠΛΑ τμήματα)
 */
function parseScheduleChangeEmailText(rawText, subject) {
  if (!rawText) return null;
  const text = (subject ? subject + "\n" : "") + rawText.trim();
  
  // 1. Εύρεση Ημερομηνίας
  const monthsMap = {
    'ιανουαρ': '01', 'φεβρουαρ': '02', 'μαρτ': '03', 'απριλ': '04',
    'μαι': '05', 'μαϊ': '05', 'ιουν': '06', 'ιουλ': '07',
    'αυγουστ': '08', 'σεπτεμβρ': '09', 'οκτωβρ': '10', 'νοεμβρ': '11', 'δεκεμβρ': '12',
    'ιαν': '01', 'φεβ': '02', 'μαρ': '03', 'απρ': '04',
    'ιουν': '06', 'ιουλ': '07', 'αυγ': '08', 'σεπ': '09', 'οκτ': '10', 'νοε': '11', 'δεκ': '12'
  };

  const greekMonthNamesPattern = '(?:Ιανουαρί(?:ου|ος)|Φεβρουαρί(?:ου|ος)|Μαρτί(?:ου|ος)|Απριλί(?:ου|ος)|Μαΐου|Μαϊου|Μαΐος|Μαϊος|Ιουνί(?:ου|ος)|Ιουλί(?:ου|ος)|Αυγούστ(?:ου|ος)|Σεπτεμβρί(?:ου|ος)|Οκτωβρί(?:ου|ος)|Νοεμβρί(?:ου|ος)|Δεκεμβρί(?:ου|ος)|Ιαν|Φεβ|Μαρ|Απρ|Μαϊ|Μαι|Ιουν|Ιουλ|Αυγ|Σεπ|Οκτ|Νοε|Δεκ)';
  
  let dateIso = '';
  let dateFormatted = '';
  let dayName = '';

  const dayMatch = text.match(/\b(Δευτέρα|Τρίτη|Τετάρτη|Πέμπτη|Παρασκευή|Σάββατο|Κυριακή)\b/i);
  if (dayMatch) {
    dayName = dayMatch[1].charAt(0).toUpperCase() + dayMatch[1].slice(1).toLowerCase();
  }

  const currentYear = new Date().getFullYear();
  const textDateMatch = text.match(new RegExp('(\\d{1,2})\\s+(' + greekMonthNamesPattern + ')(?:\\s+(\\d{4}))?', 'i'));
  const numericDateMatch = text.match(/\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?\b/);

  if (textDateMatch) {
    const d = textDateMatch[1].length === 1 ? '0' + textDateMatch[1] : textDateMatch[1];
    const mRaw = textDateMatch[2].toLowerCase();
    const y = textDateMatch[3] || currentYear.toString();
    let mNum = '';
    for (const k in monthsMap) {
      if (mRaw.indexOf(k) !== -1) {
        mNum = monthsMap[k];
        break;
      }
    }
    if (mNum) {
      dateIso = y + '-' + mNum + '-' + d;
      dateFormatted = d + '/' + mNum + '/' + y;
    }
  } else if (numericDateMatch) {
    const d = numericDateMatch[1].length === 1 ? '0' + numericDateMatch[1] : numericDateMatch[1];
    const m = numericDateMatch[2].length === 1 ? '0' + numericDateMatch[2] : numericDateMatch[2];
    let y = numericDateMatch[3] || currentYear.toString();
    if (y.length === 2) y = '20' + y;
    dateIso = y + '-' + m + '-' + d;
    dateFormatted = d + '/' + m + '/' + y;
  }

  if (dateIso && !dayName) {
    const dt = new Date(dateIso + 'T12:00:00');
    const days = ['Κυριακή', 'Δευτέρα', 'Τρίτη', 'Τετάρτη', 'Πέμπτη', 'Παρασκευή', 'Σάββατο'];
    dayName = days[dt.getDay()];
  }

  // 2. Εντοπισμός Τμημάτων
  function normalizeSec(s) {
    s = (s || '').replace(/[\s\-_\'\.]/g, '').toUpperCase();
    if (s.indexOf('A') === 0) s = 'Α' + s.slice(1);
    else if (s.indexOf('B') === 0) s = 'Β' + s.slice(1);
    else if (s.indexOf('C') === 0) s = 'Γ' + s.slice(1);
    return s;
  }

  const globalSecMatch = text.match(/(?:τμήμα(?:τος)?|πρόγραμμα(?:τος)?|τάξη(?:ς)?)\s*[:\-–]?\s*([ΑΒΓαβγABCabc][\s\-_']?[1-9])/i)
                      || text.match(/(?:^|[^\w\u0370-\u03ff])([ΑΒΓαβγABCabc][\s\-_']?[1-9])(?=$|[^\w\u0370-\u03ff])/i);
  const initialDefaultSec = globalSecMatch ? normalizeSec(globalSecMatch[1]) : '';

  const secHeaderPattern = /^(?:[-•*·\d\.]+\s*)?(?:(?:για\s+το\s+)?(?:τμήμα(?:τος)?|πρόγραμμα(?:τος)?|τάξη(?:ς)?)\s*[:\-–]?\s*)?([ΑΒΓαβγABCabc][\s\-_']?[1-9])\s*[:\-–.]?\s*$/i;
  const secInlineHeader = /(?:τμήμα(?:τος)?|τάξη(?:ς)?)\s*[:\-–]?\s*([ΑΒΓαβγABCabc][\s\-_']?[1-9])/i;

  const lines = text.split(/\r?\n/);
  const sectionsMap = {};
  let currentSec = null;

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trim();
    if (!line) continue;
    if (line.indexOf('@') !== -1 || line.toLowerCase().indexOf('προς') !== -1 || line.toLowerCase().indexOf('πλήρες πρόγραμμα') !== -1) {
      continue;
    }

    const m1 = line.match(/^(?:[-•*·]\s*)?(?:Την\s+)?([1-7])[ηή]\s*(?:ώρα|ωρα)?\s*[:\-–.]?\s*(.+)$/i);
    const m2 = !m1 ? line.match(/^(?:[-•*·]\s*)?(?:Την\s+)?([1-7])\s+(?:ώρα|ωρα)\s*[:\-–.]?\s*(.+)$/i) : null;
    const m3 = (!m1 && !m2) ? line.match(/^(?:[-•*·]\s*)?(?:ώρα|ωρα)\s*([1-7])[ηή]?\s*[:\-–.]?\s*(.+)$/i) : null;
    const hourMatch = m1 || m2 || m3;

    if (!hourMatch) {
      const mSecLine = line.match(secHeaderPattern) || line.match(secInlineHeader);
      if (mSecLine) {
        currentSec = normalizeSec(mSecLine[1]);
        if (!sectionsMap[currentSec]) {
          sectionsMap[currentSec] = [];
        }
        continue;
      }
    }

    if (hourMatch) {
      const secToUse = currentSec || initialDefaultSec || 'Γενικό';
      if (!sectionsMap[secToUse]) {
        sectionsMap[secToUse] = [];
      }

      const hourNum = parseInt(hourMatch[1], 10);
      const detail = hourMatch[2].trim().replace(/\.$/, '');
      const lower = detail.toLowerCase();
      let kind = 'substitution';
      let badgeText = 'ΑΝΑΠΛΗΡΩΣΗ';
      let badgeColor = '#10b981';
      let icon = '📚';

      if (lower.indexOf('δεν θα γινει') !== -1 || lower.indexOf('δεν θα γίνει') !== -1 || lower.indexOf('κενο') !== -1 || lower.indexOf('κενό') !== -1 || lower.indexOf('αποχωρηση') !== -1 || lower.indexOf('αποχώρηση') !== -1) {
        kind = 'free';
        badgeText = 'ΚΕΝΟ / ΑΠΟΧΩΡΗΣΗ';
        badgeColor = '#ef4444';
        icon = '🛑';
      } else if (lower.indexOf('αιθουσα') !== -1 || lower.indexOf('αίθουσα') !== -1) {
        kind = 'room';
        badgeText = 'ΑΛΛΑΓΗ ΑΙΘΟΥΣΑΣ';
        badgeColor = '#f59e0b';
        icon = '🚪';
      }

      sectionsMap[secToUse].push({
        hour: hourNum,
        detail: detail,
        kind: kind,
        badgeText: badgeText,
        badgeColor: badgeColor,
        icon: icon
      });
    }
  }

  const secKeys = Object.keys(sectionsMap);
  const numSections = secKeys.length;
  if (numSections === 0) return null;

  // Κανόνας Διάρκειας:
  // 1 κάρτα -> 15 δευτερόλεπτα
  // Πάνω από 1 κάρτα (N) -> μοίρασμα στα 20 δευτερόλεπτα (τουλάχιστον 5 δευτ. ανά κάρτα)
  const autoDuration = numSections <= 1 ? 15 : Math.max(5, Math.round(20 / numSections));

  const results = [];
  for (let s = 0; s < secKeys.length; s++) {
    const sec = secKeys[s];
    const changes = sectionsMap[sec];
    if (changes && changes.length > 0) {
      changes.sort(function(a, b) { return a.hour - b.hour; });
      results.push({
        section: sec,
        dateIso: dateIso,
        dateFormatted: dateFormatted,
        dayName: dayName,
        changes: changes,
        duration: autoDuration
      });
    }
  }

  return {
    dateIso: dateIso,
    dateFormatted: dateFormatted,
    dayName: dayName,
    sections: results
  };
}

/**
 * Αποστολή στο Firestore REST API
 */
function publishSectionsToFirestore(parsed) {
  const todayIso = Utilities.formatDate(new Date(), "Europe/Athens", "yyyy-MM-dd");
  let endDate = parsed.dateIso || todayIso;
  if (endDate < todayIso) endDate = todayIso;
  
  for (let i = 0; i < parsed.sections.length; i++) {
    const secData = parsed.sections[i];
    
    // Μετατροπή changes σε Firestore arrayValue
    const changesList = [];
    for (let c = 0; c < secData.changes.length; c++) {
      const ch = secData.changes[c];
      changesList.push({
        mapValue: {
          fields: {
            hour: { integerValue: ch.hour.toString() },
            detail: { stringValue: ch.detail },
            kind: { stringValue: ch.kind },
            badgeText: { stringValue: ch.badgeText },
            badgeColor: { stringValue: ch.badgeColor },
            icon: { stringValue: ch.icon }
          }
        }
      });
    }
    
    const docPayload = {
      fields: {
        title: { stringValue: "Αλλαγή Προγράμματος - Τμήμα " + secData.section },
        type: { stringValue: "alert" },
        mediaType: { stringValue: "schedule_change" },
        content: { stringValue: "" },
        scheduleData: {
          mapValue: {
            fields: {
              section: { stringValue: secData.section },
              dateIso: { stringValue: secData.dateIso || todayIso },
              dateFormatted: { stringValue: secData.dateFormatted || "" },
              dayName: { stringValue: secData.dayName || "" },
              duration: { integerValue: secData.duration.toString() },
              changes: {
                arrayValue: {
                  values: changesList
                }
              }
            }
          }
        },
        startDate: { stringValue: todayIso },
        endDate: { stringValue: endDate },
        startTime: { stringValue: "" },
        endTime: { stringValue: "" },
        duration: { integerValue: secData.duration.toString() },
        layout: { stringValue: "fullscreen" },
        isScheduleChange: { booleanValue: true },
        order: { integerValue: i.toString() },
        createdAt: { stringValue: new Date().toISOString() }
      }
    };
    
    const options = {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(docPayload),
      muteHttpExceptions: true
    };
    
    const res = UrlFetchApp.fetch(FIRESTORE_URL, options);
    Logger.log("Firestore Response (Τμήμα " + secData.section + ", " + secData.duration + "s): " + res.getResponseCode());
  }
}

/**
 * Δοκιμαστική συνάρτηση για άμεση εκτέλεση στο GAS Editor (Test)
 */
function testScheduleParser() {
  const sampleEmail = 
    "Αλλαγές προγράμματος - Πέμπτη 29 Οκτωβρίου 2026\n\n" +
    "Τμήμα Α4:\n" +
    "- Την 5η ώρα θα γίνει το μάθημα ΑΝΑΠΛΗΡΩΣΗ από ΑΝΑΓΝΩΣΤΟΠΟΥΛΟΥ ΜΑΡΘΑ.\n" +
    "- Την 7η ώρα δεν θα γίνει μάθημα.\n\n" +
    "Τμήμα Β2:\n" +
    "- Την 3η ώρα δεν θα γίνει μάθημα.\n" +
    "- Την 6η ώρα ΑΝΑΠΛΗΡΩΣΗ Μαθηματικά από ΠΑΠΑΔΟΠΟΥΛΟ.\n\n" +
    "Τμήμα Γ1:\n" +
    "- Την 2η ώρα αλλαγή αίθουσας στο Εργαστήριο Πληροφορικής.";
    
  const res = parseScheduleChangeEmailText(sampleEmail, "Αλλαγές προγράμματος");
  Logger.log(JSON.stringify(res, null, 2));
}
