const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL;

const pool = new Pool({
    connectionString,
    ssl: connectionString && !connectionString.includes('localhost')
        ? { rejectUnauthorized: false }
        : false,
});

async function query(text, params) {
    return pool.query(text, params);
}

async function init() {
    await query(`
        CREATE TABLE IF NOT EXISTS accounts (
            id SERIAL PRIMARY KEY,
            nickname TEXT NOT NULL,
            nickname_lower TEXT UNIQUE NOT NULL,
            ip TEXT,
            password_hash TEXT,
            is_site_admin BOOLEAN NOT NULL DEFAULT FALSE,
            is_banned BOOLEAN NOT NULL DEFAULT FALSE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
    `);

    await query(`
        CREATE TABLE IF NOT EXISTS rooms (
            name TEXT PRIMARY KEY,
            creator_account_id INTEGER REFERENCES accounts(id),
            password_hash TEXT,
            admin_account_ids INTEGER[] NOT NULL DEFAULT '{}',
            banned_account_ids INTEGER[] NOT NULL DEFAULT '{}',
            banned_ips TEXT[] NOT NULL DEFAULT '{}',
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
    `);

    console.log('[DB] Schema ready.');
}

module.exports = { query, init, pool };
