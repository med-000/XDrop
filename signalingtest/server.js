// server.js（差し替え）
const express = require('express');
const path = require('path');

const app = express();
app.use(express.json({ limit: '1mb' }));

// token -> { offer, answer, at }
const store = new Map();
const TTL_MS = 10 * 60 * 1000; // 10分

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of store) if (now - v.at > TTL_MS) store.delete(k);
}, 60 * 1000);

// === ここを“数字だけ”に変更（6桁）===
const TOKEN_LEN = 6;
function newNumericToken() {
  // 100000–999999
  return String(Math.floor(10 ** (TOKEN_LEN - 1) + Math.random() * 9 * 10 ** (TOKEN_LEN - 1)));
}

// 静的配信（React/SPAでもこのままでOK）
app.use(express.static(path.join(__dirname, 'public')));

// 発行
app.post('/api/session', (_req, res) => {
  let token;
  do {
    token = newNumericToken();
  } while (store.has(token)); // まれな衝突を回避
  store.set(token, { offer: null, answer: null, at: Date.now() });
  res.json({ token });
});

// Offer 置く/取る
app.post('/api/offer', (req, res) => {
  const { token, sdp } = req.body || {};
  const slot = store.get(token);
  if (!slot) return res.status(404).json({ error: 'no session' });
  if (slot.offer && slot.answer) return res.status(409).json({ error: 'already used' });
  slot.offer = sdp; slot.at = Date.now();
  res.json({ ok: true });
});
app.get('/api/offer', (req, res) => {
  const { token } = req.query;
  const slot = store.get(token);
  if (!slot) return res.status(404).json({ error: 'no session' });
  if (!slot.offer) return res.status(204).end();
  res.json({ sdp: slot.offer });
});

// Answer 置く/取る
app.post('/api/answer', (req, res) => {
  const { token, sdp } = req.body || {};
  const slot = store.get(token);
  if (!slot) return res.status(404).json({ error: 'no session' });
  slot.answer = sdp; slot.at = Date.now();
  res.json({ ok: true });
});
app.get('/api/answer', (req, res) => {
  const { token } = req.query;
  const slot = store.get(token);
  if (!slot) return res.status(404).json({ error: 'no session' });
  if (!slot.answer) return res.status(204).end();
  res.json({ sdp: slot.answer });
});

const PORT = process.env.PORT || 9001;
app.listen(PORT, () => console.log(`Signaling on http://localhost:${PORT}`));
