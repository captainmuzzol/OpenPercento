/**
 * Percento - 数据管理模块
 * CSV导入导出、WebDAV同步、密码锁
 */

const DataManager = {
    /**
     * 初始化数据管理模块
     */
    async init() {
        this.bindEvents();
        await this.loadWebDAVSettings();
        await this.checkPasswordLock();
    },
    
    /**
     * 绑定事件
     */
    bindEvents() {
        // 导出CSV
        document.getElementById('btnExportCSV').addEventListener('click', () => {
            this.exportToCSV();
        });
        
        // 导入CSV
        document.getElementById('btnImportCSV').addEventListener('click', () => {
            document.getElementById('csvFileInput').click();
        });
        
        document.getElementById('csvFileInput').addEventListener('change', async (e) => {
            if (e.target.files.length > 0) {
                await this.importFromCSV(e.target.files[0]);
                e.target.value = ''; // 重置input
            }
        });
        
        // WebDAV同步
        document.getElementById('btnWebdavSync').addEventListener('click', async () => {
            await this.syncWebDAV();
        });
        
        document.getElementById('btnWebdavTest').addEventListener('click', async () => {
            await this.testWebDAVConnection();
        });
        
        // 保存WebDAV设置变化
        ['webdavUrl', 'webdavUser', 'webdavPass'].forEach(id => {
            document.getElementById(id).addEventListener('change', () => {
                this.saveWebDAVSettings();
            });
        });
        
        // 密码锁开关
        document.getElementById('enablePassword').addEventListener('change', (e) => {
            const passwordSetup = document.getElementById('passwordSetup');
            if (e.target.checked) {
                passwordSetup.classList.remove('hidden');
            } else {
                passwordSetup.classList.add('hidden');
                this.removePassword();
            }
        });
        
        // 保存密码
        document.getElementById('btnSavePassword').addEventListener('click', async () => {
            await this.savePassword();
        });
        
        // 清除所有数据
        document.getElementById('btnClearData').addEventListener('click', () => {
            this.confirmClearData();
        });
        
        // 密码锁屏事件
        this.bindLockScreenEvents();
    },
    
    /**
     * 绑定密码锁屏事件
     */
    bindLockScreenEvents() {
        const pinPad = document.querySelector('.pin-pad');
        let enteredPin = '';
        
        pinPad.addEventListener('click', async (e) => {
            if (!e.target.classList.contains('pin-btn')) return;
            
            const num = e.target.dataset.num;
            
            if (num === 'clear') {
                enteredPin = enteredPin.slice(0, -1);
            } else if (num === 'ok') {
                const correctPin = await DB.getSetting('password');
                if (enteredPin === correctPin) {
                    document.getElementById('lockScreen').classList.add('hidden');
                    enteredPin = '';
                } else {
                    App.showToast(i18n.t('passwordIncorrect'), 'error');
                    enteredPin = '';
                }
            } else {
                if (enteredPin.length < 8) {
                    enteredPin += num;
                }
            }
            
            this.updatePinDots(enteredPin.length);
        });
    },
    
    /**
     * 更新密码点显示
     * @param {number} count 
     */
    updatePinDots(count) {
        const dots = document.querySelectorAll('.pin-dots .dot');
        dots.forEach((dot, index) => {
            if (index < count) {
                dot.classList.add('filled');
            } else {
                dot.classList.remove('filled');
            }
        });
    },
    
    /**
     * 检查密码锁状态
     */
    async checkPasswordLock() {
        const password = await DB.getSetting('password');
        const enabled = await DB.getSetting('passwordEnabled');
        
        if (enabled && password) {
            document.getElementById('lockScreen').classList.remove('hidden');
            document.getElementById('enablePassword').checked = true;
        } else {
            document.getElementById('lockScreen').classList.add('hidden');
            document.getElementById('enablePassword').checked = false;
        }
    },
    
    /**
     * 保存密码
     */
    async savePassword() {
        const newPassword = document.getElementById('newPassword').value;
        const confirmPassword = document.getElementById('confirmPassword').value;
        
        if (newPassword.length < 4) {
            App.showToast(i18n.currentLang === 'zh' ? '密码至少4位' : 'Password must be at least 4 digits', 'error');
            return;
        }
        
        if (newPassword !== confirmPassword) {
            App.showToast(i18n.t('passwordMismatch'), 'error');
            return;
        }
        
        await DB.saveSetting('password', newPassword);
        await DB.saveSetting('passwordEnabled', true);
        
        document.getElementById('newPassword').value = '';
        document.getElementById('confirmPassword').value = '';
        document.getElementById('passwordSetup').classList.add('hidden');
        
        App.showToast(i18n.t('passwordSet'));
    },
    
    /**
     * 移除密码
     */
    async removePassword() {
        await DB.saveSetting('password', null);
        await DB.saveSetting('passwordEnabled', false);
        App.showToast(i18n.currentLang === 'zh' ? '密码已移除' : 'Password removed');
    },
    
    // ==================== CSV 导入导出 ====================
    
    /**
     * 导出数据为CSV
     */
    async exportToCSV() {
        try {
            App.showLoading();
            
            const data = await DB.exportAllData();
            
            // 生成CSV内容
            let csvContent = '';
            
            // 账户数据
            csvContent += '=== ACCOUNTS ===\n';
            csvContent += 'id,name,group,balance,note,createdAt,updatedAt\n';
            data.accounts.forEach(a => {
                csvContent += `${a.id},"${this.escapeCsvField(a.name)}","${a.group}",${a.balance},"${this.escapeCsvField(a.note || '')}","${a.createdAt}","${a.updatedAt}"\n`;
            });
            
            // 交易记录
            csvContent += '\n=== TRANSACTIONS ===\n';
            csvContent += 'id,accountId,type,previousBalance,newBalance,amount,reason,date,createdAt\n';
            data.transactions.forEach(t => {
                csvContent += `${t.id},${t.accountId},"${t.type}",${t.previousBalance},${t.newBalance},${t.amount},"${this.escapeCsvField(t.reason || '')}","${t.date}","${t.createdAt}"\n`;
            });
            
            // 投资数据
            csvContent += '\n=== INVESTMENTS ===\n';
            csvContent += 'id,type,name,symbol,quantity,costPrice,currentPrice,note,createdAt,updatedAt\n';
            data.investments.forEach(inv => {
                csvContent += `${inv.id},"${inv.type}","${this.escapeCsvField(inv.name)}","${inv.symbol}",${inv.quantity},${inv.costPrice},${inv.currentPrice},"${this.escapeCsvField(inv.note || '')}","${inv.createdAt}","${inv.updatedAt}"\n`;
            });
            
            // 快照数据
            csvContent += '\n=== SNAPSHOTS ===\n';
            csvContent += 'id,date,netWorth,assets,liabilities,investments,createdAt\n';
            data.snapshots.forEach(s => {
                csvContent += `${s.id},"${s.date}",${s.netWorth},${s.assets},${s.liabilities},${s.totalInvestmentValue || 0},"${s.createdAt}"\n`;
            });
            
            // 下载文件
            const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `percento_backup_${new Date().toISOString().split('T')[0]}.csv`;
            link.click();
            URL.revokeObjectURL(url);
            
            App.hideLoading();
            App.showToast(i18n.t('dataExported'));
            
        } catch (error) {
            App.hideLoading();
            console.error('Export error:', error);
            App.showToast(i18n.currentLang === 'zh' ? '导出失败' : 'Export failed', 'error');
        }
    },
    
    /**
     * 从CSV导入数据
     * @param {File} file 
     */
    async importFromCSV(file) {
        try {
            App.showLoading();
            
            const text = await file.text();
            const data = this.parseCSV(text);
            
            if (!data.accounts && !data.investments) {
                throw new Error('Invalid CSV format');
            }
            
            // 导入数据
            await DB.importData(data);
            
            App.hideLoading();
            App.showToast(i18n.t('dataImported'));
            
            // 刷新应用
            await App.refreshAll();
            
        } catch (error) {
            App.hideLoading();
            console.error('Import error:', error);
            App.showToast(i18n.currentLang === 'zh' ? '导入失败，请检查文件格式' : 'Import failed, please check file format', 'error');
        }
    },
    
    /**
     * 解析CSV内容
     * @param {string} text 
     * @returns {Object}
     */
    parseCSV(text) {
        const lines = text.split('\n');
        const data = {
            accounts: [],
            transactions: [],
            investments: [],
            snapshots: [],
            settings: {}
        };
        
        let currentSection = null;
        let headers = [];
        
        lines.forEach(line => {
            line = line.trim();
            if (!line) return;
            
            // 检测段落标记
            if (line.startsWith('=== ACCOUNTS ===')) {
                currentSection = 'accounts';
                return;
            } else if (line.startsWith('=== TRANSACTIONS ===')) {
                currentSection = 'transactions';
                return;
            } else if (line.startsWith('=== INVESTMENTS ===')) {
                currentSection = 'investments';
                return;
            } else if (line.startsWith('=== SNAPSHOTS ===')) {
                currentSection = 'snapshots';
                return;
            }
            
            if (!currentSection) return;
            
            // 解析CSV行
            const values = this.parseCSVLine(line);
            
            // 第一行是表头
            if (values[0] === 'id' || values[0] === 'key') {
                headers = values;
                return;
            }
            
            // 构建对象
            const obj = {};
            headers.forEach((header, index) => {
                let value = values[index] || '';
                // 转换数字类型
                if (['id', 'accountId', 'balance', 'previousBalance', 'newBalance', 'amount', 
                     'quantity', 'costPrice', 'currentPrice', 'netWorth', 'assets', 'liabilities', 'investments'].includes(header)) {
                    value = parseFloat(value) || 0;
                }
                obj[header] = value;
            });
            
            if (currentSection && data[currentSection]) {
                data[currentSection].push(obj);
            }
        });
        
        return data;
    },
    
    /**
     * 解析单行CSV
     * @param {string} line 
     * @returns {Array}
     */
    parseCSVLine(line) {
        const result = [];
        let current = '';
        let inQuotes = false;
        
        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            
            if (char === '"') {
                if (inQuotes && line[i + 1] === '"') {
                    current += '"';
                    i++;
                } else {
                    inQuotes = !inQuotes;
                }
            } else if (char === ',' && !inQuotes) {
                result.push(current.trim());
                current = '';
            } else {
                current += char;
            }
        }
        
        result.push(current.trim());
        return result;
    },
    
    /**
     * 转义CSV字段
     * @param {string} field 
     * @returns {string}
     */
    escapeCsvField(field) {
        if (!field) return '';
        return field.replace(/"/g, '""');
    },
    
    // ==================== WebDAV 同步 ====================
    
    /**
     * 加载WebDAV设置
     */
    async loadWebDAVSettings() {
        const url = await DB.getSetting('webdavUrl', '');
        const user = await DB.getSetting('webdavUser', '');
        const pass = await DB.getSetting('webdavPass', '');
        
        document.getElementById('webdavUrl').value = url;
        document.getElementById('webdavUser').value = user;
        document.getElementById('webdavPass').value = pass;
    },
    
    /**
     * 保存WebDAV设置
     */
    async saveWebDAVSettings() {
        const url = document.getElementById('webdavUrl').value.trim();
        const user = document.getElementById('webdavUser').value.trim();
        const pass = document.getElementById('webdavPass').value;
        
        await DB.saveSetting('webdavUrl', url);
        await DB.saveSetting('webdavUser', user);
        await DB.saveSetting('webdavPass', pass);
    },
    
    /**
     * 测试WebDAV连接
     */
    async testWebDAVConnection() {
        const url = document.getElementById('webdavUrl').value.trim();
        const user = document.getElementById('webdavUser').value.trim();
        const pass = document.getElementById('webdavPass').value;
        
        if (!url) {
            App.showToast(i18n.currentLang === 'zh' ? '请输入WebDAV地址' : 'Please enter WebDAV URL', 'error');
            return;
        }
        
        App.showLoading();
        
        try {
            const response = await fetch(url, {
                method: 'PROPFIND',
                headers: {
                    'Authorization': 'Basic ' + btoa(user + ':' + pass),
                    'Depth': '0'
                }
            });
            
            App.hideLoading();
            
            if (response.ok || response.status === 207) {
                document.getElementById('syncStatus').textContent = i18n.t('connectionSuccess');
                document.getElementById('syncStatus').style.color = 'var(--color-success)';
                App.showToast(i18n.t('connectionSuccess'));
            } else {
                throw new Error('Connection failed');
            }
            
        } catch (error) {
            App.hideLoading();
            console.error('WebDAV test error:', error);
            document.getElementById('syncStatus').textContent = i18n.t('connectionFailed');
            document.getElementById('syncStatus').style.color = 'var(--color-danger)';
            App.showToast(i18n.t('connectionFailed'), 'error');
        }
    },
    
    /**
     * WebDAV同步
     */
    async syncWebDAV() {
        const url = document.getElementById('webdavUrl').value.trim();
        const user = document.getElementById('webdavUser').value.trim();
        const pass = document.getElementById('webdavPass').value;
        
        if (!url) {
            App.showToast(i18n.currentLang === 'zh' ? '请先配置WebDAV' : 'Please configure WebDAV first', 'error');
            return;
        }
        
        App.showLoading();
        
        try {
            // 导出数据
            const data = await DB.exportAllData();
            const jsonContent = JSON.stringify(data, null, 2);
            
            // 确保URL以/结尾
            const baseUrl = url.endsWith('/') ? url : url + '/';
            const fileUrl = baseUrl + 'percento_backup.json';
            
            // 上传到WebDAV
            const response = await fetch(fileUrl, {
                method: 'PUT',
                headers: {
                    'Authorization': 'Basic ' + btoa(user + ':' + pass),
                    'Content-Type': 'application/json'
                },
                body: jsonContent
            });
            
            App.hideLoading();
            
            if (response.ok || response.status === 201 || response.status === 204) {
                const now = new Date().toLocaleString();
                document.getElementById('syncStatus').textContent = 
                    `${i18n.t('syncSuccess')} - ${now}`;
                document.getElementById('syncStatus').style.color = 'var(--color-success)';
                App.showToast(i18n.t('syncSuccess'));
                
                await DB.saveSetting('lastSync', now);
            } else {
                throw new Error('Sync failed: ' + response.status);
            }
            
        } catch (error) {
            App.hideLoading();
            console.error('WebDAV sync error:', error);
            document.getElementById('syncStatus').textContent = i18n.t('syncFailed');
            document.getElementById('syncStatus').style.color = 'var(--color-danger)';
            App.showToast(i18n.t('syncFailed'), 'error');
        }
    },
    
    /**
     * 从WebDAV恢复数据
     */
    async restoreFromWebDAV() {
        const url = document.getElementById('webdavUrl').value.trim();
        const user = document.getElementById('webdavUser').value.trim();
        const pass = document.getElementById('webdavPass').value;
        
        if (!url) return;
        
        App.showLoading();
        
        try {
            const baseUrl = url.endsWith('/') ? url : url + '/';
            const fileUrl = baseUrl + 'percento_backup.json';
            
            const response = await fetch(fileUrl, {
                method: 'GET',
                headers: {
                    'Authorization': 'Basic ' + btoa(user + ':' + pass)
                }
            });
            
            if (response.ok) {
                const data = await response.json();
                await DB.importData(data);
                App.hideLoading();
                App.showToast(i18n.currentLang === 'zh' ? '数据恢复成功' : 'Data restored');
                await App.refreshAll();
            } else {
                throw new Error('Restore failed');
            }
            
        } catch (error) {
            App.hideLoading();
            console.error('WebDAV restore error:', error);
            App.showToast(i18n.currentLang === 'zh' ? '恢复失败' : 'Restore failed', 'error');
        }
    },
    
    // ==================== 数据清理 ====================
    
    /**
     * 确认清除数据
     */
    confirmClearData() {
        App.showConfirm(
            i18n.t('confirmClearData'),
            async () => {
                try {
                    await DB.clearAllData();
                    App.showToast(i18n.t('dataCleared'));
                    await App.refreshAll();
                } catch (error) {
                    console.error('Clear data error:', error);
                    App.showToast(i18n.currentLang === 'zh' ? '清除失败' : 'Clear failed', 'error');
                }
            }
        );
    }
};

// 导出
window.DataManager = DataManager;
