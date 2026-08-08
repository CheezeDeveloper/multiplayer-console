const express = require('express');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');

const { createRoom, getRoom, deleteRoomIfEmpty, listRooms } = require('./rooms');
const { processCommand, leaveCurrentRoom, getTimestamp } = require('./commands');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static(path.join(__dirname, 'public')));

const clients = new Map(); // ws -> clientData
let clientCounter = 0;

function generateGuestName() {
    const num = Math.floor(1000 + Math.random() * 9000);
    return `GUEST${num}`;
}

function send(ws, text, cls = '') {
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'line', text, cls }));
    }
}

function sendPrompt(client) {
    const promptText = client.room ? `C:\\CHAT\\${client.room}>` : `C:\\CHAT>`;
    if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(JSON.stringify({ type: 'prompt', text: promptText }));
    }
}

function sendClear(client) {
    if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(JSON.stringify({ type: 'clear' }));
    }
}

function findClientById(id) {
    for (const clientData of clients.values()) {
        if (clientData.id === id) return clientData;
    }
    return null;
}

function broadcastToRoom(roomName, text, cls = '', excludeClientId = null) {
    const room = getRoom(roomName);
    if (!room) return;
    for (const clientId of room.users.keys()) {
        if (clientId === excludeClientId) continue;
        const target = findClientById(clientId);
        if (target) send(target.ws, text, cls);
    }
}

function broadcastChatMessage(roomName, senderId, nickname, text) {
    const room = getRoom(roomName);
    if (!room) return;
    const timeStr = getTimestamp();
    for (const clientId of room.users.keys()) {
        const target = findClientById(clientId);
        if (!target) continue;
        const isSender = clientId === senderId;
        const displayName = isSender ? 'YOU' : nickname;
        const cls = isSender ? 'bright' : '';
        send(target.ws, `${timeStr} ${displayName.padEnd(11).slice(0, 11)}${text}`, cls);
    }
}

function buildContext(ts) {
    return {
        send, sendPrompt, sendClear, broadcastToRoom,
        createRoom, getRoom, deleteRoomIfEmpty, listRooms,
        findClientById, ts,
    };
}

wss.on('connection', (ws, req) => {
    clientCounter++;
    const id = `c${clientCounter}_${Date.now()}`;
    const ip = req.socket.remoteAddress || 'UNKNOWN';

    const clientData = {
        id,
        ws,
        nickname: generateGuestName(),
        room: null,
        isAdmin: false,
        ip,
    };

    clients.set(ws, clientData);

    // Boot sequence
    send(ws, 'Microsoft(R) MS-DOS(R) Version 6.30', '');
    send(ws, '         (C)Copyright Microsoft Corp 1981-1995.', '');
    send(ws, '', '');
    send(ws, 'MULTIPLAYER CONSOLE v1.0', 'bright');
    send(ws, 'MPCMD.EXE loaded successfully.', '');
    send(ws, '', '');
    send(ws, `You are connected as: ${clientData.nickname}`, '');
    send(ws, 'Type "connect /find" to browse available rooms.', '');
    send(ws, 'Type "connect /server=NAME" to join a specific room.', '');
    send(ws, 'Type "connect create /server=NAME" to create your own room.', '');
    send(ws, 'Type /help for a full command list.', '');
    send(ws, '', '');
    sendPrompt(clientData);

    ws.on('message', (raw) => {
        let data;
        try {
            data = JSON.parse(raw);
        } catch (e) {
            return;
        }

        if (data.type !== 'input') return;
        const text = (data.text || '').toString().trim();
        if (!text) return;

        handleInput(clientData, text, data.ts || Date.now());
    });

    ws.on('close', () => {
        if (clientData.room) {
            leaveCurrentRoom(clientData, buildContext(Date.now()));
        }
        clients.delete(ws);
    });
});

function handleInput(client, text, ts) {
    const isCommand = text.startsWith('/') || text.toLowerCase().startsWith('connect');

    if (isCommand) {
        const promptStr = client.room ? `C:\\CHAT\\${client.room}>` : `C:\\CHAT>`;
        send(client.ws, `${promptStr}${text}`, '');
        processCommand(client, text, buildContext(ts));
    } else {
        if (!client.room) {
            send(client.ws, 'Not connected to any server. Type "connect /find" first.', 'error');
            return;
        }

        const room = getRoom(client.room);
        if (!room) {
            send(client.ws, 'Room no longer exists.', 'error');
            client.room = null;
            sendPrompt(client);
            return;
        }

        const userInfo = room.users.get(client.id);
        if (userInfo && userInfo.muted) {
            send(client.ws, 'You are muted and cannot send messages.', 'error');
            return;
        }

        broadcastChatMessage(client.room, client.id, client.nickname, text);
    }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Multiplayer Console server running on port ${PORT}`);
});
