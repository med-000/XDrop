// public/app.js
window.addEventListener('DOMContentLoaded', () => {
  // ==== UI refs ====
  const logEl = document.getElementById('log');
  const statusEl = document.getElementById('status');
  const tokenEl = document.getElementById('token');
  const btnCreate = document.getElementById('btnCreate');
  const btnSend = document.getElementById('btnSend');
  const btnReset = document.getElementById('btnReset');
  const fileInp = document.getElementById('file');
  const progSend = document.getElementById('progSend');
  const progRecv = document.getElementById('progRecv');
  const recvName = document.getElementById('recvName');
  const aDown = document.getElementById('download');
  const myCode = document.getElementById('myCode');
  const qrBox = document.getElementById('qrBox');

  const log = (...a)=>{ logEl.textContent += a.join(' ') + '\n'; logEl.scrollTop = logEl.scrollHeight; };
  window.addEventListener('error', e => log('[ERROR]', e.message));
  window.addEventListener('unhandledrejection', e => log('[REJECT]', e.reason?.message || e.reason));

  let pc = null, dc = null, connected = false, currentToken = '';

  // ==== helpers ====
  const sleep = (ms)=> new Promise(r=>setTimeout(r,ms));
  const isDigits = (s)=> /^[0-9]{6}$/.test(s || '');

  async function api(path, opts) {
    const res = await fetch(path, opts);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }
  async function getJSONorNull(path) {
    const res = await fetch(path);
    if (res.status === 204 || res.status === 404) return null;
    if (!res.ok) throw new Error(res.status);
    return res.json();
  }

  function createPC() {
    const _pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    _pc.addEventListener('iceconnectionstatechange', ()=> log('iceConnectionState:', _pc.iceConnectionState));
    _pc.addEventListener('icegatheringstatechange', ()=> log('iceGatheringState:', _pc.iceGatheringState));
    return _pc;
  }
  function waitIceComplete(_pc) {
    if (_pc.iceGatheringState === 'complete') return Promise.resolve();
    return new Promise(res => {
      const h = () => { if (_pc.iceGatheringState === 'complete') { _pc.removeEventListener('icegatheringstatechange', h); res(); } };
      _pc.addEventListener('icegatheringstatechange', h);
    });
  }

  function wireSendChannel(ch, role) {
    ch.binaryType = 'arraybuffer';
    ch.onopen  = () => { log(`[${role}] DC open`);  dc = ch; btnSend.disabled = false; connected = true; statusEl.textContent = 'Connected'; };
    ch.onclose = () => { log(`[${role}] DC close`); if (dc===ch) { dc=null; btnSend.disabled = true; connected = false; statusEl.textContent = 'Disconnected'; } };
  }
  function wireRecvChannel(ch) {
    let expected=0, received=0, chunks=[];
    progRecv.hidden = true; progRecv.value = 0;
    ch.onmessage = (e)=>{
      if (typeof e.data === 'string') {
        if (e.data.startsWith('META:')) {
          const m = JSON.parse(e.data.slice(5));
          expected = m.size|0; received = 0; chunks = [];
          recvName.textContent = m.name || 'received.bin';
          progRecv.hidden = false; progRecv.max = expected || 1; progRecv.value = 0;
          return;
        }
        if (e.data === 'EOF') {
          const blob = new Blob(chunks, {type:'application/octet-stream'});
          aDown.href = URL.createObjectURL(blob);
          aDown.download = recvName.textContent || 'received.bin';
          aDown.style.display = 'inline-block';
          aDown.textContent = 'Download ' + aDown.download;
          log('[recv] done');
          return;
        }
      }
      const buf = new Uint8Array(e.data);
      chunks.push(buf);
      received += buf.byteLength;
      progRecv.value = received;
    };
  }

  function resetPeer() {
    try { dc?.close(); } catch {}
    try { pc?.close(); } catch {}
    pc = null; dc = null; connected = false;
    btnSend.disabled = true;
    progSend.hidden = true; progSend.value = 0;
    progRecv.hidden = true; progRecv.value = 0;
    recvName.textContent = '—';
    aDown.style.display = 'none'; aDown.href = '#';
    statusEl.textContent = '';
    log('[ui] reset');
  }

  // ==== QR ====
  function renderQRForJoin(token) {
    qrBox.innerHTML = '';
    if (!window.QRCode || !isDigits(token)) return;
    const url = `${location.origin}/?t=${token}&role=join&auto=1`;
    new QRCode(qrBox, { text: url, width: 196, height: 196 });
  }

  // ==== Offer / Answer フロー ====
  async function startOffer(token) {
    currentToken = token;
    pc = createPC();

    const ch = pc.createDataChannel('file');
    wireSendChannel(ch, 'sender');
    wireRecvChannel(ch);

    const offer = await pc.createOffer({ offerToReceiveAudio:false, offerToReceiveVideo:false });
    await pc.setLocalDescription(offer);
    await waitIceComplete(pc);

    await api('/api/offer', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ token, sdp: pc.localDescription.sdp })
    });
    log('[sender] offer posted; waiting answer…');
    statusEl.textContent = 'Waiting for partner…';

    let ans = null;
    while (!ans) {
      const json = await getJSONorNull(`/api/answer?token=${encodeURIComponent(token)}`);
      if (json) ans = json.sdp; else await sleep(800);
    }
    await pc.setRemoteDescription({ type:'answer', sdp: ans });
    log('[sender] answer applied');
  }

  async function joinWithToken(token) {
    currentToken = token;
    pc = createPC();

    pc.ondatachannel = (ev) => {
      const ch = ev.channel;
      wireSendChannel(ch, 'receiver');
      wireRecvChannel(ch);
    };

    let offerSdp = null;
    while (!offerSdp) {
      const json = await getJSONorNull(`/api/offer?token=${encodeURIComponent(token)}`);
      if (json) offerSdp = json.sdp; else await sleep(700);
    }
    await pc.setRemoteDescription({ type:'offer', sdp: offerSdp });

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await waitIceComplete(pc);

    await api('/api/answer', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ token, sdp: pc.localDescription.sdp })
    });
    log('[receiver] answer posted');
  }

  // ==== UI ====
  btnCreate.addEventListener('click', async () => {
    const { token } = await api('/api/session', { method:'POST' });
    myCode.textContent = token;
    tokenEl.value = token; // 保険
    renderQRForJoin(token);
    statusEl.textContent = `Code: ${token}`;
    log('[session] created', token);

    // 自動でOffer開始
    await startOffer(token);
  });

  // 6桁そろったら自動Join
  let joinTimer = null;
  tokenEl.addEventListener('input', () => {
    const t = tokenEl.value.replace(/\D/g,'').slice(0,6);
    if (t !== tokenEl.value) tokenEl.value = t;
    if (isDigits(t)) {
      clearTimeout(joinTimer);
      joinTimer = setTimeout(() => joinWithToken(t), 200); // 小さなデバウンス
      statusEl.textContent = 'Joining…';
    }
  });

  // ファイル送信（両側OK）
  btnSend.addEventListener('click', async () => {
    if (!dc || dc.readyState !== 'open') return alert('Not connected yet');
    const f = fileInp.files[0];
    if (!f) return alert('Choose a file');

    const chunk = 64 * 1024; // 64KB（上げ気味）
    progSend.hidden = false; progSend.max = f.size || 1; progSend.value = 0;

    dc.send('META:'+JSON.stringify({ name: f.name, size: f.size }));
    dc.bufferedAmountLowThreshold = 1 << 20; // 1MB

    let offset = 0;
    while (offset < f.size) {
      const buf = await f.slice(offset, offset + chunk).arrayBuffer();
      while (dc.bufferedAmount > dc.bufferedAmountLowThreshold) {
        await new Promise(r => { dc.onbufferedamountlow = r; });
      }
      dc.send(buf);
      offset += buf.byteLength;
      progSend.value = offset;
    }
    dc.send('EOF');
    log('[send] done');
  });

  btnReset.addEventListener('click', resetPeer);

  // ==== URLからの自動接続（QRで ?t=123456&role=join&auto=1） ====
  (function bootFromURL(){
    const qs = new URLSearchParams(location.search);
    const t = qs.get('t'); const role = qs.get('role'); const auto = qs.get('auto');
    if (isDigits(t)) {
      tokenEl.value = t;
      statusEl.textContent = `Code: ${t}`;
      if (role === 'join' && auto === '1') {
        joinWithToken(t);
      }
    }
  })();

  log('[init] ready');
});
