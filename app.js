const GROQ_API_KEY = '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';
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_WHISPER_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';

let isRecording = false;
let mediaRecorder = null;
let audioChunks = [];
let transactions = JSON.parse(localStorage.getItem('hv_transactions') || '[]');

window.addEventListener('load', () => {
  console.log('✅ Hagere Voice v5.0');

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

// ── MIC: AUTO-STOPS AFTER SILENCE ─────────────────────────
async function handleMicClick() {
  if (isRecording) {
    stopRecording();
    return;
  }
  await startRecording();
}

async function startRecording() {
  clearInput();
  console.log('🎤 Starting...');

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    console.log('✅ Mic OK');
    audioChunks = [];

    const mimeType = getSupportedMimeType();
    mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});

    mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) audioChunks.push(e.data);
    };

    mediaRecorder.onstop = async () => {
      stream.getTracks().forEach(t => t.stop());
      const blob = new Blob(audioChunks, { type: mimeType || 'audio/webm' });
      console.log('🎵 Blob size:', blob.size);

      if (blob.size < 500) {
        showStatus('ምንም አልተሰማም። እንደገና ይሞክሩ።', 'error');
        return;
      }
      await transcribeAudio(blob, mimeType);
    };

    // AUTO-STOP after 8 seconds
    mediaRecorder.start(100);
    isRecording = true;
    setMicState('recording');
    showStatus('እያዳመጥኩ ነው... (8 ሰከንድ)', 'listening');

    setTimeout(() => {
      if (isRecording) {
        console.log('⏰ Auto-stopping after 8s');
        stopRecording();
      }
    }, 8000);

  } catch (err) {
    console.error('❌ Mic error:', err.name, err.message);
    isRecording = false;
    setMicState('idle');

    if (err.name === 'NotAllowedError') {
      showStatus('ማይክሮፎን ፈቃድ ያስፈልጋል!', 'error');
    } else if (err.name === 'NotFoundError') {
      showStatus('ማይክሮፎን አልተገኘም።', 'error');
    } else {
      showStatus('Error: ' + err.message, 'error');
    }
  }
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }
  isRecording = false;
  setMicState('idle');
  showStatus('እየተነተነ ነው...', 'processing');
}

function getSupportedMimeType() {
  const types = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/ogg',
    'audio/mp4'
  ];
  for (const t of types) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return null;
}

// ── WHISPER ───────────────────────────────────────────────
async function transcribeAudio(blob, mimeType) {
  console.log('📡 Sending to Whisper...');
  document.getElementById('ai-thinking').style.display = 'flex';

  const ext = mimeType
    ? (mimeType.includes('ogg') ? 'ogg' : mimeType.includes('mp4') ? 'mp4' : 'webm')
    : 'webm';

  const formData = new FormData();
  formData.append('file', blob, `recording.${ext}`);
  formData.append('model', 'whisper-large-v3');
  formData.append('language', 'am');
  formData.append('response_format', 'json');

  try {
    const res = await fetch(GROQ_WHISPER_URL, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${GROQ_API_KEY}` },
      body: formData
    });

    console.log('📡 Whisper status:', res.status);

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.error('❌ Whisper error:', JSON.stringify(err));

      // FALLBACK to Web Speech API if Whisper fails
      console.log('🔄 Falling back to Web Speech API...');
      document.getElementById('ai-thinking').style.display = 'none';
      useSpeechRecognitionFallback();
      return;
    }

    const data = await res.json();
    const transcript = data.text && data.text.trim();
    console.log('📝 Whisper transcript:', transcript);

    if (!transcript) {
      showStatus('ምንም አልተሰማም። እንደገና ይሞክሩ።', 'error');
      document.getElementById('ai-thinking').style.display = 'none';
      return;
    }

    document.getElementById('transcription').textContent = transcript;
    await extractTransaction(transcript);

  } catch (err) {
    console.error('❌ Whisper failed:', err);
    document.getElementById('ai-thinking').style.display = 'none';
    showStatus('Network error. Try again.', 'error');
  }
}

// ── FALLBACK: WEB SPEECH API (Chrome only) ────────────────
function useSpeechRecognitionFallback() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    showStatus('Chrome browser ይጠቀሙ።', 'error');
    return;
  }

  showStatus('Chrome speech እየሞከርኩ...', 'processing');
  const rec = new SR();
  rec.lang = 'am-ET';
  rec.continuous = false;
  rec.interimResults = false;

  rec.onresult = (e) => {
    const text = e.results[0][0].transcript;
    console.log('📝 Fallback transcript:', text);
    document.getElementById('transcription').textContent = text;
    extractTransaction(text);
  };

  rec.onerror = (e) => {
    console.error('❌ Fallback error:', e.error);
    showStatus('Speech error: ' + e.error, 'error');
  };

  rec.start();
}

// ── GROQ EXTRACTION ───────────────────────────────────────
async function extractTransaction(text) {
  console.log('🤖 Extracting:', text);
  document.getElementById('ai-thinking').style.display = 'flex';

  const prompt = `You are a sales data extractor for Ethiopian artisans in Gondar.
Extract data from a sales statement. Language may be Amharic, English, or mixed.

AMHARIC NUMBER CONVERSION:
አንድ=1, ሁለት=2, ሶስት=3, አራት=4, አምስት=5, ስድስት=6, ሰባት=7, ስምንት=8, ዘጠኝ=9
አስር=10, ሃያ=20, ሰላሳ=30, አርባ=40, ሃምሳ=50, ስልሳ=60, ሰባ=70, ሰማንያ=80, ዘጠና=90
መቶ=100
ሺ=1000, ሺህ=1000, ሽህ=1000, ሽ=1000 (all mean thousand)
ሁለት ሺህ=2000, ሶስት ሺህ=3000, አምስት ሺህ=5000

ETHIOPIC NUMERALS:
፩=1,፪=2,፫=3,፬=4,፭=5,፮=6,፯=7,፰=8,፱=9
፲=10,፳=20,፴=30,፵=40,፶=50,፷=60,፸=70,፹=80,፺=90
፻=100,፪፻=200,፫፻=300,፬፻=400,፭፻=500,፮፻=600,፯፻=700,፰፻=800,፱፻=900

RULES:
- ሽህ/ሺህ/ሽ/ሺ = 1000, NEVER an item name
- ፪፻=200 NOT 2000
- No item mentioned → use "ሸቀጥ"
- No quantity → use 1
- Number near ብር = price

EXAMPLES:
"አንድ ሽህ ብር" → {"item":"ሸቀጥ","quantity":1,"price":1000,"total":1000}
"ዛሬ 3 ቀሚስ በ 1500 ብር ሸጥኩ" → {"item":"ቀሚስ","quantity":3,"price":1500,"total":4500}
"ሶስት መቶ ብር ሸጥኩ" → {"item":"ሸቀጥ","quantity":1,"price":300,"total":300}
"ሁለት ሽህ ብር" → {"item":"ሸቀጥ","quantity":1,"price":2000,"total":2000}
"500 birr 2 scarves" → {"item":"scarves","quantity":2,"price":500,"total":1000}

Statement: "${text}"
Return ONLY JSON:`;

  try {
    const res = await fetch(GROQ_URL, {
      method: 'POST',
      mode: 'cors',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
        max_tokens: 150
      })
    });

    if (!res.ok) throw new Error('Groq ' + res.status);

    const data = await res.json();
    const raw = data.choices[0].message.content.trim();
    console.log('🤖 Groq raw:', raw);

    const cleaned = raw.replace(/```json/gi, '').replace(/```/g, '').trim();
    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (e) {
      const match = cleaned.match(/\{.*\}/s);
      if (match) parsed = JSON.parse(match[0]);
      else throw new Error('No JSON found');
    }

    console.log('✅ Parsed:', parsed);
    document.getElementById('ai-thinking').style.display = 'none';

    if (parsed.price && parsed.price > 0) {
      parsed.quantity = parsed.quantity || 1;
      parsed.item = parsed.item || 'ሸቀጥ';
      parsed.total = parsed.total || (parsed.quantity * parsed.price);
      saveTransaction(text, parsed);
    } else {
      showStatus('ዋጋ አልተሰማም። ዋጋ ጨምረው ይናገሩ።', 'error');
    }

  } catch (err) {
    document.getElementById('ai-thinking').style.display = 'none';
    console.error('❌ Extract error:', err);
    saveRawTransaction(text);
    showStatus('ስህተት። Saved as pending.', 'error');
  }
}

// ── SAVE ──────────────────────────────────────────────────
function saveTransaction(originalText, parsed) {
  const t = {
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
  transactions.unshift(t);
  localStorage.setItem('hv_transactions', JSON.stringify(transactions));
  console.log('💾 Saved:', t);
  showStatus(`✓ ተመዝግቧል: ${parsed.quantity} ${parsed.item} = ${parsed.total.toLocaleString()} ብር`, 'success');
  renderLedger();
  renderSummary();
  clearInput();
}

function saveRawTransaction(text) {
  const t = {
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
  transactions.unshift(t);
  localStorage.setItem('hv_transactions', JSON.stringify(transactions));
  renderLedger();
}

// ── RENDER ────────────────────────────────────────────────
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

function setMicState(state) {
  const btn = document.getElementById('mic-btn');
  const btnText = document.getElementById('mic-btn-text');
  btn.className = 'mic-btn ' + state;
  btnText.textContent = state === 'recording' ? 'ለማቆም ይጫኑ' : 'ተናገሩ';
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
