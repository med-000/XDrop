import { startOffer } from "./peer";
import { handleOffer, handleAnswer, handleCandidate } from "./peer";

export const webSocketOpen = (ws: WebSocket, pc: RTCPeerConnection) => {
  ws.onopen = () => {
    console.log("ws connected");
  };
  startOffer(ws, pc);
};

export const webSocketMessageGet = (ws: WebSocket, pc: RTCPeerConnection) => {
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
        await handleCandidate(pc, msg);
        break;
    }
  };
};
