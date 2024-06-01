const crypto = require('crypto');

/**
 * @typedef {object} ClientConfig
 * @property {string} id
 * @property {number} createdAt
 * @property {string} clientId
 * @property {string} name
 * @property {string} platform
 * @property {string} auth
 */
/**
 * @typedef {object} ClientInfo
 * @property {id} string
 * @property {string} name
 * @property {string} platform
 * @property {string[]} auth
 */
/**
 * @typedef {object} TokenOptions
 * @property {number=} expiredTime
 */
/**
 * @param {ClientInfo} clientInfo
 * @param {TokenOptions} options
 */
export function generateToken(clientInfo, options) {
  if (!clientInfo) {
    throw new Error('Client info is blank!');
  }
  options = options ?? {expiredTime: 0};
  const expiredTime = options.expiredTime ?? 0;
  const createdAt = Date.now();
  const id = crypto.randomUUID();
  const masterKey = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);
  const salt = crypto.randomBytes(64);
  const key = crypto.pbkdf2Sync(masterKey, salt, 2145, 32, 'sha512');
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const text = JSON.stringify({
    createdAt,
    expiredTime,
    id,
    clientId: clientInfo.id,
    name: clientInfo.name,
    platform: clientInfo.platform,
    auth: clientInfo.auth.join(','),
  });
  const encryptedText = cipher.update(text, 'utf8', 'hex') + cipher.final('hex');
  console.log(encryptedText);
  const encrypted = Buffer.from(encryptedText, 'hex');
  const tag = cipher.getAuthTag();
  const token = Buffer.concat([masterKey, salt, iv, tag, encrypted]).toString('base64');
  return {
    id,
    token,
    expiredTime,
    createdAt,
  };
}

/**
 * @param {string} s
 */
export function separateToken(s) {
  console.log(s);
  const bData = Buffer.from(s, 'base64');
  let offset = 0;
  const masterKey = bData.subarray(offset, offset + 32); offset += 32;
  const salt = bData.subarray(offset, offset + 64); offset += 64;
  const iv = bData.subarray(offset, offset + 12); offset += 12;
  const tag = bData.subarray(offset, offset + 16); offset += 16;
  const text = bData.subarray(offset);
  const key = crypto.pbkdf2Sync(masterKey, salt, 2145, 32, 'sha512');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const decrypted = decipher.update(text, 'hex', 'utf8') + decipher.final('utf8');
  /** @type {ClientConfig} */
  const res = JSON.parse(decrypted);
  return res;
}

