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

export const RoomIdPage = ({ roomId }: RoomIdPageProps) => {
  const initialized = useRef(false);
  const channelsRef = useRef<Channels>({});
  const roleRef = useRef<"offer" | "answer" | null>(null);
  const senderRef = useRef<ReturnType<typeof createSender> | null>(null);

  const [messages, setMessages] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<Status>("waiting");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [sentFiles, setSentFiles] = useState<string[]>([]);
  const [receivedFiles, setReceivedFiles] = useState<
    { name: string; url: string }[]
  >([]);
  const [copiedTarget, setCopiedTarget] = useState<"url" | "roomId" | null>(
    null,
  );
  const statusColorClass: Record<Status, string> = {
    waiting: "bg-gray-500",
    ready: "bg-yellow-500",
    connected: "bg-blue-500",
    disconnected: "bg-red-500",
  };
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
        setStatus("disconnected");
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

    const fileToSend = selectedFile;
    const sender = createSender(channelsRef.current);
    const ok = await sender.sendFile(fileToSend);

    if (!ok) {
      console.log("file send failed");
      return;
    }

    setSentFiles((prev) => [fileToSend.name, ...prev]);
    setSelectedFile(null);
  };

  const copyText = async (text: string, target: "url" | "roomId") => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedTarget(target);
      setTimeout(() => setCopiedTarget(null), 1200);
    } catch {
      console.log("copy failed");
    }
  };

  return (
    <div className='h-full bg-stone-100 overflow-y-auto'>
      <div className='max-w-3xl mx-auto p-6 space-y-6'>
        <section className='bg-white border border-gray-300 rounded-xl p-4 shadow-sm'>
          <h2 className='text-sm font-semibold text-black mb-2 uppercase tracking-wide'>
            接続状態
          </h2>
          <span
            className={`inline-block px-3 py-1.5 text-white text-sm font-bold rounded-full shadow-sm ${statusColorClass[status]}`}
          >
            {statusLabel[status]}
          </span>
        </section>

        {status !== "connected" && (
          <section className='bg-white border border-gray-300 rounded-xl p-4 shadow-sm'>
            <h2 className='text-sm font-semibold text-black mb-3 uppercase tracking-wide'>
              QRコード
            </h2>
            <div className='bg-stone-50 rounded-lg border border-gray-300 p-4 flex justify-center'>
              <QRCodeSVG
                value={url}
                size={220}
                level='H'
                includeMargin={true}
              />
            </div>
          </section>
        )}

        <section className='bg-white border border-gray-300 rounded-xl p-4 shadow-sm'>
          <h2 className='text-sm font-semibold text-black mb-3 uppercase tracking-wide'>
            共有用URL
          </h2>
          <div className='flex items-stretch gap-2'>
            <input
              readOnly
              value={url}
              className='flex-1 text-sm text-black font-mono bg-white border border-gray-300 rounded px-3 py-2 focus:outline-none'
            />
            <button
              type='button'
              onClick={() => copyText(url, "url")}
              className='px-3 py-2 text-sm bg-neutral-900 hover:bg-black text-white rounded border border-neutral-900 whitespace-nowrap'
            >
              {copiedTarget === "url" ? "コピー済み" : "コピー"}
            </button>
          </div>
        </section>

        <section className='bg-white border border-gray-300 rounded-xl p-4 shadow-sm'>
          <h2 className='text-sm font-semibold text-black mb-3 uppercase tracking-wide'>
            roomId
          </h2>
          <div className='flex items-stretch gap-2'>
            <input
              readOnly
              value={roomId}
              className='flex-1 text-lg font-bold text-black font-mono bg-white border border-gray-300 rounded px-3 py-2 focus:outline-none'
            />
            <button
              type='button'
              onClick={() => copyText(roomId, "roomId")}
              className='px-3 py-2 text-sm bg-neutral-900 hover:bg-black text-white rounded border border-neutral-900 whitespace-nowrap'
            >
              {copiedTarget === "roomId" ? "コピー済み" : "コピー"}
            </button>
          </div>
        </section>

        <section className='bg-white border border-gray-300 rounded-xl p-4 space-y-4 shadow-sm'>
          <h2 className='text-sm font-semibold text-black uppercase tracking-wide'>
            ファイル送信
          </h2>

          <div className='space-y-2'>
            <div className='flex gap-3'>
              <label
                htmlFor='file-input'
                className='flex-1 flex items-center justify-center px-4 py-2 bg-stone-200 hover:bg-stone-300 text-black rounded-lg cursor-pointer transition-all font-medium border border-gray-400'
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
                className='px-4 py-2 bg-neutral-900 hover:bg-black disabled:bg-gray-300 disabled:text-gray-500 text-white rounded-lg font-bold transition-all'
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

          {receivedFiles.length > 0 && (
            <div className='space-y-2'>
              <h3 className='text-sm font-semibold text-black'>
                受信したファイル
              </h3>
              <div className='space-y-2 max-h-32 overflow-y-auto'>
                {receivedFiles.map((f, i) => (
                  <a
                    key={i}
                    href={f.url}
                    download={f.name}
                    className='block px-4 py-3 text-sm bg-stone-50 hover:bg-stone-100 text-gray-900 rounded-lg transition-all truncate font-medium border border-gray-300'
                  >
                    📥 {f.name}
                  </a>
                ))}
              </div>
            </div>
          )}

          {sentFiles.length > 0 && (
            <div className='space-y-2'>
              <h3 className='text-sm font-semibold text-black'>
                送信したファイル
              </h3>
              <div className='space-y-2 max-h-32 overflow-y-auto'>
                {sentFiles.map((name, i) => (
                  <div
                    key={`${name}-${i}`}
                    className='block px-4 py-3 text-sm bg-stone-50 text-black rounded-lg truncate font-medium border border-gray-300'
                  >
                    📤 {name}
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        <section className='bg-white border border-gray-300 rounded-xl p-4 space-y-4 shadow-sm'>
          <h2 className='text-sm font-semibold text-black uppercase tracking-wide'>
            チャット
          </h2>

          <div className='bg-stone-50 border border-gray-300 rounded-lg p-4 h-[52vh] overflow-y-auto space-y-3'>
            {messages.length === 0 ? (
              <p className='text-sm text-gray-500'>
                メッセージはまだありません
              </p>
            ) : (
              messages.map((m, i) => (
                <div
                  key={i}
                  className={`flex ${m.startsWith("me>") ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-xs px-4 py-2 rounded-lg shadow-sm ${
                      m.startsWith("me>")
                        ? "bg-neutral-900 text-white rounded-br-none"
                        : "bg-stone-300 text-black rounded-bl-none"
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

          <div className='flex gap-3'>
            <input
              type='text'
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder='メッセージを入力...'
              className='flex-1 px-4 py-2 border border-gray-400 bg-white text-black rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-800 focus:border-transparent placeholder-gray-500'
            />
            <button
              onClick={sendMessage}
              className='px-6 py-2 bg-neutral-900 hover:bg-black text-white rounded-lg font-bold transition-all shadow-sm'
            >
              送信
            </button>
          </div>
        </section>
      </div>
    </div>
  );
};

export default RoomIdPage;
