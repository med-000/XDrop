// public/app.js
window.addEventListener('DOMContentLoaded', () => {
  // ========= UI refs =========
  const logEl     = document.getElementById('log');
  const statusEl  = document.getElementById('status');
  const tokenEl   = document.getElementById('token');
  const btnNew    = document.getElementById('btnNew');
  const btnJoin   = document.getElementById('btnJoinRecv');
  const btnStart  = document.getElementById('btnStartOffer');
  const btnSend   = document.getElementById('btnSend');
  const btnReset  = document.getElementById('btnReset');
  const fileInp   = document.getElementById('file');
  const progSend  = document.getElementById('progSend');
  const progRecv  = document.getElementById('progRecv');
  const recvName  = document.getElementById('recvName');
  const aDown     = document.getElementById('download');
  const btnShowQR = document.getElementById('btnShowQR');
  const qrContainer = document.getElementById('qr');
  const qrModeEls = document.querySelectorAll('input[name="qrmode"]'); // unified / url

  // ========= logger =========
  const log = (...a)=>{ logEl.textContent += a.join(' ') + '\n'; logEl.scrollTop = logEl.scrollHeight; };
  window.addEventListener('error', e => log('[ERROR]', e.message));
  window.addEventListener('unhandledrejection', e => log('[REJECT]', e.reason?.message || e.reason));
  log('[init] app.js loaded & DOM ready');

  // ========= global state =========
  let pc = null, dc = null, connected = false;

  // ========= helpers =========
  function createPC() {
    const _pc = new RTCPeerConnection({
      // 同一LANだけなら [] でもOK。外も繋ぐなら STUN を残す
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });
    _pc.addEventListener('iceconnectionstatechange', ()=> log('iceConnectionState:', _pc.iceConnectionState));
    _pc.addEventListener('icegatheringstatechange', ()=> log('iceGatheringState:', _pc.iceGatheringState));
    return _pc;
  }

  function waitIceComplete(_pc) {
    if (_pc.iceGatheringState === 'complete') return Promise.resolve();
    return new Promise(res => {
      const h = () => {
        if (_pc.iceGatheringState === 'complete') {
          _pc.removeEventListener('icegatheringstatechange', h);
          res();
        }
      };
      _pc.addEventListener('icegatheringstatechange', h);
    });
  }

  const sleep = (ms)=> new Promise(r=>setTimeout(r,ms));

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

  // ======= QR（qrcodejs）=======
  function loadScript(url, timeoutMs = 4000) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      let done = false;
      const t = setTimeout(() => { if (!done) { done = true; s.remove(); reject(new Error('timeout ' + url)); } }, timeoutMs);
      s.src = url; s.defer = true;
      s.onload = () => { if (!done) { done = true; clearTimeout(t); resolve(); } };
      s.onerror = () => { if (!done) { done = true; clearTimeout(t); reject(new Error('load error ' + url)); } };
      document.head.appendChild(s);
    });
  }

  async function ensureQRCode() {
    if (window.QRCode) return;
    try { await loadScript('/vendor/qrcode.min.js'); } catch {}
    if (!window.QRCode) {
      try { await loadScript('https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js'); } catch {}
    }
    if (!window.QRCode) throw new ReferenceError('QRCode is not available');
  }

  function b64url(s){
    return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  }

  let qrWidget = null;
  function ensureQRWidget() {
    if (!qrWidget) {
      qrWidget = new QRCode(qrContainer, {
        width: 256,
        height: 256,
        correctLevel: QRCode.CorrectLevel.M
      });
    } else {
      qrWidget.clear();
    }
    return qrWidget;
  }

  async function drawUnifiedQR(token){
    await ensureQRCode();
    const payload = { v:1, o:location.origin, t:token, r:'join', a:1 };
    const enc = b64url(JSON.stringify(payload));
    const url = `${location.origin}/#qr=${enc}`;
    ensureQRWidget().makeCode(url);
    log('[qr] unified QR rendered');
  }

  async function drawURLQR(token){
    await ensureQRCode();
    const url = `${location.origin}/?t=${encodeURIComponent(token)}&role=join&auto=1`;
    ensureQRWidget().makeCode(url);
    log('[qr] URL QR rendered');
  }

  // ========= DataChannel wiring =========
  function wireSendChannel(ch, role) {
    ch.binaryType = 'arraybuffer';
    ch.onopen  = () => { log(`[${role}] DataChannel open`); dc = ch; btnSend.disabled = false; connected = true; };
    ch.onclose = () => { log(`[${role}] DC close`); if (dc===ch) { dc=null; btnSend.disabled = true; connected = false; } };
  }

  function wireRecvChannel(ch) {
    ch.binaryType = 'arraybuffer';
    let expected=0, received=0, chunks=[];
    progRecv.hidden = true; progRecv.value = 0;

    ch.onmessage = async (e)=>{
      if (typeof e.data === 'string') {
        if (e.data.startsWith('META:')) {
          const m = JSON.parse(e.data.slice(5));
          expected = (m.size|0); received = 0; chunks = [];
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
          log('[receiver] receive done');
          return;
        }
      }
      let bufU8;
      if (e.data instanceof ArrayBuffer) {
        bufU8 = new Uint8Array(e.data);
      } else if (e.data && typeof e.data.arrayBuffer === 'function') {
        bufU8 = new Uint8Array(await e.data.arrayBuffer());
      } else {
        // 予期しない型は無視
        return;
      }
      chunks.push(bufU8);
      received += bufU8.byteLength;
      progRecv.value = received;
    };
  }

  function resetPeer() {
    try { dc?.close(); } catch {}
    try { pc?.close(); } catch {}
    pc = null; dc = null; connected = false;

    btnSend.disabled = true;
    btnStart.disabled = false;
    btnJoin.disabled  = false;

    progSend.hidden = true; progSend.value = 0;
    progRecv.hidden = true; progRecv.value = 0;
    recvName.textContent = '—';
    aDown.style.display = 'none'; aDown.href = '#';
    log('[ui] reset');
  }

  // ========= initial UI state =========
  btnSend.disabled = true;

  // ========= UI handlers =========
  // 新規セッション（短い token を発行）
  btnNew.addEventListener('click', async () => {
    const { token } = await api('/api/session', { method:'POST' });
    tokenEl.value = token;
    statusEl.textContent = `token: ${token}`;
    log('[session] created', token);
    await drawUnifiedQR(token); // ついでに表示
  });

  // Show QR
  btnShowQR.addEventListener('click', async ()=>{
    const token = tokenEl.value.trim();
    if (!token) return alert('先に Create Session で token を作るか、token を入力してください');
    const mode = [...qrModeEls].find(el => el.checked)?.value;
    (mode === 'url' ? drawURLQR : drawUnifiedQR)(token);
  });

  // 送信側（Offerer）
  btnStart.addEventListener('click', async () => {
    if (connected || pc) { log('[sender] already running; Reset first'); return; }
    const token = tokenEl.value.trim();
    if (!token) return alert('token を入れてください');
    btnStart.disabled = true;

    pc = createPC();

    // 送信側がDataChannelを作る → 送受の両配線
    const ch = pc.createDataChannel('file');
    wireSendChannel(ch, 'sender');
    wireRecvChannel(ch); // 双方向OK

    // 非トリクル：ICE 完了待ち → SDPを一括送信
    const offer = await pc.createOffer({ offerToReceiveAudio:false, offerToReceiveVideo:false });
    await pc.setLocalDescription(offer);
    await waitIceComplete(pc);

    await api('/api/offer', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ token, sdp: pc.localDescription.sdp })
    });
    log('[sender] offer posted, waiting answer...');

    // Answer をポーリング取得
    let ans = null;
    while (!ans) {
      const json = await getJSONorNull(`/api/answer?token=${encodeURIComponent(token)}`);
      if (json) ans = json.sdp; else await sleep(800);
    }
    await pc.setRemoteDescription({ type:'answer', sdp: ans });
    log('[sender] answer applied');
  });

  // 受信側（Answerer）
  btnJoin.addEventListener('click', async () => {
    if (connected || pc) { log('[receiver] already running; Reset first'); return; }
    const token = tokenEl.value.trim();
    if (!token) return alert('token を入れてください');
    btnJoin.disabled = true;

    pc = createPC();

    // 相手が作ったDataChannelを受け取る → 送受の両配線
    pc.ondatachannel = (ev) => {
      const ch = ev.channel;
      wireSendChannel(ch, 'receiver'); // 受信側でも送信OK
      wireRecvChannel(ch);
    };

    // Offer を待つ → 適用 → Answer 生成 → ICE 完了待ち → 返送
    let offerSdp = null;
    while (!offerSdp) {
      const json = await getJSONorNull(`/api/offer?token=${encodeURIComponent(token)}`);
      if (json) offerSdp = json.sdp; else await sleep(800);
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
  });

  // ファイル送信（両側で使える）
  btnSend.addEventListener('click', async () => {
    if (!dc || dc.readyState !== 'open') return alert('DataChannel not open yet');
    const f = fileInp.files[0];
    if (!f) return alert('Choose a file');

    const chunk = 16 * 1024; // 16KB
    progSend.hidden = false; progSend.max = f.size || 1; progSend.value = 0;

    // メタ送信
    dc.send('META:'+JSON.stringify({ name: f.name, size: f.size }));
    dc.bufferedAmountLowThreshold = 1 << 20; // 1MB

    let offset = 0;
    while (offset < f.size) {
      const buf = await f.slice(offset, offset + chunk).arrayBuffer();

      // backpressure：送信バッファが減るまで待つ
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

  // Reset（やり直し用）
  btnReset.addEventListener('click', resetPeer);

  // === URL/ハッシュから自動Join/Start ===
  function ub64url(s){ s=s.replace(/-/g,'+').replace(/_/g,'/'); while(s.length%4) s+='='; return atob(s); }

  (function bootFromURL(){
    const qs = new URLSearchParams(location.search);
    const tQ = qs.get('t');          // ?t=...（URL版QR）

    const hs = new URLSearchParams(location.hash.slice(1));
    const qr = hs.get('qr');         // #qr=base64url(JSON)（統一QR）

    if (qr) {
      try {
        const obj = JSON.parse(ub64url(qr));
        if (obj.t) {
          tokenEl.value = obj.t;
          statusEl.textContent = `token: ${obj.t}`;
          log('[qr] token from hash JSON:', obj.t);
          if ((obj.a|0) === 1) {
            (obj.r === 'start' ? btnStart : btnJoin).click();
          }
          return; // ハッシュ優先
        }
      } catch(e) { log('[qr] parse error', e.message); }
    }

    // フォールバック：?t=... 形式
    const roleQ = qs.get('role');
    const autoQ = qs.get('auto');
    if (tQ) {
      tokenEl.value = tQ;
      statusEl.textContent = `token: ${tQ}`;
      log('[qr] token from query:', tQ);
      if (autoQ === '1') {
        (roleQ === 'start' ? btnStart : btnJoin).click();
      }
    }
  })();
});
