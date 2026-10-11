# API Hub (flat files, no folders)

server.js (backend) · db.js (database) · bot.js (Telegram) · endpoints.js (YOUR API scripts)
index/dashboard/sandbox/admin .html · style.css · common.js

## Run on VPS
npm install
cp .env.example .env && nano .env     # MONGO_URI, JWT_SECRET, ADMIN_EMAILS, BOT_TOKEN, ADMIN_TELEGRAM_IDS
npm i -g pm2 && pm2 start server.js --name apihub && pm2 save && pm2 startup

## Add API: edit endpoints.js, then `pm2 restart apihub`
## Admin panel: /admin.html (register an account with an email listed in ADMIN_EMAILS)
## Bot: @BotFather token -> BOT_TOKEN. Commands: /link /balance /mystats /addcoins /user /ban /unban /apistats /broadcast
## HTTPS: nginx proxy_pass http://127.0.0.1:3000 + certbot.
