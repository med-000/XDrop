import { PeerHandlers } from "./types";

export const setupDataChannel = (
  channel: RTCDataChannel,
  handlers: PeerHandlers,
) => {
  channel.onopen = () => {
    console.log(`${channel.label} open`);
  };

  channel.onmessage = async (event) => {
    const data = event.data;

    // ===== JSON =====
    if (typeof data === "string") {
      let msg: any;

      try {
        msg = JSON.parse(data);
      } catch {
        console.error("invalid JSON:", data);
        return;
      }

      switch (msg.type) {
        case "chat":
          handlers.onChat?.(msg.text);
          break;

        case "file-meta":
          handlers.onFileMeta?.(msg);
          break;

        case "file-done":
          handlers.onFileDone?.();
          break;

        default:
          console.warn("unknown message type:", msg);
      }

      return;
    }

    // ===== binary =====
    if (data instanceof ArrayBuffer) {
      handlers.onFileChunk?.(data);
    } else if (data instanceof Blob) {
      const buffer = await data.arrayBuffer();
      handlers.onFileChunk?.(buffer);
    } else {
      console.warn("unknown binary type:", data);
    }
  };

  channel.onclose = () => {
    console.log(`${channel.label} closed`);
  };
};
