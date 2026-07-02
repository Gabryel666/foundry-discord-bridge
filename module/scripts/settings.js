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

    // Custom config menu — opens a dedicated form with proper input fields
    game.settings.registerMenu(MODULE_ID, 'config', {
        name: game.i18n.localize('FDB.ConfigMenu.Name'),
        label: game.i18n.localize('FDB.ConfigMenu.Label'),
        hint: game.i18n.localize('FDB.ConfigMenu.Hint'),
        icon: 'fas fa-plug',
        type: BridgeConfig,
        restricted: true
    });

    // Hidden settings (not shown in SettingsConfig, managed by BridgeConfig form)
    game.settings.register(MODULE_ID, 'discordToken', {
        scope: 'world',
        config: false,
        type: String,
        default: ''
    });

    game.settings.register(MODULE_ID, 'discordGuildId', {
        scope: 'world',
        config: false,
        type: String,
        default: ''
    });

    game.settings.register(MODULE_ID, 'discordChannelId', {
        scope: 'world',
        config: false,
        type: String,
        default: ''
    });

    game.settings.register(MODULE_ID, 'discordWebhookUrl', {
        scope: 'world',
        config: false,
        type: String,
        default: ''
    });
}
