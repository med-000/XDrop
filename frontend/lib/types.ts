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

export type Status = "waiting" | "ready" | "connected";

export type PeerHandlers = {
  onChat?: (text: string) => void;

  onFileMeta?: (meta: { name: string; size: number }) => void;
  onFileChunk?: (chunk: ArrayBuffer) => void;
  onFileDone?: () => void;
};
