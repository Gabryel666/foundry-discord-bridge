const MODULE_ID = 'foundry-discord-bridge';
const log = (...args) => console.log(`[${MODULE_ID}]`, ...args);

export class BridgeConfig extends FormApplication {
    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            id: 'fdb-config',
            title: game.i18n.localize('FDB.ConfigMenu.Name'),
            template: `modules/${MODULE_ID}/templates/config.html`,
            width: 520,
            closeOnSubmit: true,
            classes: ['fdb-config-window']
        });
    }

    getData() {
        return {
            discordToken: game.settings.get(MODULE_ID, 'discordToken'),
            discordGuildId: game.settings.get(MODULE_ID, 'discordGuildId'),
            discordChannelId: game.settings.get(MODULE_ID, 'discordChannelId'),
            discordWebhookUrl: game.settings.get(MODULE_ID, 'discordWebhookUrl'),
            debug: game.settings.get(MODULE_ID, 'debug'),
        };
    }

    activateListeners(html) {
        super.activateListeners(html);

        // Test de connexion
        html.find('#fdb-test-connection').click(async (ev) => {
            ev.preventDefault();
            const btn = ev.currentTarget;
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Test...';

            const token = html.find('[name="discordToken"]').val();
            const guildId = html.find('[name="discordGuildId"]').val();
            const channelId = html.find('[name="discordChannelId"]').val();
            const webhookUrl = html.find('[name="discordWebhookUrl"]').val();
            const statusEl = document.getElementById('fdb-test-result');

            const results = [];
            let allOk = true;

            // Test 1: Token Discord
            if (token) {
                try {
                    const resp = await fetch('https://discord.com/api/v10/users/@me', {
                        headers: { 'Authorization': `Bot ${token}` }
                    });
                    if (resp.ok) {
                        const data = await resp.json();
                        results.push(`✅ Bot: ${data.username}#${data.discriminator || ''}`);
                    } else {
                        results.push(`❌ Token: ${resp.status} ${resp.statusText}`);
                        allOk = false;
                    }
                } catch (e) {
                    results.push(`❌ Token: requête échouée`);
                    allOk = false;
                }
            } else {
                results.push(`❌ Token: non défini`);
                allOk = false;
            }

            // Test 2: Guild
            if (token && guildId) {
                try {
                    const resp = await fetch(`https://discord.com/api/v10/guilds/${guildId}`, {
                        headers: { 'Authorization': `Bot ${token}` }
                    });
                    if (resp.ok) {
                        const data = await resp.json();
                        results.push(`✅ Serveur: ${data.name}`);
                    } else if (resp.status === 404) {
                        results.push(`❌ Serveur: introuvable (mauvais ID ?)`);
                        allOk = false;
                    } else {
                        results.push(`❌ Serveur: ${resp.status}`);
                        allOk = false;
                    }
                } catch (e) {
                    results.push(`❌ Serveur: requête échouée`);
                    allOk = false;
                }
            } else if (!guildId) {
                results.push(`❌ Serveur: ID non défini`);
                allOk = false;
            }

            // Test 3: Channel
            if (token && channelId) {
                try {
                    const resp = await fetch(`https://discord.com/api/v10/channels/${channelId}`, {
                        headers: { 'Authorization': `Bot ${token}` }
                    });
                    if (resp.ok) {
                        const data = await resp.json();
                        results.push(`✅ Salon: #${data.name}`);
                    } else if (resp.status === 404) {
                        results.push(`❌ Salon: introuvable`);
                        allOk = false;
                    } else {
                        results.push(`❌ Salon: ${resp.status}`);
                        allOk = false;
                    }
                } catch (e) {
                    results.push(`❌ Salon: requête échouée`);
                    allOk = false;
                }
            } else if (!channelId) {
                results.push(`❌ Salon: ID non défini`);
                allOk = false;
            }

            // Test 4: Webhook
            if (webhookUrl) {
                try {
                    const resp = await fetch(webhookUrl, { method: 'GET' });
                    if (resp.ok) {
                        const data = await resp.json();
                        results.push(`✅ Webhook: #${data.channel_id ? 'actif' : 'inactif'}`);
                    } else if (resp.status === 404) {
                        results.push(`❌ Webhook: introuvable`);
                        allOk = false;
                    } else {
                        results.push(`❌ Webhook: ${resp.status}`);
                        allOk = false;
                    }
                } catch (e) {
                    results.push(`❌ Webhook: requête échouée`);
                    allOk = false;
                }
            } else {
                results.push(`❌ Webhook: non défini`);
                allOk = false;
            }

            statusEl.innerHTML = results.join('<br>');
            statusEl.className = `fdb-test-result ${allOk ? 'fdb-test-ok' : 'fdb-test-fail'}`;
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-plug"></i> ' + game.i18n.localize('FDB.Config.TestConnection');
        });

        // Charger les salons
        html.find('#fdb-load-channels').click(async (ev) => {
            ev.preventDefault();
            const btn = ev.currentTarget;
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>...';

            const token = html.find('[name="discordToken"]').val();
            const guildId = html.find('[name="discordGuildId"]').val();
            const select = html.find('#fdb-channel-select');
            const statusEl = document.getElementById('fdb-channel-status');

            if (!token || !guildId) {
                statusEl.textContent = '⚠️ Remplis d\'abord le token et l\'ID du serveur.';
                statusEl.className = 'fdb-channel-status fdb-test-fail';
                btn.disabled = false;
                btn.innerHTML = '<i class="fas fa-sync"></i> ' + game.i18n.localize('FDB.Config.LoadChannels');
                return;
            }

            try {
                const resp = await fetch(`https://discord.com/api/v10/guilds/${guildId}/channels`, {
                    headers: { 'Authorization': `Bot ${token}` }
                });

                if (!resp.ok) {
                    statusEl.textContent = `❌ Erreur ${resp.status} — vérifie le token et l'ID du serveur.`;
                    statusEl.className = 'fdb-channel-status fdb-test-fail';
                    btn.disabled = false;
                    btn.innerHTML = '<i class="fas fa-sync"></i> ' + game.i18n.localize('FDB.Config.LoadChannels');
                    return;
                }

                const channels = await resp.json();
                // Filtrer salons textuels (type 0) + threads publics (type 11)
                const textChannels = channels.filter(c => c.type === 0);
                const threadChannels = channels.filter(c => c.type === 11);

                // Grouper : textuels d'abord, threads ensuite
                const all = [...textChannels, ...threadChannels];

                select.empty();
                const defaultOpt = document.createElement('option');
                defaultOpt.value = '';
                defaultOpt.textContent = '— Choisir un salon —';
                select.append(defaultOpt);
                all.forEach(ch => {
                    const opt = document.createElement('option');
                    opt.value = ch.id;
                    opt.textContent = (ch.type === 11 ? '🧵 ' : '#') + ' ' + ch.name;
                    select.append(opt);
                });

                // Sélectionner celui déjà configuré
                const currentId = html.find('[name="discordChannelId"]').val();
                if (currentId) select.val(currentId);

                statusEl.textContent = `✅ ${textChannels.length} salons textuels trouvés. Sélectionne un salon dans la liste.`;
                statusEl.className = 'fdb-channel-status fdb-test-ok';
                log(`Loaded ${textChannels.length} text + ${threadChannels.length} thread channels`);
            } catch (e) {
                statusEl.textContent = `❌ Erreur réseau: ${e.message}`;
                statusEl.className = 'fdb-channel-status fdb-test-fail';
            }

            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-sync"></i> ' + game.i18n.localize('FDB.Config.LoadChannels');
        });

        // Quand on choisit un salon dans la liste, mettre à jour le champ ID
        html.find('#fdb-channel-select').change((ev) => {
            const val = ev.currentTarget.value;
            if (val) {
                html.find('[name="discordChannelId"]').val(val);
            }
        });
    }

    async _updateObject(event, formData) {
        // Les checkbox décochées ne sont pas incluses dans formData —
        // forcer false si 'debug' est absent
        const data = foundry.utils.expandObject(formData);
        if (!('debug' in data)) data.debug = false;

        for (const [key, value] of Object.entries(data)) {
            await game.settings.set(MODULE_ID, key, value);
        }
        ui.notifications.info('Foundry-Discord Bridge | Configuration sauvegardée');
    }
}
