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
                                      Discord Bot                 Discord Webhook
                                      (écoute)                    (envoi)
                                            │                           │
                                            └──────────┬────────────────┘
                                                       │
                                                ┌──────┴──────┐
                                                │   Discord   │
                                                │   #foundry  │
                                                └─────────────┘
```

**Foundry → Discord :** le module envoie au relay, le relay poste via webhook.
**Discord → Foundry :** le bot écoute le salon, le relay transmet au module via WebSocket.

Aucun polling. Tout est événementiel.

---

## Prérequis

- Un serveur VPS (ou machine locale) avec Node.js ≥ 18
- Un bot Discord (un seul canal, permissions minimales)
- Foundry VTT (hébergé sur The Forge, self-hosted, ou local)
- Un webhook Discord sur le salon cible

---

## Installation

### 1. Créer le webhook Discord

1. Ouvrir les **paramètres du salon** → **Intégrations** → **Webhooks**
2. Cliquer sur **Nouveau webhook**
3. Copier l'URL du webhook
4. (Optionnel) Renommer le webhook en `Foundry Bridge`

### 2. Configurer le bot Discord

Le bot a besoin de deux permissions sur le salon :

- **Lire les messages** (`View Channel`)
- **Lire l'historique des messages** (`Read Message History`)

Pas besoin d'envoyer des messages — l'envoi se fait par le webhook.

Récupérer le **token du bot** et l'**ID du salon** (clic droit → Copier l'identifiant).

### 3. Déployer le relay

```bash
# Cloner le repo
git clone https://github.com/Gabryel666/foundry-discord-bridge.git
cd foundry-discord-bridge/relay

# Installer les dépendances
npm install

# Créer le fichier de configuration
cp ../.env.example ../.env
```

Éditer le fichier `.env` à la racine du projet :

```env
DISCORD_TOKEN=votre_token_bot
DISCORD_CHANNEL_ID=123456789012345678
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/xxxxx/yyyyy
RELAY_PORT=3120
RELAY_PATH=/foundry-bridge
```

> ⚠️ Le fichier `.env` contient des secrets. Il est dans `.gitignore` et ne sera jamais commité.

Lancer le relay :

```bash
npm start
```

Pour un déploiement permanent, utiliser le service systemd fourni :

```bash
sudo cp ../foundry-discord-relay.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now foundry-discord-relay
```

### 4. Installer le module Foundry

Dans Foundry VTT :

1. **Settings** → **Manage Modules** → **Install Module**
2. Dans le champ **Manifest URL**, coller :

```
https://raw.githubusercontent.com/Gabryel666/foundry-discord-bridge/main/module/module.json
```

3. Activer le module dans **Manage Modules**
4. Aller dans **Settings** → **Module Settings** → **Foundry-Discord Bridge**
5. Renseigner l'URL du relay :

```
wss://votre-serveur:3120/foundry-bridge
```

> Utiliser `wss://` si le relay est derrière un reverse proxy HTTPS, `ws://` sinon.

---

## Configuration

### Variables d'environnement (relay)

| Variable | Description | Exemple |
|----------|-------------|---------|
| `DISCORD_TOKEN` | Token du bot Discord | *(secret)* |
| `DISCORD_CHANNEL_ID` | ID du salon écouté | *(votre ID)* |
| `DISCORD_WEBHOOK_URL` | URL du webhook pour l'envoi | *(votre webhook)* |
| `RELAY_PORT` | Port du serveur WebSocket | `3120` |
| `RELAY_PATH` | Chemin du WebSocket | `/foundry-bridge` |

### Réglages Foundry (module)

| Réglage | Description | Portée |
|---------|-------------|--------|
| URL du relay | Adresse WebSocket du serveur | Monde |
| Activer le bridge | Active/désactive la connexion | Monde |
| Afficher les messages Discord | Affiche les messages entrants dans Foundry | Client |

---

## Sécurité

- Les secrets (token, webhook) ne quittent jamais le serveur relay
- Le fichier `.env` est exclu du versionnement
- Le module Foundry ne contient aucun secret — il se connecte uniquement au relay
- Les messages sont transmis en texte brut, pas d'injection HTML
- Le bot n'a accès qu'à un seul salon

---

## Mise à jour

```bash
cd foundry-discord-bridge
git pull
cd relay && npm install
sudo systemctl restart foundry-discord-relay
```

Le module Foundry se met à jour automatiquement via le manifest si une nouvelle version est publiée.

---

## Dépannage

| Problème | Solution |
|----------|----------|
| Le relay ne démarre pas | Vérifier que `.env` existe et contient les 3 variables requises |
| Pas de messages Discord dans Foundry | Vérifier l'ID du salon et les permissions du bot |
| Pas de messages Foundry dans Discord | Vérifier l'URL du webhook dans `.env` |
| Le module ne se connecte pas | Vérifier l'URL du relay dans les réglages Foundry (ws:// ou wss://) |
| Connexion qui coupe et reconnecte | Normal — le module se reconnecte automatiquement avec backoff |

---

## Architecture technique

Le relay est un processus Node.js unique avec trois rôles :

1. **Client Discord** — connexion WebSocket au gateway Discord (écoute d'événements)
2. **Serveur WebSocket** — accepte les connexions du module Foundry
3. **Client webhook** — POST vers Discord pour l'envoi de messages

Le module Foundry est du JavaScript côté client qui tourne dans le navigateur :

- Hook `createChatMessage` pour capturer les messages du chat Foundry
- WebSocket vers le relay pour envoyer/recevoir
- Affichage des messages Discord entrants dans le chat Foundry

Le MJ est le seul à se connecter au relay (évite les doublons avec plusieurs joueurs).

---

## Licence

MIT
