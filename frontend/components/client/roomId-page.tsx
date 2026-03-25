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
  return (
    <div>
      <div>hello0s</div>

      {/* 🔥 状態表示 */}
      <div>Status: {statusLabel[status]}</div>
      <div>Your URL: {url}</div>
      <QRCodeSVG value={url} />

      {/* 入力 */}
      <input value={input} onChange={(e) => setInput(e.target.value)} />

      {/* 送信 */}
      <button onClick={sendMessage}>send</button>

      {/* 表示 */}
      <div>
        {messages.map((m, i) => (
          <div key={i}>{m}</div>
        ))}
      </div>

      <input
        type='file'
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;

          const sender = createSender(channelsRef.current);
          const ok = await sender.sendFile(file);

          if (!ok) {
            console.log("file send failed");
          }
        }}
      />

      {/* received files */}
      <div>
        <div>Received Files</div>
        {receivedFiles.map((f, i) => (
          <a key={i} href={f.url} download={f.name}>
            {f.name}
          </a>
        ))}
      </div>
    </div>
  );
};

export default RoomIdPage;
