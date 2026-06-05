const GROQ_API_KEY = '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';
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_WHISPER_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
let mediaRecorder = null;
let audioChunks = [];

let isRecording = false;
let recognition = null;
let transactions = JSON.parse(localStorage.getItem('hv_transactions') || '[]');

// ── INIT ──────────────────────────────────────────────────
window.addEventListener('load', () => {
  console.log('✅ app.js loaded fresh version 3.0');

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js')
      .then(() => console.log('✅ SW registered'))
      .catch(e => console.warn('SW skipped:', e.message));
  }

  document.getElementById('mic-btn').addEventListener('click', handleMicClick);
  document.getElementById('delete-btn').addEventListener('click', deleteAllData);

  renderLedger();
  renderSummary();
});



── MIC CLICK ─────────────────────────────────────────────
async function handleMicClick() {
  console.log('🎤 Mic clicked, isRecording:', isRecording);

  if (isRecording) {
    recognition && recognition.stop();
    return;
  }

  clearInput();

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach(t => t.stop());
    console.log('✅ Mic permission OK');
  } catch (err) {
    console.error('❌ Mic denied:', err);
    showStatus('ማይክሮፎን ፈቃድ ያስፈልጋል!', 'error');
    return;
  }

  startRecognition();
}

// ── SPEECH RECOGNITION ────────────────────────────────────
function startRecognition() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    showStatus('Chrome browser ይጠቀሙ።', 'error');
    return;
  }

  recognition = new SR();
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.maxAlternatives = 3;

  // Try Amharic first
  recognition.lang = 'am-ET';

  recognition.onstart = () => {
    console.log('🎙 Listening...');
    isRecording = true;
    setMicState('recording');
    showStatus('እያዳመጥኩ ነው...', 'listening');
  };

  recognition.onresult = (event) => {
    let interim = '';
    let final = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const t = event.results[i][0].transcript;
      event.results[i].isFinal ? (final += t) : (interim += t);
    }
    const display = final || interim;
    console.log('📝 Heard:', display);
    document.getElementById('transcription').textContent = display;
    if (final) document.getElementById('transcription').dataset.final = final;
  };

  recognition.onerror = (event) => {
    console.error('❌ Speech error:', event.error);
    isRecording = false;
    setMicState('idle');

    if (event.error === 'language-not-supported') {
      console.log('🔄 Amharic not supported, retrying without lang...');
      recognition.lang = '';
      setTimeout(() => {
        try { recognition.start(); } catch(e) {}
      }, 300);
      return;
    }

    const msgs = {
      'not-allowed': 'ማይክሮፎን ፈቃድ ያስፈልጋል።',
      'no-speech': 'ምንም አልተሰማም። እንደገና ይሞክሩ።',
      'network': 'Network error. Check internet.',
      'audio-capture': 'Microphone not found.'
    };
    showStatus(msgs[event.error] || 'Error: ' + event.error, 'error');
  };

  recognition.onend = () => {
    console.log('⏹ Recognition ended');
    isRecording = false;
    setMicState('idle');

    const finalText = document.getElementById('transcription').dataset.final
      || document.getElementById('transcription').textContent;

    console.log('📄 Final text to process:', finalText);

    if (finalText && finalText.trim().length > 0) {
      extractTransaction(finalText.trim());
    } else {
      showStatus('ምንም አልተሰማም። እንደገና ይሞክሩ።', 'error');
    }
  };

  try {
    recognition.start();
  } catch (e) {
    console.error('Failed to start:', e);
    showStatus('Failed to start mic: ' + e.message, 'error');
  }
}

// ── GROQ EXTRACTION ───────────────────────────────────────
async function extractTransaction(text) {
  console.log('🤖 Sending to Groq:', text);
  showStatus('AI እየተነተነ ነው...', 'processing');
  document.getElementById('ai-thinking').style.display = 'flex';

  const prompt = `You are a sales data extractor for Ethiopian artisans in Gondar.
Extract data from a sales statement. Language may be Amharic, English, or mixed.

AMHARIC NUMBER CONVERSION (mandatory):
አንድ=1, ሁለት=2, ሶስት=3, አራት=4, አምስት=5, ስድስት=6, ሰባት=7, ስምንት=8, ዘጠኝ=9
አስር=10, ሃያ=20, ሰላሳ=30, አርባ=40, ሃምሳ=50, ስልሳ=60, ሰባ=70, ሰማንያ=80, ዘጠና=90
መቶ=100
ሺ=1000, ሺህ=1000, ሽህ=1000, ሽ=1000 (all spellings of "thousand" = 1000)
ሁለት ሺ=2000, ሁለት ሽህ=2000, ሁለት ሽ=2000
ሶስት ሺ=3000, ሶስት ሽህ=3000
አምስት ሺ=5000, አምስት ሽህ=5000
አስር ሺ=10000, አስር ሽህ=10000

ETHIOPIC NUMERAL CONVERSION (mandatory):
፩=1, ፪=2, ፫=3, ፬=4, ፭=5, ፮=6, ፯=7, ፰=8, ፱=9
፲=10, ፳=20, ፴=30, ፵=40, ፶=50, ፷=60, ፸=70, ፹=80, ፺=90
፻=100, ፼=10000
፪፻=200, ፫፻=300, ፬፻=400, ፭፻=500, ፮፻=600, ፯፻=700, ፰፻=800, ፱፻=900
፲፻=1000, ፪፻፩=201, ፩ሺ፭፻=1500

CRITICAL RULES FOR NUMBERS:
- ፪፻ means 2×100 = 200 NOT 2000
- ፫፻ means 3×100 = 300 NOT 3000
- መቶ alone = 100, ሁለት መቶ = 200, ሶስት መቶ = 300
- ሺ alone = 1000, ሁለት ሺ = 2000
- If someone says "200" or "፪፻" the price is 200, not 2000
- Never multiply by 10 extra
- ሽህ, ሺህ, ሽ, ሺ all mean 1000 — they are the same word spelled differently by speech recognition
- NEVER treat ሽህ or ሺህ as an item name — it always means 1000
- If you see [number] + ሽህ/ሺህ/ሽ/ሺ, that is a price in thousands

EXTRACTION RULES:
1. item = what was sold. If not mentioned use "ሸቀጥ"
2. quantity = how many. If not mentioned use 1
3. price = price per unit in Birr. Look for number before or after "ብር"
4. total = quantity x price

IMPORTANT: Always return JSON even if guessing. Never return nulls for price if any number exists.

Statement: "${text}"

Examples:
"ዛሬ ሶስት መቶ ብር ሸጥኩ" → {"item":"ሸቀጥ","quantity":1,"price":300,"total":300}
"ዛሬ 3 ቀሚስ በ 1500 ብር ሸጥኩ" → {"item":"ቀሚስ","quantity":3,"price":1500,"total":4500}
"ሁለት ሺ ብር የሆነ አንድ ልብስ ሸጥኩ" → {"item":"ልብስ","quantity":1,"price":2000,"total":2000}
"sold 5 scarves 300 birr each" → {"item":"scarves","quantity":5,"price":300,"total":1500}
"አምስት መቶ ሃምሳ ብር" → {"item":"ሸቀጥ","quantity":1,"price":550,"total":550}
"አንድ ሽህ ብር" → {"item":"ሸቀጥ","quantity":1,"price":1000,"total":1000}
"ሁለት ሽህ ብር ሸጥኩ" → {"item":"ሸቀጥ","quantity":1,"price":2000,"total":2000}
"አንድ ሽህ አምስት መቶ ብር" → {"item":"ሸቀጥ","quantity":1,"price":1500,"total":1500}


Return ONLY the JSON object. Nothing else.
JSON:`;

  try {
    const res = await fetch(GROQ_URL, {
      method: 'POST',
      mode: 'cors',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
        max_tokens: 150
      })
    });

    console.log('📡 Groq status:', res.status);

    if (!res.ok) {
      const err = await res.json();
      console.error('❌ Groq error:', JSON.stringify(err));
      throw new Error('Groq ' + res.status);
    }

    const data = await res.json();
    const raw = data.choices[0].message.content.trim();
    console.log('🤖 Groq raw response:', raw);

    // Clean markdown if any
    const cleaned = raw
      .replace(/```json/gi, '')
      .replace(/```/g, '')
      .trim();

    console.log('🧹 Cleaned:', cleaned);

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (parseErr) {
      console.error('❌ JSON parse failed:', parseErr, 'Raw was:', cleaned);
      // Try to extract JSON from response
      const match = cleaned.match(/\{.*\}/s);
      if (match) {
        parsed = JSON.parse(match[0]);
      } else {
        throw new Error('Could not parse JSON from: ' + cleaned);
      }
    }

    console.log('✅ Parsed result:', parsed);
    document.getElementById('ai-thinking').style.display = 'none';

    // Save if we have at least a price
    if (parsed.price && parsed.price > 0) {
      parsed.quantity = parsed.quantity || 1;
      parsed.item = parsed.item || 'ሸቀጥ';
      parsed.total = parsed.total || (parsed.quantity * parsed.price);
      saveTransaction(text, parsed);
    } else {
      console.warn('⚠️ No price found in:', parsed);
      showStatus('ዋጋ አልተሰማም። ዋጋ ጨምረው ይናገሩ። (Include the price)', 'error');
    }

  } catch (err) {
    document.getElementById('ai-thinking').style.display = 'none';
    console.error('❌ Full error:', err);
    showStatus('ስህተት ተፈጥሯል። Saved as pending.', 'error');
    saveRawTransaction(text);
  }
}

// ── SAVE ──────────────────────────────────────────────────
function saveTransaction(originalText, parsed) {
  const transaction = {
    id: Date.now(),
    timestamp: new Date().toISOString(),
    date: new Date().toLocaleDateString('am-ET'),
    original: originalText,
    item: parsed.item,
    quantity: parsed.quantity,
    price: parsed.price,
    total: parsed.total,
    status: 'confirmed'
  };
  transactions.unshift(transaction);
  localStorage.setItem('hv_transactions', JSON.stringify(transactions));
  console.log('💾 Saved:', transaction);
  showStatus(`✓ ተመዝግቧል: ${parsed.quantity} ${parsed.item} = ${parsed.total.toLocaleString()} ብር`, 'success');
  renderLedger();
  renderSummary();
  clearInput();
}

function saveRawTransaction(text) {
  const transaction = {
    id: Date.now(),
    timestamp: new Date().toISOString(),
    date: new Date().toLocaleDateString('am-ET'),
    original: text,
    item: text,
    quantity: '?',
    price: '?',
    total: 0,
    status: 'pending'
  };
  transactions.unshift(transaction);
  localStorage.setItem('hv_transactions', JSON.stringify(transactions));
  renderLedger();
}

// ── RENDER LEDGER ─────────────────────────────────────────
function renderLedger() {
  const container = document.getElementById('ledger-list');
  if (transactions.length === 0) {
    container.innerHTML = '<p class="empty-msg">እስካሁን ምንም ሽያጭ የለም።</p>';
    return;
  }
  container.innerHTML = transactions.slice(0, 20).map(t => `
    <div class="transaction-card ${t.status === 'pending' ? 'pending' : ''}">
      <div class="t-left">
        <span class="t-item">${t.item}</span>
        <span class="t-date">${t.date}</span>
        ${t.status === 'pending' ? '<span class="t-badge">ያልተነተነ</span>' : ''}
      </div>
      <div class="t-right">
        ${t.quantity !== '?' ? `<span class="t-qty">${t.quantity} ×</span>` : ''}
        <span class="t-total">${t.total > 0 ? t.total.toLocaleString() + ' ብር' : '—'}</span>
      </div>
    </div>
  `).join('');
}

// ── RENDER SUMMARY ────────────────────────────────────────
function renderSummary() {
  const today = new Date().toDateString();
  const todayTx = transactions.filter(t =>
    new Date(t.timestamp).toDateString() === today && t.status === 'confirmed'
  );
  const todayTotal = todayTx.reduce((sum, t) => sum + (t.total || 0), 0);
  const todayCount = todayTx.length;

  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const weekTx = transactions.filter(t =>
    new Date(t.timestamp) > weekAgo && t.status === 'confirmed'
  );
  const weekTotal = weekTx.reduce((sum, t) => sum + (t.total || 0), 0);

  document.getElementById('today-total').textContent = todayTotal.toLocaleString() + ' ብር';
  document.getElementById('today-count').textContent = todayCount + ' ሽያጭ';
  document.getElementById('week-total').textContent = weekTotal.toLocaleString() + ' ብር';
}

// ── UI HELPERS ────────────────────────────────────────────
function setMicState(state) {
  const btn = document.getElementById('mic-btn');
  const btnText = document.getElementById('mic-btn-text');
  btn.className = 'mic-btn ' + state;
  btnText.textContent = state === 'recording' ? 'እያዳመጥኩ...' : 'ተናገሩ';
  isRecording = state === 'recording';
}

function showStatus(msg, type) {
  const el = document.getElementById('status-msg');
  el.textContent = msg;
  el.className = 'status-msg ' + type;
  el.style.display = 'block';
  if (type === 'success' || type === 'info') {
    setTimeout(() => { el.style.display = 'none'; }, 4000);
  }
}

function clearInput() {
  const t = document.getElementById('transcription');
  t.textContent = '';
  t.dataset.final = '';
}

function deleteAllData() {
  if (confirm('ሁሉንም ውሂብ ይሰርዙ?')) {
    transactions = [];
    localStorage.removeItem('hv_transactions');
    renderLedger();
    renderSummary();
  }
}
