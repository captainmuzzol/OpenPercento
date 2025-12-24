/**
 * OpenPercento - IndexedDB 数据库模块
 * 本地数据存储，隐私优先
 */

const DB = {
    name: 'PercentoDB',
    version: 3,
    db: null,
    mode: 'indexeddb',
    apiBaseUrl: '',

    // 对象存储名称
    stores: {
        accounts: 'accounts',
        transactions: 'transactions',
        investments: 'investments',
        priceHistory: 'priceHistory',  // 新增：价格历史记录表
        settings: 'settings',
        snapshots: 'snapshots', // 净资产快照
        recurringRules: 'recurringRules'
    },

    /**
     * 初始化数据库
     * @returns {Promise}
     */
    async init() {
        const canUseApi = await this._probeApi();
        if (canUseApi) {
            this.mode = 'api';
            return true;
        }

        this.mode = 'indexeddb';
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.name, this.version);

            request.onerror = () => {
                console.error('Database error:', request.error);
                reject(request.error);
            };

            request.onsuccess = () => {
                this.db = request.result;
                console.log('Database opened successfully');
                resolve(this.db);
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;

                // 账户表
                if (!db.objectStoreNames.contains(this.stores.accounts)) {
                    const accountStore = db.createObjectStore(this.stores.accounts, {
                        keyPath: 'id',
                        autoIncrement: true
                    });
                    accountStore.createIndex('group', 'group', { unique: false });
                    accountStore.createIndex('name', 'name', { unique: false });
                }

                // 交易记录表（余额变动记录）
                if (!db.objectStoreNames.contains(this.stores.transactions)) {
                    const transactionStore = db.createObjectStore(this.stores.transactions, {
                        keyPath: 'id',
                        autoIncrement: true
                    });
                    transactionStore.createIndex('accountId', 'accountId', { unique: false });
                    transactionStore.createIndex('date', 'date', { unique: false });
                    transactionStore.createIndex('type', 'type', { unique: false });
                }

                // 投资表
                if (!db.objectStoreNames.contains(this.stores.investments)) {
                    const investmentStore = db.createObjectStore(this.stores.investments, {
                        keyPath: 'id',
                        autoIncrement: true
                    });
                    investmentStore.createIndex('type', 'type', { unique: false });
                    investmentStore.createIndex('symbol', 'symbol', { unique: false });
                }

                // 设置表
                if (!db.objectStoreNames.contains(this.stores.settings)) {
                    db.createObjectStore(this.stores.settings, { keyPath: 'key' });
                }

                // 净资产快照表
                if (!db.objectStoreNames.contains(this.stores.snapshots)) {
                    const snapshotStore = db.createObjectStore(this.stores.snapshots, {
                        keyPath: 'id',
                        autoIncrement: true
                    });
                    snapshotStore.createIndex('date', 'date', { unique: false });
                }

                // 价格历史记录表（新增）
                if (!db.objectStoreNames.contains(this.stores.priceHistory)) {
                    const historyStore = db.createObjectStore(this.stores.priceHistory, {
                        keyPath: 'id',
                        autoIncrement: true
                    });
                    historyStore.createIndex('investmentId', 'investmentId', { unique: false });
                    historyStore.createIndex('date', 'date', { unique: false });
                    historyStore.createIndex('investmentId_date', ['investmentId', 'date'], { unique: true });
                }

                // 数据库版本升级处理
                if (event.oldVersion < 2) {
                    // 版本2：添加购买日期字段到投资表
                    console.log('Upgrading database to version 2');
                }

                if (event.oldVersion < 3) {
                    if (!db.objectStoreNames.contains(this.stores.recurringRules)) {
                        const ruleStore = db.createObjectStore(this.stores.recurringRules, {
                            keyPath: 'id',
                            autoIncrement: true
                        });
                        ruleStore.createIndex('kind', 'kind', { unique: false });
                        ruleStore.createIndex('accountId', 'accountId', { unique: false });
                        ruleStore.createIndex('investmentId', 'investmentId', { unique: false });
                        ruleStore.createIndex('enabled', 'enabled', { unique: false });
                        ruleStore.createIndex('nextRun', 'nextRun', { unique: false });
                    }
                }
            };
        });
    },

    async _probeApi() {
        try {
            const res = await this._fetchJson('/api/health', { method: 'GET' }, 800);
            return !!(res && res.ok);
        } catch (e) {
            return false;
        }
    },

    async _fetchJson(path, options = {}, timeoutMs = 5000) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const headers = {
                'Accept': 'application/json',
                ...(options.headers || {})
            };
            const res = await fetch(this.apiBaseUrl + path, {
                ...options,
                headers,
                signal: controller.signal
            });

            if (!res.ok) {
                const text = await res.text().catch(() => '');
                const err = new Error(text || `HTTP ${res.status}`);
                err.status = res.status;
                throw err;
            }

            if (res.status === 204) return null;
            const contentType = res.headers.get('content-type') || '';
            if (!contentType.includes('application/json')) {
                const text = await res.text().catch(() => '');
                return text || null;
            }
            return await res.json();
        } finally {
            clearTimeout(timer);
        }
    },

    /**
     * 获取对象存储
     * @param {string} storeName 
     * @param {string} mode 
     * @returns {IDBObjectStore}
     */
    getStore(storeName, mode = 'readonly') {
        if (this.mode !== 'indexeddb') {
            throw new Error('IndexedDB store is not available in API mode');
        }
        const transaction = this.db.transaction(storeName, mode);
        return transaction.objectStore(storeName);
    },

    // ==================== 账户操作 ====================

    /**
     * 添加账户
     * @param {Object} account 
     * @returns {Promise<number>} 账户ID
     */
    async addAccount(account) {
        if (this.mode === 'api') {
            const payload = {
                ...account,
                balance: parseFloat(account.balance) || 0,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };
            const res = await this._fetchJson('/api/accounts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            return res?.id;
        }
        return new Promise((resolve, reject) => {
            const store = this.getStore(this.stores.accounts, 'readwrite');
            const data = {
                ...account,
                balance: parseFloat(account.balance) || 0,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };
            const request = store.add(data);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    },

    /**
     * 更新账户
     * @param {Object} account 
     * @returns {Promise}
     */
    async updateAccount(account) {
        if (this.mode === 'api') {
            const payload = {
                ...account,
                balance: parseFloat(account.balance) || 0,
                updatedAt: new Date().toISOString()
            };
            await this._fetchJson(`/api/accounts/${encodeURIComponent(account.id)}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            return account.id;
        }
        return new Promise((resolve, reject) => {
            const store = this.getStore(this.stores.accounts, 'readwrite');
            const data = {
                ...account,
                balance: parseFloat(account.balance) || 0,
                updatedAt: new Date().toISOString()
            };
            const request = store.put(data);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    },

    /**
     * 删除账户
     * @param {number} id 
     * @returns {Promise}
     */
    async deleteAccount(id) {
        if (this.mode === 'api') {
            await this._fetchJson(`/api/accounts/${encodeURIComponent(id)}`, { method: 'DELETE' });
            return;
        }
        return new Promise((resolve, reject) => {
            const store = this.getStore(this.stores.accounts, 'readwrite');
            const request = store.delete(id);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    },

    /**
     * 获取单个账户
     * @param {number} id 
     * @returns {Promise<Object>}
     */
    async getAccount(id) {
        if (this.mode === 'api') {
            try {
                return await this._fetchJson(`/api/accounts/${encodeURIComponent(id)}`, { method: 'GET' });
            } catch (e) {
                if (e && e.status === 404) return null;
                throw e;
            }
        }
        return new Promise((resolve, reject) => {
            const store = this.getStore(this.stores.accounts);
            const request = store.get(id);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    },

    /**
     * 获取所有账户
     * @returns {Promise<Array>}
     */
    async getAllAccounts() {
        if (this.mode === 'api') {
            const res = await this._fetchJson('/api/accounts', { method: 'GET' });
            return res || [];
        }
        return new Promise((resolve, reject) => {
            const store = this.getStore(this.stores.accounts);
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error);
        });
    },

    /**
     * 按分组获取账户
     * @param {string} group 
     * @returns {Promise<Array>}
     */
    async getAccountsByGroup(group) {
        if (this.mode === 'api') {
            const accounts = await this.getAllAccounts();
            return (accounts || []).filter(a => a.group === group);
        }
        return new Promise((resolve, reject) => {
            const store = this.getStore(this.stores.accounts);
            const index = store.index('group');
            const request = index.getAll(group);
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error);
        });
    },

    // ==================== 交易记录操作 ====================

    /**
     * 添加交易记录
     * @param {Object} transaction 
     * @returns {Promise<number>}
     */
    async addTransaction(transaction) {
        if (this.mode === 'api') {
            const payload = {
                ...transaction,
                amount: parseFloat(transaction.amount) || 0,
                previousBalance: parseFloat(transaction.previousBalance) || 0,
                newBalance: parseFloat(transaction.newBalance) || 0,
                createdAt: new Date().toISOString()
            };
            const res = await this._fetchJson('/api/transactions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            return res?.id;
        }
        return new Promise((resolve, reject) => {
            const store = this.getStore(this.stores.transactions, 'readwrite');
            const data = {
                ...transaction,
                amount: parseFloat(transaction.amount) || 0,
                previousBalance: parseFloat(transaction.previousBalance) || 0,
                newBalance: parseFloat(transaction.newBalance) || 0,
                createdAt: new Date().toISOString()
            };
            const request = store.add(data);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    },

    /**
     * 获取账户的交易记录
     * @param {number} accountId 
     * @returns {Promise<Array>}
     */
    async getTransactionsByAccount(accountId) {
        if (this.mode === 'api') {
            const res = await this._fetchJson(`/api/transactions?accountId=${encodeURIComponent(accountId)}`, { method: 'GET' });
            return res || [];
        }
        return new Promise((resolve, reject) => {
            const store = this.getStore(this.stores.transactions);
            const index = store.index('accountId');
            const request = index.getAll(accountId);
            request.onsuccess = () => {
                const results = request.result || [];
                // 按日期降序排序
                results.sort((a, b) => new Date(b.date) - new Date(a.date));
                resolve(results);
            };
            request.onerror = () => reject(request.error);
        });
    },

    /**
     * 获取所有交易记录
     * @returns {Promise<Array>}
     */
    async getAllTransactions() {
        if (this.mode === 'api') {
            const res = await this._fetchJson('/api/transactions', { method: 'GET' });
            return res || [];
        }
        return new Promise((resolve, reject) => {
            const store = this.getStore(this.stores.transactions);
            const request = store.getAll();
            request.onsuccess = () => {
                const results = request.result || [];
                results.sort((a, b) => new Date(b.date) - new Date(a.date));
                resolve(results);
            };
            request.onerror = () => reject(request.error);
        });
    },

    /**
     * 按日期范围获取交易记录
     * @param {string} startDate 
     * @param {string} endDate 
     * @returns {Promise<Array>}
     */
    async getTransactionsByDateRange(startDate, endDate) {
        const allTransactions = await this.getAllTransactions();
        return allTransactions.filter(t => {
            const date = new Date(t.date);
            return date >= new Date(startDate) && date <= new Date(endDate);
        });
    },

    // ==================== 投资操作 ====================

    /**
     * 添加投资
     * @param {Object} investment 
     * @returns {Promise<number>}
     */
    async addInvestment(investment) {
        if (this.mode === 'api') {
            const today = new Date().toISOString().split('T')[0];
            const purchaseDate = investment.type === 'wealth'
                ? (investment.purchaseDate || null)
                : (investment.purchaseDate || today);
            const payload = {
                ...investment,
                quantity: parseFloat(investment.quantity) || 0,
                costPrice: parseFloat(investment.costPrice) || 0,
                currentPrice: parseFloat(investment.currentPrice) || 0,
                annualInterestRate: parseFloat(investment.annualInterestRate) || 0,
                wealthProductType: investment.wealthProductType || null,
                maturityDate: investment.maturityDate || null,
                lastAccruedDate: investment.lastAccruedDate || null,
                purchaseDate,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };
            const res = await this._fetchJson('/api/investments', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            return res?.id;
        }
        return new Promise((resolve, reject) => {
            const store = this.getStore(this.stores.investments, 'readwrite');
            const today = new Date().toISOString().split('T')[0];
            const purchaseDate = investment.type === 'wealth'
                ? (investment.purchaseDate || null)
                : (investment.purchaseDate || today);
            const data = {
                ...investment,
                quantity: parseFloat(investment.quantity) || 0,
                costPrice: parseFloat(investment.costPrice) || 0,
                currentPrice: parseFloat(investment.currentPrice) || 0,
                annualInterestRate: parseFloat(investment.annualInterestRate) || 0,
                wealthProductType: investment.wealthProductType || null,
                maturityDate: investment.maturityDate || null,
                lastAccruedDate: investment.lastAccruedDate || null,
                purchaseDate,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };
            const request = store.add(data);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    },

    /**
     * 更新投资
     * @param {Object} investment 
     * @returns {Promise}
     */
    async updateInvestment(investment) {
        if (this.mode === 'api') {
            const today = new Date().toISOString().split('T')[0];
            const purchaseDate = investment.type === 'wealth'
                ? (investment.purchaseDate || null)
                : (investment.purchaseDate || today);
            const payload = {
                ...investment,
                quantity: parseFloat(investment.quantity) || 0,
                costPrice: parseFloat(investment.costPrice) || 0,
                currentPrice: parseFloat(investment.currentPrice) || 0,
                annualInterestRate: parseFloat(investment.annualInterestRate) || 0,
                wealthProductType: investment.wealthProductType || null,
                maturityDate: investment.maturityDate || null,
                lastAccruedDate: investment.lastAccruedDate || null,
                purchaseDate,
                updatedAt: new Date().toISOString()
            };
            await this._fetchJson(`/api/investments/${encodeURIComponent(investment.id)}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            return investment.id;
        }
        return new Promise((resolve, reject) => {
            const store = this.getStore(this.stores.investments, 'readwrite');
            const today = new Date().toISOString().split('T')[0];
            const purchaseDate = investment.type === 'wealth'
                ? (investment.purchaseDate || null)
                : (investment.purchaseDate || today);
            const data = {
                ...investment,
                quantity: parseFloat(investment.quantity) || 0,
                costPrice: parseFloat(investment.costPrice) || 0,
                currentPrice: parseFloat(investment.currentPrice) || 0,
                annualInterestRate: parseFloat(investment.annualInterestRate) || 0,
                wealthProductType: investment.wealthProductType || null,
                maturityDate: investment.maturityDate || null,
                lastAccruedDate: investment.lastAccruedDate || null,
                purchaseDate,
                updatedAt: new Date().toISOString()
            };
            const request = store.put(data);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    },

    /**
     * 删除投资
     * @param {number} id 
     * @returns {Promise}
     */
    async deleteInvestment(id) {
        if (this.mode === 'api') {
            await this._fetchJson(`/api/investments/${encodeURIComponent(id)}`, { method: 'DELETE' });
            return;
        }
        return new Promise((resolve, reject) => {
            const store = this.getStore(this.stores.investments, 'readwrite');
            const request = store.delete(id);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    },

    /**
     * 获取单个投资
     * @param {number} id 
     * @returns {Promise<Object>}
     */
    async getInvestment(id) {
        if (this.mode === 'api') {
            try {
                return await this._fetchJson(`/api/investments/${encodeURIComponent(id)}`, { method: 'GET' });
            } catch (e) {
                if (e && e.status === 404) return null;
                throw e;
            }
        }
        return new Promise((resolve, reject) => {
            const store = this.getStore(this.stores.investments);
            const request = store.get(id);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    },

    /**
     * 获取所有投资
     * @returns {Promise<Array>}
     */
    async getAllInvestments() {
        if (this.mode === 'api') {
            const res = await this._fetchJson('/api/investments', { method: 'GET' });
            return res || [];
        }
        return new Promise((resolve, reject) => {
            const store = this.getStore(this.stores.investments);
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error);
        });
    },

    /**
     * 按类型获取投资
     * @param {string} type 
     * @returns {Promise<Array>}
     */
    async getInvestmentsByType(type) {
        if (this.mode === 'api') {
            const res = await this._fetchJson(`/api/investments?type=${encodeURIComponent(type)}`, { method: 'GET' });
            return res || [];
        }
        return new Promise((resolve, reject) => {
            const store = this.getStore(this.stores.investments);
            const index = store.index('type');
            const request = index.getAll(type);
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error);
        });
    },

    // ==================== 设置操作 ====================

    /**
     * 保存设置
     * @param {string} key 
     * @param {*} value 
     * @returns {Promise}
     */
    async saveSetting(key, value) {
        if (this.mode === 'api') {
            await this._fetchJson(`/api/settings/${encodeURIComponent(key)}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ value })
            });
            return;
        }
        return new Promise((resolve, reject) => {
            const store = this.getStore(this.stores.settings, 'readwrite');
            const request = store.put({ key, value, updatedAt: new Date().toISOString() });
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    },

    /**
     * 获取设置
     * @param {string} key 
     * @param {*} defaultValue 
     * @returns {Promise<*>}
     */
    async getSetting(key, defaultValue = null) {
        if (this.mode === 'api') {
            try {
                const res = await this._fetchJson(`/api/settings/${encodeURIComponent(key)}`, { method: 'GET' });
                return res && Object.prototype.hasOwnProperty.call(res, 'value') ? res.value : defaultValue;
            } catch (e) {
                if (e && e.status === 404) return defaultValue;
                throw e;
            }
        }
        return new Promise((resolve, reject) => {
            const store = this.getStore(this.stores.settings);
            const request = store.get(key);
            request.onsuccess = () => {
                resolve(request.result ? request.result.value : defaultValue);
            };
            request.onerror = () => reject(request.error);
        });
    },

    /**
     * 获取所有设置
     * @returns {Promise<Object>}
     */
    async getAllSettings() {
        if (this.mode === 'api') {
            const res = await this._fetchJson('/api/settings', { method: 'GET' });
            return res || {};
        }
        return new Promise((resolve, reject) => {
            const store = this.getStore(this.stores.settings);
            const request = store.getAll();
            request.onsuccess = () => {
                const settings = {};
                (request.result || []).forEach(item => {
                    settings[item.key] = item.value;
                });
                resolve(settings);
            };
            request.onerror = () => reject(request.error);
        });
    },

    async getAllRecurringRules() {
        if (this.mode === 'api') {
            const res = await this._fetchJson('/api/recurring', { method: 'GET' });
            return res || [];
        }
        return new Promise((resolve, reject) => {
            const store = this.getStore(this.stores.recurringRules);
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error);
        });
    },

    async getRecurringRules({ kind, accountId, investmentId } = {}) {
        if (this.mode === 'api') {
            const params = new URLSearchParams();
            if (kind) params.set('kind', kind);
            if (accountId) params.set('accountId', String(accountId));
            if (investmentId) params.set('investmentId', String(investmentId));
            const res = await this._fetchJson(`/api/recurring?${params.toString()}`, { method: 'GET' });
            return res || [];
        }
        const rules = await this.getAllRecurringRules();
        return (rules || []).filter(r => {
            if (kind && r.kind !== kind) return false;
            if (accountId && Number(r.accountId) !== Number(accountId)) return false;
            if (investmentId && Number(r.investmentId) !== Number(investmentId)) return false;
            return true;
        });
    },

    async addRecurringRule(rule) {
        if (this.mode === 'api') {
            const payload = { ...rule, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
            const res = await this._fetchJson('/api/recurring', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            return res?.id;
        }
        return new Promise((resolve, reject) => {
            const store = this.getStore(this.stores.recurringRules, 'readwrite');
            const data = { ...rule, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
            const request = store.add(data);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    },

    async updateRecurringRule(rule) {
        if (!rule || !rule.id) return;
        if (this.mode === 'api') {
            const payload = { ...rule, updatedAt: new Date().toISOString() };
            await this._fetchJson(`/api/recurring/${encodeURIComponent(rule.id)}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            return;
        }
        return new Promise((resolve, reject) => {
            const store = this.getStore(this.stores.recurringRules, 'readwrite');
            const data = { ...rule, updatedAt: new Date().toISOString() };
            const request = store.put(data);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    },

    async deleteRecurringRule(id) {
        if (!id) return;
        if (this.mode === 'api') {
            await this._fetchJson(`/api/recurring/${encodeURIComponent(id)}`, { method: 'DELETE' });
            return;
        }
        return new Promise((resolve, reject) => {
            const store = this.getStore(this.stores.recurringRules, 'readwrite');
            const request = store.delete(id);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    },

    // ==================== 快照操作 ====================

    /**
     * 添加净资产快照
     * @param {Object} snapshot 
     * @returns {Promise<number>}
     */
    async addSnapshot(snapshot) {
        if (this.mode === 'api') {
            const payload = {
                ...snapshot,
                netWorth: parseFloat(snapshot.netWorth) || 0,
                assets: parseFloat(snapshot.assets) || 0,
                liabilities: parseFloat(snapshot.liabilities) || 0,
                investments: parseFloat(snapshot.investments) || 0,
                createdAt: new Date().toISOString()
            };
            const res = await this._fetchJson('/api/snapshots', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            return res?.id;
        }
        return new Promise((resolve, reject) => {
            const store = this.getStore(this.stores.snapshots, 'readwrite');
            const data = {
                ...snapshot,
                netWorth: parseFloat(snapshot.netWorth) || 0,
                assets: parseFloat(snapshot.assets) || 0,
                liabilities: parseFloat(snapshot.liabilities) || 0,
                investments: parseFloat(snapshot.investments) || 0,
                createdAt: new Date().toISOString()
            };
            const request = store.add(data);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    },

    /**
     * 获取所有快照
     * @returns {Promise<Array>}
     */
    async getAllSnapshots() {
        if (this.mode === 'api') {
            const res = await this._fetchJson('/api/snapshots', { method: 'GET' });
            return res || [];
        }
        return new Promise((resolve, reject) => {
            const store = this.getStore(this.stores.snapshots);
            const request = store.getAll();
            request.onsuccess = () => {
                const results = request.result || [];
                results.sort((a, b) => new Date(a.date) - new Date(b.date));
                resolve(results);
            };
            request.onerror = () => reject(request.error);
        });
    },

    /**
     * 获取日期范围内的快照
     * @param {string} startDate 
     * @param {string} endDate 
     * @returns {Promise<Array>}
     */
    async getSnapshotsByDateRange(startDate, endDate) {
        const allSnapshots = await this.getAllSnapshots();
        return allSnapshots.filter(s => {
            const date = new Date(s.date);
            return date >= new Date(startDate) && date <= new Date(endDate);
        });
    },

    /**
     * 获取最新快照
     * @returns {Promise<Object|null>}
     */
    async getLatestSnapshot() {
        if (this.mode === 'api') {
            const res = await this._fetchJson('/api/snapshots/latest', { method: 'GET' });
            return res || null;
        }
        const snapshots = await this.getAllSnapshots();
        return snapshots.length > 0 ? snapshots[snapshots.length - 1] : null;
    },

    // ==================== 价格历史记录操作 ====================

    /**
     * 添加价格历史记录
     * @param {Object} history 
     * @returns {Promise<number>}
     */
    async addPriceHistory(history) {
        if (this.mode === 'api') {
            const payload = {
                ...history,
                price: parseFloat(history.price) || 0,
                createdAt: new Date().toISOString()
            };
            const res = await this._fetchJson('/api/priceHistory', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            return res?.id;
        }
        return new Promise((resolve, reject) => {
            const store = this.getStore(this.stores.priceHistory, 'readwrite');
            const data = {
                ...history,
                price: parseFloat(history.price) || 0,
                createdAt: new Date().toISOString()
            };
            const request = store.add(data);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    },

    /**
     * 更新价格历史记录
     * @param {Object} history 
     * @returns {Promise}
     */
    async updatePriceHistory(history) {
        if (this.mode === 'api') {
            const payload = {
                ...history,
                price: parseFloat(history.price) || 0,
                updatedAt: new Date().toISOString()
            };
            await this._fetchJson(`/api/priceHistory/${encodeURIComponent(history.id)}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            return;
        }
        return new Promise((resolve, reject) => {
            const store = this.getStore(this.stores.priceHistory, 'readwrite');
            const data = {
                ...history,
                price: parseFloat(history.price) || 0,
                updatedAt: new Date().toISOString()
            };
            const request = store.put(data);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    },

    /**
     * 获取投资的价格历史记录
     * @param {number} investmentId 
     * @param {string} startDate 
     * @param {string} endDate 
     * @returns {Promise<Array>}
     */
    async getPriceHistoryByInvestment(investmentId, startDate = null, endDate = null) {
        if (this.mode === 'api') {
            const qs = new URLSearchParams();
            qs.set('investmentId', investmentId);
            if (startDate) qs.set('startDate', startDate);
            if (endDate) qs.set('endDate', endDate);
            const res = await this._fetchJson(`/api/priceHistory?${qs.toString()}`, { method: 'GET' });
            return res || [];
        }
        return new Promise((resolve, reject) => {
            const store = this.getStore(this.stores.priceHistory);
            const index = store.index('investmentId');
            const request = index.getAll(investmentId);

            request.onsuccess = () => {
                let results = request.result || [];

                // 按日期过滤
                if (startDate) {
                    results = results.filter(h => new Date(h.date) >= new Date(startDate));
                }
                if (endDate) {
                    results = results.filter(h => new Date(h.date) <= new Date(endDate));
                }

                // 按日期排序
                results.sort((a, b) => new Date(a.date) - new Date(b.date));
                resolve(results);
            };
            request.onerror = () => reject(request.error);
        });
    },

    /**
     * 获取特定日期的价格历史记录
     * @param {number} investmentId 
     * @param {string} date 
     * @returns {Promise<Object|null>}
     */
    async getPriceHistoryByDate(investmentId, date) {
        if (this.mode === 'api') {
            if (!Number.isFinite(investmentId) || !date) return null;
            const qs = new URLSearchParams();
            qs.set('investmentId', investmentId);
            qs.set('date', date);
            return await this._fetchJson(`/api/priceHistory/byDate?${qs.toString()}`, { method: 'GET' });
        }

        return new Promise((resolve, reject) => {
            if (!Number.isFinite(investmentId) || !date) {
                resolve(null);
                return;
            }

            const store = this.getStore(this.stores.priceHistory);
            const index = store.index('investmentId_date');

            let request;
            try {
                request = index.get([investmentId, date]);
            } catch (error) {
                resolve(null);
                return;
            }

            request.onsuccess = () => {
                resolve(request.result || null);
            };
            request.onerror = () => reject(request.error);
        });
    },

    /**
     * 删除投资的价格历史记录
     * @param {number} investmentId 
     * @returns {Promise}
     */
    async deletePriceHistoryByInvestment(investmentId) {
        if (this.mode === 'api') {
            await this._fetchJson(`/api/priceHistory/byInvestment/${encodeURIComponent(investmentId)}`, { method: 'DELETE' });
            return;
        }
        return new Promise((resolve, reject) => {
            const store = this.getStore(this.stores.priceHistory, 'readwrite');
            const index = store.index('investmentId');
            const request = index.openCursor(investmentId);

            request.onsuccess = () => {
                const cursor = request.result;
                if (cursor) {
                    cursor.delete();
                    cursor.continue();
                } else {
                    resolve();
                }
            };
            request.onerror = () => reject(request.error);
        });
    },

    // ==================== 数据导出/导入 ====================

    /**
     * 导出所有数据
     * @returns {Promise<Object>}
     */
    async exportAllData() {
        if (this.mode === 'api') {
            return await this._fetchJson('/api/export', { method: 'GET' });
        }
        const accounts = await this.getAllAccounts();
        const transactions = await this.getAllTransactions();
        const investments = await this.getAllInvestments();
        const settings = await this.getAllSettings();
        const snapshots = await this.getAllSnapshots();

        return {
            version: this.version,
            exportedAt: new Date().toISOString(),
            accounts,
            transactions,
            investments,
            settings,
            snapshots
        };
    },

    /**
     * 导入数据
     * @param {Object} data 
     * @returns {Promise}
     */
    async importData(data) {
        if (this.mode === 'api') {
            await this._fetchJson('/api/import', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data || {})
            });
            return;
        }
        // 清空现有数据
        await this.clearAllData();

        // 导入账户
        if (data.accounts && Array.isArray(data.accounts)) {
            for (const account of data.accounts) {
                await this.addAccount(account);
            }
        }

        // 导入交易记录
        if (data.transactions && Array.isArray(data.transactions)) {
            for (const transaction of data.transactions) {
                await this.addTransaction(transaction);
            }
        }

        // 导入投资
        if (data.investments && Array.isArray(data.investments)) {
            for (const investment of data.investments) {
                await this.addInvestment(investment);
            }
        }

        // 导入设置
        if (data.settings && typeof data.settings === 'object') {
            for (const [key, value] of Object.entries(data.settings)) {
                await this.saveSetting(key, value);
            }
        }

        // 导入快照
        if (data.snapshots && Array.isArray(data.snapshots)) {
            for (const snapshot of data.snapshots) {
                await this.addSnapshot(snapshot);
            }
        }
    },

    /**
     * 清空所有数据
     * @returns {Promise}
     */
    async clearAllData() {
        if (this.mode === 'api') {
            await this._fetchJson('/api/clear', { method: 'POST' });
            return;
        }
        const storeNames = Object.values(this.stores);
        for (const storeName of storeNames) {
            await new Promise((resolve, reject) => {
                const store = this.getStore(storeName, 'readwrite');
                const request = store.clear();
                request.onsuccess = () => resolve();
                request.onerror = () => reject(request.error);
            });
        }
    },

    async migrateData() {
        try {
            const investments = await this.getAllInvestments();
            const missingPurchaseDate = investments.filter(inv => !inv.purchaseDate);

            for (const inv of missingPurchaseDate) {
                const purchaseDate = inv.createdAt
                    ? String(inv.createdAt).split('T')[0]
                    : new Date().toISOString().split('T')[0];

                await this.updateInvestment({
                    ...inv,
                    purchaseDate
                });
            }
        } catch (error) {
            console.error('Data migration error:', error);
        }
    },

    // ==================== 统计计算 ====================

    /**
     * 计算净资产统计
     * @returns {Promise<Object>}
     */
    async calculateStats() {
        const accounts = await this.getAllAccounts();
        const investments = await this.getAllInvestments();

        let accountAssets = 0;
        let totalLiabilities = 0;
        let includedAccountAssets = 0;
        let includedLiabilities = 0;

        accounts.forEach(account => {
            const group = String(account.group || '');
            const primary = group.includes('/') ? group.split('/')[0] : (group === 'liability' ? 'liability' : 'asset');
            const includeInNetWorth = account.includeInNetWorth == null ? true : !!account.includeInNetWorth;
            if (primary === 'liability') {
                const v = Math.abs(account.balance);
                totalLiabilities += v;
                if (includeInNetWorth) includedLiabilities += v;
            } else {
                const v = account.balance;
                accountAssets += v;
                if (includeInNetWorth) includedAccountAssets += v;
            }
        });

        let totalInvestmentValue = 0;
        let totalInvestmentCost = 0;

        investments.forEach(inv => {
            const marketValue = inv.quantity * inv.currentPrice;
            const cost = inv.quantity * inv.costPrice;
            totalInvestmentValue += marketValue;
            totalInvestmentCost += cost;
        });

        const totalAssets = accountAssets + totalInvestmentValue;
        const netWorth = (includedAccountAssets + totalInvestmentValue) - includedLiabilities;

        return {
            netWorth,
            assets: totalAssets,
            liabilities: totalLiabilities,
            investments: totalInvestmentValue,
            totalAssets,
            totalLiabilities,
            totalInvestmentValue,
            totalInvestmentCost,
            investmentProfit: totalInvestmentValue - totalInvestmentCost,
            investmentProfitRate: totalInvestmentCost > 0
                ? ((totalInvestmentValue - totalInvestmentCost) / totalInvestmentCost * 100)
                : 0
        };
    },

    /**
     * 记录当日快照
     * @returns {Promise}
     */
    async recordDailySnapshot() {
        const today = new Date().toISOString().split('T')[0];
        const stats = await this.calculateStats();

        if (this.mode === 'api') {
            await this._fetchJson('/api/snapshots', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    date: today,
                    ...stats
                })
            });
            return;
        }

        // 检查今天是否已有快照
        const snapshots = await this.getAllSnapshots();
        const todaySnapshot = snapshots.find(s => s.date === today);

        if (todaySnapshot) {
            // 更新今天的快照
            await new Promise((resolve, reject) => {
                const store = this.getStore(this.stores.snapshots, 'readwrite');
                const request = store.put({
                    ...todaySnapshot,
                    ...stats,
                    date: today,
                    updatedAt: new Date().toISOString()
                });
                request.onsuccess = () => resolve();
                request.onerror = () => reject(request.error);
            });
        } else {
            // 添加新快照
            await this.addSnapshot({
                date: today,
                ...stats
            });
        }
    }
};

// 导出
window.DB = DB;
