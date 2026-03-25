"use client";
import { useEffect, useRef, useState } from "react";
import { Config } from "@/lib/config";
import { startOffer } from "@/lib/peer";
import {
  handleOffer,
  handleAnswer,
  handleCandidate,
  createPeerConnection,
} from "@/lib/peer";

import { Channels, Status } from "@/lib/types";

type RoomIdPageProps = {
  roomId: string;
};

const RoomIdPage = ({ roomId }: RoomIdPageProps) => {
  const initialized = useRef(false);
  const channelsRef = useRef<Channels>({});
  const roleRef = useRef<"offer" | "answer" | null>(null);

  const [messages, setMessages] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<Status>("waiting");
  const statusLabel = {
    waiting: "Waiting for another user...",
    ready: "User joined. Ready to connect.",
    connected: "Connected 🎉",
  };
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

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

    const handleMessage = (msg: string) => {
      setMessages((prev) => [`other> ${msg}`, ...prev]);
    };
    createPeerConnection(ws, pc, channelsRef.current, handleMessage);

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
            startOffer(ws, pc, channelsRef.current, handleMessage);
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
    const dc = channelsRef.current.chat;

    if (!dc) {
      console.log("dc not found");
      return;
    }

    if (dc.readyState !== "open") {
      console.log("dc not open");
      return;
    }

    dc.send(input);

    setMessages((prev) => [`me> ${input}`, ...prev]);
    setInput("");
  };
  return (
    <div>
      <div>hello0s</div>

      {/* 🔥 状態表示 */}
      <div>Status: {statusLabel[status]}</div>

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
    </div>
  );
};

export default RoomIdPage;
