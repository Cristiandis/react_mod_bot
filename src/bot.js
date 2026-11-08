import { Client, GatewayIntentBits, Partials, Events, EmbedBuilder } from 'discord.js';
import { database } from './db.js';
import { extractReactionStrings, checkBadWords, isBlockedReaction } from './reactionParser.js';

export function createBotClient() {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.GuildMessageReactions
    ],
    partials: [
      Partials.Message,
      Partials.Reaction,
      Partials.User
    ]
  });

  const activeMessageLocks = new Map();

  client.once(Events.ClientReady, (readyClient) => {
    console.log(`ReactMod Bot logged in as: ${readyClient.user.tag}`);
    console.log(`Connected to ${readyClient.guilds.cache.size} server(s)`);
  });

  async function sendLogEmbed(message, userObj, matchedText, channelId) {
    try {
      const logChannel = message.guild?.channels.cache.get(channelId);
      if (logChannel?.isTextBased()) {
        const messageLink = `https://discord.com/channels/${message.guild.id}/${message.channel.id}/${message.id}`;
        const embed = new EmbedBuilder()
          .setColor(0xed4245)
          .setDescription(
            `**Reactions cleared:** [${message.channel.name || 'message'}](${messageLink})\n` +
            `**User:** <@${userObj.id}> (${userObj.tag || userObj.username})\n` +
            `**Matched:** \`${matchedText}\``
          )
          .setTimestamp();

        await logChannel.send({ embeds: [embed] });
      }
    } catch (logErr) {
      console.error('[ReactionMod] Failed to send log embed:', logErr.message);
    }
  }

  client.on(Events.MessageReactionAdd, async (reaction, user) => {
    if (user.bot) return;

    const guildId = reaction.message.guildId;
    if (!guildId) return;

    const settings = database.getGuildSettings(guildId);
    if (!settings.enabled) return;

    const badWords = database.getBadWordsList(guildId);
    if (badWords.length === 0) return;

    const messageId = reaction.message.id;

    if (activeMessageLocks.has(messageId)) {
      activeMessageLocks.set(messageId, true);
      return;
    }
    activeMessageLocks.set(messageId, false);

    try {
      do {
        activeMessageLocks.set(messageId, false);

        let message = reaction.message;
        if (message.partial) {
          try {
            message = await message.fetch();
          } catch {
            break;
          }
        }

        const currentReactions = Array.from(message.reactions.cache.values());
        if (currentReactions.length === 0) break;

        let actionTaken = false;

        // 1. Check for blocked individual emoji reactions
        for (const r of currentReactions) {
          const singleMatch = isBlockedReaction(r, badWords);
          if (singleMatch.matched) {
            actionTaken = true;
            let author = user;
            try {
              const uList = await r.users.fetch({ limit: 5 }).catch(() => null);
              const nonBot = uList?.filter(u => !u.bot).first();
              if (nonBot) author = nonBot;
            } catch {}

            try {
              if (settings.clear_mode === 'all') {
                await message.reactions.removeAll();
              } else {
                await r.remove();
              }
            } catch (err) {
              if (err.code === 50013) {
                console.error(`[ReactionMod] Missing 'Manage Messages' permission in #${message.channel.name || message.channel.id}`);
              }
            }

            if (settings.log_channel_id) {
              await sendLogEmbed(message, author, singleMatch.word, settings.log_channel_id);
            }
            break;
          }
        }

        if (actionTaken) continue;

        // 2. Check for continuous text string matching bad words
        const { chunks, candidates } = extractReactionStrings(currentReactions);
        if (candidates.length === 0) break;

        const matchResult = checkBadWords(chunks, badWords, settings.match_mode, database.getGuildRegex(guildId));

        if (matchResult.matched) {
          let firstAuthor = user;
          try {
            const userCounts = new Map();
            const reactionsToCheck = matchResult.reactions?.length ? matchResult.reactions : currentReactions;
            for (const r of reactionsToCheck) {
              const uList = await r.users.fetch({ limit: 10 }).catch(() => null);
              if (uList) {
                for (const [, u] of uList) {
                  if (!u.bot) {
                    userCounts.set(u.id, { user: u, count: (userCounts.get(u.id)?.count || 0) + 1 });
                  }
                }
              }
            }
            let maxEntry = null;
            for (const entry of userCounts.values()) {
              if (!maxEntry || entry.count > maxEntry.count) maxEntry = entry;
            }
            if (maxEntry?.user) firstAuthor = maxEntry.user;
          } catch {}

          try {
            if (settings.clear_mode === 'all' || !matchResult.reactions?.length) {
              await message.reactions.removeAll();
            } else {
              for (const r of matchResult.reactions) {
                await r.remove().catch(() => {});
              }
            }
          } catch (err) {
            if (err.code === 50013) {
              console.error(`[ReactionMod] Missing 'Manage Messages' permission in #${message.channel.name || message.channel.id}`);
            }
          }

          if (settings.log_channel_id) {
            await sendLogEmbed(
              message,
              firstAuthor,
              matchResult.word || matchResult.matchedIn || candidates[0],
              settings.log_channel_id
            );
          }
        }
      } while (activeMessageLocks.get(messageId) === true);
    } catch (err) {
      console.error('[ReactionMod] Error processing reaction:', err);
    } finally {
      activeMessageLocks.delete(messageId);
    }
  });

  return client;
}
