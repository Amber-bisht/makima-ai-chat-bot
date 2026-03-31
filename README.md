# Telegram Owner-Reply Bot (JavaScript) lets goo

Telegram bot that:
- responds in groups when `@OWNER_USERNAME` is tagged or users reply to bot messages
- responds only inside authorized groups from `AUTH_GROUP_IDS`
- replies as if it is the owner (via Groq)
- stores meaningful per-user memory in MongoDB
- keeps a fast in-memory index for frequent user memory reads
- notifies the owner privately when users ask to be contacted
- supports owner-only private commands

## Stack
- JavaScript (Node.js, ESM)
- Telegram: `node-telegram-bot-api`
- AI: Groq (`groq-sdk`)
- Database: MongoDB (`mongoose`)
- In-memory index: LRU-like `Map` cache

## Setup
1. Install dependencies:
```bash
npm install
```
2. Copy env file and fill values:
```bash
cp .env.example .env
```
3. Run:
```bash
npm start
```

## Environment Variables
- `TELEGRAM_BOT_TOKEN`: Bot token from BotFather
- `OWNER_NAME`: Display name of the owner whose voice the bot uses
- `ASSISTANT_NAME`: Assistant identity (default: `Makima`)
- `OWNER_USERNAME`: Owner username without `@` (example: `username`)
- `OWNER_USER_ID`: Telegram numeric user id of owner
- `OWNER_CHAT_ID`: Optional; where owner notifications are sent (defaults to `OWNER_USER_ID`)
- `AUTH_GROUP_IDS`: Comma-separated allowed group IDs (example: `-1002231076068,-4999803462`)
- `MONGODB_URI`: MongoDB connection string
- `GROQ_API_KEYS`: Comma-separated Groq API keys for fallback (example: `key1,key2,key3`)
- `GROQ_API_KEY`: Optional single key fallback (used only when `GROQ_API_KEYS` is not set)
- `GROQ_MODEL`: Groq model name (default: `qwen/qwen3-32b`)
- `NEWS_API_KEY`: NewsAPI key for live headlines/news questions
- `TAVILY_API_KEY`: Tavily key for person/web fallback when Wikipedia data is missing
- `CACHE_MAX_USERS`: Max user memories kept in in-memory index

## Behavior
- Group messages:
  - bot ignores all groups not in `AUTH_GROUP_IDS`
  - bot responds only when:
    - `@OWNER_USERNAME` is tagged, or
    - user replies to a previous bot message
  - if triggered:
    - checks if user requested owner contact (e.g. "tell your boss to message me")
    - if contact request:
      - replies in group: `Your message has been forwarded.`
      - sends owner notification in DM with user/group/message details
    - else:
      - generates owner-style reply with Groq
      - stores only meaningful memory signals (name, facts, summaries, past questions)
      - uses shared owner text knowledge (`/text`) and manual user about-data (`/data`) when relevant
      - **Group Context**: The bot remembers the last 15-20 messages in the group, allowing it to follow conversations even if only the final message mentions the owner.
      - can enrich answers with realtime context:
        - Open-Meteo (weather)
        - NewsAPI (latest news)
        - Wikipedia summary (person info)
        - Tavily fallback (when Wikipedia is missing/insufficient)
  - if Groq key 1 is rate-limited/quota-exhausted, bot automatically retries with next key from `GROQ_API_KEYS`
  - if all Groq keys are exhausted, bot sends:
    - `Hi <name>, thanks for tagging me. Wait for sometime, I have hit my limit.`
  - tone behavior:
    - around 50% replies use a mildly sarcastic tone
    - other replies stay straightforward

- Private chat:
  - owner can use commands
  - non-owner gets:
    - welcome note
    - "group-only" + "private chat not supported" guidance

## Owner Commands (DM only)
- `/stats`: View bot usage statistics.
- `/ignore <user_id|@username>` (alias: `/ingore`): Block a user from interacting with the bot in groups. Can also be used by replying to a user's message.
- `/clear_user <user_id>`: Reset memory and history for a specific user.
- `/reply <user_id> <message>`: Send a direct message to a user via the bot.

## Group Admin Commands (Owner or Group Admins)
- `/rules <welcome text> {Button Name https://url}`: Sets the welcome message and optional inline buttons.
  - Use `{name}` for the user's first name and `{username}` for their @username.
  - Example: `/rules Welcome {name}! {Support https://t.me/support}`
- `/check_bot`: Verify bot permissions and authorization in the current group.
- `/id`: Show the current Chat ID.
- `/mute`: (Reply only) Mutes the replied-to user (removes all sending permissions).
- `/unmute`: (Reply only) Unmutes the replied-to user.
- `/ban`: (Reply only) Bans the replied-to user from the current group.
- `/unban`: (Reply only) Unbans the replied-to user in the current group.
- `/fban`: (Reply only) Bans the user from **all** authorized groups (Federal Ban).
- `/funban`: (Reply only) Unbans the user from **all** authorized groups (Federal Unban).

## Notes
- For `/reply <user_id> ...`, the recipient must have already started the bot in DM.
- Make sure the bot is added to groups and allowed to read group messages.
- For moderation commands like `/ban` or `/mute`, the bot must be an administrator in the group.
- Example feed:
  - `/feed - Hello Makima, I am XYZ, I am interested in DevOps, I am busy tonight; if someone asks, say boss is busy and will message later.`

## CI/CD (Docker + VPS)
- Workflow file: `.github/workflows/deploy.yml`
- Deployment is Docker-based (`Dockerfile` + `docker-compose.prod.yml`)
- VPS user is hardcoded as `root` in workflow

### Required GitHub Secrets
- `VPS_HOST`: VPS public IP or domain
- `VPS_PASSWORD`: SSH password for root user
- `PROD_ENV`: Full app env file contents (all runtime envs), for example:
  - `TELEGRAM_BOT_TOKEN=...`
  - `OWNER_USERNAME=...`
  - `OWNER_NAME=...`
  - `ASSISTANT_NAME=Makima`
  - `OWNER_USER_ID=...`
  - `OWNER_CHAT_ID=...`
  - `AUTH_GROUP_IDS=...`
  - `MONGODB_URI=...`
  - `GROQ_API_KEYS=key1,key2,key3`
  - `GROQ_MODEL=...`
  - `CACHE_MAX_USERS=5000`

### Deploy Flow
- On push to `main` (or manual trigger), workflow:
  - runs `npm ci` + `npm run check`
  - copies app files to VPS path `/opt/tg-reply-bot`
  - writes `prod_env` on VPS from `PROD_ENV` secret
  - runs `docker compose -f docker-compose.prod.yml up -d --build --remove-orphans`

## Groq Key Testing
- Preferred env format:
  - `GROQ_API_KEYS=key1,key2,key3`
- Supported fallback format:
  - `GROQ_API_KEY=key1,key2,key3` (comma-separated list is also parsed)
- Test keys from env:
  - `npm run test:groq-keys`
- Test keys directly:
  - `npm run test:groq-keys -- "key1,key2,key3"`
