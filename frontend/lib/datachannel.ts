export const setupDataChannel = (
  channel: RTCDataChannel,
  onMessage: (msg: string) => void,
) => {
  channel.onopen = () => {
    console.log(`${channel.label} open`);
  };

  channel.onmessage = (event) => {
    onMessage(event.data);
  };

  channel.onclose = () => {
    console.log(`${channel.label} closed`);
  };
};
