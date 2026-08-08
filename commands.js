function getTimestamp() {
    const now = new Date();
    const h = String(now.getHours()).padStart(2, '0');
    const m = String(now.getMinutes()).padStart(2, '0');
    const s = String(now.getSeconds()).padStart(2, '0');
    return `[${h}:${m}:${s}]`;
}

function effectiveId(client) {
    return client.loggedInAccountId || client.id;
}

function processCommand(client, text, ctx) {
    const {
        send, sendPrompt, sendClear, broadcastToRoom,
        createRoom, getRoom, listRooms,
        findClientById, ts,
        findAccountById, findAccountByNickname, updateNickname,
        setPassword, removePassword,
        hashPassword, verifyPassword,
    } = ctx;

    const lower = text.toLowerCase();
    const parts = text.split(/\s+/);

    // ===================== CONNECT =====================
    if (lower.startsWith('connect')) {

        if (lower.includes('/findall')) {
            const allRooms = listRooms();
            send(client.ws, '', '');
            if (allRooms.length === 0) {
                send(client.ws, 'No servers currently exist.', 'error');
                send(client.ws, 'Create one with: connect create /server=NAME', '');
            } else {
                send(client.ws, 'Listing all available servers...', '');
                send(client.ws, '', '');
                send(client.ws, 'SERVER NAME       USERS  LOCKED', 'bright');
                allRooms.forEach(r => {
                    send(client.ws, `${r.name.padEnd(18)}${String(r.users.size).padEnd(7)}${r.passwordHash ? 'YES' : 'no'}`, '');
                });
            }
            send(client.ws, '', '');
            return;
        }

        if (lower.includes('/find')) {
            const allRooms = listRooms();
            send(client.ws, '', '');
            if (allRooms.length === 0) {
                send(client.ws, 'No servers found.', 'error');
                send(client.ws, 'Create one with: connect create /server=NAME', '');
            } else {
                const best = allRooms.reduce((a, b) => (a.users.size >= b.users.size ? a : b));
                send(client.ws, `Found: ${best.name}  (${best.users.size} user(s) online)${best.passwordHash ? ' [PASSWORD PROTECTED]' : ''}`, 'bright');
                send(client.ws, `Type "connect /server=${best.name}" to join.`, '');
            }
            send(client.ws, '', '');
            return;
        }

        const createMatch = text.match(/create\s+\/server[=:](\S+)/i);
        if (createMatch) {
            const serverName = createMatch[1].toUpperCase();

            if (getRoom(serverName)) {
                send(client.ws, `Server "${serverName}" already exists. Use connect /server=${serverName} to join.`, 'error');
                return;
            }

            if (client.room) leaveCurrentRoom(client, ctx);

            const myId = effectiveId(client);
            const room = createRoom(serverName, myId);
            room.addUser(client.id, myId, client.nickname, client.ip);
            client.room = serverName;
            client.isAdmin = true;

            send(client.ws, '', '');
            send(client.ws, `Creating server "${serverName}"...`, '');
            send(client.ws, `Server "${serverName}" created successfully.`, 'bright');
            send(client.ws, `You are now the admin of this room.`, 'bright');
            send(client.ws, '', '');
            send(client.ws, `[SYSTEM] Connected to ${serverName}. 1 user(s) online.`, '');
            send(client.ws, '', '');
            sendPrompt(client);
            return;
        }

        const serverMatch = text.match(/\/server[=:](\S+)/i);
        if (serverMatch) {
            const serverName = serverMatch[1].toUpperCase();
            const room = getRoom(serverName);

            if (!room) {
                send(client.ws, `Server "${serverName}" does not exist.`, 'error');
                send(client.ws, `Type "connect /findall" to see available servers.`, '');
                return;
            }

            const myId = effectiveId(client);

            if (room.isBanned(myId, client.ip)) {
                send(client.ws, `You are banned from ${serverName}.`, 'error');
                return;
            }

            if (room.passwordHash) {
                const passMatch = text.match(/password[=:](\S+)/i);
                if (!passMatch) {
                    send(client.ws, `This room requires a password.`, 'error');
                    send(client.ws, `Reconnect with: connect /server=${serverName} password=YOURPASSWORD`, '');
                    return;
                }
                if (!verifyPassword(passMatch[1], room.passwordHash)) {
                    send(client.ws, `Incorrect room password.`, 'error');
                    return;
                }
            }

            if (client.room) leaveCurrentRoom(client, ctx);

            const isAdmin = room.addUser(client.id, myId, client.nickname, client.ip);
            client.room = serverName;
            client.isAdmin = isAdmin;

            send(client.ws, '', '');
            send(client.ws, `Connecting to ${serverName}...`, '');
            send(client.ws, 'Authenticating... OK', '');
            send(client.ws, 'Joining room... OK', '');
            send(client.ws, '', '');
            send(client.ws, `[SYSTEM] Connected to ${serverName}.${isAdmin ? ' (admin restored)' : ''}`, 'bright');
            send(client.ws, `[SYSTEM] ${room.users.size} user(s) online. Type /help for commands.`, '');
            send(client.ws, '', '');

            broadcastToRoom(serverName, `[SYSTEM] ${client.nickname} has joined the room.`, '', client.id);
            sendPrompt(client);
            return;
        }

        send(client.ws, 'Usage: connect /server=NAME | connect /find | connect /findall | connect create /server=NAME', 'error');
        return;
    }

    // ===================== SLASH COMMANDS =====================
    const cmd = parts[0].toLowerCase();

    switch (cmd) {
        case '/help': {
            send(client.ws, '', '');
            send(client.ws, 'Available commands:', 'bright');
            send(client.ws, '  connect /server=NAME             Join a server', '');
            send(client.ws, '  connect /server=NAME password=X  Join a locked server', '');
            send(client.ws, '  connect /find                    Find a server', '');
            send(client.ws, '  connect /findall                 List all servers', '');
            send(client.ws, '  connect create /server=NAME      Create a room', '');
            send(client.ws, '  /help                            Show this help', '');
            send(client.ws, '  /clear                           Clear screen', '');
            send(client.ws, '  /users                           List online users', '');
            send(client.ws, '  /ping                            Test latency', '');
            send(client.ws, '  /nick <name>                     Change nickname', '');
            send(client.ws, '  /me <action>                     Emote action', '');
            send(client.ws, '  /quit                            Disconnect', '');
            send(client.ws, '  /password add <pass>             Set account password', '');
            send(client.ws, '  /password edit <pass>            Change account password', '');
            send(client.ws, '  /password remove                 Remove account password', '');
            if (client.isAdmin && client.room) {
                send(client.ws, '', '');
                send(client.ws, 'Admin commands:', 'warn');
                send(client.ws, '  /kick user=NAME                  Kick a user', '');
                send(client.ws, '  /ban user=NAME                   Ban a user', '');
                send(client.ws, '  /banip ip=IP                     Ban an IP address', '');
                send(client.ws, '  /mute user=NAME                  Mute a user', '');
                send(client.ws, '  /promote user=NAME               Promote user to admin', '');
                send(client.ws, '  /password room add <pass>        Lock the room', '');
                send(client.ws, '  /password room edit <pass>       Change room password', '');
                send(client.ws, '  /password room remove            Unlock the room', '');
            }
            send(client.ws, '', '');
            break;
        }

        case '/clear':
            sendClear(client);
            break;

        case '/users': {
            if (!client.room) {
                send(client.ws, 'Not connected to any server.', 'error');
                break;
            }
            const room = getRoom(client.room);
            send(client.ws, '', '');
            send(client.ws, `Users online in ${client.room}:`, 'bright');
            for (const [sessionId, info] of room.users.entries()) {
                let tag = '';
                if (sessionId === client.id) tag = '(you)';
                else if (info.isAdmin) tag = '(admin)';
                send(client.ws, `  ${info.nickname.padEnd(14)}${tag}`, info.isAdmin ? 'warn' : '');
            }
            send(client.ws, '', '');
            break;
        }

        case '/ping': {
            const latency = Math.max(1, Date.now() - ts);
            send(client.ws, `Pinging ${client.room || 'server'}... Reply: ${latency}ms`, '');
            break;
        }

        case '/nick': {
            if (!parts[1]) {
                send(client.ws, 'Usage: /nick <newname>', 'error');
                break;
            }
            const newNick = parts[1].slice(0, 16);
            const oldNick = client.nickname;
            client.nickname = newNick;

            if (client.loggedInAccountId) {
                updateNickname(client.loggedInAccountId, newNick);
            }

            if (client.room) {
                const room = getRoom(client.room);
                const info = room.users.get(client.id);
                if (info) info.nickname = newNick;
                broadcastToRoom(client.room, `[SYSTEM] ${oldNick} is now known as ${newNick}.`, '', null);
            } else {
                send(client.ws, `Nickname changed to: ${newNick}`, '');
            }
            break;
        }

        case '/me': {
            if (!client.room) {
                send(client.ws, 'Not connected to any server.', 'error');
                break;
            }
            const action = parts.slice(1).join(' ');
            if (!action) {
                send(client.ws, 'Usage: /me <action>', 'error');
                break;
            }
            broadcastToRoom(client.room, `${getTimestamp()} * ${client.nickname} ${action}`, 'bright', null);
            break;
        }

        case '/quit': {
            if (!client.room) {
                send(client.ws, 'Not connected to any server.', 'error');
                break;
            }
            const roomName = client.room;
            leaveCurrentRoom(client, ctx);
            send(client.ws, '', '');
            send(client.ws, `Disconnecting from ${roomName}...`, '');
            send(client.ws, 'Connection closed.', '');
            send(client.ws, '', '');
            sendPrompt(client);
            break;
        }

        // ===================== PASSWORD =====================
        case '/password': {
            let target = 'account';
            let action = parts[1] ? parts[1].toLowerCase() : null;
            let valueIndex = 2;

            if (action === 'room') {
                target = 'room';
                action = parts[2] ? parts[2].toLowerCase() : null;
                valueIndex = 3;
            }

            if (!action || !['add', 'remove', 'edit'].includes(action)) {
                send(client.ws, 'Usage: /password add|edit|remove <password>', 'error');
                send(client.ws, '       /password room add|edit|remove <password>', 'error');
                break;
            }

            const value = parts[valueIndex];

            if (target === 'account') {
                if (!client.loggedInAccountId) {
                    send(client.ws, 'You must be logged into an account to manage its password.', 'error');
                    send(client.ws, '(Guests cannot set passwords — reconnect and log in first.)', 'error');
                    break;
                }
                const account = findAccountById(client.loggedInAccountId);

                if (action === 'add') {
                    if (account.passwordHash) {
                        send(client.ws, 'Account already has a password. Use /password edit <new> instead.', 'error');
                        break;
                    }
                    if (!value) { send(client.ws, 'Usage: /password add <password>', 'error'); break; }
                    setPassword(account.id, hashPassword(value));
                    send(client.ws, 'Password added to your account.', 'bright');

                } else if (action === 'edit') {
                    if (!account.passwordHash) {
                        send(client.ws, 'Account has no password set. Use /password add <password> instead.', 'error');
                        break;
                    }
                    if (!value) { send(client.ws, 'Usage: /password edit <newpassword>', 'error'); break; }
                    setPassword(account.id, hashPassword(value));
                    send(client.ws, 'Account password updated.', 'bright');

                } else if (action === 'remove') {
                    if (!account.passwordHash) {
                        send(client.ws, 'Account has no password set.', 'error');
                        break;
                    }
                    removePassword(account.id);
                    send(client.ws, 'Account password removed.', 'bright');
                }

            } else {
                if (!requireAdmin(client, send)) break;
                const room = getRoom(client.room);

                if (action === 'add') {
                    if (room.passwordHash) {
                        send(client.ws, 'Room already has a password. Use /password room edit <new> instead.', 'error');
                        break;
                    }
                    if (!value) { send(client.ws, 'Usage: /password room add <password>', 'error'); break; }
                    room.passwordHash = hashPassword(value);
                    room.persist();
                    send(client.ws, `Password added. Room ${client.room} is now locked.`, 'bright');

                } else if (action === 'edit') {
                    if (!room.passwordHash) {
                        send(client.ws, 'Room has no password. Use /password room add <new> instead.', 'error');
                        break;
                    }
                    if (!value) { send(client.ws, 'Usage: /password room edit <newpassword>', 'error'); break; }
                    room.passwordHash = hashPassword(value);
                    room.persist();
                    send(client.ws, 'Room password updated.', 'bright');

                } else if (action === 'remove') {
                    if (!room.passwordHash) {
                        send(client.ws, 'Room has no password set.', 'error');
                        break;
                    }
                    room.passwordHash = null;
                    room.persist();
                    send(client.ws, `Room password removed. ${client.room} is now unlocked.`, 'bright');
                }
            }
            break;
        }

        // ===================== ADMIN COMMANDS =====================
        case '/kick':
            if (!requireAdmin(client, send)) break;
            handleUserTarget(client, text, 'kick', ctx);
            break;

        case '/ban':
            if (!requireAdmin(client, send)) break;
            handleUserTarget(client, text, 'ban', ctx);
            break;

        case '/banip': {
            if (!requireAdmin(client, send)) break;
            const ipMatch = text.match(/ip[=:](\S+)/i);
            if (!ipMatch) {
                send(client.ws, 'Usage: /banip ip=XXX.XXX.XXX.XXX', 'error');
                break;
            }
            const room = getRoom(client.room);
            room.bannedIps.add(ipMatch[1]);
            room.persist();
            send(client.ws, `IP ${ipMatch[1]} has been banned from ${client.room}.`, 'warn');
            break;
        }

        case '/mute':
            if (!requireAdmin(client, send)) break;
            handleUserTarget(client, text, 'mute', ctx);
            break;

        case '/promote': {
            if (!requireAdmin(client, send)) break;
            const promoteMatch = text.match(/user[=:](\S+)/i);
            if (!promoteMatch) {
                send(client.ws, 'Usage: /promote user=USERNAME', 'error');
                break;
            }
            const room = getRoom(client.room);
            const found = room.getUserByNickname(promoteMatch[1]);
            if (!found) {
                send(client.ws, `User "${promoteMatch[1]}" not found.`, 'error');
                break;
            }
            found.info.isAdmin = true;
            room.adminAccountIds.add(found.info.accountId);
            room.persist();

            const targetClient = findClientById(found.sessionId);
            if (targetClient) {
                targetClient.isAdmin = true;
                send(targetClient.ws, `You have been promoted to admin by ${client.nickname}.`, 'warn');
            }
            broadcastToRoom(client.room, `[SYSTEM] ${found.info.nickname} has been promoted to admin.`, 'warn', client.id);
            send(client.ws, `${found.info.nickname} has been promoted to admin.`, 'warn');
            break;
        }

        default:
            send(client.ws, `Bad command or file name: ${cmd}`, 'error');
            break;
    }
}

function requireAdmin(client, send) {
    if (!client.room) {
        send(client.ws, 'Not connected to any server.', 'error');
        return false;
    }
    if (!client.isAdmin) {
        send(client.ws, 'Access denied. Admin privileges required.', 'error');
        return false;
    }
    return true;
}

function handleUserTarget(client, text, action, ctx) {
    const { send, getRoom, findClientById, broadcastToRoom, sendPrompt } = ctx;
    const match = text.match(/user[=:](\S+)/i);
    if (!match) {
        send(client.ws, `Usage: /${action} user=USERNAME`, 'error');
        return;
    }
    const targetName = match[1];
    const room = getRoom(client.room);
    const found = room.getUserByNickname(targetName);

    if (!found) {
        send(client.ws, `User "${targetName}" not found in this room.`, 'error');
        return;
    }

    if (found.sessionId === client.id) {
        send(client.ws, `You cannot ${action} yourself.`, 'error');
        return;
    }

    const targetClient = findClientById(found.sessionId);

    switch (action) {
        case 'kick': {
            room.removeUser(found.sessionId);
            if (targetClient) {
                targetClient.room = null;
                targetClient.isAdmin = false;
                send(targetClient.ws, `You have been kicked from the room by ${client.nickname}.`, 'error');
                sendPrompt(targetClient);
            }
            broadcastToRoom(client.room, `[SYSTEM] ${found.info.nickname} has been kicked.`, 'warn', null);
            break;
        }
        case 'ban': {
            room.bannedAccountIds.add(found.info.accountId);
            room.bannedIps.add(found.info.ip);
            room.persist();
            room.removeUser(found.sessionId);
            if (targetClient) {
                targetClient.room = null;
                targetClient.isAdmin = false;
                send(targetClient.ws, `You have been banned from the room by ${client.nickname}.`, 'error');
                sendPrompt(targetClient);
            }
            broadcastToRoom(client.room, `[SYSTEM] ${found.info.nickname} has been banned.`, 'warn', null);
            break;
        }
        case 'mute': {
            found.info.muted = !found.info.muted;
            const state = found.info.muted ? 'muted' : 'unmuted';
            if (targetClient) {
                send(targetClient.ws, `You have been ${state} by ${client.nickname}.`, 'warn');
            }
            broadcastToRoom(client.room, `[SYSTEM] ${found.info.nickname} has been ${state}.`, 'warn', client.id);
            send(client.ws, `${found.info.nickname} has been ${state}.`, 'warn');
            break;
        }
    }
}

function leaveCurrentRoom(client, ctx) {
    const { getRoom, broadcastToRoom } = ctx;
    if (!client.room) return;
    const room = getRoom(client.room);
    if (room) {
        room.removeUser(client.id);
        broadcastToRoom(client.room, `[SYSTEM] ${client.nickname} has left the room.`, '', null);
    }
    client.room = null;
    client.isAdmin = false;
}

module.exports = { processCommand, leaveCurrentRoom, getTimestamp };
