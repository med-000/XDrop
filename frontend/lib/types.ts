export type peerData =
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
