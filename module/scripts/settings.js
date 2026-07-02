export function registerSettings() {
    game.settings.register('foundry-discord-bridge', 'enabled', {
        name: 'FDB.Settings.Enabled.Name',
        hint: 'FDB.Settings.Enabled.Hint',
        scope: 'world',
        config: true,
        type: Boolean,
        default: true
    });

    game.settings.register('foundry-discord-bridge', 'discordToken', {
        name: 'FDB.Settings.Token.Name',
        hint: 'FDB.Settings.Token.Hint',
        scope: 'world',
        config: true,
        type: String,
        default: ''
    });

    game.settings.register('foundry-discord-bridge', 'discordGuildId', {
        name: 'FDB.Settings.GuildId.Name',
        hint: 'FDB.Settings.GuildId.Hint',
        scope: 'world',
        config: true,
        type: String,
        default: ''
    });

    game.settings.register('foundry-discord-bridge', 'discordChannelId', {
        name: 'FDB.Settings.ChannelId.Name',
        hint: 'FDB.Settings.ChannelId.Hint',
        scope: 'world',
        config: true,
        type: String,
        default: ''
    });

    game.settings.register('foundry-discord-bridge', 'discordWebhookUrl', {
        name: 'FDB.Settings.WebhookUrl.Name',
        hint: 'FDB.Settings.WebhookUrl.Hint',
        scope: 'world',
        config: true,
        type: String,
        default: ''
    });
}
