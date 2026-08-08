class Room {
    constructor(name) {
        this.name = name;
        this.users = new Map(); // clientId -> { nickname, isAdmin, ip, muted }
        this.bannedIps = new Set();
        this.bannedNicknames = new Set();
        this.createdAt = Date.now();
    }

    addUser(clientId, nickname, ip, isAdmin = false) {
        this.users.set(clientId, { nickname, isAdmin, ip, muted: false });
    }

    removeUser(clientId) {
        this.users.delete(clientId);
    }

    getUserByNickname(nickname) {
        for (const [id, user] of this.users.entries()) {
            if (user.nickname.toLowerCase() === nickname.toLowerCase()) {
                return { id, user };
            }
        }
        return null;
    }

    isEmpty() {
        return this.users.size === 0;
    }
}

// Global room registry — starts EMPTY. No default/fake servers ever.
const rooms = new Map();

function createRoom(name) {
    const key = name.toUpperCase();
    if (rooms.has(key)) return null;
    const room = new Room(key);
    rooms.set(key, room);
    return room;
}

function getRoom(name) {
    return rooms.get(name.toUpperCase());
}

function deleteRoomIfEmpty(name) {
    const key = name.toUpperCase();
    const room = rooms.get(key);
    if (room && room.isEmpty()) {
        rooms.delete(key);
    }
}

function listRooms() {
    return Array.from(rooms.values());
}

module.exports = {
    createRoom,
    getRoom,
    deleteRoomIfEmpty,
    listRooms,
};
