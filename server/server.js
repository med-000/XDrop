const express = require('express');
const path = require('path');

const app = express();
app.use(express.json({ limit: '1mb' }));

const PUBLIC_DIR = path.resolve(__dirname, '../client/dist');
console.log('[static dir]', PUBLIC_DIR);
app.use(express.static(PUBLIC_DIR));

const store = new Map();
const TTL_MS = 10 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of store) if (now - v.at > TTL_MS) store.delete(k);
}, 60 * 1000);

const TOKEN_LEN = 6;
function newNumericToken() {
  return String(
    Math.floor(10 ** (TOKEN_LEN - 1) + Math.random() * 9 * 10 ** (TOKEN_LEN - 1))
  );
}

app.post('/api/session', (_req, res) => {
  let token;
  do { token = newNumericToken(); } while (store.has(token));
  store.set(token, { offer: null, answer: null, at: Date.now() });
  res.json({ token });
});

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

app.get('/api/debug', (req, res) => {
  const { token } = req.query;
  const slot = store.get(token);
  if (!slot) return res.status(404).json({ error: 'no session' });
  res.json({ hasOffer: !!slot.offer, hasAnswer: !!slot.answer, updatedAt: slot.at });
});

app.get(/^\/(?!api\/).*/, (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

const PORT = process.env.PORT || 9001;
app.listen(PORT, () => console.log(`Signaling on http://localhost:${PORT}`));
