# Foundry-Discord Bridge

Pont en temps réel entre le chat [Foundry VTT](https://foundryvtt.com/) et un salon Discord.

**Aucun serveur requis.** Le module se connecte directement au gateway Discord depuis le navigateur.

---

## Fonctionnement

```
┌──────────────────────┐                              ┌─────────────┐
│   Foundry VTT        │                              │   Discord   │
│   (navigateur)       │                              │             │
│                      │   WebSocket (gateway)        │             │
│   ┌──────────────┐   │◄────────────────────────────►│   Gateway   │
│   │    Module     │   │   Discord → Foundry          │             │
│   └──────────────┘   │                              │             │
│                      │   HTTP POST (webhook)        │             │
│   ┌──────────────┐   │─────────────────────────────►│   #foundry  │
│   │    Module     │   │   Foundry → Discord          │             │
│   └──────────────┘   │                              │             │
└──────────────────────┘                              └─────────────┘
```

**Discord → Foundry :** le module ouvre un WebSocket vers le gateway Discord et écoute les événements `MESSAGE_CREATE` en temps réel. C'est exactement ce que fait un bot Discord, mais depuis le navigateur.

**Foundry → Discord :** le module envoie un POST vers un webhook Discord. Pas besoin de bot pour l'envoi.

---

## Installation

### 1. Créer un bot Discord

1. Aller sur le [Discord Developer Portal](https://discord.com/developers/applications)
2. Créer une application → **New Application**
3. Onglet **Bot** → copier le **Token**
4. Dans **Privileged Gateway Intents**, activer :
   - ✅ **Server Members Intent**
   - ✅ **Message Content Intent**
5. Onglet **OAuth2** → **URL Generator** :
   - Scopes : `bot`
   - Permissions : `Read Messages/View Channel`, `Read Message History`
6. Copier le lien généré et l'ouvrir pour inviter le bot sur votre serveur

### 2. Créer un webhook Discord

1. Paramètres du salon → **Intégrations** → **Webhooks**
2. Créer un webhook → copier l'URL

### 3. Installer le module Foundry

1. **Settings** → **Manage Modules** → **Install Module**
2. Dans **Manifest URL**, coller :

```
https://raw.githubusercontent.com/Gabryel666/foundry-discord-bridge/main/module/module.json
```

3. Activer le module
4. **Settings** → **Module Settings** → **Foundry-Discord Bridge** :
   - **Token du bot Discord** : le token copié à l'étape 1
   - **ID du serveur Discord** : clic droit sur le serveur → Copier l'identifiant
   - **ID du salon Discord** : clic droit sur le salon → Copier l'identifiant
   - **URL du webhook Discord** : l'URL copiée à l'étape 2

> Pour trouver les IDs : activer le **Mode Développeur** dans Discord (Paramètres → Avancé)

---

## Configuration

| Réglage | Description | Obligatoire |
|---------|-------------|-------------|
| Token du bot Discord | Token pour se connecter au gateway | ✅ |
| ID du serveur Discord | Serveur à écouter | ✅ |
| ID du salon Discord | Salon à écouter | ✅ |
| URL du webhook Discord | Webhook pour l'envoi Foundry → Discord | ✅ |
| Activer le bridge | Active/désactive la connexion | Non |

---

## Sécurité

- Le token du bot est stocké dans les réglages Foundry, visibles uniquement par le MJ
- Aucun secret n'est dans le code source du module
- Le module ne transmet que le texte des messages (pas de données sensibles)
- Seul le MJ actif se connecte au gateway (pas de doublons)

---

## Doublons

Le module gère automatiquement les cas de doublons :

- **Un seul MJ actif** se connecte au gateway (`game.users.activeGM.isSelf`)
- Si un autre MJ se connecte ou se déconnecte, le rôle de "gateway owner" est transféré automatiquement
- Les messages envoyés via le webhook ne sont pas ré-affichés dans Foundry (flag `source: 'discord'`)
- Les messages Discord envoyés par des bots sont ignorés

---

## Comportement

- La connexion au gateway se fait **uniquement quand un MJ est connecté** à Foundry
- Un bouton dans la barre d'outils (icône Discord) permet de couper/reprendre la connexion
- En cas de déconnexion, le module se reconnecte automatiquement (resume)
- Les messages sont affichés dans le chat Foundry avec le nom et l'avatar de l'auteur Discord

---

## Mise à jour

Le module se met à jour automatiquement via le manifest si une nouvelle version est publiée.

Pour une mise à jour manuelle : **Settings** → **Manage Modules** → chercher la mise à jour.

---

## Dépannage

| Problème | Solution |
|----------|----------|
| "Configuration incomplète" | Vérifier que les 4 champs sont remplis |
| Pas de messages Discord | Vérifier que le bot est invité sur le serveur et a les bonnes permissions |
| Pas de messages dans Discord | Vérifier l'URL du webhook |
| Déconnexions fréquentes | Vérifier que les **Privileged Gateway Intents** sont activés |
| Messages en double | Vérifier qu'un seul MJ est connecté (le module gère ça normalement) |

---

## Inspiré de

- [discord-to-fvtt](https://github.com/eryon/discord-to-fvtt) — connexion gateway client-side
- [foundrytodiscord](https://github.com/therealguy90/foundrytodiscord) — envoi via webhook

---

## Licence

MIT
