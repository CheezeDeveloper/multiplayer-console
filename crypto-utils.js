const crypto = require('crypto');

function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(password, salt, 64).toString('hex');
    return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
    if (!stored) return false;
    const [salt, originalHash] = stored.split(':');
    if (!salt || !originalHash) return false;

    const hash = crypto.scryptSync(password, salt, 64).toString('hex');
    const hashBuffer = Buffer.from(hash, 'hex');
    const originalBuffer = Buffer.from(originalHash, 'hex');

    if (hashBuffer.length !== originalBuffer.length) return false;
    return crypto.timingSafeEqual(hashBuffer, originalBuffer);
}

module.exports = { hashPassword, verifyPassword };
