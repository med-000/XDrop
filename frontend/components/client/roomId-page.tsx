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

import { Channels } from "@/lib/types";

type RoomIdPageProps = {
  roomId: string;
};

const RoomIdPage = ({ roomId }: RoomIdPageProps) => {
  const initialized = useRef(false);
  const channelsRef = useRef<Channels>({});

  const [messages, setMessages] = useState<string[]>([]);
  const [input, setInput] = useState("");
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    const protocol = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${protocol}://${location.host}/ws/${roomId}`);
    const pc = new RTCPeerConnection(Config);

    const handleMessage = (msg: string) => {
      setMessages((prev) => [`other> ${msg}`, ...prev]);
    };
    createPeerConnection(ws, pc, channelsRef.current, handleMessage);

    ws.onopen = () => {
      console.log("ws connected");
      startOffer(ws, pc, channelsRef.current, handleMessage);
    };
    ws.onmessage = async (event) => {
      const msg = JSON.parse(event.data);

      switch (msg.type) {
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
      console.log("dcがない");
      return;
    }

    if (dc.readyState !== "open") {
      console.log("dc openじゃない");
      return;
    }

    dc.send(input);

    setMessages((prev) => [`me> ${input}`, ...prev]);
    setInput("");
  };
  return (
    <div>
      <div>hello0s</div>

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
