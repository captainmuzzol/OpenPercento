/**
 * OpenPercento - 设置模块
 * 语言切换、深浅色模式、偏好设置
 */

const Settings = {
    /**
     * 初始化设置模块
     */
    async init() {
        await this.applyDbPathFromStorage();
        await this.loadSettings();
        this.bindEvents();
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
    }
};

// 导出
window.Settings = Settings;
