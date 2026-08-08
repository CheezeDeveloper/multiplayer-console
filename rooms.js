const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const ROOMS_FILE = path.join(DATA_DIR, 'rooms.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(ROOMS_FILE)) fs.writeFileSync(ROOMS_FILE, '{}');

let roomConfigs = {};
const liveRooms = new Map();

function loadConfigs() {
    try {
        roomConfigs = JSON.parse(fs.readFileSync(ROOMS_FILE, 'utf-8'));
    } catch (e) {
        roomConfigs = {};
    }
}

function saveConfigs() {
    try {
        fs.writeFileSync(ROOMS_FILE, JSON.stringify(roomConfigs, null, 2));
    } catch (e) {
        console.error('Failed to save rooms:', e);
    }
}

loadConfigs();

class Room {
    constructor(name, config) {
        this.name = name;
        this.creatorAccountId = config.creatorAccountId;
        this.passwordHash = config.passwordHash || null;
        this.adminAccountIds = new Set(config.adminAccountIds || [config.creatorAccountId]);
        this.bannedAccountIds = new Set(config.bannedAccountIds || []);
        this.bannedIps = new Set(config.bannedIps || []);
        this.createdAt = config.createdAt || Date.now();

        // Live runtime state — NOT persisted to disk
        this.users = new Map(); // sessionId -> { accountId, nickname, isAdmin, ip, muted }
    }

    toConfig() {
        return {
            creatorAccountId: this.creatorAccountId,
            passwordHash: this.passwordHash,
            adminAccountIds: Array.from(this.adminAccountIds),
            bannedAccountIds: Array.from(this.bannedAccountIds),
            bannedIps: Array.from(this.bannedIps),
            createdAt: this.createdAt,
        };
    }

    persist() {
        roomConfigs[this.name] = this.toConfig();
        saveConfigs();
    }

    addUser(sessionId, accountId, nickname, ip) {
        const isAdmin = this.adminAccountIds.has(accountId);
        this.users.set(sessionId, { accountId, nickname, isAdmin, ip, muted: false });
        return isAdmin;
    }

    removeUser(sessionId) {
        this.users.delete(sessionId);
    }

    getUserByNickname(nickname) {
        for (const [sessionId, info] of this.users.entries()) {
            if (info.nickname.toLowerCase() === nickname.toLowerCase()) {
                return { sessionId, info };
            }
        }
        return null;
    }

    isBanned(accountId, ip) {
        return this.bannedAccountIds.has(accountId) || this.bannedIps.has(ip);
    }
}

// Rebuild live registry from disk at boot (empty user lists — nobody connected yet)
for (const [name, config] of Object.entries(roomConfigs)) {
    liveRooms.set(name, new Room(name, config));
}

function createRoom(name, creatorAccountId) {
    const key = name.toUpperCase();
    if (liveRooms.has(key)) return null;

    const room = new Room(key, { creatorAccountId, adminAccountIds: [creatorAccountId] });
    liveRooms.set(key, room);
    room.persist();
    return room;
}

function getRoom(name) {
    return liveRooms.get(name.toUpperCase());
}

function listRooms() {
    return Array.from(liveRooms.values());
}

module.exports = {
    createRoom,
    getRoom,
    listRooms,
};
