# Foundry-Discord Bridge

Un pont en temps réel entre le chat **Foundry VTT** et un salon **Discord**.

## Architecture (v2)

```
┌─────────────┐  Webhook POST    ┌─────────────┐
│  Module      │────────────────►│  Discord     │
│  Foundry     │  (direct)       │  Webhook     │
│  (The Forge) │                 └─────────────┘
│              │
│              │  WebSocket       ┌──────────────┐  HTTP Polling   ┌─────────────┐
│              │◄────────────────│  Bridge       │◄───────────────│  Discord API │
└─────────────┘  (navigateur)    │  (VPS)        │  (GET /messages)│  (Bot token) │
                                 └──────────────┘                 └─────────────┘
```

**Foundry → Discord** : le module envoie directement via un webhook Discord (pas besoin de passer par le bridge).  
**Discord → Foundry** : le bridge poll l'API Discord toutes les 2 secondes et forward via WebSocket.

## Installation

### 1. Créer le webhook Discord

1. Va dans les paramètres du salon `#foundry` → **Intégrations** → **Webhooks**
2. Crée un webhook, copie l'URL
3. Tu en auras besoin pour la config Foundry

### 2. Le Bridge (sur le VPS)

```bash
cd bridge/
cp config.example.json config.json
```

Édite `config.json` :
- `discord.token` — le token du bot Jasra (pour lire les messages)
- `discord.channelId` — l'ID du salon `#foundry`
- `websocket.port` — port WebSocket (défaut: 3120)

```bash
npm install
npm start
```

Pour un déploiement durable, crée un service systemd :

```ini
[Unit]
Description=Foundry-Discord Bridge
After=network.target

[Service]
Type=simple
User=debian
WorkingDirectory=/home/debian/foundry-discord-bridge/bridge
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

### 3. Le Module Foundry

1. **Settings** → **Manage Modules** → **Install Module**
2. Manifest URL :
   ```
   https://raw.githubusercontent.com/Gabryel666/foundry-discord-bridge/main/module/module.json
   ```
3. Active le module, puis configure dans **Module Settings** :
   - **Bridge WebSocket URL** : `ws://ton-vps:3120/foundry-bridge`
   - **Discord Webhook URL** : l'URL du webhook créé à l'étape 1

## Configuration

| Paramètre | Description | Portée |
|-----------|-------------|--------|
| `bridgeUrl` | URL WebSocket du bridge | World |
| `discordWebhookUrl` | Webhook Discord pour l'envoi | World |
| `bridgeEnabled` | Active le bridge | World |
| `showDiscordMessages` | Affiche les messages Discord dans Foundry | Client |
| `sendToDiscord` | Envoie les messages Foundry vers Discord | World |

## Comportement

- **Seul le MJ** se connecte au WebSocket (évite les doublons)
- L'envoi Foundry→Discord se fait par **tous les clients** (webhook direct)
- Reconnexion automatique avec backoff exponentiel
- Les échos Discord→Foundry→Discord sont filtrés
- Compatible **n'importe quel système** Foundry (API `ChatMessage` core)
- Pas de dépendance discord.js côté bridge (HTTP pur + WebSocket)

## License

MIT
