# Hirosaki Musique

Bot Discord musical avec recherche de titres, lecture vocale et file d'attente par serveur.

## Commandes

- /play recherche : titre, artiste ou lien YouTube, Spotify ou Apple Music
- /pause, /resume, /skip, /stop
- /queue, /nowplaying

Les liens Spotify et Apple Music sont résolus vers une source de lecture compatible avec Discord. Le bot ne télécharge pas les flux protégés de ces plateformes.

## Installation sur une VM Linux

1. Installer Node.js 20+ et FFmpeg : sudo apt update && sudo apt install -y ffmpeg
2. Cloner le dépôt puis installer les dépendances : npm install
3. Créer les variables : cp .env.example .env
4. Renseigner DISCORD_BOT_TOKEN et DISCORD_CLIENT_ID dans l'environnement, jamais dans GitHub.
5. Construire puis lancer : npm run build && npm start

Pour fonctionner en continu avec PM2 : npm install -g pm2 && pm2 start dist/main.js --name hirosaki-musique && pm2 save.

## Inviter le bot

Dans Discord Developer Portal puis OAuth2 puis URL Generator, sélectionner les scopes bot et applications.commands, avec les permissions View Channel, Send Messages, Connect et Speak.

## Commandes slash instantanées

Sans DISCORD_GUILD_ID, les commandes sont enregistrées globalement et peuvent prendre du temps à apparaître. Pour un serveur de test, définir DISCORD_GUILD_ID avec l'identifiant du serveur avant de lancer le bot.
