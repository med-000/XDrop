export const setupDataChannel = (channel: RTCDataChannel) => {
  channel.onopen = () => {
    console.log("DataChannel open");
  };

  channel.onmessage = (event) => {};
};
