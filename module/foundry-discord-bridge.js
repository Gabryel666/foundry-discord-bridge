/**
 * Foundry-Discord Bridge v3 — Settings Test
 * 
 * Minimal version: ONLY registers settings. No Discord gateway.
 * Purpose: verify that settings render as actual input fields.
 */

const MODULE_ID = 'foundry-discord-bridge';
const log = (...args) => console.log(`[${MODULE_ID}]`, ...args);

// ── Settings Registration ──────────────────────────────────────────────

Hooks.once('init', () => {
  log('init hook fired');

  game.settings.register(MODULE_ID, 'enabled', {
    name: 'Activer le bridge',
    scope: 'world',
    config: true,
    type: Boolean,
    default: true,
  });

  game.settings.register(MODULE_ID, 'discordToken', {
    name: 'Token du bot Discord',
    hint: 'Token du bot Discord pour écouter les messages (visible uniquement par le MJ)',
    scope: 'world',
    config: true,
    type: String,
    default: '',
  });

  game.settings.register(MODULE_ID, 'discordGuildId', {
    name: 'ID du serveur Discord',
    hint: 'Identifiant du serveur Discord (clic droit → Copier l\'identifiant)',
    scope: 'world',
    config: true,
    type: String,
    default: '',
  });

  game.settings.register(MODULE_ID, 'discordChannelId', {
    name: 'ID du salon Discord',
    hint: 'Identifiant du salon à écouter (clic droit → Copier l\'identifiant)',
    scope: 'world',
    config: true,
    type: String,
    default: '',
  });

  game.settings.register(MODULE_ID, 'discordWebhookUrl', {
    name: 'URL du webhook Discord',
    hint: 'Webhook du salon pour envoyer les messages Foundry → Discord',
    scope: 'world',
    config: true,
    type: String,
    default: '',
  });

  log('all 5 settings registered via game.settings.register()');
});

// ── Ready ──────────────────────────────────────────────────────────────

Hooks.once('ready', () => {
  log('ready hook fired');
  log('enabled =', game.settings.get(MODULE_ID, 'enabled'));
  log('token set =', !!game.settings.get(MODULE_ID, 'discordToken'));
  ui.notifications.info('Foundry-Discord Bridge | Module chargé (mode test)');
});
