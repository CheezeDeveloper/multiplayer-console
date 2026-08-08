const express = require('express');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');

const { createRoom, getRoom, listRooms } = require('./rooms');
const { processCommand, leaveCurrentRoom, getTimestamp } = require('./commands');
const accounts = require('./accounts');
const { hashPassword, verifyPassword } = require('./crypto-utils');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static(path.join(__dirname, 'public')));

const clients = new Map();
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

function setAuthMode(client, enabled) {
    if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(JSON.stringify({ type: 'authmode', enabled }));
    }
}

function findClientById(sessionId) {
    for (const c of clients.values()) {
        if (c.id === sessionId) return c;
    }
    return null;
}

function broadcastToRoom(roomName, text, cls = '', excludeSessionId = null) {
    const room = getRoom(roomName);
    if (!room) return;
    for (const sessionId of room.users.keys()) {
        if (sessionId === excludeSessionId) continue;
        const target = findClientById(sessionId);
        if (target) send(target.ws, text, cls);
    }
}

function broadcastChatMessage(roomName, senderSessionId, nickname, text) {
    const room = getRoom(roomName);
    if (!room) return;
    const timeStr = getTimestamp();
    for (const sessionId of room.users.keys()) {
        const target = findClientById(sessionId);
        if (!target) continue;
        const isSender = sessionId === senderSessionId;
        const displayName = isSender ? 'YOU' : nickname;
        const cls = isSender ? 'bright' : '';
        send(target.ws, `${timeStr} ${displayName.padEnd(11).slice(0, 11)}${text}`, cls);
    }
}

function buildContext(ts) {
    return {
        send, sendPrompt, sendClear, broadcastToRoom,
        createRoom, getRoom, listRooms,
        findClientById, ts,
        findAccountById: accounts.findAccountById,
        findAccountByNickname: accounts.findAccountByNickname,
        updateNickname: accounts.updateNickname,
        setPassword: accounts.setPassword,
        removePassword: accounts.removePassword,
        hashPassword, verifyPassword,
    };
}

wss.on('connection', (ws, req) => {
    clientCounter++;
    const sessionId = `s${clientCounter}_${Date.now()}`;
    const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'UNKNOWN')
        .split(',')[0].trim();

    const clientData = {
        id: sessionId,
        ws,
        ip,
        nickname: generateGuestName(),
        room: null,
        isAdmin: false,
        loggedInAccountId: null,
        pendingAccount: null,
        authState: 'ready',
    };

    clients.set(ws, clientData);

    let account = accounts.findAccountByIp(ip);

    function printBanner() {
        send(ws, 'Microsoft(R) MS-DOS(R) Version 6.30', '');
        send(ws, '         (C)Copyright Microsoft Corp 1981-1995.', '');
        send(ws, '', '');
    }

    if (!account) {
        account = accounts.createAccount(ip, clientData.nickname);
        clientData.loggedInAccountId = account.id;
        clientData.nickname = account.nickname;

        printBanner();
        send(ws, 'MULTIPLAYER CONSOLE v1.0', 'bright');
        send(ws, 'MPCMD.EXE loaded successfully.', '');
        send(ws, '', '');
        send(ws, `[SYSTEM] New account registered for this connection: ${account.nickname}`, 'bright');
        send(ws, `[SYSTEM] Use /nick <name> to set a permanent nickname.`, '');
        send(ws, `[SYSTEM] Use /password add <password> to secure your account.`, '');
        send(ws, '', '');
        send(ws, 'Type "connect /find" to browse available rooms.', '');
        send(ws, 'Type "connect /server=NAME" to join a specific room.', '');
        send(ws, 'Type "connect create /server=NAME" to create your own room.', '');
        send(ws, '/help for a full command list.', '');
        send(ws, '', '');
        sendPrompt(clientData);

    } else if (account.passwordHash) {
        clientData.pendingAccount = account;
        clientData.authState = 'awaiting_password';

        printBanner();
        send(ws, `[SYSTEM] This connection is registered to account: ${account.nickname}`, 'bright');
        send(ws, `[SYSTEM] Enter password to login, or type /guest to continue as a guest.`, '');
        send(ws, '', '');
        setAuthMode(clientData, true);

    } else {
        clientData.loggedInAccountId = account.id;
        clientData.nickname = account.nickname;

        printBanner();
        send(ws, 'MULTIPLAYER CONSOLE v1.0', 'bright');
        send(ws, '', '');
        send(ws, `[SYSTEM] Welcome back, ${account.nickname}.`, 'bright');
        send(ws, '', '');
        send(ws, 'Type "connect /find" to browse available rooms.', '');
        send(ws, 'Type "connect /server=NAME" to join a specific room.', '');
        send(ws, 'Type "connect create /server=NAME" to create your own room.', '');
        send(ws, '/help for a full command list.', '');
        send(ws, '', '');
        sendPrompt(clientData);
    }

    ws.on('message', (raw) => {
        let data;
        try { data = JSON.parse(raw); } catch (e) { return; }
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

    if (client.authState === 'awaiting_password') {
        if (text.toLowerCase() === '/guest') {
            client.authState = 'ready';
            client.loggedInAccountId = null;
            client.pendingAccount = null;
            client.nickname = generateGuestName();
            setAuthMode(client, false);
            send(client.ws, `[SYSTEM] Continuing as guest: ${client.nickname}`, 'bright');
            send(client.ws, '', '');
            sendPrompt(client);
            return;
        }

        const account = client.pendingAccount;
        if (verifyPassword(text, account.passwordHash)) {
            client.authState = 'ready';
            client.loggedInAccountId = account.id;
            client.nickname = account.nickname;
            client.pendingAccount = null;
            setAuthMode(client, false);
            send(client.ws, `[SYSTEM] Login successful. Welcome back, ${account.nickname}.`, 'bright');
            send(client.ws, '', '');
            sendPrompt(client);
        } else {
            send(client.ws, 'Incorrect password. Try again, or type /guest to continue as a guest.', 'error');
        }
        return;
    }

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
