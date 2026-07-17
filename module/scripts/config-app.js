const MODULE_ID = 'foundry-discord-bridge';

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

        // Charger les salons depuis le cache du gateway (via window.__fdbBridge)
        html.find('#fdb-load-channels').click((ev) => {
            ev.preventDefault();
            const guildId = html.find('[name="discordGuildId"]').val();
            const select = html.find('#fdb-channel-select');
            const statusEl = document.getElementById('fdb-channel-status');

            if (!guildId) {
                statusEl.textContent = '⚠️ Remplis d\'abord l\'ID du serveur.';
                statusEl.className = 'fdb-channel-status fdb-test-fail';
                return;
            }

            const bridge = window.__fdbBridge;
            if (!bridge || !bridge.guildChannels) {
                statusEl.textContent = '⏳ Connexion au gateway Discord en cours… réessaie dans quelques secondes.';
                statusEl.className = 'fdb-channel-status fdb-test-fail';
                return;
            }

            const channels = bridge.guildChannels[guildId];
            if (!channels || !channels.length) {
                statusEl.textContent = '❌ Serveur introuvable dans le cache. Vérifie l\'ID du serveur.';
                statusEl.className = 'fdb-channel-status fdb-test-fail';
                return;
            }

            // Filtrer salons textuels (type 0)
            const textChannels = channels.filter(c => c.type === 0);

            select.empty();
            const defaultOpt = document.createElement('option');
            defaultOpt.value = '';
            defaultOpt.textContent = '— Choisir un salon —';
            select.append(defaultOpt);

            textChannels.forEach(ch => {
                const opt = document.createElement('option');
                opt.value = ch.id;
                opt.textContent = '# ' + ch.name;
                select.append(opt);
            });

            // Pré-sélectionner celui déjà configuré
            const currentId = html.find('[name="discordChannelId"]').val();
            if (currentId) {
                select.val(currentId);
                // Forcer le déclenchement de change pour que le hidden soit à jour
                select.trigger('change');
            }

            statusEl.textContent = `✅ ${textChannels.length} salons textuels trouvés. Sélectionne un salon.`;
            statusEl.className = 'fdb-channel-status fdb-test-ok';
        });

        // Quand on choisit un salon, mettre à jour le champ caché
        html.find('#fdb-channel-select').change((ev) => {
            const val = ev.currentTarget.value;
            html.find('[name="discordChannelId"]').val(val);
        });

        // Test de connexion complet (gateway, serveur, salon, messages, webhook)
        html.find('#fdb-test-connection').click(async (ev) => {
            ev.preventDefault();
            const btn = ev.currentTarget;
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Test...';

            const guildId = html.find('[name="discordGuildId"]').val();
            const channelId = html.find('[name="discordChannelId"]').val();
            const webhookUrl = html.find('[name="discordWebhookUrl"]').val();
            const statusEl = document.getElementById('fdb-test-result');
            const bridge = window.__fdbBridge;

            const results = [];
            let allOk = true;

            // 1. Gateway / Token
            if (bridge && bridge.connected) {
                results.push(`✅ Gateway: connecté (${bridge.botName})`);
            } else {
                results.push('❌ Gateway: non connecté — vérifie le token et recharge Foundry');
                allOk = false;
            }

            // 2. Serveur
            if (guildId && bridge?.guildChannels?.[guildId]) {
                results.push(`✅ Serveur: ${bridge.guildName || guildId} (${bridge.guildChannels[guildId].length} salons)`);
            } else if (!guildId) {
                results.push('❌ Serveur: ID non défini');
                allOk = false;
            } else {
                results.push('❌ Serveur: introuvable dans le cache — vérifie l\'ID');
                allOk = false;
            }

            // 3. Salon
            if (guildId && channelId && bridge?.guildChannels?.[guildId]) {
                const ch = bridge.guildChannels[guildId].find(c => c.id === channelId);
                if (ch) {
                    if (ch.type === 0) {
                        results.push(`✅ Salon: #${ch.name} (textuel)`);
                    } else {
                        const typeNames = { 0: 'textuel', 2: 'vocal', 4: 'catégorie', 5: 'annonce', 11: 'thread' };
                        results.push(`⚠️ Salon: #${ch.name} (${typeNames[ch.type] || 'type ' + ch.type} — privilégie un salon textuel)`);
                    }
                } else if (bridge.guildChannels[guildId].some(c => c.name === channelId)) {
                    results.push('❌ Salon: l\'ID ne correspond pas. As-tu mis un nom au lieu d\'un ID ?');
                    allOk = false;
                } else {
                    results.push('❌ Salon: introuvable dans ce serveur');
                    allOk = false;
                }
            } else if (!channelId) {
                results.push('❌ Salon: non défini');
                allOk = false;
            }

            // 4. Message ascendant (Discord → Foundry)
            const msgCount = bridge?.messageCount || 0;
            if (msgCount > 0) {
                results.push(`✅ Messages reçus: ${msgCount} depuis la connexion`);
            } else {
                results.push('⚠️ Messages reçus: aucun pour l\'instant (normal si personne n\'a parlé)');
            }

            // 5. Webhook (message descendant Foundry → Discord)
            if (webhookUrl) {
                try {
                    const resp = await fetch(webhookUrl, { method: 'GET' });
                    if (resp.ok) {
                        const data = await resp.json();
                        results.push(`✅ Webhook: actif (#${data.name || 'inconnu'})`);
                    } else if (resp.status === 404) {
                        results.push('❌ Webhook: introuvable (supprimé ?) — crées-en un dans les paramètres du salon');
                        allOk = false;
                    } else {
                        results.push(`❌ Webhook: erreur ${resp.status}`);
                        allOk = false;
                    }
                } catch (e) {
                    results.push('❌ Webhook: injoignable — vérifie l\'URL');
                    allOk = false;
                }
            } else {
                results.push('❌ Webhook: URL non définie — les messages Foundry → Discord ne passeront pas');
                allOk = false;
            }

            statusEl.innerHTML = results.join('<br>');
            statusEl.className = `fdb-test-result ${allOk ? 'fdb-test-ok' : 'fdb-test-fail'}`;
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-plug"></i> ' + game.i18n.localize('FDB.Config.TestConnection');
        });
    }

    async _updateObject(event, formData) {
        const data = foundry.utils.expandObject(formData);
        if (!('debug' in data)) data.debug = false;

        for (const [key, value] of Object.entries(data)) {
            await game.settings.set(MODULE_ID, key, value);
        }
        ui.notifications.info('Foundry-Discord Bridge | Configuration sauvegardée');
    }
}
