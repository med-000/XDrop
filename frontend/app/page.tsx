"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function JoinRoom() {
  const [roomId, setRoomId] = useState("");
  const router = useRouter();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!roomId) return;

    router.push(`/room/${roomId}`);
  };

  return (
    <form onSubmit={handleSubmit}>
      <input
        value={roomId}
        onChange={(e) => setRoomId(e.target.value)}
        placeholder='room id'
      />
      <button type='submit'>Join</button>
    </form>
  );
}
