# Foundry-Discord Bridge

Un pont en temps réel entre le chat **Foundry VTT** et un salon **Discord**.

Les joueurs dans Foundry voient les messages Discord, et inversement — parfait quand certains joueurs sont sur Foundry et d'autres suivent sur Discord.

## Architecture

```
┌─────────────┐    WebSocket     ┌──────────────┐    Discord API    ┌─────────────┐
│  Module      │◄──────────────►│  Bridge       │◄────────────────►│  Bot Discord │
│  Foundry     │  (navigateur)  │  (VPS)        │                  │  (Jasra)     │
│  (The Forge) │                │  Node.js      │                  │              │
└─────────────┘                └──────────────┘                  └─────────────┘
```

## Installation

### 1. Le Bridge (sur le VPS)

```bash
cd bridge/
cp config.example.json config.json
# Édite config.json avec :
#   - Le token du bot Discord (le même que Jasra)
#   - L'ID du salon Discord dédié
#   - Le port WebSocket (défaut: 3120)

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

### 2. Le Module Foundry

Dans Foundry VTT :

1. **Settings** → **Manage Modules** → **Install Module**
2. Dans le champ "Manifest URL", colle l'URL du manifest :
   ```
   https://raw.githubusercontent.com/Gabryel666/foundry-discord-bridge/main/module/module.json
   ```
3. Active le module dans **Manage Modules**
4. Va dans **Settings** → **Module Settings** → **Foundry-Discord Bridge**
5. Configure l'URL du WebSocket bridge (ex: `ws://ton-vps:3120/foundry-bridge`)

### 3. Configuration

| Paramètre | Description | Défaut |
|-----------|-------------|--------|
| `bridgeUrl` | URL WebSocket du bridge | `ws://localhost:3120/foundry-bridge` |
| `bridgeEnabled` | Active/désactive la connexion | `true` |
| `showDiscordMessages` | Affiche les messages Discord dans Foundry | `true` |
| `sendToDiscord` | Envoie les messages Foundry vers Discord | `true` |

## Comportement

- **Seul le MJ** se connecte au bridge (évite les doublons)
- Les messages Discord apparaissent dans Foundry avec le tag `(Discord)` et la couleur blurple
- Reconnexion automatique en cas de coupure (backoff exponentiel)
- Les échos de messages sont filtrés pour éviter les boucles
- Compatible avec **n'importe quel système** Foundry (utilise l'API `ChatMessage` core)

## Sécurité

- Le token Discord ne quitte jamais le serveur bridge
- Les messages sont passés en plain text (pas d'injection HTML)
- Le WebSocket n'accepte que les messages au format attendu

## License

MIT
