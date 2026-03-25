import { Channels } from "./types";

export const createSender = (channels: Channels) => {
  const sendChat = (text: string): boolean => {
    const dc = channels.chat;
    if (!dc || dc.readyState !== "open") return false;

    dc.send(JSON.stringify({ type: "chat", text }));
    return true;
  };

  const sendFile = async (file: File): Promise<boolean> => {
    const dc = channels.file;
    if (!dc || dc.readyState !== "open") return false;

    if (file.size > 100 * 1024 * 1024) {
      console.log("file too large");
      return false;
    }

    try {
      dc.send(
        JSON.stringify({
          type: "file-meta",
          name: file.name,
          size: file.size,
        }),
      );

      const chunkSize = 16 * 1024;
      let offset = 0;

      while (offset < file.size) {
        const slice = file.slice(offset, offset + chunkSize);
        const buffer = await slice.arrayBuffer();

        while (dc.bufferedAmount > 1_000_000) {
          await new Promise((r) => setTimeout(r, 10));
        }

        dc.send(buffer);
        offset += chunkSize;
      }

      dc.send(JSON.stringify({ type: "file-done" }));
      return true;
    } catch (e) {
      console.error("send error", e);
      return false;
    }
  };

  return {
    sendChat,
    sendFile,
  };
};
