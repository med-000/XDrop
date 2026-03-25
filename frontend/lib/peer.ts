import { PeerData, Channels } from "./types";
import { setupDataChannel } from "./datachannel";

//websocketにdataを送る
export const sendSignal = (ws: WebSocket, data: PeerData) => {
  ws.send(JSON.stringify(data));
};

//RTCpcconnectionの作成
export const createPeerConnection = (
  ws: WebSocket,
  pc: RTCPeerConnection,
  channels: Channels,
  onMessage: (msg: string) => void,
) => {
  console.log("create peerConnection");
  //iceが見つかるイベント(iceが見つかるたびに呼び出される)
  pc.onicecandidate = (event) => {
    //ice見つからなかったら何も返さない
    if (!event.candidate) {
      console.log("candidate not found");
      return;
    }

    //見つかればcandidateを送る
    console.log("send candidate");
    sendSignal(ws, {
      type: "candidate",
      candidate: event.candidate,
    });
  };

  //ここの理解が浅い
  pc.ondatachannel = (event) => {
    const dc = event.channel;

    if (dc.label === "chat") {
      channels.chat = dc;
    } else if (dc.label === "file") {
      channels.file = dc;
    }

    setupDataChannel(dc, onMessage);
  };
};

//offercandidate作成
export const startOffer = async (
  ws: WebSocket,
  pc: RTCPeerConnection,
  channels: Channels,
  onMessage: (msg: string) => void,
) => {
  const chatdc = pc.createDataChannel("chat");
  const filedc = pc.createDataChannel("file");

  channels.chat = chatdc;
  channels.file = filedc;

  setupDataChannel(chatdc, onMessage);
  setupDataChannel(filedc, onMessage);

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
  console.log("send offer");
};

//offer受信
export const handleOffer = async (
  ws: WebSocket,
  pc: RTCPeerConnection,
  sdp: string,
) => {
  console.log("get offer");
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
  console.log("send answer");
};

//answer受信
export const handleAnswer = async (pc: RTCPeerConnection, sdp: string) => {
  console.log("get answer");
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
  console.log("get candidate");
  await pc.addIceCandidate(candidate);
};
