// server.js
const express = require('express');
const path = require('path');

const app = express();
app.use(express.json({ limit: '1mb' }));

// ===== 静的ファイル（public/）配信：絶対パスで固定してログに出す =====
const PUBLIC_DIR = path.join(__dirname, 'public');
console.log('[static dir]', PUBLIC_DIR);
app.use(express.static(PUBLIC_DIR));

// ====== メモリ内ストア（token -> { offer, answer, at }）======
const store = new Map();
const TTL_MS = 10 * 60 * 1000; // 10分で掃除
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of store) {
    if (now - v.at > TTL_MS) store.delete(k);
  }
}, 60 * 1000);

const newToken = () => Math.random().toString(36).slice(2, 8);

// 1) セッション発行
app.post('/api/session', (_req, res) => {
  const token = newToken();
  store.set(token, { offer: null, answer: null, at: Date.now() });
  res.json({ token });
});

// 2) Offer 置く/取る（非トリクルICE）
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
  if (!slot) return res.status(404).json({ error: 'no session' }); // セッション自体無し
  if (!slot.offer) return res.status(204).end();                    // まだ置かれていない（正常）
  res.json({ sdp: slot.offer });
});

// 3) Answer 置く/取る
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

// デバッグ（任意）
app.get('/api/debug', (req, res) => {
  const { token } = req.query;
  const slot = store.get(token);
  if (!slot) return res.status(404).json({ error: 'no session' });
  res.json({ hasOffer: !!slot.offer, hasAnswer: !!slot.answer, updatedAt: slot.at });
});

const PORT = process.env.PORT || 9001;
app.listen(PORT, () => console.log(`Signaling on http://localhost:${PORT}`));
