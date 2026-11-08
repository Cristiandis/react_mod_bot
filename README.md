# react_mod_bot

Discord bot running on Bun that detects prohibited words formed by text reactions and blocked individual emojis, clearing offending reactions while leaving unrelated reactions intact. Includes a minimal web panel accessible only to users with Manage Server permissions.

## Features

- Detects words formed by regional indicator emojis (A-Z) and letter symbols.
- Moderates individual blocked emojis (e.g. offensive or blacklisted emojis).
- Clears only the offending reactions (or all reactions, configurable in panel).
- Web panel to configure bad words, match modes, and log channels.
- Logs deletions to a designated Discord channel with message links, author, and matched words.
- Access restricted via Discord OAuth2 to users with Manage Server permissions.

## Setup

1. Copy environment template:
```bash
cp .env.example .env
```

2. Fill in `.env`:
```env
DISCORD_TOKEN=your_bot_token
DISCORD_CLIENT_ID=your_client_id
DISCORD_CLIENT_SECRET=your_client_secret
REDIRECT_URI=http://localhost:3000/auth/callback
PORT=3000
PANEL_PASSWORD=admin123
```

3. Discord Developer Portal configuration:
- In the Bot tab, enable Server Members Intent.
- In OAuth2 Redirects, add your redirect URI (e.g. `http://localhost:3000/auth/callback`).
- Invite the bot with `Manage Messages`, `Read Message History`, and `View Channel` permissions.

## Usage

Start the bot and panel:
```bash
bun start
```

Run in development mode:
```bash
bun dev
```

Run tests:
```bash
bun test
```
