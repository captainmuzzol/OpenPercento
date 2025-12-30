/**
 * OpenPercento - 设置模块
 * 语言切换、深浅色模式、偏好设置
 */

const Settings = {
    /**
     * 初始化设置模块
     */
    async init() {
        const rememberedMode = localStorage.getItem('percento_sync_mode') || '';
        if (rememberedMode !== 'webdav') {
            await this.applyDbPathFromStorage();
        } else {
            localStorage.removeItem('percento_db_path');
            if (DB.mode === 'api') {
                try {
                    await fetch('/api/config/resetDbPath', { method: 'POST', headers: { 'Accept': 'application/json' } });
                } catch (e) { }
            }
        }
        await this.loadSettings();
        await this.loadWebDAVSettings();
        this.bindEvents();
        await this.updateSyncUI();
        try {
            const mode = localStorage.getItem('percento_sync_mode') || await DB.getSetting('syncMode', 'db');
            const autoSync = await DB.getSetting('autoSync', false);
            const enabled = autoSync === true || autoSync === 1 || autoSync === '1' || autoSync === 'true';
            if (mode === 'webdav' && enabled) this.startAutoSync();
        } catch (e) { }
    },

    /**
     * 绑定事件
     */
    bindEvents() {
        // 主题切换
        document.querySelectorAll('.theme-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const theme = e.currentTarget.dataset.theme;
                await this.setTheme(theme);
            });
        });

        // 语言切换
        document.getElementById('languageSelect').addEventListener('change', async (e) => {
            await this.setLanguage(e.target.value);
        });

        // 默认币种
        document.getElementById('currencySelect').addEventListener('change', async (e) => {
            await this.setCurrency(e.target.value);
        });

        // 默认时间周期
        document.getElementById('periodSelect').addEventListener('change', async (e) => {
            await this.setPeriod(e.target.value);
        });

        document.getElementById('invertColorsToggle')?.addEventListener('change', async (e) => {
            await this.setInvertColors(!!e.target.checked);
        });

        document.getElementById('btnApplyDbPath')?.addEventListener('click', async () => {
            await this.applyDbPath();
        });

        document.getElementById('syncModeSelect')?.addEventListener('change', async (e) => {
            await this.setSyncMode(e.target.value);
        });

        document.getElementById('autoSyncToggle')?.addEventListener('change', async (e) => {
            await this.setAutoSync(!!e.target.checked);
        });

        document.getElementById('syncIntervalSelect')?.addEventListener('change', async (e) => {
            await this.setSyncInterval(parseInt(e.target.value));
        });

        document.getElementById('webdavUrl')?.addEventListener('change', async () => {
            await this.saveWebDAVSettings();
        });

        document.getElementById('webdavUser')?.addEventListener('change', async () => {
            await this.saveWebDAVSettings();
        });

        document.getElementById('webdavPass')?.addEventListener('change', async () => {
            await this.saveWebDAVSettings();
        });

        document.getElementById('btnTestWebdav')?.addEventListener('click', async () => {
            await this.testWebDAVConnection();
        });

        document.getElementById('btnSyncNow')?.addEventListener('click', async () => {
            await this.syncWebDAV();
        });

        document.getElementById('btnRestoreWebdav')?.addEventListener('click', async () => {
            await this.restoreFromWebDAV();
        });
    },

    /**
     * 加载保存的设置
     */
    async loadSettings() {
        // 加载主题
        const rawTheme = await DB.getSetting('theme', 'light');
        const theme = rawTheme === 'dark' ? 'dark' : 'light';
        this.applyTheme(theme);
        if (rawTheme !== theme) await DB.saveSetting('theme', theme);

        // 加载语言
        const rawLang = await DB.getSetting('language', 'zh');
        const lang = (rawLang === 'zh' || rawLang === 'en')
            ? rawLang
            : (rawLang === '中文' ? 'zh' : (rawLang === 'English' ? 'en' : 'zh'));
        const appliedLang = this._setSelectValue(document.getElementById('languageSelect'), lang, 'zh');
        if (rawLang !== appliedLang) await DB.saveSetting('language', appliedLang);
        i18n.setLanguage(appliedLang);

        // 加载币种
        const rawCurrency = await DB.getSetting('currency', 'CNY');
        const currency = (typeof rawCurrency === 'string' && rawCurrency) ? rawCurrency : 'CNY';
        const appliedCurrency = this._setSelectValue(document.getElementById('currencySelect'), currency, 'CNY');
        if (rawCurrency !== appliedCurrency) await DB.saveSetting('currency', appliedCurrency);

        // 加载默认周期
        const rawPeriod = await DB.getSetting('period', 'month');
        const period = (typeof rawPeriod === 'string' && rawPeriod) ? rawPeriod : 'month';
        const appliedPeriod = this._setSelectValue(document.getElementById('periodSelect'), period, 'month');
        if (rawPeriod !== appliedPeriod) await DB.saveSetting('period', appliedPeriod);

        const rawInvert = await DB.getSetting('invertColors', false);
        const invert = rawInvert === true || rawInvert === 1 || rawInvert === '1';
        this.applyInvertColors(invert);
        const invertToggle = document.getElementById('invertColorsToggle');
        if (invertToggle) invertToggle.checked = invert;
        if (rawInvert !== invert) await DB.saveSetting('invertColors', invert);

        this.initDbPathUI();
    },

    _setSelectValue(el, value, fallback) {
        if (!el) return fallback;
        const v = typeof value === 'string' ? value : '';
        const hasOption = Array.from(el.options || []).some(opt => opt && opt.value === v);
        const next = hasOption ? v : fallback;
        el.value = next;
        if (el.value !== next) {
            el.selectedIndex = 0;
            return el.value || fallback;
        }
        return next;
    },

    initDbPathUI() {
        const input = document.getElementById('dbPathInput');
        const btn = document.getElementById('btnApplyDbPath');
        const currentEl = document.getElementById('dbPathCurrent');
        if (!input || !btn || !currentEl) return;

        const saved = localStorage.getItem('percento_db_path') || '';
        input.value = saved;

        const isApi = DB.mode === 'api';
        input.disabled = !isApi;
        btn.disabled = !isApi;

        if (!isApi) {
            currentEl.textContent = i18n.currentLang === 'zh'
                ? '仅在本地服务模式可用'
                : 'Available only in local server mode';
            return;
        }

        this.refreshDbPathCurrent().catch(() => { });
    },

    async refreshDbPathCurrent() {
        const currentEl = document.getElementById('dbPathCurrent');
        if (!currentEl) return;
        if (DB.mode !== 'api') return;

        const res = await fetch('/api/config', { method: 'GET', headers: { 'Accept': 'application/json' } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        currentEl.textContent = data?.dbPath || '-';
    },

    normalizeDbPath(input) {
        let p = String(input || '').trim();
        if (!p) return '';
        if (p.startsWith('file://')) {
            try {
                p = decodeURIComponent(p.replace(/^file:\/\//, ''));
            } catch (e) {
                p = p.replace(/^file:\/\//, '');
            }
        }
        return p;
    },

    async applyDbPathFromStorage() {
        if (DB.mode !== 'api') return;
        const rememberedMode = localStorage.getItem('percento_sync_mode') || '';
        if (rememberedMode === 'webdav') return;
        const saved = localStorage.getItem('percento_db_path');
        if (!saved) return;
        try {
            await this._postDbPath(this.normalizeDbPath(saved), { silent: true, refresh: false });
        } catch (e) {
            return;
        }
    },

    async applyDbPath() {
        if (DB.mode !== 'api') {
            App.showToast(i18n.currentLang === 'zh' ? '仅本地服务模式支持切换数据库文件' : 'DB path is supported only in local server mode', 'error');
            return;
        }

        const input = document.getElementById('dbPathInput');
        if (!input) return;

        const path = this.normalizeDbPath(input.value);
        if (!path) {
            App.showToast(i18n.currentLang === 'zh' ? '请输入数据库文件路径' : 'Please enter DB file path', 'error');
            return;
        }

        localStorage.setItem('percento_db_path', path);
        await this._postDbPath(path);
    },

    async _postDbPath(path, { silent = false, refresh = true } = {}) {
        const res = await fetch('/api/config/dbPath', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify({ dbPath: path })
        });

        if (!res.ok) {
            const data = await res.json().catch(() => null);
            const code = data?.error;
            const message = this._formatDbPathError(code) || (data ? JSON.stringify(data) : '');
            const fallback = message || `HTTP ${res.status}`;
            if (!silent) App.showToast((i18n.currentLang === 'zh' ? '应用失败：' : 'Apply failed: ') + fallback, 'error');
            throw new Error(fallback);
        }

        const data = await res.json().catch(() => ({}));
        const currentEl = document.getElementById('dbPathCurrent');
        if (currentEl) currentEl.textContent = data?.dbPath || path;

        if (!silent) App.showToast(i18n.currentLang === 'zh' ? '数据库位置已切换' : 'DB path updated');
        if (refresh && window.App && typeof App.refreshAll === 'function') {
            await App.refreshAll();
        }
    },

    _formatDbPathError(code) {
        if (!code) return '';
        const zh = {
            invalid_db_path: '路径无效',
            db_path_must_be_absolute: '路径必须是绝对路径（例如 /Users/... 或 ~/...）',
            db_path_must_end_with_db: '文件名需以 .db 结尾',
            db_path_parent_unwritable: '目标目录不可写'
        };
        const en = {
            invalid_db_path: 'Invalid path',
            db_path_must_be_absolute: 'Path must be absolute (e.g. /Users/... or ~/...)',
            db_path_must_end_with_db: 'File name must end with .db',
            db_path_parent_unwritable: 'Target directory is not writable'
        };
        const dict = i18n.currentLang === 'zh' ? zh : en;
        return dict[code] || String(code);
    },

    /**
     * 设置主题
     * @param {string} theme 
     */
    async setTheme(theme) {
        this.applyTheme(theme);
        await DB.saveSetting('theme', theme);
    },

    /**
     * 应用主题
     * @param {string} theme 
     */
    applyTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);

        // 更新主题按钮状态
        document.querySelectorAll('.theme-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.theme === theme);
        });

        // 更新 meta theme-color
        const metaTheme = document.querySelector('meta[name="theme-color"]');
        if (metaTheme) {
            metaTheme.content = theme === 'dark' ? '#1A1B1E' : '#E0E8F0';
        }

        // 注意：不在这里调用 Charts.refreshChartsTheme()
        // 图表会在更新时自动使用新的 CSS 变量
    },

    applyInvertColors(enabled) {
        document.documentElement.setAttribute('data-invert-colors', enabled ? '1' : '0');
    },

    /**
     * 设置语言
     * @param {string} lang 
     */
    async setLanguage(lang) {
        i18n.setLanguage(lang);
        await DB.saveSetting('language', lang);

        // 刷新图表（标签需要更新）
        if (window.Charts) {
            await Charts.updateCharts();
        }
    },

    /**
     * 设置默认币种
     * @param {string} currency 
     */
    async setCurrency(currency) {
        await DB.saveSetting('currency', currency);

        // 刷新显示
        await App.updateDashboardStats();
        await Accounts.renderAccountList();
        await Investments.renderInvestmentList();
    },

    /**
     * 设置默认时间周期
     * @param {string} period 
     */
    async setPeriod(period) {
        await DB.saveSetting('period', period);

        // 更新图表默认周期
        if (window.Charts) {
            Charts.currentPeriod = period;

            // 更新选中状态
            document.querySelectorAll('#chartTimeTabs .filter-tab').forEach(tab => {
                tab.classList.toggle('active', tab.dataset.period === period);
            });

            await Charts.updateCharts();
        }
    },

    async setInvertColors(enabled) {
        this.applyInvertColors(!!enabled);
        await DB.saveSetting('invertColors', !!enabled);
        if (window.App && typeof App.refreshAll === 'function') {
            await App.refreshAll();
        }
    },

    /**
     * 获取货币符号
     * @param {string} currency 
     * @returns {string}
     */
    getCurrencySymbol(currency) {
        const symbols = {
            'CNY': '¥',
            'USD': '$',
            'EUR': '€',
            'JPY': '¥',
            'GBP': '£',
            'HKD': '$'
        };
        return symbols[currency] || '¥';
    },

    /**
     * 获取当前币种
     * @returns {Promise<string>}
     */
    async getCurrentCurrency() {
        return await DB.getSetting('currency', 'CNY');
    },

    async loadWebDAVSettings() {
        const webdavUrl = await DB.getSetting('webdavUrl', '');
        const webdavUser = await DB.getSetting('webdavUser', '');
        const webdavPass = await DB.getSetting('webdavPass', '');
        const syncMode = await DB.getSetting('syncMode', 'db');
        const autoSync = await DB.getSetting('autoSync', false);
        const syncInterval = await DB.getSetting('syncInterval', 15);
        const lastSync = await DB.getSetting('lastSync', '');

        const urlInput = document.getElementById('webdavUrl');
        const userInput = document.getElementById('webdavUser');
        const passInput = document.getElementById('webdavPass');
        const syncModeSelect = document.getElementById('syncModeSelect');
        const autoSyncToggle = document.getElementById('autoSyncToggle');
        const syncIntervalSelect = document.getElementById('syncIntervalSelect');
        const lastSyncEl = document.getElementById('lastSyncTime');

        if (urlInput) urlInput.value = webdavUrl;
        if (userInput) userInput.value = webdavUser;
        if (passInput) passInput.value = webdavPass;

        if (syncModeSelect) {
            syncModeSelect.value = syncMode;
        }
        if (autoSyncToggle) {
            autoSyncToggle.checked = autoSync === true || autoSync === 'true';
        }
        if (syncIntervalSelect) {
            syncIntervalSelect.value = syncInterval || 15;
        }
        if (lastSyncEl) {
            lastSyncEl.textContent = lastSync || i18n.t('neverSynced');
        }
    },

    async saveWebDAVSettings() {
        const urlInput = document.getElementById('webdavUrl');
        const userInput = document.getElementById('webdavUser');
        const passInput = document.getElementById('webdavPass');

        if (urlInput) {
            await DB.saveSetting('webdavUrl', urlInput.value);
        }
        if (userInput) {
            await DB.saveSetting('webdavUser', userInput.value);
        }
        if (passInput) {
            await DB.saveSetting('webdavPass', passInput.value);
        }
    },

    async updateSyncUI() {
        const syncModeSelect = document.getElementById('syncModeSelect');
        const autoSyncSetting = document.getElementById('autoSyncSetting');
        const syncIntervalSetting = document.getElementById('syncIntervalSetting');
        const webdavActionButtons = document.getElementById('webdavActionButtons');
        const webdavSettingsSection = document.getElementById('webdavSettingsSection');
        const syncStatusDisplay = document.getElementById('syncStatusDisplay');
        const storageSection = document.getElementById('storageSection');

        if (!syncModeSelect) return;

        const syncMode = syncModeSelect.value;
        const isWebdavMode = syncMode === 'webdav';

        if (autoSyncSetting) {
            autoSyncSetting.style.display = isWebdavMode ? 'flex' : 'none';
        }
        if (syncIntervalSetting) {
            syncIntervalSetting.classList.toggle('hidden', !isWebdavMode);
        }
        if (webdavActionButtons) {
            webdavActionButtons.style.display = isWebdavMode ? 'flex' : 'none';
        }
        if (webdavSettingsSection) {
            webdavSettingsSection.style.display = isWebdavMode ? 'block' : 'none';
        }
        if (storageSection) {
            storageSection.style.display = isWebdavMode ? 'none' : 'block';
        }
        if (isWebdavMode) {
            localStorage.removeItem('percento_db_path');
            const input = document.getElementById('dbPathInput');
            const currentEl = document.getElementById('dbPathCurrent');
            if (input) input.value = '';
            if (currentEl) currentEl.textContent = '-';
        }
        if (syncStatusDisplay) {
            if (isWebdavMode) {
                const webdavUrl = document.getElementById('webdavUrl')?.value;
                if (webdavUrl && webdavUrl.trim()) {
                    syncStatusDisplay.textContent = i18n.t('syncStatusConnected');
                    syncStatusDisplay.style.color = 'var(--color-success)';
                } else {
                    syncStatusDisplay.textContent = i18n.t('syncStatusDisconnected');
                    syncStatusDisplay.style.color = 'var(--color-text-muted)';
                }
            } else {
                syncStatusDisplay.textContent = i18n.t('syncStatusConnected');
                syncStatusDisplay.style.color = 'var(--color-success)';
            }
        }
    },

    async setSyncMode(mode) {
        await DB.saveSetting('syncMode', mode);
        localStorage.setItem('percento_sync_mode', mode);
        if (mode === 'webdav') {
            localStorage.removeItem('percento_db_path');
            if (DB.mode === 'api') {
                try {
                    await fetch('/api/config/resetDbPath', { method: 'POST', headers: { 'Accept': 'application/json' } });
                } catch (e) { }
            }
        }
        await this.updateSyncUI();
    },

    async setAutoSync(enabled) {
        await DB.saveSetting('autoSync', enabled);

        if (enabled) {
            this.startAutoSync();
        } else {
            this.stopAutoSync();
        }
    },

    async setSyncInterval(minutes) {
        await DB.saveSetting('syncInterval', minutes);
        if (await DB.getSetting('autoSync', false)) {
            this.stopAutoSync();
            this.startAutoSync();
        }
    },

    autoSyncTimer: null,

    startAutoSync() {
        this.stopAutoSync();
        const interval = parseInt(document.getElementById('syncIntervalSelect')?.value || 15) * 60 * 1000;
        this.syncWebDAV(false).catch(() => { });
        this.autoSyncTimer = setInterval(async () => {
            const mode = await DB.getSetting('syncMode', 'db');
            if (mode === 'webdav') {
                await this.syncWebDAV(false);
            }
        }, interval);
    },

    stopAutoSync() {
        if (this.autoSyncTimer) {
            clearInterval(this.autoSyncTimer);
            this.autoSyncTimer = null;
        }
    },

    async testWebDAVConnection() {
        const url = document.getElementById('webdavUrl')?.value.trim();
        const user = document.getElementById('webdavUser')?.value.trim();
        const pass = document.getElementById('webdavPass')?.value;
        const syncStatusDisplay = document.getElementById('syncStatusDisplay');

        if (!url) {
            App.showToast(i18n.currentLang === 'zh' ? '请输入WebDAV地址' : 'Please enter WebDAV URL', 'error');
            return;
        }

        App.showLoading();

        try {
            const response = await fetch('/api/webdav/propfind', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    url: url,
                    username: user,
                    password: pass
                })
            });

            if (response.status === 404) {
                throw new Error(i18n.currentLang === 'zh'
                    ? '后端未提供 WebDAV 接口，请确认运行的是项目自带 server.py'
                    : 'Backend WebDAV API not found. Please run the bundled server.py');
            }

            const result = await response.json();

            App.hideLoading();

            if (result.ok) {
                if (syncStatusDisplay) {
                    syncStatusDisplay.textContent = i18n.t('webdavConnected');
                    syncStatusDisplay.style.color = 'var(--color-success)';
                }
                App.showToast(i18n.currentLang === 'zh' ? '连接成功' : 'Connection successful');
                await DB.saveSetting('webdavConnected', true);
            } else {
                const msg = result.hint || result.message || result.error || 'Connection failed';
                throw new Error(msg);
            }

        } catch (error) {
            App.hideLoading();
            console.error('WebDAV test error:', error);
            if (syncStatusDisplay) {
                syncStatusDisplay.textContent = i18n.t('webdavConnectionFailed');
                syncStatusDisplay.style.color = 'var(--color-danger)';
            }
            App.showToast(i18n.currentLang === 'zh' ? '连接失败' : 'Connection failed', 'error');
            await DB.saveSetting('webdavConnected', false);
        }
    },

    async syncWebDAV(showToast = true) {
        const url = document.getElementById('webdavUrl')?.value.trim();
        const user = document.getElementById('webdavUser')?.value.trim();
        const pass = document.getElementById('webdavPass')?.value;
        const syncStatusDisplay = document.getElementById('syncStatusDisplay');
        const lastSyncEl = document.getElementById('lastSyncTime');

        if (!url) {
            if (showToast) App.showToast(i18n.currentLang === 'zh' ? '请先配置WebDAV' : 'Please configure WebDAV first', 'error');
            return;
        }

        if (DB.mode !== 'api') {
            if (showToast) App.showToast(i18n.currentLang === 'zh' ? 'WebDAV 云同步需要先运行本地服务（server.py）' : 'WebDAV sync requires running local server (server.py)', 'error');
            return;
        }

        if (showToast) {
            App.showLoading();
        }

        try {
            const response = await fetch('/api/webdav/db/sync', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    url: url,
                    username: user,
                    password: pass,
                    filename: 'openpercento.db'
                })
            });

            if (response.status === 404) {
                throw new Error(i18n.currentLang === 'zh'
                    ? '后端未提供 /api/webdav/db/sync。请查看运行 server.py 的终端输出端口，并确保浏览器打开的是同一个端口。'
                    : 'Backend /api/webdav/db/sync not found. Ensure the browser uses the same port as server.py.');
            }

            const result = await response.json();

            if (showToast) {
                App.hideLoading();
            }

            if (result.ok) {
                const now = new Date().toLocaleString();
                if (lastSyncEl) {
                    lastSyncEl.textContent = now;
                }
                if (syncStatusDisplay) {
                    syncStatusDisplay.textContent = i18n.t('syncStatusSuccess');
                    syncStatusDisplay.style.color = 'var(--color-success)';
                }
                await DB.saveSetting('lastSync', now);
                if (showToast) {
                    const action = result.action || '';
                    const msgZh = action === 'upload'
                        ? '同步成功：已上传本地数据库'
                        : (action === 'download' ? '同步成功：已下载云端数据库' : '同步完成：无需更新');
                    const msgEn = action === 'upload'
                        ? 'Sync success: uploaded local DB'
                        : (action === 'download' ? 'Sync success: downloaded remote DB' : 'Sync complete: no changes');
                    App.showToast(i18n.currentLang === 'zh' ? msgZh : msgEn);
                }
                if (result.action === 'download' && window.App && typeof App.refreshAll === 'function') {
                    await App.refreshAll();
                }
            } else {
                const msg = result.hint || result.message || result.error || 'Sync failed';
                throw new Error(msg);
            }

        } catch (error) {
            if (showToast) {
                App.hideLoading();
            }
            console.error('WebDAV sync error:', error);
            if (syncStatusDisplay) {
                const detail = error && error.message ? `: ${error.message}` : '';
                syncStatusDisplay.textContent = `${i18n.t('syncStatusFailed')}${detail}`;
                syncStatusDisplay.style.color = 'var(--color-danger)';
            }
            if (showToast) {
                const msg = error && error.message ? `${i18n.t('syncFailed')}: ${error.message}` : i18n.t('syncFailed');
                App.showToast(msg, 'error');
            }
        }
    },

    async restoreFromWebDAV() {
        const url = document.getElementById('webdavUrl')?.value.trim();
        const user = document.getElementById('webdavUser')?.value.trim();
        const pass = document.getElementById('webdavPass')?.value;

        if (!url) {
            App.showToast(i18n.currentLang === 'zh' ? '请先配置WebDAV' : 'Please configure WebDAV first', 'error');
            return;
        }

        App.showLoading();

        try {
            if (DB.mode !== 'api') {
                App.hideLoading();
                App.showToast(i18n.currentLang === 'zh' ? '从云端恢复需要先运行本地服务（server.py）' : 'Restore requires running local server (server.py)', 'error');
                return;
            }

            const response = await fetch('/api/webdav/db/sync', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    url: url,
                    username: user,
                    password: pass,
                    filename: 'openpercento.db',
                    force: 'download'
                })
            });

            if (response.status === 404) {
                throw new Error(i18n.currentLang === 'zh'
                    ? '后端未提供 /api/webdav/db/sync。请确认运行的是项目自带 server.py'
                    : 'Backend /api/webdav/db/sync not found. Please run the bundled server.py');
            }

            const result = await response.json();

            if (result.ok) {
                App.hideLoading();
                const action = result.action || '';
                const msgZh = action === 'download' ? '已从云端恢复数据库' : '恢复完成';
                const msgEn = action === 'download' ? 'Database restored from cloud' : 'Restore complete';
                App.showToast(i18n.currentLang === 'zh' ? msgZh : msgEn);

                const now = new Date().toLocaleString();
                const lastSyncEl = document.getElementById('lastSyncTime');
                if (lastSyncEl) lastSyncEl.textContent = now;
                await DB.saveSetting('lastSync', now);

                if (window.App && typeof App.refreshAll === 'function') {
                    await App.refreshAll();
                }
            } else {
                const msg = result.hint || result.message || result.error || 'Restore failed';
                throw new Error(msg);
            }

        } catch (error) {
            App.hideLoading();
            console.error('WebDAV restore error:', error);
            const msg = error && error.message
                ? (i18n.currentLang === 'zh' ? `恢复失败: ${error.message}` : `Restore failed: ${error.message}`)
                : (i18n.currentLang === 'zh' ? '恢复失败' : 'Restore failed');
            App.showToast(msg, 'error');
        }
    }
};

// 导出
window.Settings = Settings;
