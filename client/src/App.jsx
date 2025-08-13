import React, { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode.react';

export default function App() {
  // ===== UI state =====
  const [token, setToken] = useState('');
  const [status, setStatus] = useState('');
  const [logs, setLogs] = useState([]);
  const [sendEnabled, setSendEnabled] = useState(false);
  const [qrMode, setQrMode] = useState('unified'); // 'unified' | 'url'
  const [qrValue, setQrValue] = useState('');
  const [recvName, setRecvName] = useState('—');
  const [sendProg, setSendProg] = useState({ hidden: true, max: 1, value: 0 });
  const [recvProg, setRecvProg] = useState({ hidden: true, max: 1, value: 0 });

  const fileRef = useRef(null);

  // ===== non-reactive refs =====
  const pcRef = useRef(null);
  const dcRef = useRef(null);
  const connectedRef = useRef(false);

  const log = (...a) => setLogs(x => [...x, a.join(' ')]);

  // ===== helpers =====
  const api = async (path, opts) => {
    const r = await fetch(path, opts);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  };
  const getJSONorNull = async (path) => {
    const r = await fetch(path);
    if (r.status === 204 || r.status === 404) return null;
    if (!r.ok) throw new Error(r.status);
    return r.json();
  };
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  function createPC() {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });
    pc.addEventListener('iceconnectionstatechange', () => log('iceConnectionState:', pc.iceConnectionState));
    pc.addEventListener('icegatheringstatechange', () => log('iceGatheringState:', pc.iceGatheringState));
    return pc;
  }
  function waitIceComplete(pc) {
    if (pc.iceGatheringState === 'complete') return Promise.resolve();
    return new Promise(res => {
      const h = () => {
        if (pc.iceGatheringState === 'complete') {
          pc.removeEventListener('icegatheringstatechange', h);
          res();
        }
      };
      pc.addEventListener('icegatheringstatechange', h);
    });
  }

  // ===== DataChannel wiring =====
  function wireSendChannel(ch, role) {
    ch.binaryType = 'arraybuffer';
    ch.onopen = () => {
      log(`[${role}] DataChannel open`);
      dcRef.current = ch; setSendEnabled(true); connectedRef.current = true;
    };
    ch.onclose = () => {
      log(`[${role}] DC close`);
      if (dcRef.current === ch) { dcRef.current = null; setSendEnabled(false); connectedRef.current = false; }
    };
  }
  function wireRecvChannel(ch) {
    ch.binaryType = 'arraybuffer';
    let expected=0, received=0, chunks=[];
    setRecvProg({ hidden: true, max: 1, value: 0 });

    ch.onmessage = async (e) => {
      if (typeof e.data === 'string') {
        if (e.data.startsWith('META:')) {
          const m = JSON.parse(e.data.slice(5));
          expected = (m.size|0); received = 0; chunks = [];
          setRecvName(m.name || 'received.bin');
          setRecvProg({ hidden: false, max: expected || 1, value: 0 });
          return;
        }
        if (e.data === 'EOF') {
          const blob = new Blob(chunks, {type:'application/octet-stream'});
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url; a.download = recvName || 'received.bin'; a.click();
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
        return;
      }
      chunks.push(bufU8);
      received += bufU8.byteLength;
      setRecvProg(p => ({ ...p, value: received }));
    };
  }

  // ===== actions =====
  const createSession = async () => {
    const { token } = await api('/api/session', { method: 'POST' });
    setToken(token);
    setStatus(`token: ${token}`);
    log('[session] created', token);
    setQrValue(buildUnifiedURL(token)); // 自動表示
  };

  const startSender = async () => {
    if (connectedRef.current || pcRef.current) { log('[sender] already running; Reset first'); return; }
    if (!token) { alert('token を入れてください'); return; }

    setSendEnabled(false);
    const pc = createPC(); pcRef.current = pc;

    const ch = pc.createDataChannel('file');
    wireSendChannel(ch, 'sender');
    wireRecvChannel(ch); // 双方向

    const offer = await pc.createOffer({ offerToReceiveAudio: false, offerToReceiveVideo: false });
    await pc.setLocalDescription(offer);
    await waitIceComplete(pc);

    await api('/api/offer', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ token, sdp: pc.localDescription.sdp })
    });
    log('[sender] offer posted, waiting answer...');

    let ans = null;
    while (!ans) {
      const json = await getJSONorNull(`/api/answer?token=${encodeURIComponent(token)}`);
      if (json) ans = json.sdp; else await sleep(800);
    }
    await pc.setRemoteDescription({ type:'answer', sdp: ans });
    log('[sender] answer applied');
  };

  const joinReceiver = async () => {
    if (connectedRef.current || pcRef.current) { log('[receiver] already running; Reset first'); return; }
    if (!token) { alert('token を入れてください'); return; }

    const pc = createPC(); pcRef.current = pc;

    pc.ondatachannel = (ev) => {
      const ch = ev.channel;
      wireSendChannel(ch, 'receiver');
      wireRecvChannel(ch);
    };

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
  };

  const sendFile = async () => {
    const dc = dcRef.current;
    if (!dc || dc.readyState !== 'open') { alert('DataChannel not open yet'); return; }
    const f = fileRef.current?.files?.[0];
    if (!f) { alert('Choose a file'); return; }

    const chunk = 16 * 1024;
    setSendProg({ hidden: false, max: f.size || 1, value: 0 });

    dc.send('META:' + JSON.stringify({ name: f.name, size: f.size }));
    dc.bufferedAmountLowThreshold = 1 << 20; // 1MB

    let offset = 0;
    while (offset < f.size) {
      const buf = await f.slice(offset, offset + chunk).arrayBuffer();
      while (dc.bufferedAmount > dc.bufferedAmountLowThreshold) {
        await new Promise(r => { dc.onbufferedamountlow = r; });
      }
      dc.send(buf);
      offset += buf.byteLength;
      setSendProg(p => ({ ...p, value: offset }));
    }
    dc.send('EOF');
    log('[send] done');
  };

  const reset = () => {
    try { dcRef.current?.close(); } catch {}
    try { pcRef.current?.close(); } catch {}
    dcRef.current = null; pcRef.current = null; connectedRef.current = false;
    setSendEnabled(false);
    setRecvName('—');
    setSendProg({ hidden: true, max: 1, value: 0 });
    setRecvProg({ hidden: true, max: 1, value: 0 });
    log('[ui] reset');
  };

  // ===== QR =====
  const b64url = (s) => btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  const ub64url = (s) => {
    s = s.replace(/-/g,'+').replace(/_/g,'/'); while(s.length%4) s+='=';
    return atob(s);
  };
  const buildUnifiedURL = (tok) => {
    const payload = { v:1, o:location.origin, t:tok, r:'join', a:1 };
    const enc = b64url(JSON.stringify(payload));
    return `${location.origin}/#qr=${enc}`;
  };
  const buildURLOnly = (tok) =>
    `${location.origin}/?t=${encodeURIComponent(tok)}&role=join&auto=1`;

  const showQR = () => {
    if (!token) { alert('先に Create Session で token を作るか、token を入力してください'); return; }
    setQrValue(qrMode === 'url' ? buildURLOnly(token) : buildUnifiedURL(token));
  };

  // ===== boot from URL/hash =====
  useEffect(() => {
    const qs = new URLSearchParams(location.search);
    const hs = new URLSearchParams(location.hash.slice(1));
    const qr = hs.get('qr');
    const tQ = qs.get('t');

    if (qr) {
      try {
        const obj = JSON.parse(ub64url(qr));
        if (obj.t) {
          setToken(obj.t);
          setStatus(`token: ${obj.t}`);
          log('[qr] token from hash JSON:', obj.t);
          if ((obj.a|0) === 1) {
            (obj.r === 'start' ? startSender : joinReceiver)();
          }
          return;
        }
      } catch (e) { log('[qr] parse error', e.message); }
    }
    const roleQ = qs.get('role'); const autoQ = qs.get('auto');
    if (tQ) {
      setToken(tQ);
      setStatus(`token: ${tQ}`);
      log('[qr] token from query:', tQ);
      if (autoQ === '1') {
        (roleQ === 'start' ? startSender : joinReceiver)();
      }
    }
    // eslint-disable-next-line
  }, []);

  // ===== UI =====
  return (
    <div style={{fontFamily:'system-ui,-apple-system,Segoe UI,Roboto,sans-serif', maxWidth:900, margin:'24px auto', padding:'0 16px'}}>
      <h1>WebRTC DataChannel – React</h1>

      <fieldset>
        <legend>Session</legend>
        <button onClick={createSession}>Create Session</button>{' '}
        <input value={token} onChange={e=>setToken(e.target.value)} placeholder="token" style={{width:240,padding:6}}/>{' '}
        <button onClick={joinReceiver}>Join as Receiver</button>{' '}
        <button onClick={reset}>Reset</button>{' '}
        <span>{status}</span>
      </fieldset>

      <div style={{marginTop:10}}>
        <button onClick={showQR}>Show QR</button>
        <label style={{marginLeft:8}}>
          <input type="radio" name="qrmode" checked={qrMode==='unified'} onChange={()=>setQrMode('unified')} />
          {' '}Unified(JSON in URL)
        </label>
        <label style={{marginLeft:8}}>
          <input type="radio" name="qrmode" checked={qrMode==='url'} onChange={()=>setQrMode('url')} />
          {' '}URL only
        </label>
        <div style={{width:256,height:256,marginTop:6,display:'grid',placeItems:'center',border:'1px dashed #ccc',borderRadius:8}}>
          {qrValue && <QRCode value={qrValue} size={240} level="M" includeMargin={true} />}
        </div>
      </div>

      <fieldset>
        <legend>Sender / Receiver</legend>
        <button onClick={startSender}>Start as Sender</button>{' '}
        <input ref={fileRef} type="file"/>{' '}
        <button onClick={sendFile} disabled={!sendEnabled}>Send File</button>
        {!sendProg.hidden && <progress value={sendProg.value} max={sendProg.max} style={{width:'100%',display:'block',marginTop:8}}/>}
      </fieldset>

      <fieldset>
        <legend>Receiver</legend>
        <div>File: <b>{recvName}</b></div>
        {!recvProg.hidden && <progress value={recvProg.value} max={recvProg.max} style={{width:'100%'}}/>}
      </fieldset>

      <h3>Log</h3>
      <div style={{whiteSpace:'pre-wrap', background:'#fafafa', border:'1px solid #eee', borderRadius:8, padding:10, height:200, overflow:'auto'}}>
        {logs.join('\n')}
      </div>
    </div>
  );
}
