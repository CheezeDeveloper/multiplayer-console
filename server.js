const express = require('express');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');

const db = require('./db');
const { createRoom, getRoom, getRoomSync, listRooms } = require('./rooms');
const { processCommand, leaveCurrentRoom, getTimestamp } = require('./commands');
const accounts = require('./accounts');
const { hashPassword, verifyPassword } = require('./crypto-utils');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static(path.join(__dirname, 'public')));

const clients = new Map();
let clientCounter = 0;

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

function sendCustomPrompt(client, text) {
    if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(JSON.stringify({ type: 'prompt', text }));
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

function findClientByAccountId(accountId) {
    for (const c of clients.values()) {
        if (c.loggedInAccountId === accountId) return c;
    }
    return null;
}

function broadcastToRoom(roomName, text, cls = '', excludeSessionId = null) {
    const room = getRoomSync(roomName);
    if (!room) return;
    for (const sessionId of room.users.keys()) {
        if (sessionId === excludeSessionId) continue;
        const target = findClientById(sessionId);
        if (target) send(target.ws, text, cls);
    }
}

function broadcastChatMessage(roomName, senderSessionId, nickname, text) {
    const room = getRoomSync(roomName);
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

function broadcastGlobal(text, cls = '') {
    for (const c of clients.values()) {
        send(c.ws, text, cls);
    }
}

function buildContext(ts) {
    return {
        send, sendPrompt, sendClear, broadcastToRoom, broadcastGlobal,
        createRoom, getRoom, listRooms,
        findClientById, findClientByAccountId, ts,
        findAccountById: accounts.findAccountById,
        findAccountByNickname: accounts.findAccountByNickname,
        nicknameTaken: accounts.nicknameTaken,
        updateNickname: accounts.updateNickname,
        setPassword: accounts.setPassword,
        removePassword: accounts.removePassword,
        setGlobalBan: accounts.setGlobalBan,
        hashPassword, verifyPassword,
        leaveCurrentRoom,
    };
}

async function generateUniqueSessionGuestName() {
    let name;
    let inUse = true;
    while (inUse) {
        name = await accounts.generateUniqueGuestName();
        inUse = false;
        for (const c of clients.values()) {
            if (c.nickname && c.nickname.toLowerCase() === name.toLowerCase()) {
                inUse = true;
                break;
            }
        }
    }
    return name;
}

wss.on('connection', async (ws, req) => {
    clientCounter++;
    const sessionId = `s${clientCounter}_${Date.now()}`;
    const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'UNKNOWN')
        .split(',')[0].trim();

    const clientData = {
        id: sessionId,
        ws,
        ip,
        nickname: null,
        room: null,
        isAdmin: false,
        isSiteAdmin: false,
        loggedInAccountId: null,
        pendingAccount: null,
        loginAttemptUsername: null,
        authState: 'ready',
    };

    clients.set(ws, clientData);

    function printBanner() {
        send(ws, 'Microsoft(R) MS-DOS(R) Version 6.30', '');
        send(ws, '         (C)Copyright Microsoft Corp 1981-1995.', '');
        send(ws, '', '');
    }

    function printFooter() {
        send(ws, 'Type "connect /find" to browse available rooms.', '');
        send(ws, 'Type "connect /server=NAME" to join a specific room.', '');
        send(ws, 'Type "connect create /server=NAME" to create your own room.', '');
        send(ws, '/help for a full command list.', '');
        send(ws, '', '');
    }

    try {
        let account = await accounts.findAccountByIp(ip);

        if (account && account.isBanned) {
            printBanner();
            send(ws, '[SYSTEM] This connection has been banned from the site.', 'error');
            ws.close();
            return;
        }

        if (!account) {
            const guestName = await generateUniqueSessionGuestName();
            account = await accounts.createAccount(ip, guestName);

            if (!account) {
                clientData.nickname = await generateUniqueSessionGuestName();
                printBanner();
                send(ws, 'MULTIPLAYER CONSOLE v1.0', 'bright');
                send(ws, '', '');
                printFooter();
                sendPrompt(clientData);
            } else {
                clientData.loggedInAccountId = account.id;
                clientData.nickname = account.nickname;
                clientData.isSiteAdmin = account.isSiteAdmin;

                printBanner();
                send(ws, 'MULTIPLAYER CONSOLE v1.01', 'bright');
                send(ws, 'MPCMD.EXE loaded successfully.', '');
                send(ws, '', '');
                send(ws, `[SYSTEM] New account created: ${account.nickname}`, 'bright');
                send(ws, `[SYSTEM] Use /nick <name> to set a permanent nickname.`, '');
                send(ws, `[SYSTEM] Use /password add <password> to secure your account.`, '');
                send(ws, `[SYSTEM] Already have an account? Use /login to sign in.`, '');
                send(ws, '', '');
                printFooter();
                sendPrompt(clientData);
            }

        } else if (account.passwordHash) {
            clientData.pendingAccount = account;
            clientData.authState = 'awaiting_password';
            clientData.nickname = await generateUniqueSessionGuestName();

            printBanner();
            send(ws, `[SYSTEM] Account recognised: ${account.nickname}`, 'bright');
            send(ws, `[SYSTEM] Enter password to login, or type /guest to continue as a guest.`, '');
            send(ws, '', '');
            setAuthMode(clientData, true);

        } else {
            clientData.loggedInAccountId = account.id;
            clientData.nickname = account.nickname;
            clientData.isSiteAdmin = account.isSiteAdmin;

            printBanner();
            send(ws, 'MULTIPLAYER CONSOLE v1.01', 'bright');
            send(ws, '', '');
            send(ws, `[SYSTEM] Welcome back, ${account.nickname}.`, 'bright');
            send(ws, '', '');
            printFooter();
            sendPrompt(clientData);
        }

    } catch (err) {
        console.error('Error during connection setup:', err);
        send(ws, '[SYSTEM] An error occurred during connection setup.', 'error');
        ws.close();
        return;
    }

    ws.on('message', async (raw) => {
        let data;
        try { data = JSON.parse(raw); } catch (e) { return; }
        if (data.type !== 'input') return;
        const text = (data.text || '').toString().trim();
        if (!text) return;

        try {
            await handleInput(clientData, text, data.ts || Date.now());
        } catch (err) {
            console.error('Error handling input:', err);
            send(clientData.ws, '[SYSTEM] An internal error occurred.', 'error');
        }
    });

    ws.on('close', async () => {
        try {
            if (clientData.room) {
                await leaveCurrentRoom(clientData, buildContext(Date.now()));
            }
        } catch (err) {
            console.error('Error during disconnect cleanup:', err);
        }
        clients.delete(ws);
    });
});

async function attemptLogin(client, username, password) {
    const account = await accounts.findAccountByNickname(username);

    if (!account) {
        send(client.ws, `No account found with the name "${username}".`, 'error');
        sendPrompt(client);
        return;
    }
    if (account.isBanned) {
        send(client.ws, `This account has been banned from the site.`, 'error');
        sendPrompt(client);
        return;
    }
    if (!account.passwordHash) {
        send(client.ws, `That account has no password set and cannot be logged into remotely.`, 'error');
        send(client.ws, `Connect from the original IP address instead.`, '');
        sendPrompt(client);
        return;
    }
    if (!verifyPassword(password, account.passwordHash)) {
        send(client.ws, `Incorrect password.`, 'error');
        sendPrompt(client);
        return;
    }

    if (client.room) {
        await leaveCurrentRoom(client, buildContext(Date.now()));
    }

    await accounts.reassignIp(account.id, client.ip);

    client.loggedInAccountId = account.id;
    client.nickname = account.nickname;
    client.isSiteAdmin = account.isSiteAdmin;

    send(client.ws, '', '');
    send(client.ws, `[SYSTEM] Login successful. Welcome, ${account.nickname}.`, 'bright');
    if (account.isSiteAdmin) {
        send(client.ws, `[SYSTEM] Site administrator privileges active.`, 'warn');
    }
    send(client.ws, '', '');
    sendPrompt(client);
}

async function handleLogout(client) {
    if (!client.loggedInAccountId) {
        send(client.ws, 'You are not logged into any account.', 'error');
        return;
    }
    const oldNick = client.nickname;

    if (client.room) {
        await leaveCurrentRoom(client, buildContext(Date.now()));
    }

    client.loggedInAccountId = null;
    client.isSiteAdmin = false;
    client.nickname = await generateUniqueSessionGuestName();

    send(client.ws, '', '');
    send(client.ws, `[SYSTEM] Logged out of ${oldNick}.`, 'bright');
    send(client.ws, `[SYSTEM] Continuing as guest: ${client.nickname}`, '');
    send(client.ws, '', '');
    sendPrompt(client);
}

async function handleInput(client, text, ts) {

    if (client.authState === 'awaiting_password') {
        if (text.toLowerCase() === '/guest') {
            client.authState = 'ready';
            client.pendingAccount = null;
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
            client.isSiteAdmin = account.isSiteAdmin;
            client.pendingAccount = null;
            setAuthMode(client, false);
            await accounts.reassignIp(account.id, client.ip);
            send(client.ws, `[SYSTEM] Login successful. Welcome back, ${account.nickname}.`, 'bright');
            if (account.isSiteAdmin) {
                send(client.ws, `[SYSTEM] Site administrator privileges active.`, 'warn');
            }
            send(client.ws, '', '');
            sendPrompt(client);
        } else {
            send(client.ws, 'Incorrect password. Try again, or type /guest to continue as a guest.', 'error');
        }
        return;
    }

    if (client.authState === 'login_awaiting_username') {
        client.loginAttemptUsername = text;
        client.authState = 'login_awaiting_password';
        setAuthMode(client, true);
        return;
    }

    if (client.authState === 'login_awaiting_password') {
        const username = client.loginAttemptUsername;
        client.loginAttemptUsername = null;
        client.authState = 'ready';
        setAuthMode(client, false);
        await attemptLogin(client, username, text);
        return;
    }

    const trimmedLower = text.toLowerCase();

    if (trimmedLower === '/login') {
        client.authState = 'login_awaiting_username';
        send(client.ws, '', '');
        send(client.ws, 'Enter the account nickname you wish to log into:', '');
        sendCustomPrompt(client, 'Username: ');
        return;
    }

    if (trimmedLower.startsWith('/login ')) {
        const args = text.split(/\s+/).slice(1);
        if (args.length < 2) {
            send(client.ws, 'Usage: /login <username> <password>', 'error');
            send(client.ws, 'Or just type /login for a guided prompt.', '');
            return;
        }
        const promptStr = client.room ? `C:\\CHAT\\${client.room}>` : `C:\\CHAT>`;
        send(client.ws, `${promptStr}/login ${args[0]} ********`, '');
        await attemptLogin(client, args[0], args.slice(1).join(' '));
        return;
    }

    if (trimmedLower === '/logout') {
        const promptStr = client.room ? `C:\\CHAT\\${client.room}>` : `C:\\CHAT>`;
        send(client.ws, `${promptStr}${text}`, '');
        await handleLogout(client);
        return;
    }

    // DOS commands that don't start with /
    const dosCommands = ['cls', 'dir', 'date', 'time', 'echo', 'ver'];
    const firstWord = trimmedLower.split(/\s+/)[0];
    const isCommand = text.startsWith('/')
        || trimmedLower.startsWith('connect')
        || dosCommands.includes(firstWord);

    if (isCommand) {
        const promptStr = client.room ? `C:\\CHAT\\${client.room}>` : `C:\\CHAT>`;
        send(client.ws, `${promptStr}${text}`, '');
        await processCommand(client, text, buildContext(ts));
    } else {
        if (!client.room) {
            send(client.ws, 'Not connected to any server. Type "connect /find" first.', 'error');
            return;
        }

        const room = getRoomSync(client.room);
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

(async () => {
    try {
        await db.init();
        await accounts.ensureSiteAdminSeed();
        server.listen(PORT, () => {
            console.log(`Multiplayer Console server running on port ${PORT}`);
        });
    } catch (err) {
        console.error('Failed to start server:', err);
        process.exit(1);
    }
})();
