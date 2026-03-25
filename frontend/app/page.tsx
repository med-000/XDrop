"use client";

import { useState, useEffect, useRef } from "react";

export default function Home() {
  const [logs, setLogs] = useState<string[]>([]);
  const wsRef = useRef<any>(null);
  const [connected, setConnected] = useState(false);
  const [roomId, setRoomId] = useState<string>("123");
  const [inputRoomId, setInputRoomId] = useState<string>("123");

  const connectWebSocket = (id: string) => {
    // 既に接続されていたら切断
    if (wsRef.current) {
      wsRef.current.close();
    }

    setLogs([]);
    setRoomId(id);

    const socket = new WebSocket(`ws://localhost:8080/ws/${id}`);

    socket.onopen = () => {
      console.log("接続成功");
      setConnected(true);
      setLogs((prev) => [...prev, `[接続] ws://localhost:8080/ws/${id}`]);
      socket.send("hello");
    };

    socket.onmessage = (e) => {
      console.log("受信:", e.data);
      setLogs((prev) => [...prev, `[受信] ${e.data}`]);
    };

    socket.onerror = (error) => {
      console.error("エラー:", error);
      setLogs((prev) => [...prev, "[エラー] WebSocket接続失敗"]);
    };

    socket.onclose = () => {
      console.log("切断");
      setConnected(false);
      setLogs((prev) => [...prev, "[切断] サーバーから切断"]);
    };

    wsRef.current = socket;
  };

  const disconnect = () => {
    if (wsRef.current) {
      wsRef.current.close();
      setConnected(false);
    }
  };

  const sendMessage = () => {
    if (wsRef.current && connected) {
      const msg = `test message ${Date.now()}`;
      wsRef.current.send(msg);
      setLogs((prev) => [...prev, `[送信] ${msg}`]);
    }
  };

  return (
    <div className='flex flex-col items-center justify-center min-h-screen bg-zinc-50 p-4'>
      <div className='w-full max-w-md bg-white rounded-lg shadow-lg p-6'>
        <h1 className='text-2xl font-bold mb-4'>WebSocket テスト</h1>

        <div className='mb-4'>
          <label className='block text-sm font-semibold mb-2'>Room ID</label>
          <div className='flex gap-2'>
            <input
              type='text'
              value={inputRoomId}
              onChange={(e) => setInputRoomId(e.target.value)}
              disabled={connected}
              className='flex-1 px-3 py-2 border border-gray-300 rounded disabled:bg-gray-100'
              placeholder='例：123'
            />
            <button
              onClick={() => connectWebSocket(inputRoomId)}
              disabled={connected || !inputRoomId}
              className='bg-green-500 hover:bg-green-600 disabled:bg-gray-300 text-white font-bold py-2 px-4 rounded'
            >
              接続
            </button>
            {connected && (
              <button
                onClick={disconnect}
                className='bg-red-500 hover:bg-red-600 text-white font-bold py-2 px-4 rounded'
              >
                切断
              </button>
            )}
          </div>
        </div>

        <div className='mb-4'>
          <p className='text-sm font-semibold'>
            ステータス:{" "}
            <span className={connected ? "text-green-600" : "text-red-600"}>
              {connected ? `接続中 (Room: ${roomId})` : "切断"}
            </span>
          </p>
        </div>

        <button
          onClick={sendMessage}
          disabled={!connected}
          className='w-full bg-blue-500 hover:bg-blue-600 disabled:bg-gray-300 text-white font-bold py-2 px-4 rounded mb-4'
        >
          メッセージ送信
        </button>

        <div className='bg-gray-100 border border-gray-300 rounded p-3 h-64 overflow-y-auto'>
          {logs.map((log, i) => (
            <div key={i} className='text-xs text-gray-700 font-mono py-1'>
              {log}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
