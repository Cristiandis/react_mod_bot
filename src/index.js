import { createBotClient } from './bot.js';
import { startWebServer } from './server.js';

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;

const client = createBotClient();
const webServer = startWebServer(client);

if (!DISCORD_TOKEN || DISCORD_TOKEN.trim() === '' || DISCORD_TOKEN.includes('YOUR_DISCORD_BOT_TOKEN')) {
  console.warn('DISCORD_TOKEN is missing in .env. Web panel is running at http://localhost:' + webServer.port);
} else {
  client.login(DISCORD_TOKEN).catch(err => {
    console.error('Failed to login to Discord:', err.message);
  });
}

function shutdown() {
  try {
    client.destroy();
  } catch {}
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
