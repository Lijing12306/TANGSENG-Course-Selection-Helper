import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, readJson, writeJsonAtomic, ensureDir } from './storage.js';

const SECRET_FILE = path.join(DATA_DIR, 'secrets.json');
const KEY_FILE = path.join(DATA_DIR, 'machine.key');
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 };

function machineKey() {
  ensureDir(DATA_DIR);
  if (fs.existsSync(KEY_FILE)) return fs.readFileSync(KEY_FILE);
  const key = crypto.randomBytes(32);
  fs.writeFileSync(KEY_FILE, key, { mode: 0o600 });
  return key;
}

function derive(salt, password) {
  return crypto.scryptSync(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
}

export function encryptPassword(plain, passphrase = null) {
  const secret = passphrase || machineKey().toString('hex');
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = passphrase ? derive(salt, passphrase) : derive(salt, secret);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(Buffer.from(plain, 'utf8')), cipher.final()]);
  return {
    v: 1,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: enc.toString('base64'),
  };
}

export function decryptPassword(blob, passphrase = null) {
  if (!blob || typeof blob !== 'object' || !blob.data) return null;
  try {
    const secret = passphrase || machineKey().toString('hex');
    const salt = Buffer.from(blob.salt, 'base64');
    const iv = Buffer.from(blob.iv, 'base64');
    const key = passphrase ? derive(salt, passphrase) : derive(salt, secret);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(Buffer.from(blob.tag, 'base64'));
    const dec = Buffer.concat([decipher.update(Buffer.from(blob.data, 'base64')), decipher.final()]);
    return dec.toString('utf8');
  } catch {
    return null;
  }
}

export function loadSecrets() {
  return readJson(SECRET_FILE, {});
}

export function saveAccount(username, password) {
  const secrets = loadSecrets();
  secrets.username = username;
  secrets.password = encryptPassword(password);
  writeJsonAtomic(SECRET_FILE, secrets);
  return secrets;
}

export function resolveAccount(config) {
  const username = config?.account?.username || loadSecrets().username || '';
  let password = config?.account?.password || '';
  if (!password) {
    const blob = loadSecrets().password;
    password = decryptPassword(blob) || '';
  }
  return { username, password };
}

export function clearSecrets() {
  try { fs.rmSync(SECRET_FILE, { force: true }); } catch { /* ignore */ }
}
