import { Database } from 'bun:sqlite';
import { mkdirSync } from 'fs';
import { dirname } from 'path';

const DB_PATH = process.env.DB_PATH || 'data/reaction_mod.sqlite';
mkdirSync(dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.run('PRAGMA journal_mode = WAL;');

db.run(`
  CREATE TABLE IF NOT EXISTS guild_settings (
    guild_id TEXT PRIMARY KEY,
    enabled INTEGER NOT NULL DEFAULT 1,
    match_mode TEXT NOT NULL DEFAULT 'contains',
    clear_mode TEXT NOT NULL DEFAULT 'targeted',
    log_channel_id TEXT
  );
  CREATE TABLE IF NOT EXISTS bad_words (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    word TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    UNIQUE(guild_id, word)
  );
`);

try {
  db.run("ALTER TABLE guild_settings ADD COLUMN clear_mode TEXT DEFAULT 'targeted'");
} catch {}

const badWordsCache = new Map();
const settingsCache = new Map();
const regexCache = new Map();
const sessions = new Map();

function syncGuildCache(guildId) {
  const words = db.query('SELECT word FROM bad_words WHERE guild_id = ?').values(guildId).flat();
  badWordsCache.set(guildId, words);
  regexCache.set(guildId, words.length ? new RegExp(words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'i') : null);
}

export const database = {
  getBadWords(guildId) {
    return db.query('SELECT id, word, created_at FROM bad_words WHERE guild_id = ? ORDER BY id DESC').all(guildId);
  },

  getBadWordsList(guildId) {
    if (!badWordsCache.has(guildId)) syncGuildCache(guildId);
    return badWordsCache.get(guildId) || [];
  },

  getGuildRegex(guildId) {
    if (!regexCache.has(guildId)) syncGuildCache(guildId);
    return regexCache.get(guildId);
  },

  addBadWord(guildId, word) {
    const clean = word.trim().toLowerCase();
    if (!clean) return false;
    db.run('INSERT OR IGNORE INTO bad_words (guild_id, word, created_at) VALUES (?, ?, ?)', [guildId, clean, Date.now()]);
    syncGuildCache(guildId);
    return true;
  },

  addMultipleBadWords(guildId, wordsArray) {
    const now = Date.now();
    const insertMany = db.transaction((words) => {
      for (const w of words) {
        const clean = w.trim().toLowerCase();
        if (clean) db.run('INSERT OR IGNORE INTO bad_words (guild_id, word, created_at) VALUES (?, ?, ?)', [guildId, clean, now]);
      }
    });
    insertMany(wordsArray);
    syncGuildCache(guildId);
  },

  removeBadWord(guildId, id) {
    db.run('DELETE FROM bad_words WHERE guild_id = ? AND id = ?', [guildId, id]);
    syncGuildCache(guildId);
  },

  clearBadWords(guildId) {
    db.run('DELETE FROM bad_words WHERE guild_id = ?', [guildId]);
    badWordsCache.set(guildId, []);
    regexCache.set(guildId, null);
  },

  getGuildSettings(guildId) {
    if (settingsCache.has(guildId)) return settingsCache.get(guildId);
    const row = db.query('SELECT enabled, match_mode, clear_mode, log_channel_id FROM guild_settings WHERE guild_id = ?').get(guildId);
    const settings = {
      enabled: row ? row.enabled === 1 : true,
      match_mode: row?.match_mode || 'contains',
      clear_mode: row?.clear_mode || 'targeted',
      log_channel_id: row?.log_channel_id || null
    };
    settingsCache.set(guildId, settings);
    return settings;
  },

  setGuildSettings(guildId, { enabled = true, match_mode = 'contains', clear_mode = 'targeted', log_channel_id = null }) {
    db.run(
      `INSERT INTO guild_settings (guild_id, enabled, match_mode, clear_mode, log_channel_id)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(guild_id) DO UPDATE SET
         enabled = excluded.enabled,
         match_mode = excluded.match_mode,
         clear_mode = excluded.clear_mode,
         log_channel_id = excluded.log_channel_id`,
      [guildId, enabled ? 1 : 0, match_mode, clear_mode, log_channel_id]
    );
    settingsCache.set(guildId, { enabled, match_mode, clear_mode, log_channel_id });
  },

  createSession(sessionId, userData, ttlMs = 7 * 86400000) {
    sessions.set(sessionId, { user: userData, expiresAt: Date.now() + ttlMs });
  },

  getSession(sessionId) {
    const s = sessions.get(sessionId);
    if (!s) return null;
    if (Date.now() > s.expiresAt) {
      sessions.delete(sessionId);
      return null;
    }
    return s.user;
  },

  deleteSession(sessionId) {
    sessions.delete(sessionId);
  }
};
