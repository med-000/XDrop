import { redirect } from "next/navigation";
import { randomUUID } from "crypto";

function generateRoomId() {
  return randomUUID().slice(0, 6);
}

export default function Home() {
  const roomId = generateRoomId();

  redirect(`/room/${roomId}`);
}
