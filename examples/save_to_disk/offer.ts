import { RTCPeerConnection } from "../../src";
import { Server } from "ws";
import { exec } from "child_process";
import { createSocket } from "dgram";

const gst = exec(`gst-launch-1.0 -e \
udpsrc name=videoRTP port=4002 \
caps = "application/x-rtp, media=(string)video, clock-rate=(int)90000, encoding-name=(string)VP8, payload=(int)97" \
! queue \
! rtpvp8depay ! vp8dec ! videoconvert ! x264enc \
! queue ! muxer.video_0 \
udpsrc port=4003 \
caps = "application/x-rtp, media=(string)audio, clock-rate=(int)48000, encoding-name=(string)OPUS, payload=(int)96" \
! queue \
! rtpopusdepay ! opusparse \
! queue ! muxer.audio_0 \
qtmux name="muxer" ! filesink location=../capture.webm`);

gst.stdout.on("data", (data) => console.log(data.toString()));

process.on("SIGINT", () => {
  gst.kill("SIGINT");
  process.exit();
});

const udp = createSocket("udp4");
const server = new Server({ port: 8888 });
console.log("start");

server.on("connection", async (socket) => {
  const pc = new RTCPeerConnection({});

  {
    const transceiver = pc.addTransceiver("video", "sendrecv");
    transceiver.onTrack.subscribe((track) => {
      track.onRtp.subscribe((rtp) => {
        transceiver.sendRtp(rtp);
        udp.send(rtp.serialize(), 4002, "127.0.0.1");
      });
      track.onRtp.once(() => {
        setInterval(() => transceiver.receiver.sendRtcpPLI(track.ssrc), 2000);
      });
    });
  }
  {
    const transceiver = pc.addTransceiver("audio", "sendrecv");
    transceiver.onTrack.subscribe((track) => {
      track.onRtp.subscribe((rtp) => {
        transceiver.sendRtp(rtp);
        udp.send(rtp.serialize(), 4003, "127.0.0.1");
      });
    });
  }

  const offer = pc.createOffer();
  await pc.setLocalDescription(offer);
  const sdp = JSON.stringify(pc.localDescription);
  socket.send(sdp);

  socket.on("message", (data: any) => {
    pc.setRemoteDescription(JSON.parse(data));
  });
});
