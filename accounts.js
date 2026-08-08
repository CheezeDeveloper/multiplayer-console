const db = require('./db');
const { hashPassword } = require('./crypto-utils');

function rowToAccount(row) {
    if (!row) return null;
    return {
        id: row.id,
        nickname: row.nickname,
        ip: row.ip,
        passwordHash: row.password_hash,
        isSiteAdmin: row.is_site_admin,
        isBanned: row.is_banned,
        createdAt: row.created_at,
    };
}

async function findAccountByIp(ip) {
    if (!ip) return null;
    const res = await db.query(
        'SELECT * FROM accounts WHERE ip = $1 ORDER BY id ASC LIMIT 1',
        [ip]
    );
    return rowToAccount(res.rows[0]);
}

async function findAccountById(id) {
    const res = await db.query('SELECT * FROM accounts WHERE id = $1', [id]);
    return rowToAccount(res.rows[0]);
}

async function findAccountByNickname(nickname) {
    const res = await db.query(
        'SELECT * FROM accounts WHERE nickname_lower = $1',
        [nickname.toLowerCase()]
    );
    return rowToAccount(res.rows[0]);
}

async function nicknameTaken(nickname, excludeId = null) {
    const account = await findAccountByNickname(nickname);
    if (!account) return false;
    if (excludeId && account.id === excludeId) return false;
    return true;
}

// Creates an account. Returns null if the name is already taken
// (either caught in advance or via the DB unique constraint race-condition safety net).
async function createAccount(ip, nickname) {
    try {
        const res = await db.query(
            `INSERT INTO accounts (nickname, nickname_lower, ip)
             VALUES ($1, $2, $3) RETURNING *`,
            [nickname, nickname.toLowerCase(), ip]
        );
        return rowToAccount(res.rows[0]);
    } catch (err) {
        if (err.code === '23505') return null; // unique_violation
        throw err;
    }
}

async function updateNickname(accountId, newNickname) {
    try {
        const res = await db.query(
            `UPDATE accounts SET nickname = $1, nickname_lower = $2
             WHERE id = $3 RETURNING *`,
            [newNickname, newNickname.toLowerCase(), accountId]
        );
        return rowToAccount(res.rows[0]);
    } catch (err) {
        if (err.code === '23505') return null;
        throw err;
    }
}

async function setPassword(accountId, hash) {
    await db.query('UPDATE accounts SET password_hash = $1 WHERE id = $2', [hash, accountId]);
    return true;
}

async function removePassword(accountId) {
    return setPassword(accountId, null);
}

async function setSiteAdmin(accountId, value) {
    await db.query('UPDATE accounts SET is_site_admin = $1 WHERE id = $2', [value, accountId]);
}

async function setGlobalBan(accountId, value) {
    await db.query('UPDATE accounts SET is_banned = $1 WHERE id = $2', [value, accountId]);
}

// Generates a guest name guaranteed not to collide with any existing account.
async function generateUniqueGuestName() {
    let attempt;
    let exists = true;
    while (exists) {
        const num = Math.floor(1000 + Math.random() * 9000);
        attempt = `GUEST${num}`;
        exists = await nicknameTaken(attempt);
    }
    return attempt;
}

// Called once at boot. Ensures the designated site admin account exists,
// is flagged correctly, and has an initial password if none is set yet.
async function ensureSiteAdminSeed() {
    const username = process.env.ADMIN_USERNAME || 'codexll34';
    const password = process.env.ADMIN_PASSWORD || null;

    let account = await findAccountByNickname(username);

    if (!account) {
        account = await createAccount(null, username);
        if (!account) {
            console.error(`[SEED] Could not create site admin account "${username}" — name conflict.`);
            return;
        }
        console.log(`[SEED] Created site admin account: ${username}`);
    }

    if (!account.isSiteAdmin) {
        await setSiteAdmin(account.id, true);
        console.log(`[SEED] Flagged ${username} as site admin.`);
    }

    if (!account.passwordHash && password) {
        await setPassword(account.id, hashPassword(password));
        console.log(`[SEED] Initial password set for ${username} from ADMIN_PASSWORD.`);
    }
}

module.exports = {
    findAccountByIp,
    findAccountById,
    findAccountByNickname,
    nicknameTaken,
    createAccount,
    updateNickname,
    setPassword,
    removePassword,
    setSiteAdmin,
    setGlobalBan,
    generateUniqueGuestName,
    ensureSiteAdminSeed,
};
