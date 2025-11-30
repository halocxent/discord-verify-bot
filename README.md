# discord verify bot

feature:

anti alt, anti vpn/proxy

make sure u fill `.env` correct or bot not work


## clone repo
```git clone https://github.com/halocxent/discord-verify-bot.git && cd discord-verify-bot```

## install
```npm install```

## .env setup
open `.env.example`, fill everything, then rename to `.env`, make sure all of these exist and you give correct stuff:


DISCORD_TOKEN=""

PROXYCHECK_KEY="your proxycheck.io key"

VERIFIED_ROLE_ID=roleid

EMBED_CHANNEL_ID=channelid

LOGS_CHANNEL_ID=channelid

DOMAIN=https://example.com

PORT=3000

HCAPTCHA_SITE_KEY="sitekey"

HCAPTCHA_SECRET_KEY="secretkey"

## run bot

### method 1
```node index.js```

### method 2 (pm2)
```npm install -g pm2```

```pm2 start index.js```
