import { BridgeConfig } from './config-app.js';

const MODULE_ID = 'foundry-discord-bridge';

export function registerSettings() {
    // Toggle
    game.settings.register(MODULE_ID, 'enabled', {
        name: game.i18n.localize('FDB.Settings.Enabled.Name'),
        hint: game.i18n.localize('FDB.Settings.Enabled.Hint'),
        scope: 'world',
        config: true,
        type: Boolean,
        default: true
    });

    // Chat mode
    game.settings.register(MODULE_ID, 'chatMode', {
        name: game.i18n.localize('FDB.Settings.ChatMode.Name'),
        hint: game.i18n.localize('FDB.Settings.ChatMode.Hint'),
        scope: 'world',
        config: true,
        type: String,
        default: 'invisible',
        choices: {
            'invisible': game.i18n.localize('FDB.Settings.ChatMode.Invisible'),
            'notification': game.i18n.localize('FDB.Settings.ChatMode.Notification'),
            'public': game.i18n.localize('FDB.Settings.ChatMode.Public')
        }
    });

    // Custom config menu
    game.settings.registerMenu(MODULE_ID, 'config', {
        name: game.i18n.localize('FDB.ConfigMenu.Name'),
        label: game.i18n.localize('FDB.ConfigMenu.Label'),
        hint: game.i18n.localize('FDB.ConfigMenu.Hint'),
        icon: 'fas fa-plug',
        type: BridgeConfig,
        restricted: true
    });

    // Hidden settings (managed by BridgeConfig form)
    game.settings.register(MODULE_ID, 'discordToken', {
        scope: 'world', config: false, type: String, default: ''
    });

    game.settings.register(MODULE_ID, 'discordGuildId', {
        scope: 'world', config: false, type: String, default: ''
    });

    game.settings.register(MODULE_ID, 'discordChannelId', {
        scope: 'world', config: false, type: String, default: ''
    });

    game.settings.register(MODULE_ID, 'discordWebhookUrl', {
        scope: 'world', config: false, type: String, default: ''
    });
}
