import { describe, test, expect } from "bun:test";
import { database } from "../src/db.js";

describe("Database Operations", () => {
  const guildId = "test_guild_" + Date.now();

  test("adds and retrieves bad words", () => {
    database.addBadWord(guildId, "spamword");
    database.addBadWord(guildId, "badword");

    const words = database.getBadWords(guildId);
    expect(words.length).toBe(2);
    expect(words.map((w) => w.word)).toContain("spamword");
    expect(words.map((w) => w.word)).toContain("badword");

    const list = database.getBadWordsList(guildId);
    expect(list).toContain("spamword");
  });

  test("removes bad word and clears", () => {
    const words = database.getBadWords(guildId);
    const target = words.find((w) => w.word === "spamword");
    expect(target).toBeDefined();

    database.removeBadWord(guildId, target.id);
    const updated = database.getBadWords(guildId);
    expect(updated.length).toBe(1);

    database.clearBadWords(guildId);
    expect(database.getBadWords(guildId).length).toBe(0);
  });

  test("manages guild settings", () => {
    database.setGuildSettings(guildId, {
      enabled: false,
      match_mode: "exact",
      clear_mode: "targeted",
      log_channel_id: "123456789",
    });

    const settings = database.getGuildSettings(guildId);
    expect(settings.enabled).toBe(false);
    expect(settings.match_mode).toBe("exact");
    expect(settings.clear_mode).toBe("targeted");
    expect(settings.log_channel_id).toBe("123456789");
  });

  test("session storage and expiration", () => {
    const sessionId = "test_session_" + Date.now();
    database.createSession(
      sessionId,
      { user: "Cristian", role: "admin" },
      5000,
    );

    const session = database.getSession(sessionId);
    expect(session).toBeDefined();
    expect(session.user).toBe("Cristian");

    database.deleteSession(sessionId);
    expect(database.getSession(sessionId)).toBeNull();
  });
});

describe("Multi-process cache coherence", () => {
  test("sees settings and words written by another process", () => {
    const guildId = "shared_guild_" + Date.now();
    const dbPath = process.env.DB_PATH || "data/reaction_mod.sqlite";

    expect(database.getGuildSettings(guildId).log_channel_id).toBeNull();
    expect(database.getBadWordsList(guildId)).toEqual([]);

    const script = `
      import { database } from ${JSON.stringify(new URL("../src/db.js", import.meta.url).pathname)};
      database.setGuildSettings(${JSON.stringify(guildId)}, { enabled: false, match_mode: 'exact', clear_mode: 'all', log_channel_id: '987' });
      database.addBadWord(${JSON.stringify(guildId)}, 'otherproc');
    `;
    const child = Bun.spawnSync(["bun", "-e", script], {
      env: { ...process.env, DB_PATH: dbPath },
    });
    expect(child.exitCode).toBe(0);

    const settings = database.getGuildSettings(guildId);
    expect(settings.enabled).toBe(false);
    expect(settings.match_mode).toBe("exact");
    expect(settings.clear_mode).toBe("all");
    expect(settings.log_channel_id).toBe("987");
    expect(database.getBadWordsList(guildId)).toContain("otherproc");
    expect(database.getGuildRegex(guildId).test("otherproc")).toBe(true);
  });
});
