const express = require('express');
const http = require('http');
const path = require('path');
const { WebSocketServer } = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// In-memory room registry: roomId -> Set of ws
const roomIdToClients = new Map();

function joinRoom(ws, roomId) {
  if (!roomIdToClients.has(roomId)) {
    roomIdToClients.set(roomId, new Set());
  }
  const clients = roomIdToClients.get(roomId);
  clients.add(ws);
  ws._roomId = roomId;
}

function leaveRoom(ws) {
  const roomId = ws._roomId;
  if (!roomId) return;
  const clients = roomIdToClients.get(roomId);
  if (!clients) return;
  clients.delete(ws);
  if (clients.size === 0) {
    roomIdToClients.delete(roomId);
  }
}

function broadcastToRoom(roomId, data, exceptWs) {
  const clients = roomIdToClients.get(roomId);
  if (!clients) return;
  for (const client of clients) {
    if (client !== exceptWs && client.readyState === 1) {
      client.send(JSON.stringify(data));
    }
  }
}

wss.on('connection', (ws) => {
  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch {
      return;
    }
    const { type, roomId, payload } = msg || {};
    if (type === 'join') {
      joinRoom(ws, roomId);
      // Notify others a new peer joined
      broadcastToRoom(roomId, { type: 'peer-joined' }, ws);
      // Tell the new peer how many are in room (for UI if needed)
      const size = roomIdToClients.get(roomId)?.size || 1;
      ws.send(JSON.stringify({ type: 'room-peers', payload: { count: size - 1 } }));
      return;
    }
    if (!ws._roomId) return;
    // Relay WebRTC signaling messages within the room
    if (['offer', 'answer', 'ice-candidate', 'leave'].includes(type)) {
      broadcastToRoom(ws._roomId, { type, payload }, ws);
    }
  });

  ws.on('close', () => {
    const roomId = ws._roomId;
    leaveRoom(ws);
    if (roomId) {
      broadcastToRoom(roomId, { type: 'peer-left' }, ws);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});


