function getTimestamp() {
    const now = new Date();
    const h = String(now.getHours()).padStart(2, '0');
    const m = String(now.getMinutes()).padStart(2, '0');
    const s = String(now.getSeconds()).padStart(2, '0');
    return `[${h}:${m}:${s}]`;
}

function effectiveId(client) {
    return client.loggedInAccountId;
}

async function processCommand(client, text, ctx) {
    const {
        send, sendPrompt, sendClear, broadcastToRoom, broadcastGlobal,
        createRoom, getRoom, listRooms,
        findClientById, findClientByAccountId, ts,
        findAccountById, findAccountByNickname, updateNickname, nicknameTaken,
        setPassword, removePassword, setGlobalBan,
        hashPassword, verifyPassword,
        leaveCurrentRoom,
    } = ctx;

    const lower = text.toLowerCase();
    const parts = text.split(/\s+/);

    // ===================== CONNECT =====================
    if (lower.startsWith('connect')) {

        if (lower.includes('/findall')) {
            const allRooms = await listRooms();
            send(client.ws, '', '');
            if (allRooms.length === 0) {
                send(client.ws, 'No servers currently exist.', 'error');
                send(client.ws, 'Create one with: connect create /server=NAME', '');
            } else {
                send(client.ws, 'SERVER NAME       USERS  LOCKED', 'bright');
                allRooms.forEach(r => {
                    send(client.ws,
                        `${r.name.padEnd(18)}${String(r.userCount).padEnd(7)}${r.passwordHash ? 'YES' : 'no'}`,
                        ''
                    );
                });
            }
            send(client.ws, '', '');
            return;
        }

        if (lower.includes('/find')) {
            const allRooms = await listRooms();
            send(client.ws, '', '');
            if (allRooms.length === 0) {
                send(client.ws, 'No servers found.', 'error');
                send(client.ws, 'Create one with: connect create /server=NAME', '');
            } else {
                const best = allRooms.reduce((a, b) => (a.userCount >= b.userCount ? a : b));
                send(client.ws,
                    `Found: ${best.name}  (${best.userCount} user(s) online)${best.passwordHash ? ' [LOCKED]' : ''}`,
                    'bright'
                );
                send(client.ws, `Type "connect /server=${best.name}" to join.`, '');
            }
            send(client.ws, '', '');
            return;
        }

        const createMatch = text.match(/create\s+\/server[=:](\S+)/i);
        if (createMatch) {
            const serverName = createMatch[1].toUpperCase();

            if (await getRoom(serverName)) {
                send(client.ws, `Server "${serverName}" already exists.`, 'error');
                return;
            }

            if (client.room) await leaveCurrentRoom(client, ctx);

            const myId = effectiveId(client);
            if (!myId) {
                send(client.ws, 'You must be logged into an account to create a room.', 'error');
                return;
            }

            const room = await createRoom(serverName, myId);
            if (!room) {
                send(client.ws, `Server "${serverName}" already exists.`, 'error');
                return;
            }

            room.addUser(client.id, myId, client.nickname, client.ip);
            client.room = serverName;
            client.isAdmin = true;

            send(client.ws, '', '');
            send(client.ws, `Creating server "${serverName}"...`, '');
            send(client.ws, `Server "${serverName}" created successfully.`, 'bright');
            send(client.ws, `You are the admin of this room.`, 'bright');
            send(client.ws, '', '');
            send(client.ws, `[SYSTEM] Connected to ${serverName}. 1 user(s) online.`, '');
            send(client.ws, '', '');
            sendPrompt(client);
            return;
        }

        const serverMatch = text.match(/\/server[=:](\S+)/i);
        if (serverMatch) {
            const serverName = serverMatch[1].toUpperCase();
            const room = await getRoom(serverName);

            if (!room) {
                send(client.ws, `Server "${serverName}" does not exist.`, 'error');
                send(client.ws, `Type "connect /findall" to see available servers.`, '');
                return;
            }

            const myId = effectiveId(client);

            if (myId && room.isBanned(myId, client.ip)) {
                send(client.ws, `You are banned from ${serverName}.`, 'error');
                return;
            }

            if (room.passwordHash) {
                const passMatch = text.match(/password[=:](\S+)/i);
                if (!passMatch) {
                    send(client.ws, `This room requires a password.`, 'error');
                    send(client.ws, `Usage: connect /server=${serverName} password=YOURPASSWORD`, '');
                    return;
                }
                if (!verifyPassword(passMatch[1], room.passwordHash)) {
                    send(client.ws, `Incorrect room password.`, 'error');
                    return;
                }
            }

            if (client.room) await leaveCurrentRoom(client, ctx);

            const isRoomAdmin = room.addUser(client.id, myId, client.nickname, client.ip);
            client.room = serverName;
            client.isAdmin = isRoomAdmin || client.isSiteAdmin;

            send(client.ws, '', '');
            send(client.ws, `Connecting to ${serverName}...`, '');
            send(client.ws, 'Authenticating... OK', '');
            send(client.ws, 'Joining room... OK', '');
            send(client.ws, '', '');
            send(client.ws, `[SYSTEM] Connected to ${serverName}.${client.isAdmin ? ' (admin)' : ''}`, 'bright');
            send(client.ws, `[SYSTEM] ${room.users.size} user(s) online. Type /help for commands.`, '');
            send(client.ws, '', '');

            broadcastToRoom(serverName, `[SYSTEM] ${client.nickname} has joined the room.`, '', client.id);
            sendPrompt(client);
            return;
        }

        send(client.ws, 'Usage: connect /server=NAME | connect /find | connect /findall | connect create /server=NAME', 'error');
        return;
    }

    const cmd = parts[0].toLowerCase();

    switch (cmd) {

        // ===================== HELP =====================
        case '/help': {
            send(client.ws, '', '');
            send(client.ws, 'Available commands:', 'bright');
            send(client.ws, '  connect /server=NAME             Join a server', '');
            send(client.ws, '  connect /server=NAME password=X  Join a locked server', '');
            send(client.ws, '  connect /find                    Find best server', '');
            send(client.ws, '  connect /findall                 List all servers', '');
            send(client.ws, '  connect create /server=NAME      Create a room', '');
            send(client.ws, '  /help                            This list', '');
            send(client.ws, '  /clear                           Clear screen', '');
            send(client.ws, '  /users                           List online users', '');
            send(client.ws, '  /ping                            Test latency', '');
            send(client.ws, '  /nick <name>                     Change nickname', '');
            send(client.ws, '  /me <action>                     Emote action', '');
            send(client.ws, '  /whoami                          Show your info', '');
            send(client.ws, '  /whois <nick>                    Show info on a user', '');
            send(client.ws, '  /login                           Login to account', '');
            send(client.ws, '  /logout                          Logout of account', '');
            send(client.ws, '  /quit                            Leave current room', '');
            send(client.ws, '  /password add <pass>             Set account password', '');
            send(client.ws, '  /password edit <pass>            Change account password', '');
            send(client.ws, '  /password remove                 Remove account password', '');
            if (client.isAdmin && client.room) {
                send(client.ws, '', '');
                send(client.ws, 'Room admin commands:', 'warn');
                send(client.ws, '  /kick user=NAME                  Kick a user', '');
                send(client.ws, '  /ban user=NAME                   Ban a user', '');
                send(client.ws, '  /banip ip=IP                     Ban an IP', '');
                send(client.ws, '  /mute user=NAME                  Mute/unmute a user', '');
                send(client.ws, '  /promote user=NAME               Promote to admin', '');
                send(client.ws, '  /password room add <pass>        Lock the room', '');
                send(client.ws, '  /password room edit <pass>       Change room password', '');
                send(client.ws, '  /password room remove            Unlock the room', '');
            }
            if (client.isSiteAdmin) {
                send(client.ws, '', '');
                send(client.ws, 'Site admin commands:', 'warn');
                send(client.ws, '  /siteban user=NAME               Ban from entire site', '');
                send(client.ws, '  /siteunban user=NAME             Remove site ban', '');
                send(client.ws, '  /announce <message>              Broadcast to all users', '');
            }
            send(client.ws, '', '');
            send(client.ws, 'DOS-style commands:', 'bright');
            send(client.ws, '  ver                              Show system version', '');
            send(client.ws, '  cls                              Clear screen', '');
            send(client.ws, '  dir                              List directory', '');
            send(client.ws, '  date                             Show current date', '');
            send(client.ws, '  time                             Show current time', '');
            send(client.ws, '  echo <text>                      Echo text back', '');
            send(client.ws, '  run <program>                    Run a DOS program', '');
            send(client.ws, '', '');
            send(client.ws, 'Fun commands:', 'bright');
            send(client.ws, '  /8ball ask="question"            Ask the Magic 8-Ball', '');
            send(client.ws, '  /color <hex>                     Change console color', '');
            send(client.ws, '  /color reset                     Reset console color', '');
            send(client.ws, '  /version                         Show MPCMD version', '');
            send(client.ws, '', '');
            break;
        }

        // ===================== CLEAR =====================
        case '/clear':
            sendClear(client);
            break;

        // ===================== USERS =====================
        case '/users': {
            if (!client.room) {
                send(client.ws, 'Not connected to any server.', 'error');
                break;
            }
            const room = await getRoom(client.room);
            send(client.ws, '', '');
            send(client.ws, `Users online in ${client.room}:`, 'bright');
            for (const [sessionId, info] of room.users.entries()) {
                let tag = sessionId === client.id ? '(you)' : info.isAdmin ? '(admin)' : '';
                send(client.ws, `  ${info.nickname.padEnd(14)}${tag}`, info.isAdmin ? 'warn' : '');
            }
            send(client.ws, '', '');
            break;
        }

        // ===================== PING =====================
        case '/ping': {
            const latency = Math.max(1, Date.now() - ts);
            send(client.ws, `Pinging ${client.room || 'server'}... Reply: ${latency}ms`, '');
            break;
        }

        // ===================== NICK =====================
        case '/nick': {
            if (!parts[1]) {
                send(client.ws, 'Usage: /nick <newname>', 'error');
                break;
            }
            const newNick = parts[1].slice(0, 16);
            const taken = await nicknameTaken(newNick, client.loggedInAccountId);
            if (taken) {
                send(client.ws, `The name "${newNick}" is already taken.`, 'error');
                break;
            }
            const oldNick = client.nickname;
            client.nickname = newNick;

            if (client.loggedInAccountId) {
                const updated = await updateNickname(client.loggedInAccountId, newNick);
                if (!updated) {
                    client.nickname = oldNick;
                    send(client.ws, `The name "${newNick}" is already taken.`, 'error');
                    break;
                }
            }

            if (client.room) {
                const room = await getRoom(client.room);
                const info = room.users.get(client.id);
                if (info) info.nickname = newNick;
                broadcastToRoom(client.room, `[SYSTEM] ${oldNick} is now known as ${newNick}.`, '', null);
            } else {
                send(client.ws, `Nickname changed to: ${newNick}`, '');
            }
            break;
        }

        // ===================== ME =====================
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

        // ===================== WHOAMI =====================
        case '/whoami': {
            send(client.ws, '', '');
            send(client.ws, 'USER INFORMATION:', 'bright');
            send(client.ws, `  Nickname  :  ${client.nickname}`, '');
            send(client.ws, `  Account   :  ${client.loggedInAccountId || 'GUEST (no account)'}`, '');
            send(client.ws, `  Room      :  ${client.room || 'none'}`, '');
            send(client.ws, `  Room Admin:  ${client.isAdmin ? 'YES' : 'no'}`, '');
            send(client.ws, `  Site Admin:  ${client.isSiteAdmin ? 'YES' : 'no'}`, '');
            send(client.ws, `  IP        :  ${client.ip}`, 'dim');
            send(client.ws, '', '');
            break;
        }

        // ===================== WHOIS =====================
        case '/whois': {
            if (!client.room) {
                send(client.ws, 'You must be in a room to use /whois.', 'error');
                break;
            }
            const targetName = parts[1];
            if (!targetName) {
                send(client.ws, 'Usage: /whois <nickname>', 'error');
                break;
            }
            const room = await getRoom(client.room);
            const found = room.getUserByNickname(targetName);
            if (!found) {
                send(client.ws, `User "${targetName}" not found in this room.`, 'error');
                break;
            }
            send(client.ws, '', '');
            send(client.ws, `USER INFO: ${found.info.nickname}`, 'bright');
            send(client.ws, `  Status    :  Online`, '');
            send(client.ws, `  Room      :  ${client.room}`, '');
            send(client.ws, `  Role      :  ${found.info.isAdmin ? 'Room Admin' : 'User'}`, '');
            send(client.ws, `  Account   :  ${found.info.accountId || 'Guest'}`, '');
            send(client.ws, '', '');
            break;
        }

        // ===================== QUIT =====================
        case '/quit': {
            if (!client.room) {
                send(client.ws, 'Not connected to any server.', 'error');
                break;
            }
            const roomName = client.room;
            await leaveCurrentRoom(client, ctx);
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
                    send(client.ws, 'You must be logged in to manage your account password.', 'error');
                    break;
                }
                const account = await findAccountById(client.loggedInAccountId);

                if (action === 'add') {
                    if (account.passwordHash) {
                        send(client.ws, 'Account already has a password. Use /password edit instead.', 'error');
                        break;
                    }
                    if (!value) { send(client.ws, 'Usage: /password add <password>', 'error'); break; }
                    await setPassword(account.id, hashPassword(value));
                    send(client.ws, 'Password added to your account.', 'bright');
                } else if (action === 'edit') {
                    if (!account.passwordHash) {
                        send(client.ws, 'No password set. Use /password add instead.', 'error');
                        break;
                    }
                    if (!value) { send(client.ws, 'Usage: /password edit <newpassword>', 'error'); break; }
                    await setPassword(account.id, hashPassword(value));
                    send(client.ws, 'Account password updated.', 'bright');
                } else if (action === 'remove') {
                    if (!account.passwordHash) {
                        send(client.ws, 'No password set.', 'error');
                        break;
                    }
                    await removePassword(account.id);
                    send(client.ws, 'Account password removed.', 'bright');
                }

            } else {
                if (!requireAdmin(client, send)) break;
                const room = await getRoom(client.room);

                if (action === 'add') {
                    if (room.passwordHash) {
                        send(client.ws, 'Room already has a password. Use /password room edit instead.', 'error');
                        break;
                    }
                    if (!value) { send(client.ws, 'Usage: /password room add <password>', 'error'); break; }
                    room.passwordHash = hashPassword(value);
                    await room.persist();
                    send(client.ws, `Room ${client.room} is now locked.`, 'bright');
                } else if (action === 'edit') {
                    if (!room.passwordHash) {
                        send(client.ws, 'Room has no password. Use /password room add instead.', 'error');
                        break;
                    }
                    if (!value) { send(client.ws, 'Usage: /password room edit <newpassword>', 'error'); break; }
                    room.passwordHash = hashPassword(value);
                    await room.persist();
                    send(client.ws, 'Room password updated.', 'bright');
                } else if (action === 'remove') {
                    if (!room.passwordHash) {
                        send(client.ws, 'Room has no password set.', 'error');
                        break;
                    }
                    room.passwordHash = null;
                    await room.persist();
                    send(client.ws, `Room ${client.room} is now unlocked.`, 'bright');
                }
            }
            break;
        }

        // ===================== ADMIN COMMANDS =====================
        case '/kick':
            if (!requireAdmin(client, send)) break;
            await handleUserTarget(client, text, 'kick', ctx);
            break;

        case '/ban':
            if (!requireAdmin(client, send)) break;
            await handleUserTarget(client, text, 'ban', ctx);
            break;

        case '/banip': {
            if (!requireAdmin(client, send)) break;
            const ipMatch = text.match(/ip[=:](\S+)/i);
            if (!ipMatch) {
                send(client.ws, 'Usage: /banip ip=XXX.XXX.XXX.XXX', 'error');
                break;
            }
            const room = await getRoom(client.room);
            room.bannedIps.add(ipMatch[1]);
            await room.persist();
            send(client.ws, `IP ${ipMatch[1]} has been banned from ${client.room}.`, 'warn');
            break;
        }

        case '/mute':
            if (!requireAdmin(client, send)) break;
            await handleUserTarget(client, text, 'mute', ctx);
            break;

        case '/promote': {
            if (!requireAdmin(client, send)) break;
            const promoteMatch = text.match(/user[=:](\S+)/i);
            if (!promoteMatch) {
                send(client.ws, 'Usage: /promote user=USERNAME', 'error');
                break;
            }
            const room = await getRoom(client.room);
            const found = room.getUserByNickname(promoteMatch[1]);
            if (!found) {
                send(client.ws, `User "${promoteMatch[1]}" not found.`, 'error');
                break;
            }
            found.info.isAdmin = true;
            room.adminAccountIds.add(found.info.accountId);
            await room.persist();

            const promotedClient = findClientById(found.sessionId);
            if (promotedClient) {
                promotedClient.isAdmin = true;
                send(promotedClient.ws, `You have been promoted to admin by ${client.nickname}.`, 'warn');
            }
            broadcastToRoom(client.room, `[SYSTEM] ${found.info.nickname} has been promoted to admin.`, 'warn', client.id);
            send(client.ws, `${found.info.nickname} has been promoted to admin.`, 'warn');
            break;
        }

        // ===================== SITE ADMIN =====================
        case '/siteban': {
            if (!client.isSiteAdmin) {
                send(client.ws, 'Access denied. Site admin only.', 'error');
                break;
            }
            const match = text.match(/user[=:](\S+)/i);
            if (!match) { send(client.ws, 'Usage: /siteban user=USERNAME', 'error'); break; }
            const target = await findAccountByNickname(match[1]);
            if (!target) { send(client.ws, `Account "${match[1]}" not found.`, 'error'); break; }
            await setGlobalBan(target.id, true);
            send(client.ws, `${target.nickname} has been banned from the site.`, 'warn');
            const bannedClient = findClientByAccountId(target.id);
            if (bannedClient) {
                send(bannedClient.ws, 'You have been banned from this site.', 'error');
                bannedClient.ws.close();
            }
            break;
        }

        case '/siteunban': {
            if (!client.isSiteAdmin) {
                send(client.ws, 'Access denied. Site admin only.', 'error');
                break;
            }
            const match = text.match(/user[=:](\S+)/i);
            if (!match) { send(client.ws, 'Usage: /siteunban user=USERNAME', 'error'); break; }
            const target = await findAccountByNickname(match[1]);
            if (!target) { send(client.ws, `Account "${match[1]}" not found.`, 'error'); break; }
            await setGlobalBan(target.id, false);
            send(client.ws, `${target.nickname}'s site ban has been lifted.`, 'bright');
            break;
        }

        case '/announce': {
            if (!client.isSiteAdmin) {
                send(client.ws, 'Access denied. Site admin only.', 'error');
                break;
            }
            const message = parts.slice(1).join(' ');
            if (!message) { send(client.ws, 'Usage: /announce <message>', 'error'); break; }
            broadcastGlobal(`[ANNOUNCEMENT] ${message}`, 'bright');
            break;
        }

        // ===================== VERSION =====================
        case '/version':
        case 'ver': {
            send(client.ws, '', '');
            send(client.ws, 'MultiPlayer CoMmanD (Prompt)', 'bright');
            send(client.ws, 'MPCMD [Version 1.02]', '');
            send(client.ws, '(C) MPCMD Systems. Created by codexll34.', 'dim');
            send(client.ws, '', '');
            break;
        }

        // ===================== COLOR =====================
        case '/color': {
            const colorArg = parts[1];
            if (!colorArg) {
                send(client.ws, 'Usage: /color <hex>   e.g. /color #00ff00', 'error');
                send(client.ws, 'Use /color reset to restore default color.', '');
                break;
            }
            const targetColor = colorArg.toLowerCase() === 'reset' ? '#aaaaaa' : colorArg;
            client.ws.send(JSON.stringify({ type: 'color-change', color: targetColor }));
            send(client.ws, `Terminal color set to ${targetColor}.`, '');
            break;
        }

        // ===================== MAGIC 8-BALL =====================
        case '/8ball': {
            const askMatch = text.match(/ask=["'](.+?)["']/i);
            if (!askMatch) {
                send(client.ws, 'Usage: /8ball ask="Your question here"', 'error');
                break;
            }
            const question = askMatch[1];
            const responses = [
                'It is certain.',
                'It is decidedly so.',
                'Without a doubt.',
                'Yes, definitely.',
                'You may rely on it.',
                'As I see it, yes.',
                'Most likely.',
                'Outlook good.',
                'Yes.',
                'Signs point to yes.',
                'Reply hazy, try again.',
                'Ask again later.',
                'Better not tell you now.',
                'Cannot predict now.',
                'Concentrate and ask again.',
                'Absolutely not.',
                "Don't count on it.",
                'My reply is no.',
                'My sources say no.',
                'Outlook not so good.',
                'Very doubtful.',
            ];
            const answer = responses[Math.floor(Math.random() * responses.length)];
            send(client.ws, '', '');
            send(client.ws, `You asked: "${question}"`, 'dim');
            send(client.ws, `The Magic 8-Ball answers: ${answer}`, 'bright');
            send(client.ws, '', '');
            break;
        }

        // ===================== DOS COMMANDS =====================
        case 'cls':
            sendClear(client);
            break;

        case 'dir': {
            const now = new Date();
            const dateStr = now.toLocaleDateString('en-US', {
                month: '2-digit', day: '2-digit', year: '2-digit'
            });
            send(client.ws, '', '');
            send(client.ws, ` Volume in drive C is MPCMD`, '');
            send(client.ws, ` Directory of C:\\CHAT`, '');
            send(client.ws, '', '');
            send(client.ws, `COMMANDS  SYS       42,069  ${dateStr}  12:00a`, '');
            send(client.ws, `ROOMS     DAT        1,337  ${dateStr}  12:00a`, '');
            send(client.ws, `ACCOUNTS  DB        99,999  ${dateStr}  12:00a`, '');
            send(client.ws, `CHATLOG   TXT     Infinite  ${dateStr}  ${getTimestamp()}`, '');
            send(client.ws, `        4 file(s)`, '');
            send(client.ws, '', '');
            break;
        }

        case 'date': {
            const now = new Date();
            const dateStr = now.toLocaleDateString('en-US', {
                weekday: 'short', month: '2-digit', day: '2-digit', year: 'numeric'
            });
            send(client.ws, `Current date is ${dateStr}`, '');
            break;
        }

        case 'time': {
            send(client.ws, `Current time is ${getTimestamp()}`, '');
            break;
        }

        case 'echo': {
            const echoText = parts.slice(1).join(' ');
            send(client.ws, echoText || '', '');
            break;
        }

        // ===================== RUN DOS PROGRAM =====================
        case 'run': {
            const program = parts[1] ? parts[1].toLowerCase() : null;
            if (!program) {
                send(client.ws, 'Usage: run <program>', 'error');
                send(client.ws, 'Available programs: doom, digger', '');
                break;
            }

            const bundles = {
                doom:   '/doom.jsdos',
                digger: 'https://js-dos.com/v7/build/test/digger.jsdos',
            };

            if (!bundles[program]) {
                send(client.ws, `Unknown program: ${program}`, 'error');
                send(client.ws, 'Available programs: doom, digger', '');
                break;
            }

            send(client.ws, '', '');
            send(client.ws, `Loading ${program.toUpperCase()}...`, 'bright');
            send(client.ws, 'Initializing WASM x86 emulator...', '');
            send(client.ws, '', '');
            client.ws.send(JSON.stringify({ type: 'run-dos', bundle: bundles[program] }));
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
    if (!client.isAdmin && !client.isSiteAdmin) {
        send(client.ws, 'Access denied. Admin privileges required.', 'error');
        return false;
    }
    return true;
}

async function handleUserTarget(client, text, action, ctx) {
    const { send, getRoom, findClientById, broadcastToRoom, sendPrompt } = ctx;
    const match = text.match(/user[=:](\S+)/i);
    if (!match) {
        send(client.ws, `Usage: /${action} user=USERNAME`, 'error');
        return;
    }
    const room = await getRoom(client.room);
    const found = room.getUserByNickname(match[1]);

    if (!found) {
        send(client.ws, `User "${match[1]}" not found in this room.`, 'error');
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
                send(targetClient.ws, `You have been kicked by ${client.nickname}.`, 'error');
                sendPrompt(targetClient);
            }
            broadcastToRoom(client.room, `[SYSTEM] ${found.info.nickname} has been kicked.`, 'warn', null);
            break;
        }
        case 'ban': {
            room.bannedAccountIds.add(found.info.accountId);
            room.bannedIps.add(found.info.ip);
            await room.persist();
            room.removeUser(found.sessionId);
            if (targetClient) {
                targetClient.room = null;
                targetClient.isAdmin = false;
                send(targetClient.ws, `You have been banned by ${client.nickname}.`, 'error');
                sendPrompt(targetClient);
            }
            broadcastToRoom(client.room, `[SYSTEM] ${found.info.nickname} has been banned.`, 'warn', null);
            break;
        }
        case 'mute': {
            found.info.muted = !found.info.muted;
            const state = found.info.muted ? 'muted' : 'unmuted';
            if (targetClient) send(targetClient.ws, `You have been ${state} by ${client.nickname}.`, 'warn');
            broadcastToRoom(client.room, `[SYSTEM] ${found.info.nickname} has been ${state}.`, 'warn', client.id);
            send(client.ws, `${found.info.nickname} has been ${state}.`, 'warn');
            break;
        }
    }
}

async function leaveCurrentRoom(client, ctx) {
    const { getRoom, broadcastToRoom } = ctx;
    if (!client.room) return;
    const room = await getRoom(client.room);
    if (room) {
        room.removeUser(client.id);
        broadcastToRoom(client.room, `[SYSTEM] ${client.nickname} has left the room.`, '', null);
    }
    client.room = null;
    client.isAdmin = false;
}

module.exports = { processCommand, leaveCurrentRoom, getTimestamp };
