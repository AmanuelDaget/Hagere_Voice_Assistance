const GROQ_API_KEY = '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';
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_WHISPER_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';

let isRecording = false;
let mediaRecorder = null;
let audioChunks = [];
let transactions = JSON.parse(localStorage.getItem('hv_transactions') || '[]');

// ── INIT ──────────────────────────────────────────────────
window.addEventListener('load', () => {
  console.log('✅ Hagere Voice v4.0 — cross-platform Whisper');

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

// ── MIC CLICK ─────────────────────────────────────────────
async function handleMicClick() {
  if (isRecording) {
    stopRecording();
    return;
  }
  await startRecording();
}

// ── START RECORDING ───────────────────────────────────────
async function startRecording() {
  console.log('🎤 Requesting mic...');
  clearInput();

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        sampleRate: 16000,
        echoCancellation: true,
        noiseSuppression: true
      }
    });

    console.log('✅ Mic granted');
    audioChunks = [];

    // Pick best supported format
    const mimeType = getSupportedMimeType();
    console.log('🎵 Using format:', mimeType);

    mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});

    mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        audioChunks.push(e.data);
      }
    };

    mediaRecorder.onstop = async () => {
      console.log('⏹ Recording stopped, chunks:', audioChunks.length);
      stream.getTracks().forEach(t => t.stop());

      if (audioChunks.length === 0) {
        showStatus('ምንም አልተሰማም። እንደገና ይሞክሩ።', 'error');
        return;
      }

      const audioBlob = new Blob(audioChunks, {
        type: mimeType || 'audio/webm'
      });
      console.log('🎵 Audio blob size:', audioBlob.size, 'bytes');

      if (audioBlob.size < 1000) {
        showStatus('ድምጽ በጣም አጭር ነው። ረዘም ብለው ይናገሩ።', 'error');
        return;
      }

      await transcribeWithWhisper(audioBlob, mimeType);
    };

    mediaRecorder.start(100); // collect every 100ms
    isRecording = true;
    setMicState('recording');
    showStatus('እያዳመጥኩ ነው... (ለማቆም እንደገና ይጫኑ)', 'listening');
    console.log('🎙 Recording started');

  } catch (err) {
    console.error('❌ Mic error:', err);
    if (err.name === 'NotAllowedError') {
      showStatus('ማይክሮፎን ፈቃድ ያስፈልጋል! Allow microphone.', 'error');
    } else if (err.name === 'NotFoundError') {
      showStatus('ማይክሮፎን አልተገኘም።', 'error');
    } else {
      showStatus('Mic error: ' + err.message, 'error');
    }
  }
}

// ── STOP RECORDING ────────────────────────────────────────
function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    console.log('⏹ Stopping recording...');
    mediaRecorder.stop();
    isRecording = false;
    setMicState('idle');
    showStatus('እየተነተነ ነው...', 'processing');
  }
}

// ── GET SUPPORTED AUDIO FORMAT ────────────────────────────
function getSupportedMimeType() {
  const types = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/ogg',
    'audio/mp4',
  ];
  for (const type of types) {
    if (MediaRecorder.isTypeSupported(type)) {
      return type;
    }
  }
  return null; // browser default
}

// ── WHISPER TRANSCRIPTION ─────────────────────────────────
async function transcribeWithWhisper(audioBlob, mimeType) {
  console.log('📡 Sending to Whisper...');
  showStatus('ድምጽ እየተነተነ ነው...', 'processing');
  document.getElementById('ai-thinking').style.display = 'flex';

  // Determine file extension
  const ext = mimeType && mimeType.includes('ogg') ? 'ogg'
    : mimeType && mimeType.includes('mp4') ? 'mp4'
    : 'webm';

  const formData = new FormData();
  formData.append('file', audioBlob, `audio.${ext}`);
  formData.append('model', 'whisper-large-v3');
  formData.append('language', 'am'); // Amharic
  formData.append('response_format', 'json');

  try {
    const res = await fetch(GROQ_WHISPER_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`
        // NO Content-Type here — browser sets it with boundary for FormData
      },
      body: formData
    });

    console.log('📡 Whisper status:', res.status);

    if (!res.ok) {
      const err = await res.json();
      console.error('❌ Whisper error:', JSON.stringify(err));
      throw new Error('Whisper ' + res.status + ': ' + JSON.stringify(err));
    }

    const data = await res.json();
    const transcript = data.text && data.text.trim();
    console.log('📝 Whisper transcript:', transcript);

    document.getElementById('transcription').textContent = transcript;

    if (!transcript || transcript.length === 0) {
      document.getElementById('ai-thinking').style.display = 'none';
      showStatus('ምንም አልተሰማም። እንደገና ይሞክሩ።', 'error');
      return;
    }

    await extractTransaction(transcript);

  } catch (err) {
    document.getElementById('ai-thinking').style.display = 'none';
    console.error('❌ Whisper failed:', err);
    showStatus('Whisper error. Check console.', 'error');
  }
}

// ── GROQ EXTRACTION ───────────────────────────────────────
async function extractTransaction(text) {
  console.log('🤖 Extracting from:', text);

  const prompt = `You are a sales data extractor for Ethiopian artisans in Gondar.
Extract data from a sales statement. Language may be Amharic, English, or mixed.

AMHARIC NUMBER CONVERSION (mandatory):
አንድ=1, ሁለት=2, ሶስት=3, አራት=4, አምስት=5, ስድስት=6, ሰባት=7, ስምንት=8, ዘጠኝ=9
አስር=10, ሃያ=20, ሰላሳ=30, አርባ=40, ሃምሳ=50, ስልሳ=60, ሰባ=70, ሰማንያ=80, ዘጠና=90
መቶ=100
ሺ=1000, ሺህ=1000, ሽህ=1000, ሽ=1000 (all spellings of thousand = 1000)
ሁለት ሺህ=2000, ሶስት ሺህ=3000, አምስት ሺህ=5000, አስር ሺህ=10000

ETHIOPIC NUMERAL CONVERSION:
፩=1, ፪=2, ፫=3, ፬=4, ፭=5, ፮=6, ፯=7, ፰=8, ፱=9
፲=10, ፳=20, ፴=30, ፵=40, ፶=50, ፷=60, ፸=70, ፹=80, ፺=90
፻=100, ፪፻=200, ፫፻=300, ፬፻=400, ፭፻=500, ፮፻=600, ፯፻=700, ፰፻=800, ፱፻=900
፼=10000

CRITICAL RULES:
- ሽህ, ሺህ, ሽ, ሺ all mean 1000 — NEVER treat as item name
- ፪፻ = 200 NOT 2000
- If no item mentioned use "ሸቀጥ"
- If no quantity mentioned use 1
- Number before or after ብር is the price
- ALWAYS return JSON even if guessing

EXAMPLES:
"አንድ ሽህ ብር" → {"item":"ሸቀጥ","quantity":1,"price":1000,"total":1000}
"ዛሬ ሶስት መቶ ብር ሸጥኩ" → {"item":"ሸቀጥ","quantity":1,"price":300,"total":300}
"ዛሬ 3 ቀሚስ በ 1500 ብር ሸጥኩ" → {"item":"ቀሚስ","quantity":3,"price":1500,"total":4500}
"ሁለት ሽህ ብር ሸጥኩ" → {"item":"ሸቀጥ","quantity":1,"price":2000,"total":2000}
"አንድ ሽህ አምስት መቶ ብር" → {"item":"ሸቀጥ","quantity":1,"price":1500,"total":1500}
"፪፻ ብር" → {"item":"ሸቀጥ","quantity":1,"price":200,"total":200}
"sold 2 scarves 800 birr each" → {"item":"scarves","quantity":2,"price":800,"total":1600}

Statement: "${text}"

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

    if (!res.ok) {
      const err = await res.json();
      console.error('❌ Groq error:', JSON.stringify(err));
      throw new Error('Groq ' + res.status);
    }

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
      else throw new Error('No JSON in: ' + cleaned);
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
    showStatus('ስህተት። Saved as pending.', 'error');
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
