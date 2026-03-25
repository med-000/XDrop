export type PeerData =
  | {
      type: "ready";
    }
  | {
      type: "role";
      role: "offer" | "answer";
    }
  | {
      type: "offer";
      sdp: string;
    }
  | {
      type: "answer";
      sdp: string;
    }
  | {
      type: "candidate";
      candidate: RTCIceCandidateInit;
    }
  | {
      type: "joined";
      role: "offer" | "answer";
    };

export type Channels = {
  chat?: RTCDataChannel;
  file?: RTCDataChannel;
};
