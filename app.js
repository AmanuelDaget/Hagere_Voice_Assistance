// ─── CONFIG ─────────────────────────────────────────────── 
const GROQ_API_KEY = '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';
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

// ─── STATE ────────────────────────────────────────────────
let isRecording = false;
let recognition = null;
let transactions = JSON.parse(localStorage.getItem('hv_transactions') || '[]');

// ─── SPEECH RECOGNITION SETUP ─────────────────────────────
function setupSpeechRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!SpeechRecognition) {
    showStatus('የድምጽ ማወቂያ አይደገፍም። Chrome ይጠቀሙ።', 'error');
    // "Speech recognition not supported. Use Chrome."
    return null;
  }

  const rec = new SpeechRecognition();
  rec.lang = 'am-ET';
  rec.continuous = false;
  rec.interimResults = true;
  rec.maxAlternatives = 3;

  rec.onstart = () => {
    showStatus('እያዳመጥኩ ነው...', 'listening');
    // "I am listening..."
    setMicState('recording');
  };

  rec.onresult = (event) => {
    let interimText = '';
    let finalText = '';

    for (let i = event.resultIndex; i < event.results.length; i++) {
      const transcript = event.results[i][0].transcript;
      if (event.results[i].isFinal) {
        finalText += transcript;
      } else {
        interimText += transcript;
      }
    }

    // Show live transcription
    document.getElementById('transcription').textContent =
      finalText || interimText;

    if (finalText) {
      document.getElementById('transcription').dataset.final = finalText;
    }
  };

  rec.onend = () => {
    setMicState('idle');
    const finalText = document.getElementById('transcription').dataset.final;
    if (finalText) {
      extractTransaction(finalText);
    } else {
      showStatus('ምንም አልተሰማም። እንደገና ይሞክሩ።', 'error');
      // "Nothing heard. Please try again."
    }
  };

  rec.onerror = (event) => {
    setMicState('idle');
    if (event.error === 'not-allowed') {
      showStatus('ማይክሮፎን ፈቃድ ያስፈልጋል!', 'error');
      // "Microphone permission required!"
    } else if (event.error === 'language-not-supported') {
      // Fallback: try without language tag
      rec.lang = '';
      showStatus('አማርኛ እየሞከርኩ ነው...', 'info');
    } else {
      showStatus('ስህተት: ' + event.error, 'error');
    }
  };

  return rec;
}

// ─── GROQ AI EXTRACTION ───────────────────────────────────
async function extractTransaction(amharicText) {
  showStatus('እየተነተነ ነው...', 'processing');
  // "Processing..."
  document.getElementById('ai-thinking').style.display = 'block';

  const prompt = `You are a business data extractor for Ethiopian artisans.
Extract transaction data from this Amharic sales statement.

Rules:
- item: the product sold (keep in Amharic script)
- quantity: number sold (integer)
- price: price per item in Birr (number)
- total: quantity × price (number)
- If any field is missing or unclear, set it to null
- Return ONLY valid JSON, no explanation, no markdown

Amharic statement: "${amharicText}"

Example input: "ዛሬ 3 ቀሚስ በ 1500 ብር ሸጥኩ"
Example output: {"item":"ቀሚስ","quantity":3,"price":1500,"total":4500}

JSON output:`;

  try {
    const response = await fetch(GROQ_URL, {
      method: 'POST',
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

    if (!response.ok) throw new Error('Groq API error: ' + response.status);

    const data = await response.json();
    const raw = data.choices[0].message.content.trim();

    // Clean any accidental markdown
    const cleaned = raw.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(cleaned);

    document.getElementById('ai-thinking').style.display = 'none';

    if (parsed.item && parsed.quantity && parsed.price) {
      saveTransaction(amharicText, parsed);
    } else {
      showStatus('ሙሉ መረጃ አልተገኘም። እንደገና ይሞክሩ።', 'error');
      // "Complete data not found. Please try again."
    }

  } catch (err) {
    document.getElementById('ai-thinking').style.display = 'none';
    console.error(err);
    showStatus('ኢንተርኔት አልተገናኘም። ውሂቡ ተቀምጧል።', 'error');
    // Offline fallback — save raw text for later
    saveRawTransaction(amharicText);
  }
}

// ─── SAVE TRANSACTION ─────────────────────────────────────
function saveTransaction(originalText, parsed) {
  const transaction = {
    id: Date.now(),
    timestamp: new Date().toISOString(),
    date: new Date().toLocaleDateString('am-ET'),
    original: originalText,
    item: parsed.item,
    quantity: parsed.quantity,
    price: parsed.price,
    total: parsed.total || (parsed.quantity * parsed.price),
    status: 'confirmed'
  };

  transactions.unshift(transaction);
  localStorage.setItem('hv_transactions', JSON.stringify(transactions));

  showStatus(`✓ ተመዝግቧል: ${parsed.quantity} ${parsed.item} = ${transaction.total} ብር`, 'success');
  // "Recorded: [qty] [item] = [total] Birr"

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

// ─── RENDER LEDGER ────────────────────────────────────────
function renderLedger() {
  const container = document.getElementById('ledger-list');
  if (transactions.length === 0) {
    container.innerHTML = '<p class="empty-msg">እስካሁን ምንም ሽያጭ የለም።</p>';
    // "No sales yet."
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

// ─── RENDER SUMMARY ───────────────────────────────────────
function renderSummary() {
  const today = new Date().toDateString();
  const todayTx = transactions.filter(t =>
    new Date(t.timestamp).toDateString() === today && t.status === 'confirmed'
  );

  const todayTotal = todayTx.reduce((sum, t) => sum + (t.total || 0), 0);
  const todayCount = todayTx.length;

  // Weekly
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const weekTx = transactions.filter(t =>
    new Date(t.timestamp) > weekAgo && t.status === 'confirmed'
  );
  const weekTotal = weekTx.reduce((sum, t) => sum + (t.total || 0), 0);

  document.getElementById('today-total').textContent =
    todayTotal.toLocaleString() + ' ብር';
  document.getElementById('today-count').textContent =
    todayCount + ' ሽያጭ';
  document.getElementById('week-total').textContent =
    weekTotal.toLocaleString() + ' ብር';
}

// ─── UI HELPERS ───────────────────────────────────────────
function setMicState(state) {
  const btn = document.getElementById('mic-btn');
  const btnText = document.getElementById('mic-btn-text');

  btn.className = 'mic-btn ' + state;

  if (state === 'recording') {
    btnText.textContent = 'እያዳመጥኩ...';
    isRecording = true;
  } else {
    btnText.textContent = 'ተናገሩ';
    isRecording = false;
  }
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
  document.getElementById('transcription').textContent = '';
  document.getElementById('transcription').dataset.final = '';
}

function deleteAllData() {
  if (confirm('ሁሉንም ውሂብ ይሰርዙ?')) {
    // "Delete all data?"
    transactions = [];
    localStorage.removeItem('hv_transactions');
    renderLedger();
    renderSummary();
  }
}

// ─── MIC BUTTON HANDLER ───────────────────────────────────
function handleMicPress() {
  if (isRecording) {
    recognition.stop();
    return;
  }

  clearInput();
  document.getElementById('status-msg').style.display = 'none';

  if (!recognition) {
    recognition = setupSpeechRecognition();
  }

  if (recognition) {
    try {
      recognition.start();
    } catch (e) {
      // If already started, stop and restart
      recognition.stop();
      setTimeout(() => recognition.start(), 300);
    }
  }
}

// ─── INIT ─────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Register service worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(console.error);
  }

  // Setup speech recognition
  recognition = setupSpeechRecognition();

  // Mic button
document.getElementById('mic-btn').addEventListener('click', async () => {
  // Explicitly request permission first
  try {
    await navigator.mediaDevices.getUserMedia({ audio: true });
    handleMicPress();
  } catch (err) {
    showStatus('ማይክሮፎን ፈቃድ ያስፈልጋል! Microphone permission denied.', 'error');
  }
});

  // Delete button
  document.getElementById('delete-btn').addEventListener('click', deleteAllData);

  // Initial render
  renderLedger();
  renderSummary();
});
