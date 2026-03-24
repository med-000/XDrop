import { Config } from "./config";
import { peerData } from "./types";
import { setupDataChannel } from "./datachannel";

//PeerConnection
let pc: RTCPeerConnection | null = null;
//DataConnection
let dc: RTCDataChannel | null = null;

//websocketにdataを送る
export const sendSignal = (ws: WebSocket, data: peerData) => {
  ws.send(JSON.stringify(data));
};

//RTCpcconnectionの作成
export const createPeerConnection = (ws: WebSocket): RTCPeerConnection => {
  pc = new RTCPeerConnection(Config);
  //iceが見つかるイベント(iceが見つかるたびに呼び出される)
  pc.onicecandidate = (event) => {
    //ice見つからなかったら何も返さない
    if (!event.candidate) {
      console.log("candidateが見つかりませんでした");
      return;
    }

    //見つかればcandidateを送る
    sendSignal(ws, {
      type: "candidate",
      candidate: event.candidate,
    });
  };

  //ここの理解が浅い
  pc.ondatachannel = (event) => {
    dc = event.channel;

    setupDataChannel(dc);
  };

  return pc;
};

//offercandidate作成
export const startOffer = async (ws: WebSocket, pc: RTCPeerConnection) => {
  createPeerConnection(ws);

  dc = pc.createDataChannel("chat");

  setupDataChannel(dc);

  const offer = await pc.createOffer();
  if (!offer.sdp) {
    console.log("offer.sdpが見つかりませんでした");
    return;
  }
  //自分の通信条件をsetting
  await pc.setLocalDescription(offer);

  sendSignal(ws, {
    type: "offer",
    sdp: offer.sdp,
  });
};

//offer受信
export const handleOffer = async (
  ws: WebSocket,
  pc: RTCPeerConnection,
  sdp: string,
) => {
  createPeerConnection(ws);

  //自分に受け取った情報をsetting
  await pc.setRemoteDescription({
    type: "offer",
    sdp: sdp,
  });

  const answer = await pc.createAnswer();
  if (!answer.sdp) {
    console.log("answer.sdpが見つかりませんでした");
    return;
  }

  //相手に送る情報を自分にsetting
  await pc.setLocalDescription(answer);

  sendSignal(ws, {
    type: "answer",
    sdp: answer.sdp,
  });
};

//answer受信
export const handleAnswer = async (pc: RTCPeerConnection, sdp: string) => {
  await pc.setRemoteDescription({
    type: "answer",
    sdp: sdp,
  });
};

//candidate受信
export const handleCandidate = async (
  pc: RTCPeerConnection,
  candidate: RTCIceCandidateInit,
) => {
  if (!pc) return;
  await pc.addIceCandidate(candidate);
};
