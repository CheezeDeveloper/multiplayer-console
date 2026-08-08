const db = require('./db');

// Runtime cache: room name -> live Room instance (holds connected users, which is never persisted)
const liveRooms = new Map();

class Room {
    constructor(name, config) {
        this.name = name;
        this.creatorAccountId = config.creatorAccountId;
        this.passwordHash = config.passwordHash || null;
        this.adminAccountIds = new Set(config.adminAccountIds || []);
        this.bannedAccountIds = new Set(config.bannedAccountIds || []);
        this.bannedIps = new Set(config.bannedIps || []);
        this.createdAt = config.createdAt || Date.now();

        // Runtime-only, never written to DB
        this.users = new Map(); // sessionId -> { accountId, nickname, isAdmin, ip, muted }
    }

    async persist() {
        await db.query(
            `UPDATE rooms
             SET password_hash = $1, admin_account_ids = $2,
                 banned_account_ids = $3, banned_ips = $4
             WHERE name = $5`,
            [
                this.passwordHash,
                Array.from(this.adminAccountIds),
                Array.from(this.bannedAccountIds),
                Array.from(this.bannedIps),
                this.name,
            ]
        );
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

function rowToConfig(row) {
    return {
        creatorAccountId: row.creator_account_id,
        passwordHash: row.password_hash,
        adminAccountIds: row.admin_account_ids,
        bannedAccountIds: row.banned_account_ids,
        bannedIps: row.banned_ips,
        createdAt: row.created_at,
    };
}

// Creates a room. Returns null if the name is already taken.
async function createRoom(name, creatorAccountId) {
    const key = name.toUpperCase();

    const existing = await db.query('SELECT 1 FROM rooms WHERE name = $1', [key]);
    if (existing.rows.length > 0) return null;

    await db.query(
        `INSERT INTO rooms (name, creator_account_id, admin_account_ids)
         VALUES ($1, $2, $3)`,
        [key, creatorAccountId, [creatorAccountId]]
    );

    const room = new Room(key, { creatorAccountId, adminAccountIds: [creatorAccountId] });
    liveRooms.set(key, room);
    return room;
}

// Async — checks memory cache first, falls back to DB, caches result.
async function getRoom(name) {
    const key = name.toUpperCase();
    if (liveRooms.has(key)) return liveRooms.get(key);

    const res = await db.query('SELECT * FROM rooms WHERE name = $1', [key]);
    if (res.rows.length === 0) return null;

    const room = new Room(key, rowToConfig(res.rows[0]));
    liveRooms.set(key, room);
    return room;
}

// Sync — only checks the in-memory cache. Safe to use in hot paths
// (like broadcasting chat messages) since any room with connected
// users must already be cached.
function getRoomSync(name) {
    return liveRooms.get(name.toUpperCase()) || null;
}

// Returns summaries of every room that has ever been created, including
// ones with nobody currently online. userCount is 0 if not cached live.
async function listRooms() {
    const res = await db.query('SELECT name, password_hash FROM rooms ORDER BY name ASC');
    return res.rows.map(row => {
        const live = liveRooms.get(row.name);
        return {
            name: row.name,
            userCount: live ? live.users.size : 0,
            passwordHash: row.password_hash,
        };
    });
}

module.exports = {
    createRoom,
    getRoom,
    getRoomSync,
    listRooms,
};
