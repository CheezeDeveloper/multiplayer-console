const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const ACCOUNTS_FILE = path.join(DATA_DIR, 'accounts.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(ACCOUNTS_FILE)) fs.writeFileSync(ACCOUNTS_FILE, '{}');

let accounts = {};

function load() {
    try {
        accounts = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf-8'));
    } catch (e) {
        accounts = {};
    }
}

function save() {
    try {
        fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2));
    } catch (e) {
        console.error('Failed to save accounts:', e);
    }
}

load();

let counter = Object.keys(accounts).length;

function generateAccountId() {
    counter++;
    return `acc_${Date.now()}_${counter}`;
}

function findAccountByIp(ip) {
    return Object.values(accounts).find(a => a.ip === ip) || null;
}

function findAccountById(id) {
    return accounts[id] || null;
}

function findAccountByNickname(nickname) {
    return Object.values(accounts).find(
        a => a.nickname.toLowerCase() === nickname.toLowerCase()
    ) || null;
}

function createAccount(ip, nickname) {
    const id = generateAccountId();
    const account = {
        id,
        ip,
        nickname,
        passwordHash: null,
        createdAt: Date.now(),
    };
    accounts[id] = account;
    save();
    return account;
}

function updateNickname(accountId, newNickname) {
    const account = accounts[accountId];
    if (!account) return null;
    account.nickname = newNickname;
    save();
    return account;
}

function setPassword(accountId, hash) {
    const account = accounts[accountId];
    if (!account) return false;
    account.passwordHash = hash;
    save();
    return true;
}

function removePassword(accountId) {
    return setPassword(accountId, null);
}

module.exports = {
    findAccountByIp,
    findAccountById,
    findAccountByNickname,
    createAccount,
    updateNickname,
    setPassword,
    removePassword,
};
