# Foundry-Discord Bridge

Pont en temps réel entre le chat [Foundry VTT](https://foundryvtt.com/) et un salon Discord.

Les joueurs sur Foundry et ceux sur Discord voient les mêmes messages. La conversation est partagée, dans les deux sens.

---

## Fonctionnement

```
┌──────────────────┐         WebSocket          ┌──────────────────┐
│   Foundry VTT    │◄───────────────────────────►│   Relay Server   │
│   (module)       │                             │   (Node.js)      │
└──────────────────┘                             └────────┬─────────┘
                                                          │
                                            ┌─────────────┴─────────────┐
                                            │                           │
                                       HTTP Polling              Discord Webhook
                                       (GET /messages)           (POST)
                                            │                           │
                                            └──────────┬────────────────┘
                                                       │
                                                ┌──────┴──────┐
                                                │   Discord   │
                                                │   #foundry  │
                                                └─────────────┘
```

**Foundry → Discord :** le module envoie au relay, le relay poste via webhook Discord.
**Discord → Foundry :** le relay lit les messages via l'API Discord HTTP, transmet au module via WebSocket.

Pas de bot Discord séparé. Pas de polling agressif. Le relay utilise des requêtes HTTP classiques qui ne conflit pas avec les bots existants.

---

## Prérequis

- Node.js ≥ 18
- Un bot Discord existant avec accès au salon cible (pour la lecture)
- Un webhook Discord sur le salon cible (pour l'envoi)
- Foundry VTT (The Forge, self-hosted, ou local)

---

## Installation

### 1. Créer le webhook Discord

1. Ouvrir les **paramètres du salon** → **Intégrations** → **Webhooks**
2. Cliquer sur **Nouveau webhook**
3. Copier l'URL du webhook

### 2. Déployer le relay

```bash
git clone https://github.com/Gabryel666/foundry-discord-bridge.git
cd foundry-discord-bridge/relay
npm install
```

Créer le fichier `config.json` dans le dossier `relay/` :

```json
{
  "channelId": "VOTRE_CHANNEL_ID",
  "webhookUrl": "https://discord.com/api/webhooks/xxxxx/yyyyy"
}
```

Créer le fichier `.env` à la racine du projet :

```env
DISCORD_TOKEN=votre_token_bot
RELAY_PORT=3120
RELAY_PATH=/foundry-bridge
```

> ⚠️ `config.json` et `.env` contiennent des secrets. Les deux sont dans `.gitignore`.

Lancer :

```bash
npm start
```

Pour un déploiement permanent :

```bash
# Via systemd (nécessite sudo)
sudo cp ../foundry-discord-relay.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now foundry-discord-relay

# Ou via pm2
pm2 start server.js --name foundry-relay

# Ou via screen/tmux
screen -S foundry-relay
npm start
```

### 3. Installer le module Foundry

Dans Foundry VTT :

1. **Settings** → **Manage Modules** → **Install Module**
2. Dans le champ **Manifest URL**, coller :

```
https://raw.githubusercontent.com/Gabryel666/foundry-discord-bridge/main/module/module.json
```

3. Activer le module dans **Manage Modules**
4. **Settings** → **Module Settings** → **Foundry-Discord Bridge**
5. Renseigner l'URL du relay : `ws://votre-serveur:3120/foundry-bridge`

> Utiliser `wss://` si le relay est derrière un reverse proxy HTTPS, `ws://` sinon.

---

## Configuration

### Fichiers de configuration

| Fichier | Contenu | Gitignored |
|---------|---------|------------|
| `.env` | Token bot, port, chemin WebSocket | ✅ |
| `relay/config.json` | Channel ID, URL webhook | ✅ |
| `.env.example` | Modèle vide pour `.env` | ❌ |
| `relay/config.example.json` | Modèle vide pour `config.json` | ❌ |

### Variables d'environnement (`.env`)

| Variable | Description | Défaut |
|----------|-------------|--------|
| `DISCORD_TOKEN` | Token du bot Discord | *(requis)* |
| `RELAY_PORT` | Port du serveur WebSocket | `3120` |
| `RELAY_PATH` | Chemin du WebSocket | `/foundry-bridge` |

### Config relay (`relay/config.json`)

| Clé | Description |
|-----|-------------|
| `channelId` | ID du salon Discord à écouter |
| `webhookUrl` | URL du webhook pour l'envoi de messages |

### Réglages Foundry (module)

| Réglage | Description | Portée |
|---------|-------------|--------|
| URL du relay | Adresse WebSocket du serveur | Monde |
| Activer le bridge | Active/désactive la connexion | Monde |
| Afficher les messages Discord | Affiche les messages entrants | Client |

---

## Sécurité

- Les secrets ne quittent jamais le serveur relay
- `config.json` et `.env` sont exclus du versionnement
- Le module Foundry ne contient aucun secret
- Les messages sont transmis en texte brut (pas d'injection HTML)
- Le relay n'a accès qu'à un seul salon Discord
- Aucun conflit avec les bots Discord existants (HTTP, pas gateway)

---

## Mise à jour

```bash
cd foundry-discord-bridge
git pull
cd relay && npm install
# Redémarrer le service
sudo systemctl restart foundry-discord-relay
# Ou pm2 restart foundry-relay
```

---

## Dépannage

| Problème | Solution |
|----------|----------|
| `Missing config.json` | Créer `relay/config.json` avec `channelId` et `webhookUrl` |
| `Missing DISCORD_TOKEN` | Vérifier le fichier `.env` à la racine |
| Pas de messages Discord dans Foundry | Vérifier l'ID du salon et les permissions du bot |
| Pas de messages Foundry dans Discord | Vérifier l'URL du webhook dans `config.json` |
| Module ne se connecte pas | Vérifier l'URL du relay (ws:// ou wss://) |
| Rate limiting Discord | Le relay gère le backoff automatiquement |

---

## Architecture technique

Le relay est un processus Node.js unique :

1. **Serveur WebSocket** — accepte les connexions du module Foundry
2. **HTTP Polling** — lit les messages Discord via REST API (toutes les 3 secondes)
3. **Webhook** — POST vers Discord pour l'envoi de messages

Le module Foundry est du JavaScript côté client :

- Hook `createChatMessage` pour capturer les messages du chat
- WebSocket vers le relay pour envoyer/recevoir
- Affichage des messages Discord dans le chat Foundry
- Seul le MJ se connecte au relay (évite les doublons)
- System-agnostic (API `ChatMessage` core)

---

## Licence

MIT
