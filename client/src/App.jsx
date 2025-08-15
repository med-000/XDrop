import React, { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode.react';

export default function App() {
  // ===== UI states =====
  const [token, setToken] = useState('');
  const [logs, setLogs] = useState([]);
  const [qrValue, setQrValue] = useState('');
  const [conn, setConn] = useState({
    role: 'idle',            // 'idle' | 'sender' | 'receiver'
    phase: 'idle',           // 'idle' | 'signaling' | 'waiting-offer' | 'waiting-answer' | 'connecting' | 'connected' | 'closed' | 'error'
    ice: 'new',
    dc: 'closed'
  });

  // 送受信用の状態
  const [selectedFile, setSelectedFile] = useState(null);
  const [sentFiles, setSentFiles] = useState([]);       // {id, name, size, status:'queued'|'sending'|'done'|'error', sentBytes, at}
  const [receivedFiles, setReceivedFiles] = useState([]); // {id, name, size, blob, at}

  // ===== refs =====
  const fileRef = useRef(null);
  const pcRef = useRef(null);
  const dcRef = useRef(null);
  const connectedRef = useRef(false);
  const autoStartedRef = useRef(false);
  const pendingFileRef = useRef(null); // 接続待ちキュー

  const log = (...a) => setLogs(x => [...x, a.join(' ')]);
  const isTokenValid = /^\d{6}$/.test(token);

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

  // ファイル名サニタイズ＆フォールバック
  const two = (n)=>String(n).padStart(2,'0');
  const nowStamp = () => {
    const d=new Date();
    return `${d.getFullYear()}${two(d.getMonth()+1)}${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}${two(d.getSeconds())}`;
  };
  const sanitizeFilename = (name, fallbackExt='bin') => {
    let n = (name||'').toString().trim();
    if (!n || n === '-' || n === '—') {
      n = `xdrop-${nowStamp()}.${fallbackExt}`;
    }
    // 禁止文字を置換
    n = n.replace(/[\\/:*?"<>|\u0000-\u001F]+/g, '_');
    // 末尾スペース/ドットはNGな環境がある
    n = n.replace(/[. ]+$/g, '');
    if (!n) n = `xdrop-${nowStamp()}.${fallbackExt}`;
    // 長すぎる場合は切り詰め（拡張子は残す）
    if (n.length > 200) {
      const i = n.lastIndexOf('.');
      if (i > 0 && i < n.length-1) {
        const base = n.slice(0, i).slice(0, 180);
        const ext = n.slice(i+1);
        n = `${base}.${ext}`;
      } else {
        n = n.slice(0, 200);
      }
    }
    return n;
  };

  function createPC() {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });
    pc.addEventListener('iceconnectionstatechange', () => {
      const s = pc.iceConnectionState;
      log('iceConnectionState:', s);
      setConn(c => ({ ...c, ice: s, phase: (s === 'connected' || s === 'completed') ? 'connected' : c.phase }));
    });
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
      dcRef.current = ch;
      connectedRef.current = true;
      setConn(c => ({ ...c, dc: 'open', phase: 'connected' }));

      // 接続後、キューされているファイルがあれば送信
      if (pendingFileRef.current) {
        sendFileNow(pendingFileRef.current).catch(e => log('[send] error', e.message));
      }
    };
    ch.onclose = () => {
      log(`[${role}] DC close`);
      if (dcRef.current === ch) {
        dcRef.current = null;
        connectedRef.current = false;
        setConn(c => ({ ...c, dc: 'closed', phase: 'closed' }));
      }
    };
  }
  function wireRecvChannel(ch) {
    ch.binaryType = 'arraybuffer';
    let expected=0, received=0, chunks=[];
    let metaName='';

    ch.onmessage = async (e) => {
      if (typeof e.data === 'string') {
        if (e.data.startsWith('META:')) {
          const m = JSON.parse(e.data.slice(5));
          expected = (m.size|0); received = 0; chunks = [];
          metaName = sanitizeFilename(m.name, 'bin');
          // 受信プログレス表示は一覧側でやるのでここでは記録のみ
          return;
        }
        if (e.data === 'EOF') {
          const blob = new Blob(chunks, {type:'application/octet-stream'});
          const item = {
            id: `rx_${Date.now()}`,
            name: metaName || sanitizeFilename('', 'bin'),
            size: expected || blob.size || 0,
            blob,
            at: Date.now()
          };
          setReceivedFiles(list => [item, ...list]);
          log('[receiver] receive done:', item.name);
          return;
        }
      }
      // バイナリチャンク
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
    };
  }

  // ===== actions =====
  const createSession = async () => {
    const { token } = await api('/api/session', { method: 'POST' });
    setToken(token);
    setConn({ role: 'sender', phase: 'signaling', ice: 'new', dc: 'closed' });
    log('[session] created', token);
    autoStartedRef.current = false;
    startSender(token).catch(e => {
      log('[sender] error:', e.message);
      setConn(c => ({ ...c, phase: 'error' }));
    });
  };

  const startSender = async (tok = token) => {
    if (connectedRef.current || pcRef.current) { log('[sender] already running; Reset first'); return; }
    if (!/^\d{6}$/.test(tok)) { alert('6桁の token が必要です'); return; }

    setConn(c => ({ ...c, role: 'sender', phase: 'signaling' }));
    const pc = createPC(); pcRef.current = pc;

    const ch = pc.createDataChannel('file');
    wireSendChannel(ch, 'sender');
    wireRecvChannel(ch);

    const offer = await pc.createOffer({ offerToReceiveAudio: false, offerToReceiveVideo: false });
    await pc.setLocalDescription(offer);
    await waitIceComplete(pc);

    await api('/api/offer', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ token: tok, sdp: pc.localDescription.sdp })
    });
    log('[sender] offer posted, waiting answer...');
    setConn(c => ({ ...c, phase: 'waiting-answer' }));

    let ans = null;
    while (!ans) {
      const json = await getJSONorNull(`/api/answer?token=${encodeURIComponent(tok)}`);
      if (json) ans = json.sdp; else await sleep(700);
    }
    await pc.setRemoteDescription({ type:'answer', sdp: ans });
    log('[sender] answer applied');
    setConn(c => ({ ...c, phase: 'connecting' }));
  };

  const joinReceiver = async () => {
    if (connectedRef.current || pcRef.current) { log('[receiver] already running; Reset first'); return; }
    if (!isTokenValid) { alert('6桁の token を入れてください'); return; }

    setConn({ role: 'receiver', phase: 'waiting-offer', ice: 'new', dc: 'closed' });
    const pc = createPC(); pcRef.current = pc;

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
    setConn(c => ({ ...c, phase: 'connecting' }));
  };

  // 送信本体（Sendボタン or 接続完了後の自動送信）
  const sendFileNow = async (f) => {
    const dc = dcRef.current;
    const itemId = `tx_${Date.now()}`;

    // 送信リストに登録（queued）
    setSentFiles(list => [{ id:itemId, name:f.name, size:f.size, status:'queued', sentBytes:0, at:Date.now() }, ...list]);

    if (!dc || dc.readyState !== 'open') {
      pendingFileRef.current = f;
      log('[send] queued (will send after connected):', f.name);
      return;
    }

    // sending 開始
    setSentFiles(list => list.map(it => it.id===itemId ? { ...it, status:'sending' } : it));

    const chunk = 16 * 1024;
    dc.send('META:' + JSON.stringify({ name: f.name, size: f.size }));
    dc.bufferedAmountLowThreshold = 1 << 20; // 1MB

    let offset = 0;
    try {
      while (offset < f.size) {
        const buf = await f.slice(offset, offset + chunk).arrayBuffer();
        while (dc.bufferedAmount > dc.bufferedAmountLowThreshold) {
          await new Promise(r => { dc.onbufferedamountlow = r; });
        }
        dc.send(buf);
        offset += buf.byteLength;
        setSentFiles(list => list.map(it => it.id===itemId ? { ...it, sentBytes: offset } : it));
      }
      dc.send('EOF');
      log('[send] done:', f.name);
      setSentFiles(list => list.map(it => it.id===itemId ? { ...it, status:'done', sentBytes: f.size } : it));
    } catch (e) {
      log('[send] error:', e.message);
      setSentFiles(list => list.map(it => it.id===itemId ? { ...it, status:'error' } : it));
    }
  };

  const onChooseFile = (e) => {
    const f = e.target?.files?.[0];
    if (!f) { setSelectedFile(null); return; }
    setSelectedFile(f);
  };

  const clickSend = () => {
    const f = selectedFile || fileRef.current?.files?.[0];
    if (!f) { alert('ファイルを選択してください'); return; }
    sendFileNow(f).catch(err => log('[send] error', err.message));
  };

  const clickDownload = (item) => {
    const name = sanitizeFilename(item.name, 'bin');
    const url = URL.createObjectURL(item.blob);
    const a = document.createElement('a');
    a.href = url; a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };

  const reset = () => {
    try { dcRef.current?.close(); } catch {}
    try { pcRef.current?.close(); } catch {}
    dcRef.current = null; pcRef.current = null; connectedRef.current = false;
    pendingFileRef.current = null;
    setSelectedFile(null);
    setSentFiles([]);
    setReceivedFiles([]);
    autoStartedRef.current = false;
    setConn({ role: 'idle', phase: 'idle', ice: 'new', dc: 'closed' });
    log('[ui] reset');
    if (fileRef.current) fileRef.current.value = '';
  };

  // ===== QR =====
  const b64url = (s) => btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  const ub64url = (s) => { s = s.replace(/-/g,'+').replace(/_/g,'/'); while(s.length%4) s+='='; return atob(s); };
  const buildUnifiedURL = (tok) => {
    const payload = { v:1, o:location.origin, t:tok, r:'join', a:1 };
    const enc = b64url(JSON.stringify(payload));
    return `${location.origin}/#qr=${enc}`;
  };

  useEffect(() => {
    if (/^\d{6}$/.test(token)) setQrValue(buildUnifiedURL(token));
    else setQrValue('');
  }, [token]);

  // ===== ページ起動時：URL/ハッシュの自動処理 =====
  useEffect(() => {
    const qs = new URLSearchParams(location.search);
    const hs = new URLSearchParams(location.hash.slice(1));
    const qr = hs.get('qr');
    const tQ = qs.get('t');

    if (qr) {
      try {
        const obj = JSON.parse(ub64url(qr));
        if (obj.t) {
          const cleaned = String(obj.t).replace(/\D/g,'').slice(0,6);
          setToken(cleaned);
          log('[qr] token from hash JSON:', cleaned);
          if ((obj.a|0) === 1) {
            if (obj.r === 'start') {
              setConn({ role: 'sender', phase: 'signaling', ice: 'new', dc: 'closed' });
              startSender(cleaned).catch(e => log('[sender] error:', e.message));
            } else {
              setConn({ role: 'receiver', phase: 'waiting-offer', ice: 'new', dc: 'closed' });
              setTimeout(() => joinReceiver(), 0);
            }
          }
          return;
        }
      } catch (e) { log('[qr] parse error', e.message); }
    }
    const roleQ = qs.get('role'); const autoQ = qs.get('auto');
    if (tQ) {
      const cleaned = String(tQ).replace(/\D/g,'').slice(0,6);
      setToken(cleaned);
      log('[qr] token from query:', cleaned);
      if (autoQ === '1') {
        if (roleQ === 'start') {
          setConn({ role: 'sender', phase: 'signaling', ice: 'new', dc: 'closed' });
          startSender(cleaned).catch(e => log('[sender] error:', e.message));
        } else {
          setConn({ role: 'receiver', phase: 'waiting-offer', ice: 'new', dc: 'closed' });
          setTimeout(() => joinReceiver(), 0);
        }
      }
    }
    // eslint-disable-next-line
  }, []);

  // token が6桁になったら自動接続（未接続のみ）
  useEffect(() => {
    if (!isTokenValid) { autoStartedRef.current = false; return; }
    if (pcRef.current || connectedRef.current) return;
    if (autoStartedRef.current) return;
    autoStartedRef.current = true;
    log('[auto] token ready -> Join as Receiver');
    setConn({ role: 'receiver', phase: 'waiting-offer', ice: 'new', dc: 'closed' });
    joinReceiver().catch(e => {
      log('[receiver] error:', e.message);
      setConn(c => ({ ...c, phase: 'error' }));
    });
    // eslint-disable-next-line
  }, [token]);

  // ===== UI parts =====
  const PhaseBadge = ({conn}) => {
    const map = {
      idle: {label:'Idle', bg:'#eee', fg:'#333'},
      'waiting-offer': {label:'Waiting Offer', bg:'#fff4cc', fg:'#7a5b00'},
      'waiting-answer': {label:'Waiting Answer', bg:'#fff4cc', fg:'#7a5b00'},
      signaling: {label:'Signaling', bg:'#e8f0fe', fg:'#1a53bf'},
      connecting: {label:'Connecting', bg:'#e6fffa', fg:'#046c4e'},
      connected: {label:'Connected', bg:'#daf5d7', fg:'#1a7f37'},
      closed: {label:'Closed', bg:'#f1f5f9', fg:'#334155'},
      error: {label:'Error', bg:'#fde2e2', fg:'#b42318'},
    };
    const s = map[conn.phase] || map.idle;
    return (
      <span style={{padding:'4px 10px', borderRadius:999, background:s.bg, color:s.fg, fontWeight:600}}>
        {s.label}
      </span>
    );
  };

  const humanSize = (n=0) => {
    const units=['B','KB','MB','GB']; let i=0, x=n;
    while (x>=1024 && i<units.length-1){ x/=1024; i++; }
    return `${x.toFixed(x<10 && i>0 ? 1 : 0)} ${units[i]}`;
  };

  const dcOpen = dcRef.current && dcRef.current.readyState === 'open';

  return (
    <div style={{fontFamily:'system-ui,-apple-system,Segoe UI,Roboto,sans-serif', maxWidth:1000, margin:'24px auto', padding:'0 16px'}}>
      <h1 style={{marginBottom:8}}>XDrop – WebRTC</h1>

      <div style={{display:'flex', gap:12, alignItems:'center', flexWrap:'wrap', marginBottom:8}}>
        <PhaseBadge conn={conn} />
        <span style={{opacity:.8}}>Role: <b>{conn.role}</b></span>
        <span style={{opacity:.8}}>ICE: <b>{conn.ice}</b></span>
        <span style={{opacity:.8}}>DC: <b>{conn.dc}</b></span>
        {isTokenValid && <span style={{opacity:.8}}>Token: <b>{token}</b></span>}
      </div>

      <fieldset>
        <legend>Controls</legend>
        <button onClick={createSession}>Create Session</button>{' '}
        <button onClick={reset}>Reset</button>
        <div style={{marginTop:8}}>
          <input
            value={token}
            onChange={e=>setToken(e.target.value.replace(/\D/g, '').slice(0, 6))}
            inputMode="numeric"
            pattern="\d{6}"
            placeholder="6-digit token (auto-join)"
            style={{width:180,padding:6}}
          />
        </div>
      </fieldset>

      {/* QR（6桁なら表示） */}
      <div style={{marginTop:10}}>
        <div style={{fontSize:13, color:'#444', marginBottom:6}}>
          他端末でこのQRを読み込むと自動で接続します（Receiverとして参加）
        </div>
        <div style={{width:256,height:256,display:'grid',placeItems:'center',border:'1px dashed #ccc',borderRadius:8}}>
          {qrValue ? <QRCode value={qrValue} size={240} level="M" includeMargin={true} /> : <span style={{color:'#888'}}>Token を作成/入力すると表示</span>}
        </div>
      </div>

      {/* 送信 */}
      <fieldset style={{marginTop:12}}>
        <legend>Send</legend>
        <div style={{display:'flex', gap:8, alignItems:'center', flexWrap:'wrap'}}>
          <input ref={fileRef} type="file" onChange={onChooseFile} />
          <button onClick={clickSend} disabled={!selectedFile && !fileRef.current?.files?.[0]}>
            Send
          </button>
          <span style={{opacity:.8}}>
            {dcOpen ? 'DataChannel: open' : 'DataChannel: not ready'}
          </span>
          {selectedFile && <span>Selected: <b>{selectedFile.name}</b> ({humanSize(selectedFile.size)})</span>}
        </div>

        {/* 送信履歴 */}
        <div style={{marginTop:10}}>
          <div style={{fontWeight:600, marginBottom:6}}>Sent</div>
          {sentFiles.length === 0 ? (
            <div style={{color:'#666'}}>No sent files yet</div>
          ) : (
            <table style={{width:'100%', borderCollapse:'collapse', fontSize:14}}>
              <thead>
                <tr style={{textAlign:'left', borderBottom:'1px solid #eee'}}>
                  <th style={{padding:'6px 4px'}}>Name</th>
                  <th style={{padding:'6px 4px'}}>Size</th>
                  <th style={{padding:'6px 4px'}}>Progress</th>
                  <th style={{padding:'6px 4px'}}>Status</th>
                  <th style={{padding:'6px 4px'}}>Time</th>
                </tr>
              </thead>
              <tbody>
                {sentFiles.map(it => {
                  const pct = it.size ? Math.floor((it.sentBytes||0)*100/it.size) : 0;
                  const dt = new Date(it.at).toLocaleTimeString();
                  return (
                    <tr key={it.id} style={{borderBottom:'1px solid #f4f4f4'}}>
                      <td style={{padding:'6px 4px', wordBreak:'break-all'}}>{it.name}</td>
                      <td style={{padding:'6px 4px'}}>{humanSize(it.size)}</td>
                      <td style={{padding:'6px 4px'}}>{it.status==='sending' ? `${pct}%` : it.status==='done' ? '100%' : it.sentBytes ? `${pct}%` : '-'}</td>
                      <td style={{padding:'6px 4px'}}>{it.status}</td>
                      <td style={{padding:'6px 4px'}}>{dt}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </fieldset>

      {/* 受信 */}
      <fieldset style={{marginTop:12}}>
        <legend>Received</legend>
        {receivedFiles.length === 0 ? (
          <div style={{color:'#666'}}>No received files yet</div>
        ) : (
          <table style={{width:'100%', borderCollapse:'collapse', fontSize:14}}>
            <thead>
              <tr style={{textAlign:'left', borderBottom:'1px solid #eee'}}>
                <th style={{padding:'6px 4px'}}>Name</th>
                <th style={{padding:'6px 4px'}}>Size</th>
                <th style={{padding:'6px 4px'}}>Time</th>
                <th style={{padding:'6px 4px'}}>Action</th>
              </tr>
            </thead>
            <tbody>
              {receivedFiles.map(it => (
                <tr key={it.id} style={{borderBottom:'1px solid #f4f4f4'}}>
                  <td style={{padding:'6px 4px', wordBreak:'break-all'}}>{it.name}</td>
                  <td style={{padding:'6px 4px'}}>{humanSize(it.size)}</td>
                  <td style={{padding:'6px 4px'}}>{new Date(it.at).toLocaleTimeString()}</td>
                  <td style={{padding:'6px 4px'}}>
                    <button onClick={()=>clickDownload(it)}>Download</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </fieldset>

      {/* ログ */}
      <h3>Log</h3>
      <div style={{whiteSpace:'pre-wrap', background:'#fafafa', border:'1px solid #eee', borderRadius:8, padding:10, height:220, overflow:'auto'}}>
        {logs.join('\n')}
      </div>
    </div>
  );
}
