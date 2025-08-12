// Basic WebRTC + WebSocket signaling client
// Features: rooms, voice chat, screen share (entire screen or window)

const createRoomBtn = document.getElementById('createRoomBtn');
const joinRoomBtn = document.getElementById('joinRoomBtn');
const roomIdInput = document.getElementById('roomIdInput');
const shareLinkDiv = document.getElementById('shareLink');

const lobbySection = document.getElementById('lobby');
const roomSection = document.getElementById('room');
const roomLabel = document.getElementById('roomLabel');

const muteBtn = document.getElementById('muteBtn');
const shareBtn = document.getElementById('shareBtn');
const stopShareBtn = document.getElementById('stopShareBtn');
const leaveBtn = document.getElementById('leaveBtn');

const remoteVideo = document.getElementById('remoteVideo');
const remoteAudio = document.getElementById('remoteAudio');
const localShare = document.getElementById('localShare');
const statusLine = document.getElementById('status');
const remoteMuteBtn = document.getElementById('remoteMuteBtn');
const remoteVolume = document.getElementById('remoteVolume');
const participantsList = document.getElementById('participants');

let ws;
let pc;
let micStream;
let screenStream;
let roomId;
let isMuted = false;
let isRemoteMuted = false;

// Hold composed remote streams to avoid overriding on multiple tracks
const remoteVideoStream = new MediaStream();
const remoteAudioStream = new MediaStream();

// Keep refs to screen share senders to remove later
let screenVideoSender = null;
let screenAudioSender = null;

function logStatus(text) {
  statusLine.textContent = text;
}

function genId() {
  return Math.random().toString(36).slice(2, 10);
}

function initWs() {
  const wsProto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${wsProto}://${location.host}`);
  ws.addEventListener('open', () => {
    ws.send(JSON.stringify({ type: 'join', roomId, payload: { name: myDisplayName() } }));
  });
  ws.addEventListener('message', async (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === 'welcome') {
      selfId = msg.payload?.id;
      selfName = msg.payload?.name || selfName;
      return;
    }
    if (msg.type === 'peer-joined') {
      // New peer joined -> we create and send an offer
      await ensurePeerConnection();
      await makeOffer();
      return;
    }
    if (msg.type === 'room-peers') {
      // If there are already peers, we wait for their offer
      await ensurePeerConnection();
      return;
    }
    if (msg.type === 'roster') {
      const roster = msg.payload?.roster || [];
      renderParticipants(roster);
      return;
    }
    if (msg.type === 'offer') {
      await ensurePeerConnection();
      await pc.setRemoteDescription(new RTCSessionDescription(msg.payload));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      ws.send(JSON.stringify({ type: 'answer', roomId, payload: answer }));
      return;
    }
    if (msg.type === 'answer') {
      if (pc) {
        await pc.setRemoteDescription(new RTCSessionDescription(msg.payload));
      }
      return;
    }
    if (msg.type === 'ice-candidate') {
      if (pc && msg.payload) {
        try { await pc.addIceCandidate(msg.payload); } catch (e) { console.warn(e); }
      }
      return;
    }
    if (msg.type === 'peer-left') {
      // Keep UI simple: we do not tear down; remote tracks will end
      logStatus('Пир вышел из комнаты');
      return;
    }
  });
}

async function ensurePeerConnection() {
  if (pc) return;
  pc = new RTCPeerConnection({
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
    ],
  });

  pc.onicecandidate = (e) => {
    if (e.candidate) {
      ws.send(JSON.stringify({ type: 'ice-candidate', roomId, payload: e.candidate }));
    }
  };
  pc.ontrack = (e) => {
    const track = e.track;
    if (track.kind === 'video') {
      remoteVideoStream.addTrack(track);
      if (remoteVideo.srcObject !== remoteVideoStream) {
        remoteVideo.srcObject = remoteVideoStream;
      }
    } else if (track.kind === 'audio') {
      remoteAudioStream.addTrack(track);
      if (remoteAudio.srcObject !== remoteAudioStream) {
        remoteAudio.srcObject = remoteAudioStream;
        remoteAudio.volume = (Number(remoteVolume?.value) || 100) / 100;
        remoteAudio.muted = isRemoteMuted;
        remoteAudio.play?.().catch(() => {});
      }
    }

    // Remove ended tracks from our composed streams
    track.addEventListener('ended', () => {
      if (track.kind === 'video') {
        remoteVideoStream.removeTrack(track);
      } else if (track.kind === 'audio') {
        remoteAudioStream.removeTrack(track);
      }
    });
  };

  // Get mic audio by default
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    for (const track of micStream.getTracks()) {
      pc.addTrack(track, micStream);
    }
  } catch (e) {
    logStatus('Не удалось получить доступ к микрофону');
  }
}

async function makeOffer() {
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  ws.send(JSON.stringify({ type: 'offer', roomId, payload: offer }));
}

function teardown() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'leave', roomId }));
  }
  if (pc) {
    pc.close();
    pc = null;
  }
  if (micStream) {
    micStream.getTracks().forEach(t => t.stop());
    micStream = null;
  }
  if (screenStream) {
    screenStream.getTracks().forEach(t => t.stop());
    screenStream = null;
  }
  remoteVideo.srcObject = null;
  remoteAudio.srcObject = null;
  localShare.srcObject = null;
}

createRoomBtn.addEventListener('click', () => {
  const id = genId();
  roomIdInput.value = id;
  const url = `${location.origin}?room=${id}`;
  shareLinkDiv.textContent = `Ссылка для приглашения: ${url}`;
});

joinRoomBtn.addEventListener('click', async () => {
  const id = (roomIdInput.value || '').trim();
  if (!id) return;
  roomId = id;
  window.history.replaceState({}, '', `?room=${encodeURIComponent(roomId)}`);
  lobbySection.classList.add('hidden');
  roomSection.classList.remove('hidden');
  roomLabel.textContent = `Комната: ${roomId}`;
  initWs();
});

muteBtn.addEventListener('click', () => {
  if (!micStream) return;
  isMuted = !isMuted;
  micStream.getAudioTracks().forEach(t => t.enabled = !isMuted);
  muteBtn.textContent = isMuted ? '🔊 Включить микрофон' : '🔇 Микрофон';
});

shareBtn.addEventListener('click', async () => {
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { displaySurface: 'monitor' },
      audio: true,
    });
    screenStream = stream;
    localShare.srcObject = stream;

    // Add or replace the existing sender for video
    const videoTrack = stream.getVideoTracks()[0];
    if (videoTrack) {
      const existingVideoSender = screenVideoSender || pc.getSenders().find(s => s.track && s.track.kind === 'video');
      if (existingVideoSender) {
        await existingVideoSender.replaceTrack(videoTrack);
        screenVideoSender = existingVideoSender;
      } else {
        screenVideoSender = pc.addTrack(videoTrack, stream);
      }
    }

    // Add screen audio in addition to mic if present
    const screenAudioTrack = stream.getAudioTracks()[0];
    if (screenAudioTrack) {
      if (screenAudioSender) {
        await screenAudioSender.replaceTrack(screenAudioTrack);
      } else {
        screenAudioSender = pc.addTrack(screenAudioTrack, stream);
      }
    }

    // React to user stopping share from browser UI
    if (videoTrack) {
      videoTrack.addEventListener('ended', async () => {
        await stopSharing();
      });
    }

    // Renegotiate
    await makeOffer();
  } catch (e) {
    logStatus('Шеринг экрана отменён или не поддерживается');
  }
});

async function stopSharing() {
  if (!pc) return;
  if (screenVideoSender) {
    try { pc.removeTrack(screenVideoSender); } catch {}
    screenVideoSender = null;
  }
  if (screenAudioSender) {
    try { pc.removeTrack(screenAudioSender); } catch {}
    screenAudioSender = null;
  }
  if (screenStream) {
    screenStream.getTracks().forEach(t => t.stop());
    screenStream = null;
  }
  localShare.srcObject = null;
  // Renegotiate to remove video m-line
  await makeOffer();
}

stopShareBtn.addEventListener('click', stopSharing);

leaveBtn.addEventListener('click', () => {
  teardown();
  lobbySection.classList.remove('hidden');
  roomSection.classList.add('hidden');
});

// Local control over remote audio
remoteMuteBtn?.addEventListener('click', () => {
  isRemoteMuted = !isRemoteMuted;
  if (remoteAudio) remoteAudio.muted = isRemoteMuted;
  remoteMuteBtn.textContent = isRemoteMuted ? '🔊 Включить звук собеседника' : '🔇 Заглушить собеседника';
});

remoteVolume?.addEventListener('input', (e) => {
  const val = Number(e.target.value) || 0;
  if (remoteAudio) remoteAudio.volume = val / 100;
});

// Simple identity helpers (can be extended to prompt user)
let selfId = null;
let selfName = `Вы`;
function myDisplayName() { return selfName; }

function renderParticipants(roster) {
  if (!participantsList) return;
  participantsList.innerHTML = '';
  for (const p of roster) {
    const li = document.createElement('li');
    const nameSpan = document.createElement('span');
    nameSpan.className = 'name';
    nameSpan.textContent = p.id === selfId ? `${p.name} (вы)` : p.name;
    const youPill = document.createElement('span');
    if (p.id === selfId) {
      youPill.className = 'pill';
      youPill.textContent = 'you';
    }
    li.appendChild(nameSpan);
    if (p.id === selfId) li.appendChild(youPill);
    participantsList.appendChild(li);
  }
}

// Auto-join if room param exists
const params = new URLSearchParams(location.search);
const autoRoom = params.get('room');
if (autoRoom) {
  roomIdInput.value = autoRoom;
}


