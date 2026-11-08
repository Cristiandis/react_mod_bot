import { database } from './db.js';

const MANAGE_GUILD = 1n << 5n;
const ADMINISTRATOR = 1n << 3n;

function userHasManageGuild(guild) {
  if (guild.owner) return true;
  if (!guild.permissions) return false;
  try {
    const perms = BigInt(guild.permissions);
    return (perms & ADMINISTRATOR) === ADMINISTRATOR || (perms & MANAGE_GUILD) === MANAGE_GUILD;
  } catch {
    return false;
  }
}

function getCookie(req, name) {
  const cookieHeader = req.headers.get('cookie') || '';
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

export function startWebServer(client) {
  const PORT = parseInt(process.env.PORT || '3000', 10);
  const CLIENT_ID = process.env.DISCORD_CLIENT_ID || '';
  const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET || '';
  const REDIRECT_URI = process.env.REDIRECT_URI || `http://localhost:${PORT}/auth/callback`;
  const PANEL_PASSWORD = process.env.PANEL_PASSWORD || '';

  const server = Bun.serve({
    port: PORT,
    async fetch(req) {
      const url = new URL(req.url);
      const pathname = url.pathname;
      const method = req.method;

      const sessionId = getCookie(req, 'session_id');
      const sessionUser = database.getSession(sessionId);

      if (pathname === '/login') {
        if (sessionUser) return Response.redirect('/', 302);
        return new Response(renderLoginPage({ CLIENT_ID, PANEL_PASSWORD }), {
          headers: { 'Content-Type': 'text/html; charset=utf-8' }
        });
      }

      if (pathname === '/auth/discord') {
        if (!CLIENT_ID || !CLIENT_SECRET) {
          return new Response(
            renderErrorPage(
              'OAuth Not Configured',
              'DISCORD_CLIENT_ID or DISCORD_CLIENT_SECRET is missing in .env.'
            ),
            { headers: { 'Content-Type': 'text/html; charset=utf-8' }, status: 400 }
          );
        }
        const discordAuthUrl = `https://discord.com/oauth2/authorize?client_id=${CLIENT_ID}&response_type=code&redirect_uri=${encodeURIComponent(
          REDIRECT_URI
        )}&scope=identify%20guilds`;
        return Response.redirect(discordAuthUrl, 302);
      }

      if (pathname === '/auth/callback') {
        const code = url.searchParams.get('code');
        if (!code) return Response.redirect('/login?error=no_code', 302);

        try {
          const tokenRes = await fetch('https://discord.com/api/v10/oauth2/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              client_id: CLIENT_ID,
              client_secret: CLIENT_SECRET,
              grant_type: 'authorization_code',
              code,
              redirect_uri: REDIRECT_URI
            })
          });

          if (!tokenRes.ok) return Response.redirect('/login?error=token_failed', 302);
          const tokenData = await tokenRes.json();

          const userRes = await fetch('https://discord.com/api/v10/users/@me', {
            headers: { Authorization: `Bearer ${tokenData.access_token}` }
          });
          const userData = await userRes.json();

          const guildsRes = await fetch('https://discord.com/api/v10/users/@me/guilds', {
            headers: { Authorization: `Bearer ${tokenData.access_token}` }
          });
          const userGuilds = await guildsRes.json();
          if (!Array.isArray(userGuilds)) return Response.redirect('/login?error=guilds_failed', 302);

          const manageableGuilds = userGuilds
            .filter(g => userHasManageGuild(g))
            .map(g => ({
              id: g.id,
              name: g.name,
              icon: g.icon,
              owner: g.owner
            }));

          const newSessionId = crypto.randomUUID();
          database.createSession(newSessionId, {
            id: userData.id,
            username: userData.username,
            avatar: userData.avatar,
            manageableGuilds,
            authMethod: 'discord'
          });

          return new Response(null, {
            status: 302,
            headers: {
              Location: '/',
              'Set-Cookie': `session_id=${newSessionId}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${7 * 86400}`
            }
          });
        } catch {
          return Response.redirect('/login?error=server_error', 302);
        }
      }

      if (pathname === '/auth/login-password' && method === 'POST') {
        const formData = await req.formData();
        if (PANEL_PASSWORD && formData.get('password') === PANEL_PASSWORD) {
          const newSessionId = crypto.randomUUID();
          const botGuilds = Array.from(client.guilds.cache.values()).map(g => ({
            id: g.id,
            name: g.name,
            icon: g.icon,
            owner: true
          }));

          database.createSession(newSessionId, {
            id: 'admin',
            username: 'Server Admin',
            avatar: null,
            manageableGuilds: botGuilds,
            authMethod: 'password'
          });

          return new Response(null, {
            status: 302,
            headers: {
              Location: '/',
              'Set-Cookie': `session_id=${newSessionId}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${7 * 86400}`
            }
          });
        }
        return Response.redirect('/login?error=invalid_password', 302);
      }

      if (pathname === '/auth/logout') {
        if (sessionId) database.deleteSession(sessionId);
        return new Response(null, {
          status: 302,
          headers: {
            Location: '/login',
            'Set-Cookie': 'session_id=; HttpOnly; Path=/; Max-Age=0'
          }
        });
      }

      if (!sessionUser) return Response.redirect('/login', 302);

      const botGuildMap = client.guilds.cache;
      const validGuilds = sessionUser.manageableGuilds.filter(g => botGuildMap.has(g.id));

      if (validGuilds.length === 0) {
        return new Response(renderAccessDeniedPage(sessionUser), {
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
          status: 403
        });
      }

      const requestedGuildId = url.searchParams.get('guild_id');
      const currentGuildId = requestedGuildId && validGuilds.some(g => g.id === requestedGuildId)
        ? requestedGuildId
        : validGuilds[0].id;

      const currentDiscordGuild = botGuildMap.get(currentGuildId);

      function verifyGuildAccess(gId) {
        return validGuilds.some(g => g.id === gId);
      }

      if (pathname === '/api/badwords/add' && method === 'POST') {
        const formData = await req.formData();
        const targetGuild = formData.get('guild_id');
        if (!verifyGuildAccess(targetGuild)) return new Response('Forbidden', { status: 403 });

        const words = (formData.get('word') || '').toString().split(/[\n,]+/).map(w => w.trim()).filter(Boolean);
        if (words.length > 0) database.addMultipleBadWords(targetGuild, words);
        return Response.redirect(`/?guild_id=${targetGuild}`, 302);
      }

      if (pathname === '/api/badwords/delete' && method === 'POST') {
        const formData = await req.formData();
        const targetGuild = formData.get('guild_id');
        const wordId = parseInt(formData.get('id') || '0', 10);
        if (!verifyGuildAccess(targetGuild)) return new Response('Forbidden', { status: 403 });

        if (wordId) database.removeBadWord(targetGuild, wordId);
        return Response.redirect(`/?guild_id=${targetGuild}`, 302);
      }

      if (pathname === '/api/badwords/clear' && method === 'POST') {
        const formData = await req.formData();
        const targetGuild = formData.get('guild_id');
        if (!verifyGuildAccess(targetGuild)) return new Response('Forbidden', { status: 403 });

        database.clearBadWords(targetGuild);
        return Response.redirect(`/?guild_id=${targetGuild}`, 302);
      }

      if (pathname === '/api/settings/save' && method === 'POST') {
        const formData = await req.formData();
        const targetGuild = formData.get('guild_id');
        if (!verifyGuildAccess(targetGuild)) return new Response('Forbidden', { status: 403 });

        database.setGuildSettings(targetGuild, {
          enabled: formData.get('enabled') === '1',
          match_mode: formData.get('match_mode') === 'exact' ? 'exact' : 'contains',
          clear_mode: formData.get('clear_mode') === 'all' ? 'all' : 'targeted',
          log_channel_id: formData.get('log_channel_id') === 'none' ? null : formData.get('log_channel_id')
        });

        return Response.redirect(`/?guild_id=${targetGuild}`, 302);
      }

      if (pathname === '/') {
        const badWords = database.getBadWords(currentGuildId);
        const settings = database.getGuildSettings(currentGuildId);
        const textChannels = currentDiscordGuild
          ? Array.from(currentDiscordGuild.channels.cache.values())
              .filter(c => c.isTextBased() && !c.isThread())
              .map(c => ({ id: c.id, name: c.name }))
          : [];

        const html = renderDashboardPage({
          sessionUser,
          validGuilds,
          currentGuildId,
          currentDiscordGuild,
          badWords,
          settings,
          textChannels,
          botUser: client.user
        });

        return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      }

      return new Response('Not Found', { status: 404 });
    }
  });

  console.log(`Web Panel running at: http://localhost:${PORT}`);
  return server;
}

const COMMON_CSS = `
  :root {
    --bg: #111215;
    --surface: #1a1b1f;
    --surface-hover: #22242a;
    --border: #292b32;
    --text: #dbdcde;
    --text-muted: #838690;
    --primary: #5865f2;
    --primary-hover: #4752c4;
    --danger: #da373c;
    --danger-bg: rgba(218, 55, 60, 0.15);
    --success: #23a55a;
    --success-bg: rgba(35, 165, 90, 0.15);
    --radius: 8px;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: var(--bg);
    color: var(--text);
    line-height: 1.5;
    font-size: 13px;
  }
  a { color: inherit; text-decoration: none; }
  button, input, select {
    font: inherit;
    color: inherit;
    outline: none;
  }
  .header {
    background: var(--surface);
    border-bottom: 1px solid var(--border);
    padding: 12px 24px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    position: sticky;
    top: 0;
    z-index: 10;
  }
  .header-side { display: flex; align-items: center; gap: 12px; }
  .avatar { width: 30px; height: 30px; border-radius: 50%; }
  .badge {
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 12px;
    background: rgba(88, 101, 242, 0.18);
    color: #8b94f7;
    font-weight: 600;
  }
  .btn {
    padding: 6px 14px;
    border-radius: var(--radius);
    border: 1px solid transparent;
    cursor: pointer;
    font-size: 12px;
    font-weight: 600;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    transition: background 0.15s, border-color 0.15s;
  }
  .btn-primary { background: var(--primary); color: #fff; }
  .btn-primary:hover { background: var(--primary-hover); }
  .btn-secondary { background: var(--surface-hover); border-color: var(--border); }
  .btn-secondary:hover { background: #2c2f37; }
  .btn-danger { background: var(--danger-bg); border-color: rgba(218, 55, 60, 0.4); color: #ff7b7f; }
  .btn-danger:hover { background: rgba(218, 55, 60, 0.28); }
  .container {
    max-width: 1100px;
    margin: 0 auto;
    padding: 20px 16px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 18px;
  }
  .card-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1px solid var(--border);
    padding-bottom: 12px;
    margin-bottom: 14px;
  }
  .card-title { font-size: 15px; font-weight: 700; color: #fff; display: flex; align-items: center; gap: 8px; }
  .card-subtitle { color: var(--text-muted); font-size: 12px; margin-top: 2px; }
  .grid {
    display: grid;
    grid-template-columns: 2fr 1fr;
    gap: 16px;
  }
  @media (max-width: 820px) {
    .grid { grid-template-columns: 1fr; }
  }
  .input, .select {
    width: 100%;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 8px 12px;
    font-size: 13px;
  }
  .input:focus, .select:focus { border-color: var(--primary); }
  .words-box {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 12px;
    min-height: 180px;
    max-height: 400px;
    overflow-y: auto;
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-content: flex-start;
  }
  .word-chip {
    background: var(--surface);
    border: 1px solid var(--border);
    padding: 4px 8px;
    border-radius: 6px;
    font-size: 12px;
    font-family: monospace;
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .word-chip button {
    background: none;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    font-weight: bold;
    padding: 0 2px;
  }
  .word-chip button:hover { color: var(--danger); }
  .server-tabs { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
  .server-pill {
    padding: 6px 12px;
    border-radius: 6px;
    background: var(--surface-hover);
    border: 1px solid var(--border);
    font-weight: 500;
  }
  .server-pill.active {
    background: var(--primary);
    border-color: var(--primary);
    color: #fff;
  }
`;

function renderHeader(sessionUser, botUser) {
  const avatarUrl = sessionUser.avatar
    ? `https://cdn.discordapp.com/avatars/${sessionUser.id}/${sessionUser.avatar}.png?size=64`
    : 'https://cdn.discordapp.com/embed/avatars/0.png';

  const botAvatar = botUser?.avatar
    ? `https://cdn.discordapp.com/avatars/${botUser.id}/${botUser.avatar}.png?size=64`
    : 'https://cdn.discordapp.com/embed/avatars/1.png';

  return `
    <header class="header">
      <div class="header-side">
        <img src="${botAvatar}" class="avatar" alt="Bot">
        <div>
          <div style="font-weight: 700; color: #fff; display: flex; align-items: center; gap: 8px;">
            ${botUser ? botUser.username : 'ReactMod'}
            <span class="badge">Active</span>
          </div>
        </div>
      </div>
      <div class="header-side">
        <div style="display: flex; align-items: center; gap: 8px; background: var(--bg); padding: 4px 10px; border-radius: 20px; border: 1px solid var(--border);">
          <img src="${avatarUrl}" style="width: 20px; height: 20px; border-radius: 50%;" alt="Avatar">
          <span>${escapeHtml(sessionUser.username)}</span>
        </div>
        <a href="/auth/logout" class="btn btn-danger" style="padding: 4px 10px;">Logout</a>
      </div>
    </header>
  `;
}

function renderDashboardPage({
  sessionUser,
  validGuilds,
  currentGuildId,
  currentDiscordGuild,
  badWords,
  settings,
  textChannels,
  botUser
}) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(currentDiscordGuild?.name || 'Dashboard')} - ReactMod</title>
  <style>${COMMON_CSS}</style>
</head>
<body>
  ${renderHeader(sessionUser, botUser)}

  <main class="container">
    <div class="card" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;">
      <div class="server-tabs">
        <span style="color: var(--text-muted); font-size: 12px; font-weight: 600;">SERVERS:</span>
        ${validGuilds.map(g => `
          <a href="/?guild_id=${g.id}" class="server-pill ${g.id === currentGuildId ? 'active' : ''}">
            ${escapeHtml(g.name)}
          </a>
        `).join('')}
      </div>
      <div style="display: flex; align-items: center; gap: 8px; font-size: 12px;">
        <span style="width: 8px; height: 8px; border-radius: 50%; background: ${settings.enabled ? 'var(--success)' : 'var(--danger)'};"></span>
        <span>Filter: <strong>${settings.enabled ? 'Enabled' : 'Disabled'}</strong></span>
      </div>
    </div>

    <div class="grid">
      <div style="display: flex; flex-direction: column; gap: 16px;">
        
        <div class="card">
          <div class="card-header">
            <div>
              <div class="card-title">
                Blocked Words & Emojis
                <span class="badge" style="background: var(--bg); color: var(--text);">${badWords.length} items</span>
              </div>
              <div class="card-subtitle">Wipes prohibited reaction words and blocked individual emojis.</div>
            </div>
            ${badWords.length > 0 ? `
              <form action="/api/badwords/clear" method="POST" onsubmit="return confirm('Clear all bad words?');">
                <input type="hidden" name="guild_id" value="${currentGuildId}">
                <button type="submit" class="btn btn-danger" style="padding: 4px 8px; font-size: 11px;">Clear All</button>
              </form>
            ` : ''}
          </div>

          <form action="/api/badwords/add" method="POST" style="display: flex; gap: 8px; margin-bottom: 10px;">
            <input type="hidden" name="guild_id" value="${currentGuildId}">
            <input type="text" name="word" required placeholder="Add prohibited word(s) or emoji(s), comma-separated (e.g. hi, spam, 🖕, clown)" class="input">
            <button type="submit" class="btn btn-primary" style="white-space: nowrap;">+ Add</button>
          </form>

          <input type="text" placeholder="Filter words below..." oninput="filterWords(this.value)" class="input" style="padding: 6px 10px; font-size: 12px; margin-bottom: 10px;">

          <div class="words-box">
            ${badWords.length === 0 ? `
              <div style="color: var(--text-muted); text-align: center; width: 100%; padding: 40px 0;">
                No items configured yet. Add words or emojis above to start protecting this server.
              </div>
            ` : badWords.map(w => `
              <span class="word-chip" data-word="${escapeHtml(w.word)}">
                <span>${escapeHtml(w.word)}</span>
                <form action="/api/badwords/delete" method="POST" style="display: inline;">
                  <input type="hidden" name="guild_id" value="${currentGuildId}">
                  <input type="hidden" name="id" value="${w.id}">
                  <button type="submit">×</button>
                </form>
              </span>
            `).join('')}
          </div>
        </div>

      </div>

      <div style="display: flex; flex-direction: column; gap: 16px;">
        
        <div class="card">
          <div class="card-title" style="margin-bottom: 14px;">Settings & Logging</div>
          <form action="/api/settings/save" method="POST" style="display: flex; flex-direction: column; gap: 14px;">
            <input type="hidden" name="guild_id" value="${currentGuildId}">

            <label style="display: flex; align-items: center; gap: 10px; cursor: pointer;">
              <input type="checkbox" name="enabled" value="1" ${settings.enabled ? 'checked' : ''} style="width: 16px; height: 16px;">
              <span><strong>Enable Reaction Filter</strong></span>
            </label>

            <div>
              <label style="display: block; font-size: 11px; font-weight: 600; color: var(--text-muted); margin-bottom: 6px;">REMOVAL ACTION</label>
              <select name="clear_mode" class="select">
                <option value="targeted" ${settings.clear_mode !== 'all' ? 'selected' : ''}>Clear offending reaction(s) only (Recommended)</option>
                <option value="all" ${settings.clear_mode === 'all' ? 'selected' : ''}>Clear all reactions on message</option>
              </select>
            </div>

            <div>
              <label style="display: block; font-size: 11px; font-weight: 600; color: var(--text-muted); margin-bottom: 6px;">MATCH MODE</label>
              <select name="match_mode" class="select">
                <option value="contains" ${settings.match_mode === 'contains' ? 'selected' : ''}>Contains (Substring - Recommended)</option>
                <option value="exact" ${settings.match_mode === 'exact' ? 'selected' : ''}>Exact match only</option>
              </select>
            </div>

            <div>
              <label style="display: block; font-size: 11px; font-weight: 600; color: var(--text-muted); margin-bottom: 6px;">LOG CHANNEL</label>
              <select name="log_channel_id" class="select">
                <option value="none">Disabled (No logs)</option>
                ${settings.log_channel_id && !textChannels.some(ch => ch.id === settings.log_channel_id) ? `
                  <option value="${escapeHtml(settings.log_channel_id)}" selected>Unavailable channel (${escapeHtml(settings.log_channel_id)})</option>
                ` : ''}
                ${textChannels.map(ch => `
                  <option value="${ch.id}" ${settings.log_channel_id === ch.id ? 'selected' : ''}>#${escapeHtml(ch.name)}</option>
                `).join('')}
              </select>
            </div>

            <div style="background: var(--bg); border-left: 3px solid #ed4245; border-radius: 4px; padding: 10px; font-size: 11px; line-height: 1.6;">
              <div style="color: var(--text-muted); font-size: 10px; font-weight: 700; margin-bottom: 4px; text-transform: uppercase;">Channel Log Embed Format</div>
              <div><strong>Reactions cleared:</strong> <a href="#" style="color: var(--primary);">#channel</a></div>
              <div><strong>User:</strong> @Username</div>
              <div><strong>Matched:</strong> <span style="background: rgba(237, 66, 69, 0.15); color: #ff7b7f; padding: 1px 4px; border-radius: 3px; font-family: monospace;">prohibited_word</span></div>
              <div style="color: var(--text-muted); font-size: 10px; margin-top: 4px;">Today at 12:00 PM</div>
            </div>

            <button type="submit" class="btn btn-secondary" style="width: 100%; margin-top: 4px;">Save Settings</button>
          </form>
        </div>

      </div>
    </div>
  </main>

  <script>
    function filterWords(q) {
      const query = q.trim().toLowerCase();
      document.querySelectorAll('.word-chip').forEach(el => {
        const word = el.getAttribute('data-word') || '';
        el.style.display = word.includes(query) ? 'inline-flex' : 'none';
      });
    }
  </script>
</body>
</html>`;
}

function renderLoginPage({ CLIENT_ID, PANEL_PASSWORD }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Login - ReactMod</title>
  <style>
    ${COMMON_CSS}
    body {
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 16px;
    }
    .login-box {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 32px;
      width: 100%;
      max-width: 400px;
      display: flex;
      flex-direction: column;
      gap: 20px;
    }
  </style>
</head>
<body>
  <div class="login-box">
    <div style="text-align: center;">
      <h1 style="font-size: 20px; font-weight: 700; color: #fff;">ReactMod Panel</h1>
      <p style="color: var(--text-muted); font-size: 12px; margin-top: 4px;">Sign in to manage text reaction filters.</p>
    </div>

    <div style="background: var(--bg); border: 1px solid var(--border); border-radius: var(--radius); padding: 12px; font-size: 12px; color: var(--text-muted);">
      <strong style="color: var(--text);">Manage Server Required</strong><br>
      Access is restricted to users with Manage Server permissions in servers where this bot is installed.
    </div>

    <a href="/auth/discord" class="btn btn-primary" style="padding: 10px; font-size: 14px;">
      Login with Discord
    </a>

    ${PANEL_PASSWORD ? `
      <div style="display: flex; align-items: center; gap: 10px; margin: 4px 0;">
        <div style="flex: 1; height: 1px; background: var(--border);"></div>
        <span style="font-size: 11px; color: var(--text-muted);">or password</span>
        <div style="flex: 1; height: 1px; background: var(--border);"></div>
      </div>
      <form action="/auth/login-password" method="POST" style="display: flex; flex-direction: column; gap: 10px;">
        <input type="password" name="password" required placeholder="Enter PANEL_PASSWORD" class="input">
        <button type="submit" class="btn btn-secondary">Sign In with Password</button>
      </form>
    ` : ''}

    ${!CLIENT_ID ? `
      <div style="font-size: 11px; color: #f1c40f; background: rgba(241, 196, 15, 0.1); border: 1px solid rgba(241, 196, 15, 0.2); padding: 8px; border-radius: 6px;">
        DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET not configured in .env.
      </div>
    ` : ''}
  </div>
</body>
</html>`;
}

function renderAccessDeniedPage(sessionUser) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Access Denied - ReactMod</title>
  <style>
    ${COMMON_CSS}
    body { display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 16px; }
    .box { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 32px; max-width: 420px; text-align: center; }
  </style>
</head>
<body>
  <div class="box">
    <h1 style="color: var(--danger); font-size: 20px; margin-bottom: 8px;">Access Denied</h1>
    <p style="color: var(--text-muted); font-size: 12px; margin-bottom: 16px;">
      Signed in as <strong>${escapeHtml(sessionUser.username)}</strong>.
    </p>
    <p style="font-size: 13px; margin-bottom: 20px;">
      You do not have <strong>Manage Server</strong> permission on any server where this bot is currently installed.
    </p>
    <a href="/auth/logout" class="btn btn-secondary">Log Out</a>
  </div>
</body>
</html>`;
}

function renderErrorPage(title, message) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${escapeHtml(title)} - ReactMod</title>
  <style>
    ${COMMON_CSS}
    body { display: flex; align-items: center; justify-content: center; min-height: 100vh; }
    .box { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 32px; max-width: 400px; text-align: center; }
  </style>
</head>
<body>
  <div class="box">
    <h1 style="color: var(--danger); font-size: 18px; margin-bottom: 8px;">${escapeHtml(title)}</h1>
    <p style="color: var(--text-muted); font-size: 12px; margin-bottom: 16px;">${escapeHtml(message)}</p>
    <a href="/login" class="btn btn-primary">Return to Login</a>
  </div>
</body>
</html>`;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
