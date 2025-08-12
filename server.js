const express = require('express');
const http = require('http');
const path = require('path');
const { WebSocketServer } = require('ws');
const { v4: uuidv4 } = require('uuid');

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

function getRoomRoster(roomId) {
  const clients = roomIdToClients.get(roomId);
  if (!clients) return [];
  const roster = [];
  for (const client of clients) {
    roster.push({ id: client._peerId, name: client._displayName || 'Гость' });
  }
  return roster;
}

function sendRoster(roomId) {
  const clients = roomIdToClients.get(roomId);
  if (!clients) return;
  const roster = getRoomRoster(roomId);
  const message = JSON.stringify({ type: 'roster', payload: { roster } });
  for (const client of clients) {
    if (client.readyState === 1) client.send(message);
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
      // Assign identity
      ws._peerId = uuidv4();
      ws._displayName = payload?.name || `Гость-${String(ws._peerId).slice(0, 4)}`;

      joinRoom(ws, roomId);
      // Notify others a new peer joined
      broadcastToRoom(roomId, { type: 'peer-joined' }, ws);
      // Tell the new peer how many are in room (for UI if needed)
      const size = roomIdToClients.get(roomId)?.size || 1;
      ws.send(JSON.stringify({ type: 'room-peers', payload: { count: size - 1 } }));
      // Welcome with self id
      ws.send(JSON.stringify({ type: 'welcome', payload: { id: ws._peerId, name: ws._displayName } }));
      // Broadcast roster to all (including the new peer)
      sendRoster(roomId);
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
      sendRoster(roomId);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening on http://0.0.0.0:${PORT}`);
});


