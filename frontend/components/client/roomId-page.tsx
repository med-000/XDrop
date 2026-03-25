"use client";
import { useEffect, useRef, useState } from "react";
import { Config, statusLabel } from "@/lib/config";
import { startOffer } from "@/lib/peer";
import {
  handleOffer,
  handleAnswer,
  handleCandidate,
  createPeerConnection,
} from "@/lib/peer";
import { QRCodeSVG } from "qrcode.react";
import { createFileReceiver } from "@/lib/handler";
import { createSender } from "@/lib/sender";
import { Channels, Status, PeerHandlers } from "@/lib/types";
import { usePathname } from "next/navigation";

type RoomIdPageProps = {
  roomId: string;
};

const RoomIdPage = ({ roomId }: RoomIdPageProps) => {
  const initialized = useRef(false);
  const channelsRef = useRef<Channels>({});
  const roleRef = useRef<"offer" | "answer" | null>(null);
  const senderRef = useRef<ReturnType<typeof createSender> | null>(null);

  const [messages, setMessages] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<Status>("waiting");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [receivedFiles, setReceivedFiles] = useState<
    { name: string; url: string }[]
  >([]);
  const pathname = usePathname();
  const url = `http://localhost:3000${pathname}`;

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    senderRef.current = createSender(channelsRef.current);

    const protocol = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${protocol}://localhost:8080/ws/${roomId}`);
    const pc = new RTCPeerConnection(Config);

    pc.onconnectionstatechange = () => {
      console.log("connection:", pc.connectionState);

      if (pc.connectionState === "connected") {
        setStatus("connected");
      }

      if (
        pc.connectionState === "disconnected" ||
        pc.connectionState === "failed" ||
        pc.connectionState === "closed"
      ) {
        setStatus("waiting");
      }
    };

    const fileReceiver = createFileReceiver((file) => {
      setReceivedFiles((prev) => [file, ...prev]);
    });

    const handlers: PeerHandlers = {
      onChat: (text) => {
        setMessages((prev) => [`other> ${text}`, ...prev]);
      },

      onFileMeta: fileReceiver.onMeta,
      onFileChunk: fileReceiver.onChunk,
      onFileDone: fileReceiver.onDone,
    };

    createPeerConnection(ws, pc, channelsRef.current, handlers);

    ws.onopen = () => {
      console.log("ws connected");
    };
    ws.onmessage = async (event) => {
      const msg = JSON.parse(event.data);

      switch (msg.type) {
        case "role":
          roleRef.current = msg.role;
          console.log("role:", msg.role);
          break;

        case "ready":
          setStatus("ready");
          console.log("ready");

          if (roleRef.current === "offer") {
            startOffer(ws, pc, channelsRef.current, handlers);
          }
          break;
        case "offer":
          await handleOffer(ws, pc, msg.sdp);
          break;

        case "answer":
          await handleAnswer(pc, msg.sdp);
          break;

        case "candidate":
          await handleCandidate(pc, msg.candidate);
          break;
      }
    };
    return () => {
      ws.close();
      pc.close();
      initialized.current = false;
      channelsRef.current = {};
    };
  }, [roomId]);
  const sendMessage = () => {
    const sender = createSender(channelsRef.current);

    const ok = sender.sendChat(input);

    if (!ok) return;

    setMessages((prev) => [`me> ${input}`, ...prev]);
    setInput("");
  };

  const sendSelectedFile = async () => {
    if (!selectedFile) return;

    const sender = createSender(channelsRef.current);
    const ok = await sender.sendFile(selectedFile);

    if (!ok) {
      console.log("file send failed");
      return;
    }

    setSelectedFile(null);
  };

  return (
    <div className='flex h-screen bg-white'>
      {/* サイドバー: URL共有とステータス */}
      <div className='w-80 border-r border-gray-200 bg-gray-50 p-6 overflow-y-auto shadow-sm flex flex-col'>
        <div className='space-y-6 flex-1'>
          {/* ステータス */}
          <div>
            <h3 className='text-sm font-semibold text-black mb-2 uppercase tracking-wide'>
              接続状態
            </h3>
            <div className='inline-block px-3 py-1.5 bg-blue-500 text-white text-sm font-bold rounded-full shadow-md'>
              {statusLabel[status]}
            </div>
          </div>

          {/* QRコードとURL */}
          <div>
            <h3 className='text-sm font-semibold text-black mb-3 uppercase tracking-wide'>
              共有用URL
            </h3>
            <div className='bg-white p-4 rounded-lg flex flex-col items-center gap-4 border border-gray-200 shadow-sm'>
              <QRCodeSVG
                value={url}
                size={200}
                level='H'
                includeMargin={true}
                className='border-4 border-white'
              />
              <p className='text-xs text-gray-700 text-center break-all font-mono bg-gray-100 px-3 py-2 rounded w-full'>
                {url}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* メインコンテンツ */}
      <div className='flex-1 flex flex-col bg-white'>
        {/* ヘッダー */}
        <div className='border-b border-gray-200 bg-gray-50 px-6 py-4 shadow-sm'>
          <h2 className='text-xl font-bold text-black'>チャット</h2>
        </div>

        {/* メッセージエリア */}
        <div className='flex-1 overflow-y-auto p-6 space-y-3'>
          {messages.length === 0 ? (
            <div className='flex items-center justify-center h-full text-gray-400'>
              <p className='text-lg'>メッセージはまだありません</p>
            </div>
          ) : (
            messages.map((m, i) => (
              <div
                key={i}
                className={`flex ${m.startsWith("me>") ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-xs px-4 py-2 rounded-lg shadow-sm ${
                    m.startsWith("me>")
                      ? "bg-blue-500 text-white rounded-br-none"
                      : "bg-gray-200 text-black rounded-bl-none"
                  }`}
                >
                  <p className='text-sm'>
                    {m.startsWith("me>") ? m.slice(4) : m.slice(7)}
                  </p>
                </div>
              </div>
            ))
          )}
        </div>

        {/* ファイル受信エリア */}
        {receivedFiles.length > 0 && (
          <div className='border-t border-gray-200 px-6 py-4 bg-gray-50'>
            <h4 className='text-sm font-semibold text-black mb-3 uppercase tracking-wide'>
              受信したファイル
            </h4>
            <div className='space-y-2 max-h-32 overflow-y-auto'>
              {receivedFiles.map((f, i) => (
                <a
                  key={i}
                  href={f.url}
                  download={f.name}
                  className='block px-4 py-3 text-sm bg-white hover:bg-gray-100 text-blue-600 hover:text-blue-700 rounded-lg transition-all truncate font-medium border border-gray-200 hover:border-gray-300 shadow-sm'
                >
                  📥 {f.name}
                </a>
              ))}
            </div>
          </div>
        )}

        {/* 入力エリア */}
        <div className='border-t border-gray-200 p-6 space-y-4 bg-gray-50'>
          {/* ファイル送信 */}
          <div className='space-y-2'>
            <div className='flex gap-3'>
              <label
                htmlFor='file-input'
                className='flex-1 flex items-center justify-center px-4 py-2 bg-gray-200 hover:bg-gray-300 text-black rounded-lg cursor-pointer transition-all font-medium border border-gray-300 hover:border-gray-400 shadow-sm'
              >
                ファイルを選択
              </label>
              <input
                id='file-input'
                type='file'
                className='hidden'
                onChange={(e) => {
                  const file = e.target.files?.[0] ?? null;
                  setSelectedFile(file);
                }}
              />
              <button
                type='button'
                onClick={sendSelectedFile}
                disabled={!selectedFile}
                className='px-4 py-2 bg-blue-500 hover:bg-blue-600 disabled:bg-gray-300 disabled:text-gray-500 text-white rounded-lg font-bold transition-all shadow-md hover:shadow-lg disabled:shadow-none'
              >
                ファイルを送信
              </button>
            </div>
            <p className='text-sm text-gray-600'>
              {selectedFile
                ? `選択中: ${selectedFile.name}`
                : "ファイルを選択してください"}
            </p>
          </div>

          {/* メッセージ送信 */}
          <div className='flex gap-3'>
            <input
              type='text'
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder='メッセージを入力...'
              className='flex-1 px-4 py-2 border border-gray-300 bg-white text-black rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent placeholder-gray-500'
            />
            <button
              onClick={sendMessage}
              className='px-6 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg font-bold transition-all shadow-md hover:shadow-lg'
            >
              送信
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RoomIdPage;
