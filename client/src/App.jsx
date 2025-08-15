// src/App.jsx（テキスト/URL送受信対応 版）
// 依存: react, react-router-dom, qrcode.react
//   npm i react-router-dom qrcode.react
import React, {
  useEffect, useMemo, useRef, useState,
  createContext, useContext
} from 'react';
import {
  BrowserRouter, Routes, Route,
  useNavigate, useLocation, Link,
  useParams, Navigate
} from 'react-router-dom';
import QRCode from 'qrcode.react';

/* ========== ユーティリティ ========== */
const TOKEN_RE = /^\d{6}$/;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function api(path, opts) {
  const r = await fetch(path, opts);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
async function getJSONorNull(path) {
  const r = await fetch(path);
  if (r.status === 204 || r.status === 404) return null;
  if (!r.ok) throw new Error(r.status);
  return r.json();
}
function formatBytes(n) {
  if (!Number.isFinite(n)) return '-';
  const u = ['B','KB','MB','GB','TB'];
  let i=0, x=n;
  while (x>=1024 && i<u.length-1) { x/=1024; i++; }
  return `${x.toFixed(x<10 && i>0?1:0)} ${u[i]}`;
}
function safeFilename(name, fallback='received.bin') {
  const t = (name||'').trim();
  if (!t || t === '-') return fallback;
  return t.replace(/[\\/:*?"<>|\u0000-\u001F]/g, '_');
}
function b64url(s){return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
function ub64url(s){s=s.replace(/-/g,'+').replace(/_/g,'/');while(s.length%4)s+='=';return atob(s);}

function useClipboard() {
  const [copied, setCopied] = useState('');
  const copy = async (text) => {
    if (!text) return;
    try { await navigator.clipboard.writeText(text); }
    catch {
      const ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); document.body.removeChild(ta);
    }
    setCopied('Copied'); setTimeout(()=>setCopied(''), 1200);
  };
  return {copied, copy};
}
function isProbablyURL(s) {
  const t = String(s||'').trim();
  if (!t) return false;
  try { new URL(t); return true; } catch {}
  return /^www\.[^\s]+/i.test(t);
}
function normalizeURL(s) {
  const t = String(s||'').trim();
  if (!t) return t;
  if (/^https?:\/\//i.test(t)) return t;
  if (/^www\./i.test(t)) return 'https://' + t;
  return t;
}

/* ========== WebRTC コンテキスト ========== */
const ConnCtx = createContext(null);
const useConn = () => useContext(ConnCtx);

function ConnProvider({ children }) {
  const pcRef = useRef(null);
  const dcRef = useRef(null);

  const [token, setToken] = useState('');
  const [status, setStatus] = useState('Idle');
  const [connected, setConnected] = useState(false);
  const [logs, setLogs] = useState([]);

  // 転送関連ステート
  const [sendProg, setSendProg] = useState({ hidden:true, max:1, value:0 });
  const [recvProg, setRecvProg] = useState({ hidden:true, max:1, value:0 });
  const [recvName, setRecvName] = useState('—');

  const [recvFiles, setRecvFiles] = useState([]); // {name,size,blobUrl,ts}
  const [sentFiles, setSentFiles] = useState([]); // {name,size,bytes,done,ts}

  // メッセージ（テキスト/URL）ログ
  const [messages, setMessages] = useState([]); // {dir:'in'|'out', kind:'text'|'url', text, ts}

  const log = (...a) => setLogs(x => [...x, a.join(' ')]);

  function createPC() {
    const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    pc.addEventListener('iceconnectionstatechange', () => log('iceConnectionState:', pc.iceConnectionState));
    pc.addEventListener('icegatheringstatechange', () => log('iceGatheringState:', pc.iceGatheringState));
    pc.addEventListener('connectionstatechange', () => {
      setStatus(pc.connectionState);
      setConnected(pc.connectionState === 'connected');
    });
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

  function wireSendChannel(ch, role) {
    ch.binaryType = 'arraybuffer';
    ch.onopen = () => {
      log(`[${role}] DataChannel open`);
      dcRef.current = ch;
      setConnected(true);
      setStatus('connected');
    };
    ch.onclose = () => {
      log(`[${role}] DataChannel close`);
      if (dcRef.current === ch) {
        dcRef.current = null;
        setConnected(false);
        setStatus('closed');
      }
    };
  }

  function wireRecvChannel(ch) {
    ch.binaryType = 'arraybuffer';
    let expected=0, received=0, chunks=[];
    setRecvProg({ hidden:true, max:1, value:0 });
    setRecvName('—');

    ch.onmessage = async (e) => {
      if (typeof e.data === 'string') {
        // 1) テキスト/URL
        if (e.data.startsWith('MSG:')) {
          try {
            const m = JSON.parse(e.data.slice(4));
            const kind = m.kind === 'url' ? 'url' : (isProbablyURL(m.text) ? 'url' : 'text');
            setMessages(arr => [{ dir:'in', kind, text:String(m.text||''), ts:Date.now() }, ...arr]);
            log('[msg] IN', kind, m.text);
          } catch {}
          return;
        }
        // 2) ファイルメタ
        if (e.data.startsWith('META:')) {
          const m = JSON.parse(e.data.slice(5));
          expected = (m.size|0); received = 0; chunks = [];
          setRecvName(safeFilename(m.name));
          setRecvProg({ hidden:false, max: expected || 1, value:0 });
          log('[recv] META', m.name, expected, 'bytes');
          return;
        }
        // 3) ファイル終端
        if (e.data === 'EOF') {
          const blob = new Blob(chunks, { type:'application/octet-stream' });
          const url = URL.createObjectURL(blob);
          const n = safeFilename(recvName);
          setRecvFiles(f => [{ name:n, size:expected, blobUrl:url, ts:Date.now() }, ...f]);
          setRecvProg(p => ({ ...p, value: expected||p.value }));
          log('[recv] DONE', n);
          return;
        }
      }
      // 4) バイナリ本体
      let u8;
      if (e.data instanceof ArrayBuffer) u8 = new Uint8Array(e.data);
      else if (e.data && typeof e.data.arrayBuffer === 'function') u8 = new Uint8Array(await e.data.arrayBuffer());
      else return;
      chunks.push(u8);
      received += u8.byteLength;
      setRecvProg(p => ({ ...p, value: received }));
    };
  }

  const startSender = async (tok) => {
    if (!tok) throw new Error('token required');
    if (pcRef.current) return;
    setStatus('starting(sender)');
    const pc = createPC(); pcRef.current = pc;

    const ch = pc.createDataChannel('file'); // 双方向で使う
    wireSendChannel(ch, 'sender');
    wireRecvChannel(ch);

    const offer = await pc.createOffer({ offerToReceiveAudio:false, offerToReceiveVideo:false });
    await pc.setLocalDescription(offer);
    await waitIceComplete(pc);

    await api('/api/offer', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ token: tok, sdp: pc.localDescription.sdp })
    });
    log('[sender] offer posted; waiting answer');

    let ans = null;
    while (!ans) {
      const json = await getJSONorNull(`/api/answer?token=${encodeURIComponent(tok)}`);
      if (json) ans = json.sdp; else await sleep(800);
    }
    await pc.setRemoteDescription({ type:'answer', sdp: ans });
    setStatus('answer-applied');
  };

  const joinReceiver = async (tok) => {
    if (!tok) throw new Error('token required');
    if (pcRef.current) return;
    setStatus('starting(receiver)');
    const pc = createPC(); pcRef.current = pc;

    pc.ondatachannel = (ev) => {
      const ch = ev.channel;
      wireSendChannel(ch, 'receiver');
      wireRecvChannel(ch);
    };

    let offerSdp = null;
    while (!offerSdp) {
      const json = await getJSONorNull(`/api/offer?token=${encodeURIComponent(tok)}`);
      if (json) offerSdp = json.sdp; else await sleep(800);
    }
    await pc.setRemoteDescription({ type:'offer', sdp: offerSdp });

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await waitIceComplete(pc);

    await api('/api/answer', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ token: tok, sdp: pc.localDescription.sdp })
    });
    log('[receiver] answer posted');
    setStatus('answer-posted');
  };

  const sendFile = async (file) => {
    const dc = dcRef.current;
    if (!dc || dc.readyState !== 'open') throw new Error('DataChannel not open');
    if (!file) throw new Error('No file selected');

    const entry = { name:file.name||'(unnamed)', size:file.size|0, bytes:0, done:false, ts:Date.now() };
    setSentFiles(list => [entry, ...list]);
    setSendProg({ hidden:false, max:file.size||1, value:0 });

    const chunk = 16*1024;
    dc.send('META:' + JSON.stringify({ name:file.name, size:file.size }));
    dc.bufferedAmountLowThreshold = 1<<20;

    let offset = 0;
    while (offset < file.size) {
      const buf = await file.slice(offset, offset + chunk).arrayBuffer();
      while (dc.bufferedAmount > dc.bufferedAmountLowThreshold) {
        await new Promise(r => { dc.onbufferedamountlow = r; });
      }
      dc.send(buf);
      offset += buf.byteLength;
      setSendProg(p => ({ ...p, value: offset }));
      setSentFiles(([first, ...rest]) => [{ ...first, bytes: offset }, ...rest]);
    }
    dc.send('EOF');
    setSentFiles(([first, ...rest]) => [{ ...first, bytes:first.size, done:true }, ...rest]);
    log('[send] done', file.name, file.size);
  };

  const sendText = async (textRaw) => {
    const dc = dcRef.current;
    if (!dc || dc.readyState !== 'open') throw new Error('DataChannel not open');
    const text = String(textRaw||'').trim();
    if (!text) throw new Error('Empty message');

    const kind = isProbablyURL(text) ? 'url' : 'text';
    const payload = { kind, text };
    dc.send('MSG:' + JSON.stringify(payload));
    setMessages(arr => [{ dir:'out', kind, text, ts:Date.now() }, ...arr]);
    log('[msg] OUT', kind, text);
  };

  const reset = () => {
    try { dcRef.current?.close(); } catch {}
    try { pcRef.current?.close(); } catch {}
    dcRef.current = null; pcRef.current = null;
    setConnected(false);
    setStatus('Idle');
    setLogs([]);
    setRecvFiles([]); setSentFiles([]);
    setMessages([]);
    setSendProg({ hidden:true, max:1, value:0 });
    setRecvProg({ hidden:true, max:1, value:0 });
    setRecvName('—');
  };

  const value = useMemo(() => ({
    token, setToken, status, setStatus, connected,
    logs, log,
    sendProg, recvProg, recvName,
    recvFiles, sentFiles,
    messages,
    startSender, joinReceiver, sendFile, sendText, reset,
    pcRef, dcRef
  }), [token, status, connected, logs, sendProg, recvProg, recvName, recvFiles, sentFiles, messages]);

  return <ConnCtx.Provider value={value}>{children}</ConnCtx.Provider>;
}

/* ========== 画面 ========== */
function Layout({ children }) {
  const { status, connected } = useConn();
  const loc = useLocation();
  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <h1 style={{margin:0, fontSize:22}}>XDrop</h1>
        <nav style={styles.nav}>
          <Link to="/start">Start</Link>
          <Link to="/join">Join</Link>
        </nav>
      <div style={styles.headerRight}>
          <b>Status:</b> {status} {connected ? '✅' : '…'}
          <span style={{marginLeft:10, opacity:.7}}>{loc.pathname}</span>
        </div>
      </header>
      {children}
    </div>
  );
}

function StartPage() {
  const { token, setToken, status, connected, startSender, reset, logs } = useConn();
  const [joinURL, setJoinURL] = useState('');
  const {copied, copy} = useClipboard();
  const nav = useNavigate();
  const buildJoinURL = (t) => `${location.origin}/join?t=${encodeURIComponent(t)}&auto=1`;

  const createSession = async () => {
    const { token: t } = await api('/api/session', { method:'POST' });
    setToken(t);
    const url = buildJoinURL(t);
    setJoinURL(url);
    startSender(t).catch(console.error);
  };

  useEffect(() => {
    if (connected && token) nav(`/room/${token}`, { replace:true });
  }, [connected, token, nav]);

  return (
    <Layout>
      <fieldset style={styles.box}>
        <legend>Start (Issue token & QR)</legend>
        <div style={styles.row}>
          <button onClick={createSession}>Create Session</button>
          <button onClick={reset} style={{marginLeft:8}}>Reset</button>
          <span style={{marginLeft:12}}>Token: <code style={{fontSize:18}}>{token || '—'}</code></span>
        </div>
        <div style={{marginTop:12, display:'flex', gap:16, alignItems:'center', flexWrap:'wrap'}}>
          <div style={styles.qrBox}>
            {joinURL ? <QRCode value={joinURL} size={240} level="M" includeMargin /> : <span style={{opacity:.6}}>QR</span>}
          </div>
          <div style={{fontSize:14, flex:1, minWidth:260}}>
            <div><b>Status:</b> {status}</div>
            <div style={{marginTop:6}}>Share this link:</div>
            <input
              value={joinURL}
              readOnly
              onClick={e=>e.currentTarget.select()}
              placeholder="(after Create Session)"
              style={styles.inputFull}
            />
            <div style={{marginTop:6, display:'flex', gap:8, alignItems:'center'}}>
              <button onClick={()=>copy(joinURL)} disabled={!joinURL}>Copy URL</button>
              {copied && <span style={{color:'#2e7d32'}}>{copied}</span>}
            </div>
          </div>
        </div>
      </fieldset>

      <h3>Log</h3>
      <pre style={styles.log}>{logs.join('\n') || '—'}</pre>
    </Layout>
  );
}

function JoinPage() {
  const { setToken, token, status, connected, joinReceiver, reset, logs } = useConn();
  const [input, setInput] = useState('');
  const nav = useNavigate();
  const loc = useLocation();

  useEffect(() => {
    const qs = new URLSearchParams(loc.search);
    const t = qs.get('t') || '';
    const auto = qs.get('auto') === '1';

    // #qr= base64url(JSON:{t,...}) からも拾う
    const hs = new URLSearchParams(location.hash.slice(1));
    const qr = hs.get('qr');
    let t2 = t;
    if (qr) {
      try {
        const obj = JSON.parse(ub64url(qr));
        if (obj?.t && TOKEN_RE.test(String(obj.t))) t2 = String(obj.t);
      } catch {}
    }

    if (TOKEN_RE.test(t2)) {
      setInput(t2); setToken(t2);
      if (auto || qr) joinReceiver(t2).catch(console.error);
    }
    // eslint-disable-next-line
  }, []);

  useEffect(() => {
    if (connected && (token || input)) nav(`/room/${token || input}`, { replace:true });
  }, [connected, token, input, nav]);

  const onChange = (v) => {
    const vv = v.replace(/\D/g, '').slice(0,6);
    setInput(vv);
    setToken(vv);
    if (TOKEN_RE.test(vv)) joinReceiver(vv).catch(console.error);
  };

  return (
    <Layout>
      <fieldset style={styles.box}>
        <legend>Join</legend>
        <div style={styles.row}>
          <input
            value={input}
            onChange={e=>onChange(e.target.value)}
            placeholder="Enter 6-digit token"
            style={{width:220, padding:8, fontSize:18, letterSpacing:2}}
            inputMode="numeric" pattern="\d*"
          />
          <button onClick={reset} style={{marginLeft:8}}>Reset</button>
          <span style={{marginLeft:12}}><b>Status:</b> {status}</span>
        </div>
        <div style={{marginTop:6, color:'#777'}}>トークン入力（またはQR遷移）で自動接続します。</div>
      </fieldset>

      <h3>Log</h3>
      <pre style={styles.log}>{logs.join('\n') || '—'}</pre>
    </Layout>
  );
}

function RoomPage() {
  const { token } = useParams();
  const {
    connected, status, sendFile, sendText,
    recvFiles, sentFiles, messages,
    reset, sendProg, recvProg, recvName, logs
  } = useConn();
  const fileRef = useRef(null);
  const [chat, setChat] = useState('');
  const { copy } = useClipboard();

  const onSendFile = async () => {
    const f = fileRef.current?.files?.[0];
    if (!f) return alert('Choose a file');
    try { await sendFile(f); } catch (e) { alert(e.message || String(e)); }
  };
  const onSendText = async () => {
    const text = chat.trim();
    if (!text) return;
    try { await sendText(text); setChat(''); }
    catch (e) { alert(e.message || String(e)); }
  };

  return (
    <Layout>
      <fieldset style={styles.box}>
        <legend>Room</legend>
        <div style={styles.row}>
          <div>Token: <b>{token}</b></div>
          <div style={{marginLeft:12}}><b>Status:</b> {status} {connected ? '✅' : '❌'}</div>
          <button onClick={reset} style={{marginLeft:'auto'}}>Reset</button>
        </div>

        <div style={{marginTop:12, display:'grid', gridTemplateColumns:'1fr 1fr', gap:16}}>
          {/* ===== Send (file) ===== */}
          <div>
            <div style={{fontWeight:600}}>Send File</div>
            <div style={styles.row}>
              <input ref={fileRef} type="file" />
              <button onClick={onSendFile} disabled={!connected} style={{marginLeft:8}}>Send File</button>
            </div>
            {!sendProg.hidden && <progress value={sendProg.value} max={sendProg.max} style={styles.progress} />}
            {!sendProg.hidden && (
              <div style={{textAlign:'right', fontSize:12, color:'#666'}}>
                {formatBytes(sendProg.value)} / {formatBytes(sendProg.max)}
              </div>
            )}

            <div style={{marginTop:12}}>
              <div style={{fontWeight:600, marginBottom:6}}>Sent files</div>
              {sentFiles.length===0 ? <div style={{opacity:.6}}>—</div> :
                <ul style={styles.ul}>
                  {sentFiles.map((it,i)=>(
                    <li key={i} style={styles.li}>
                      <div style={styles.rowBetween}>
                        <div>{it.name} <span style={styles.dim}>({formatBytes(it.size)})</span></div>
                        <div style={styles.dim}>{new Date(it.ts).toLocaleTimeString()}</div>
                      </div>
                      <div style={styles.rowBetween}>
                        <progress value={it.bytes} max={it.size||1} style={{width:'100%'}} />
                        <span style={{marginLeft:8, minWidth:80, textAlign:'right'}}>
                          {it.done ? 'done' : `${Math.floor((it.bytes/Math.max(1,it.size))*100)}%`}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              }
            </div>
          </div>

          {/* ===== Receive (file) ===== */}
          <div>
            <div style={{fontWeight:600}}>Receive File</div>
            <div>File: <b>{recvName}</b></div>
            {!recvProg.hidden && <progress value={recvProg.value} max={recvProg.max} style={styles.progress} />}
            {!recvProg.hidden && (
              <div style={{textAlign:'right', fontSize:12, color:'#666'}}>
                {formatBytes(recvProg.value)} / {formatBytes(recvProg.max)}
              </div>
            )}

            <div style={{marginTop:12}}>
              <div style={{fontWeight:600, marginBottom:6}}>Downloads</div>
              {recvFiles.length===0 ? <div style={{opacity:.6}}>—</div> :
                <ul style={styles.ul}>
                  {recvFiles.map((f,i)=>(
                    <li key={i} style={styles.li}>
                      <div style={styles.rowBetween}>
                        <div>{f.name} <span style={styles.dim}>({formatBytes(f.size)})</span></div>
                        <div style={styles.dim}>{new Date(f.ts).toLocaleTimeString()}</div>
                      </div>
                      <div style={{marginTop:6, textAlign:'right'}}>
                        <a href={f.blobUrl} download={safeFilename(f.name)} style={styles.btnLink}>Download again</a>
                      </div>
                    </li>
                  ))}
                </ul>
              }
            </div>
          </div>
        </div>

        {/* ===== Chat (text / URL) ===== */}
        <div style={{marginTop:18}}>
          <div style={{fontWeight:700, marginBottom:8}}>Chat (Text / URL)</div>
          <div style={{display:'grid', gridTemplateColumns:'1fr auto', gap:8}}>
            <input
              value={chat}
              onChange={e=>setChat(e.target.value)}
              placeholder="Type message or paste URL and press Enter"
              style={styles.inputFull}
            />
            <button onClick={onSendText} disabled={!connected}>Send</button>
          </div>

          <div style={{marginTop:10, maxHeight:260, overflow:'auto', border:'1px solid #eee', borderRadius:8}}>
            {messages.length===0 ? <div style={{padding:10, opacity:.6}}>No messages yet</div> :
              <ul style={{...styles.ul, padding:8}}>
                {messages.map((m,i)=>(
                  <li key={i} style={{
                    ...styles.chatItem,
                    alignSelf: m.dir==='out' ? 'flex-end' : 'flex-start',
                    background: m.dir==='out' ? '#e8f5e9' : '#f5f5f5'
                  }}>
                    <div style={{fontSize:12, color:'#666', marginBottom:2}}>
                      {m.dir==='out' ? 'You' : 'Peer'} · {new Date(m.ts).toLocaleTimeString()}
                    </div>
                    {m.kind==='url'
                      ? <a href={normalizeURL(m.text)} target="_blank" rel="noreferrer">{m.text}</a>
                      : <div style={{whiteSpace:'pre-wrap', wordBreak:'break-word'}}>{m.text}</div>
                    }
                    <div style={{textAlign:'right', marginTop:6}}>
                      <button onClick={()=>copy(m.text)} style={{fontSize:12}}>Copy</button>
                    </div>
                  </li>
                ))}
              </ul>
            }
          </div>
        </div>
      </fieldset>

      <h3>Log</h3>
      <pre style={styles.log}>{logs.join('\n') || '—'}</pre>
    </Layout>
  );
}

/* ========== ルーティング ========== */
function App() {
  return (
    <BrowserRouter>
      <ConnProvider>
        <Routes>
          <Route path="/" element={<Navigate to="/start" replace />} />
          <Route path="/start" element={<StartPage />} />
          <Route path="/join" element={<JoinPage />} />
          <Route path="/room/:token" element={<RoomPage />} />
          <Route path="*" element={<Navigate to="/start" replace />} />
        </Routes>
      </ConnProvider>
    </BrowserRouter>
  );
}

export default App;

/* ========== スタイル ========== */
const styles = {
  page: { fontFamily:'system-ui,-apple-system,Segoe UI,Roboto,sans-serif', maxWidth:980, margin:'24px auto', padding:'0 16px' },
  header: { display:'flex', alignItems:'center', gap:12, marginBottom:12 },
  nav: { display:'flex', gap:10 },
  headerRight: { marginLeft:'auto', fontSize:13, opacity:.85 },
  box: { border:'1px solid #eee', borderRadius:12, padding:12, background:'#fff' },
  row: { display:'flex', alignItems:'center', flexWrap:'wrap' },
  rowBetween: { display:'flex', alignItems:'center', justifyContent:'space-between', gap:12 },
  inputFull: { width:'100%', padding:8 },
  qrBox: { width:256, height:256, display:'grid', placeItems:'center', border:'1px dashed #ccc', borderRadius:8, background:'#fafafa' },
  progress: { width:'100%', display:'block', marginTop:8 },
  ul: { listStyle:'none', padding:0, margin:0 },
  li: { border:'1px solid #eee', borderRadius:8, padding:'8px 10px', marginBottom:8, background:'#fff' },
  log: { whiteSpace:'pre-wrap', background:'#fafafa', border:'1px solid #eee', borderRadius:8, padding:10, height:220, overflow:'auto' },
  dim: { color:'#777' },
  btnLink: { padding:'6px 10px', border:'1px solid #ddd', borderRadius:6, textDecoration:'none' },
  chatItem: { maxWidth:'80%', padding:'8px 10px', borderRadius:10, margin:'6px 0' },
};
