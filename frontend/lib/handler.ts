export const createFileReceiver = (
  onComplete: (file: { name: string; url: string }) => void,
) => {
  let buffers: ArrayBuffer[] = [];
  let meta: { name: string; size: number } | null = null;

  return {
    onMeta: (m: { name: string; size: number }) => {
      meta = m;
      buffers = [];
    },

    onChunk: (chunk: ArrayBuffer) => {
      buffers.push(chunk);
    },

    onDone: () => {
      if (!meta) return;

      const blob = new Blob(buffers);
      const url = URL.createObjectURL(blob);

      // 👇 UI側に渡す
      onComplete({
        name: meta.name,
        url,
      });

      // reset
      buffers = [];
      meta = null;
    },
  };
};
