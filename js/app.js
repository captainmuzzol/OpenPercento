/**
 * OpenPercento - 主应用模块
 * 应用初始化、路由、通用功能、键盘快捷键
 */

const Charts = {
    charts: {},
    currentPeriod: 'month',
    colors: {
        primary: '#4A6FA5',
        success: '#8FBF9F',
        warning: '#F2B880',
        danger: '#E57373',
        gray: '#A0AEC0',
        palette: [
            '#4A6FA5', '#8FBF9F', '#F2B880', '#E57373',
            '#9F8FBF', '#8FBFBF', '#BF8F9F', '#A5A56F'
        ]
    },
    initialized: {
        dashboard: false,
        netWorth: false,
        assetPie: false,
        changes: false
    },
    async init() {
        this.bindEvents();
        await this.initDashboardChart();
    },
    bindEvents() {
        const chartTimeTabs = document.getElementById('chartTimeTabs');
        if (chartTimeTabs) {
            chartTimeTabs.addEventListener('click', (e) => {
                if (e.target.classList.contains('filter-tab')) {
                    document.querySelectorAll('#chartTimeTabs .filter-tab').forEach(tab => {
                        tab.classList.remove('active');
                    });
                    e.target.classList.add('active');
                    this.currentPeriod = e.target.dataset.period;
                    this.updateCharts();
                }
            });
        }

        const btnExportChart = document.getElementById('btnExportChart');
        if (btnExportChart) {
            btnExportChart.addEventListener('click', () => {
                this.exportCharts();
            });
        }
    },
    async initChartsPage() {
        if (typeof Chart !== 'undefined') {
            Chart.defaults.font.family = "'Inter', -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Arial, sans-serif";
            Chart.defaults.font.size = 12;
            Chart.defaults.color = getComputedStyle(document.documentElement).getPropertyValue('--color-text-secondary').trim() || '#718096';
        }

        if (!this.initialized.netWorth) {
            await this.initNetWorthChart();
            this.initialized.netWorth = true;
        }
        if (!this.initialized.assetPie) {
            await this.initNetWorthAllocationSquare();
            this.initialized.assetPie = true;
        }
        if (!this.initialized.changes) {
            await this.initChangesChart();
            this.initialized.changes = true;
        }
    },
    async initNetWorthChart() {
        const ctx = document.getElementById('netWorthChart');
        if (!ctx) return;

        const data = await this.getNetWorthData();

        this.charts.netWorth = new Chart(ctx, {
            type: 'line',
            data: {
                labels: data.labels,
                datasets: [{
                    label: i18n.t('netWorth'),
                    data: data.values,
                    borderColor: this.colors.primary,
                    backgroundColor: this.colors.primary + '20',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.3,
                    pointRadius: 3,
                    pointHoverRadius: 5,
                    pointBackgroundColor: this.colors.primary,
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    intersect: false,
                    mode: 'index'
                },
                plugins: {
                    legend: {
                        display: false
                    },
                    tooltip: {
                        backgroundColor: 'rgba(255, 255, 255, 0.95)',
                        titleColor: '#2D3748',
                        bodyColor: '#2D3748',
                        borderColor: '#E2E8F0',
                        borderWidth: 1,
                        padding: 12,
                        callbacks: {
                            label: (context) => {
                                return App.formatCurrency(context.raw);
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        grid: {
                            display: false,
                            drawBorder: false
                        }
                    },
                    y: {
                        grid: {
                            color: '#E2E8F0',
                            drawBorder: false
                        },
                        ticks: {
                            callback: (value) => {
                                return this.formatAxisValue(value);
                            }
                        }
                    }
                }
            }
        });
    },
    async initNetWorthAllocationSquare() {
        await this.updateNetWorthAllocationSquare();
    },
    async initChangesChart() {
        const ctx = document.getElementById('changesChart');
        if (!ctx) return;

        const data = await this.getFinancialChangesData();

        this.charts.changes = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: data.labels,
                datasets: [
                    {
                        label: i18n.currentLang === 'zh' ? '收入' : 'Income',
                        data: data.income,
                        backgroundColor: this.colors.success,
                        borderRadius: 4,
                        barPercentage: 0.6
                    },
                    {
                        label: i18n.currentLang === 'zh' ? '支出' : 'Expense',
                        data: data.expense,
                        backgroundColor: this.colors.danger,
                        borderRadius: 4,
                        barPercentage: 0.6
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    intersect: false,
                    mode: 'index'
                },
                plugins: {
                    legend: {
                        position: 'top',
                        align: 'end',
                        labels: {
                            boxWidth: 12,
                            boxHeight: 12,
                            padding: 16,
                            usePointStyle: true,
                            pointStyle: 'rect'
                        }
                    },
                    tooltip: {
                        backgroundColor: 'rgba(255, 255, 255, 0.95)',
                        titleColor: '#2D3748',
                        bodyColor: '#2D3748',
                        borderColor: '#E2E8F0',
                        borderWidth: 1,
                        padding: 12,
                        callbacks: {
                            label: (context) => {
                                return `${context.dataset.label}: ${App.formatCurrency(Math.abs(context.raw))}`;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        grid: {
                            display: false,
                            drawBorder: false
                        }
                    },
                    y: {
                        grid: {
                            color: '#E2E8F0',
                            drawBorder: false
                        },
                        ticks: {
                            callback: (value) => {
                                return this.formatAxisValue(value);
                            }
                        }
                    }
                }
            }
        });
    },
    async initDashboardChart() {
        if (this.initialized.dashboard) return;

        const ctx = document.getElementById('dashboardChart');
        if (!ctx) return;

        if (typeof Chart !== 'undefined') {
            Chart.defaults.font.family = "'Inter', -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Arial, sans-serif";
            Chart.defaults.font.size = 12;
        }

        const data = await this.getNetWorthData('week');

        this.charts.dashboard = new Chart(ctx, {
            type: 'line',
            data: {
                labels: data.labels,
                datasets: [{
                    data: data.values,
                    borderColor: this.colors.primary,
                    backgroundColor: this.colors.primary + '20',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.4,
                    pointRadius: 0,
                    pointHoverRadius: 4,
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: false
                    },
                    tooltip: {
                        enabled: true,
                        backgroundColor: 'rgba(255, 255, 255, 0.95)',
                        titleColor: '#2D3748',
                        bodyColor: '#2D3748',
                        borderColor: '#E2E8F0',
                        borderWidth: 1,
                        padding: 8,
                        displayColors: false,
                        callbacks: {
                            title: () => '',
                            label: (context) => {
                                return App.formatCurrency(context.raw);
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        display: false
                    },
                    y: {
                        display: false
                    }
                }
            }
        });
        this.initialized.dashboard = true;
    },
    async updateCharts() {
        await this.initChartsPage();

        await this.updateNetWorthChart();
        await this.updateNetWorthAllocationSquare();
        await this.updateChangesChart();
    },
    async updateNetWorthChart() {
        if (!this.charts.netWorth) return;

        const data = await this.getNetWorthData(this.currentPeriod);

        this.charts.netWorth.data.labels = data.labels;
        this.charts.netWorth.data.datasets[0].data = data.values;
        this.charts.netWorth.update('none');
    },
    async updateNetWorthAllocationSquare() {
        const container = document.getElementById('netWorthAllocationSquare');
        if (!container) return;

        const data = await this.getAssetAllocationData();
        const assetsItems = data.assetsItems || [];
        const assetsTotal = Number(data.assetsTotal) || 0;
        const liabilitiesTotal = Number(data.liabilitiesTotal) || 0;
        const grandTotal = Number(data.total) || 0;

        if (assetsTotal <= 0 && liabilitiesTotal <= 0) {
            container.innerHTML = `<div class="allocation-empty">${i18n.currentLang === 'zh' ? '暂无数据' : 'No data'}</div>`;
            return;
        }

        container.innerHTML = '';

        const layout = document.createElement('div');
        layout.className = `allocation-percento${liabilitiesTotal > 0 ? '' : ' no-liability'}`;

        let left = null;
        if (liabilitiesTotal > 0) {
            left = document.createElement('div');
            left.className = 'allocation-liability-col';
        }

        const right = document.createElement('div');
        right.className = 'allocation-assets-col';

        if (liabilitiesTotal > 0 && grandTotal > 0 && left) {
            const rawPct = (liabilitiesTotal / grandTotal) * 100;
            const pctText = rawPct < 1 ? '<1%' : `${Math.round(rawPct)}%`;
            const heightPct = Math.max(0, Math.min(100, (liabilitiesTotal / grandTotal) * 100));

            const bar = document.createElement('div');
            bar.className = 'allocation-liability-bar';
            bar.style.height = `${heightPct.toFixed(4)}%`;
            bar.style.backgroundColor = String(data.liabilityColor || '#E9CFC9');

            const label = document.createElement('div');
            label.className = 'allocation-seg-label bottom';

            const percentEl = document.createElement('div');
            percentEl.className = 'allocation-seg-percent';
            percentEl.textContent = pctText;
            if (rawPct < 15) percentEl.classList.add('small');

            const nameEl = document.createElement('div');
            nameEl.className = 'allocation-seg-name';
            nameEl.textContent = i18n.currentLang === 'zh' ? '负债' : 'Liabilities';
            if (rawPct < 15) nameEl.classList.add('small');

            label.appendChild(percentEl);
            label.appendChild(nameEl);
            left.appendChild(bar);
            left.appendChild(label);
        }

        if (assetsTotal > 0) {
            const labelLayer = document.createElement('div');
            labelLayer.className = 'allocation-label-layer';
            right.appendChild(labelLayer);

            let cumulative = 0;
            for (const item of assetsItems) {
                const v = Number(item.value) || 0;
                if (v <= 0) continue;

                const rawPct = (v / assetsTotal) * 100;
                const pctText = rawPct < 1 ? '<1%' : `${Math.round(rawPct)}%`;

                const seg = document.createElement('div');
                seg.className = 'allocation-asset-seg';
                seg.style.backgroundColor = String(item.color || '#E2E8F0');
                seg.style.flex = `${v}`;

                const label = document.createElement('div');
                label.className = 'allocation-seg-label';

                const percentEl = document.createElement('div');
                percentEl.className = 'allocation-seg-percent';
                percentEl.textContent = pctText;
                if (rawPct < 15) percentEl.classList.add('small');

                const nameEl = document.createElement('div');
                nameEl.className = 'allocation-seg-name';
                nameEl.textContent = String(item.label || '');
                if (rawPct < 15) nameEl.classList.add('small');

                label.appendChild(percentEl);
                label.appendChild(nameEl);

                const startRatio = cumulative / assetsTotal;
                label.dataset.ratio = String(startRatio);
                labelLayer.appendChild(label);
                right.appendChild(seg);

                cumulative += v;
            }

            requestAnimationFrame(() => {
                const h = right.clientHeight || 0;
                if (!h) return;
                const labels = Array.from(labelLayer.querySelectorAll('.allocation-seg-label'));
                for (const el of labels) {
                    const ratio = Number(el.dataset.ratio) || 0;
                    const desiredTop = ratio * h + 12;
                    const maxTop = Math.max(12, h - el.offsetHeight - 12);
                    const clamped = Math.max(12, Math.min(maxTop, desiredTop));
                    el.style.top = `${clamped}px`;
                }
            });
        }

        if (left) layout.appendChild(left);
        layout.appendChild(right);
        container.appendChild(layout);
    },

    layoutAllocationRects(items) {
        const total = items.reduce((s, it) => s + (Number(it.value) || 0), 0) || 1;
        const norm = items.map(it => ({ item: it, v: (Number(it.value) || 0) / total })).filter(x => x.v > 0);
        const n = norm.length;
        if (n === 0) return [];
        if (n === 1) return [{ x: 0, y: 0, w: 1, h: 1, item: norm[0].item }];
        if (n === 2) {
            const w0 = norm[0].v;
            return [
                { x: 0, y: 0, w: w0, h: 1, item: norm[0].item },
                { x: w0, y: 0, w: 1 - w0, h: 1, item: norm[1].item }
            ];
        }
        if (n === 3) {
            if (norm[0].v >= 0.5) {
                const w0 = norm[0].v;
                const rest = 1 - w0;
                const v1 = norm[1].v / rest;
                return [
                    { x: 0, y: 0, w: w0, h: 1, item: norm[0].item },
                    { x: w0, y: 0, w: rest, h: v1, item: norm[1].item },
                    { x: w0, y: v1, w: rest, h: 1 - v1, item: norm[2].item }
                ];
            }
            const h0 = norm[0].v;
            const rest = 1 - h0;
            const v1 = norm[1].v / rest;
            return [
                { x: 0, y: 0, w: 1, h: h0, item: norm[0].item },
                { x: 0, y: h0, w: v1, h: rest, item: norm[1].item },
                { x: v1, y: h0, w: 1 - v1, h: rest, item: norm[2].item }
            ];
        }
        const a = norm[0], b = norm[1], c = norm[2], d = norm[3];
        const topV = a.v + b.v;
        const bottomV = 1 - topV;
        const wa = topV > 0 ? (a.v / topV) : 0.5;
        const wc = bottomV > 0 ? (c.v / bottomV) : 0.5;
        return [
            { x: 0, y: 0, w: wa, h: topV, item: a.item },
            { x: wa, y: 0, w: 1 - wa, h: topV, item: b.item },
            { x: 0, y: topV, w: wc, h: bottomV, item: c.item },
            { x: wc, y: topV, w: 1 - wc, h: bottomV, item: d.item }
        ].filter(r => r.w > 0 && r.h > 0);
    },
    async updateChangesChart() {
        if (!this.charts.changes) return;

        const data = await this.getFinancialChangesData(this.currentPeriod);

        this.charts.changes.data.labels = data.labels;
        this.charts.changes.data.datasets[0].data = data.income;
        this.charts.changes.data.datasets[1].data = data.expense;
        this.charts.changes.update('none');
    },
    async updateDashboardChart() {
        if (!this.charts.dashboard) return;

        const data = await this.getNetWorthData('week');

        this.charts.dashboard.data.labels = data.labels;
        this.charts.dashboard.data.datasets[0].data = data.values;
        this.charts.dashboard.update('none');
    },
    async getNetWorthData(period = 'month') {
        const snapshots = await DB.getAllSnapshots();
        const { startDate, endDate, labelFormat } = this.getPeriodRange(period);

        const filteredSnapshots = snapshots.filter(s => {
            const date = new Date(s.date);
            return date >= startDate && date <= endDate;
        });

        if (filteredSnapshots.length === 0) {
            const stats = await DB.calculateStats();
            const today = new Date().toISOString().split('T')[0];
            return {
                labels: [this.formatDateLabel(today, labelFormat)],
                values: [stats.netWorth]
            };
        }

        const groupedData = this.groupDataByPeriod(filteredSnapshots, period);

        return {
            labels: groupedData.map(d => d.label),
            values: groupedData.map(d => d.value)
        };
    },
    async getAssetAllocationData() {
        const accounts = await DB.getAllAccounts();
        const investments = await DB.getAllInvestments();
        const includedAccounts = (accounts || []).filter(a => a && (a.includeInNetWorth == null ? true : !!a.includeInNetWorth));

        let currentTotal = 0;
        let fixedTotal = 0;
        let receivableTotal = 0;
        let liabilitiesTotal = 0;

        for (const account of includedAccounts) {
            const group = Accounts?.normalizeGroup ? Accounts.normalizeGroup(account.group) : null;
            const primary = group?.primary || String(account.group || '').split('/')[0];
            const balance = Number(account.balance) || 0;

            if (primary === 'liability') {
                const v = Math.abs(balance);
                if (v > 0) liabilitiesTotal += v;
                continue;
            }

            if (balance <= 0) continue;

            if (primary === 'current') currentTotal += balance;
            else if (primary === 'fixed') fixedTotal += balance;
            else if (primary === 'receivable') receivableTotal += balance;
            else fixedTotal += balance;
        }

        let investmentTotal = 0;
        for (const inv of (investments || [])) {
            if (!inv || !inv.type) continue;
            const marketValue = (Number(inv.quantity) || 0) * (Number(inv.currentPrice) || 0);
            if (marketValue <= 0) continue;
            investmentTotal += marketValue;
        }

        const assetsItems = [
            { key: 'current', label: i18n.t('groupCurrent'), value: currentTotal, color: '#F2DEB9' },
            { key: 'investment', label: i18n.t('investments'), value: investmentTotal, color: '#ECA0A0' },
            { key: 'fixed', label: i18n.t('groupFixed'), value: fixedTotal, color: '#7D8CC2' },
            { key: 'receivable', label: i18n.t('groupReceivable'), value: receivableTotal, color: '#C8D9F0' }
        ].filter(it => (Number(it.value) || 0) > 0);

        const assetsTotal = assetsItems.reduce((s, it) => s + (Number(it.value) || 0), 0);
        const total = assetsTotal + liabilitiesTotal;

        return {
            assetsItems,
            assetsTotal,
            liabilitiesTotal,
            total,
            liabilityColor: '#E9CFC9'
        };
    },
    async getFinancialChangesData(period = 'month') {
        const transactions = await DB.getAllTransactions();
        const { startDate, endDate } = this.getPeriodRange(period);

        const filteredTransactions = transactions.filter(t => {
            const date = new Date(t.date);
            return date >= startDate && date <= endDate;
        });

        const groupedData = {};

        filteredTransactions.forEach(t => {
            const dateKey = this.getDateGroupKey(t.date, period);
            if (!groupedData[dateKey]) {
                groupedData[dateKey] = { income: 0, expense: 0 };
            }

            if (t.amount > 0) {
                groupedData[dateKey].income += t.amount;
            } else {
                groupedData[dateKey].expense += Math.abs(t.amount);
            }
        });

        const sortedKeys = Object.keys(groupedData).sort();

        if (sortedKeys.length === 0) {
            return {
                labels: [i18n.currentLang === 'zh' ? '暂无数据' : 'No data'],
                income: [0],
                expense: [0]
            };
        }

        return {
            labels: sortedKeys.map(k => this.formatGroupKeyLabel(k, period)),
            income: sortedKeys.map(k => groupedData[k].income),
            expense: sortedKeys.map(k => groupedData[k].expense)
        };
    },
    getPeriodRange(period) {
        const now = new Date();
        let startDate, labelFormat;

        switch (period) {
            case 'week':
                startDate = new Date(now);
                startDate.setDate(now.getDate() - 7);
                labelFormat = 'day';
                break;
            case 'month':
                startDate = new Date(now);
                startDate.setMonth(now.getMonth() - 1);
                labelFormat = 'day';
                break;
            case 'quarter':
                startDate = new Date(now);
                startDate.setMonth(now.getMonth() - 3);
                labelFormat = 'week';
                break;
            case 'year':
                startDate = new Date(now);
                startDate.setFullYear(now.getFullYear() - 1);
                labelFormat = 'month';
                break;
            case 'all':
            default:
                startDate = new Date('2020-01-01');
                labelFormat = 'month';
                break;
        }

        return {
            startDate,
            endDate: now,
            labelFormat
        };
    },
    groupDataByPeriod(data, period) {
        const grouped = {};

        data.forEach(item => {
            const key = this.getDateGroupKey(item.date, period);
            if (!grouped[key] || new Date(item.date) > new Date(grouped[key].date)) {
                grouped[key] = {
                    label: this.formatGroupKeyLabel(key, period),
                    value: item.netWorth,
                    date: item.date
                };
            }
        });

        return Object.values(grouped).sort((a, b) => new Date(a.date) - new Date(b.date));
    },
    getDateGroupKey(dateStr, period) {
        const date = new Date(dateStr);

        switch (period) {
            case 'week':
            case 'month':
                return dateStr.substring(0, 10);
            case 'quarter':
                const weekNum = this.getWeekNumber(date);
                return `${date.getFullYear()}-W${weekNum}`;
            case 'year':
            case 'all':
                return dateStr.substring(0, 7);
            default:
                return dateStr.substring(0, 10);
        }
    },
    formatGroupKeyLabel(key) {
        if (key.includes('-W')) {
            const [, week] = key.split('-W');
            return i18n.currentLang === 'zh' ? `${week}周` : `W${week}`;
        }

        if (key.length === 7) {
            const [, month] = key.split('-');
            return i18n.currentLang === 'zh' ? `${month}月` : `${month}`;
        }

        const date = new Date(key);
        return `${date.getMonth() + 1}/${date.getDate()}`;
    },
    formatDateLabel(dateStr, format) {
        const date = new Date(dateStr);

        switch (format) {
            case 'day':
                return `${date.getMonth() + 1}/${date.getDate()}`;
            case 'week':
                return `W${this.getWeekNumber(date)}`;
            case 'month':
                return i18n.currentLang === 'zh'
                    ? `${date.getMonth() + 1}月`
                    : date.toLocaleDateString('en', { month: 'short' });
            default:
                return dateStr.substring(5);
        }
    },
    getWeekNumber(date) {
        const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
        const dayNum = d.getUTCDay() || 7;
        d.setUTCDate(d.getUTCDate() + 4 - dayNum);
        const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
        return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    },
    formatAxisValue(value) {
        if (Math.abs(value) >= 10000) {
            return (value / 10000).toFixed(1) + (i18n.currentLang === 'zh' ? '万' : 'W');
        }
        return value.toLocaleString();
    },
    exportCharts() {
        if (this.charts.netWorth) {
            const link = document.createElement('a');
            link.download = `percento_networth_${new Date().toISOString().split('T')[0]}.png`;
            link.href = this.charts.netWorth.toBase64Image();
            link.click();
        }

        if (this.charts.assetPie) {
            setTimeout(() => {
                const link = document.createElement('a');
                link.download = `percento_allocation_${new Date().toISOString().split('T')[0]}.png`;
                link.href = this.charts.assetPie.toBase64Image();
                link.click();
            }, 500);
        }

        App.showToast(i18n.currentLang === 'zh' ? '图表已导出' : 'Charts exported');
    }
};

const Recurring = {
    context: { kind: null, accountId: null, investmentId: null },
    cache: { accounts: [], investments: [] },

    async init() {
        const actionEl = document.getElementById('recurringAction');
        const freqEl = document.getElementById('recurringFrequency');
        const saveBtn = document.getElementById('btnSaveRecurring');
        const listEl = document.getElementById('recurringList');

        actionEl?.addEventListener('change', () => this.updateFormVisibility());
        freqEl?.addEventListener('change', () => this.updateFormVisibility());

        saveBtn?.addEventListener('click', async () => {
            await this.saveFromForm();
        });

        listEl?.addEventListener('click', async (e) => {
            const item = e.target.closest('.recurring-item');
            if (!item) return;
            const id = parseInt(item.dataset.id, 10);
            if (!id) return;

            if (e.target.closest('[data-action="toggle"]')) {
                await this.toggleRule(id);
            }
            if (e.target.closest('[data-action="delete"]')) {
                await this.deleteRule(id);
            }
        });

        setInterval(() => {
            this.runDue().catch(() => { });
        }, 5 * 60 * 1000);

        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) {
                this.runDue().catch(() => { });
            }
        });
    },

    async openForAccount(accountId) {
        this.context = { kind: 'account', accountId: Number(accountId), investmentId: null };
        await this.open();
    },

    async openForInvestment(investmentId) {
        this.context = { kind: 'investment', accountId: null, investmentId: Number(investmentId) };
        await this.open();
    },

    async open() {
        const modal = document.getElementById('recurringModal');
        const title = document.getElementById('recurringModalTitle');
        const kindEl = document.getElementById('recurringKind');
        const accountIdEl = document.getElementById('recurringAccountId');
        const investmentIdEl = document.getElementById('recurringInvestmentId');

        if (!modal || !kindEl || !accountIdEl || !investmentIdEl) return;

        kindEl.value = this.context.kind || '';
        accountIdEl.value = this.context.accountId ? String(this.context.accountId) : '';
        investmentIdEl.value = this.context.investmentId ? String(this.context.investmentId) : '';

        await this.refreshCache();
        await this.populateAccountSelects();

        const actionEl = document.getElementById('recurringAction');
        if (actionEl) {
            if (this.context.kind === 'investment') {
                actionEl.value = 'dca';
            } else {
                actionEl.value = 'income';
            }
        }
        const freqEl = document.getElementById('recurringFrequency');
        if (freqEl) freqEl.value = 'daily';

        if (title) {
            title.textContent = this.context.kind === 'investment' ? i18n.t('dca') : i18n.t('recurring');
        }

        this.updateFormVisibility();
        await this.renderList();
        App.openModal(modal);
    },

    async refreshCache() {
        const [accounts, investments] = await Promise.all([DB.getAllAccounts(), DB.getAllInvestments()]);
        this.cache.accounts = accounts || [];
        this.cache.investments = investments || [];
    },

    async populateAccountSelects() {
        const fromEl = document.getElementById('recurringFromAccount');
        const toEl = document.getElementById('recurringToAccount');
        if (fromEl) {
            fromEl.innerHTML = this.cache.accounts.map(a => `<option value="${a.id}">${this.escapeHtml(a.name)}</option>`).join('');
        }
        if (toEl) {
            const exclude = this.context.kind === 'account' ? this.context.accountId : null;
            toEl.innerHTML = this.cache.accounts
                .filter(a => !exclude || Number(a.id) !== Number(exclude))
                .map(a => `<option value="${a.id}">${this.escapeHtml(a.name)}</option>`).join('');
        }
    },

    updateFormVisibility() {
        const kind = document.getElementById('recurringKind')?.value || '';
        const action = document.getElementById('recurringAction')?.value || '';
        const freq = document.getElementById('recurringFrequency')?.value || '';

        const weekdayGroup = document.getElementById('recurringWeekdayGroup');
        const monthdayGroup = document.getElementById('recurringMonthdayGroup');
        const yeardayGroup = document.getElementById('recurringYeardayGroup');
        const fromGroup = document.getElementById('recurringFromAccountGroup');
        const toGroup = document.getElementById('recurringToAccountGroup');

        weekdayGroup?.classList.toggle('hidden', freq !== 'weekly');
        monthdayGroup?.classList.toggle('hidden', freq !== 'monthly');
        yeardayGroup?.classList.toggle('hidden', freq !== 'yearly');

        if (kind === 'investment') {
            if (document.getElementById('recurringAction')) document.getElementById('recurringAction').value = 'dca';
            fromGroup?.classList.toggle('hidden', false);
            toGroup?.classList.toggle('hidden', true);
            const actionEl = document.getElementById('recurringAction');
            if (actionEl) {
                Array.from(actionEl.options || []).forEach(opt => {
                    opt.disabled = opt.value !== 'dca';
                });
            }
            return;
        }

        const actionEl = document.getElementById('recurringAction');
        if (actionEl) {
            Array.from(actionEl.options || []).forEach(opt => {
                opt.disabled = opt.value === 'dca';
            });
            if (actionEl.value === 'dca') actionEl.value = 'income';
        }

        fromGroup?.classList.toggle('hidden', true);
        toGroup?.classList.toggle('hidden', action !== 'transfer');
    },

    async renderList() {
        const listEl = document.getElementById('recurringList');
        if (!listEl) return;

        const { kind, accountId, investmentId } = this.context;
        const rules = await DB.getRecurringRules({ kind, accountId, investmentId });

        if (!rules || rules.length === 0) {
            listEl.innerHTML = `<p class="muted">${i18n.t('noSchedules')}</p>`;
            return;
        }

        const sorted = [...rules].sort((a, b) => String(a.nextRun || '').localeCompare(String(b.nextRun || '')));
        listEl.innerHTML = sorted.map(r => {
            const enabled = !!r.enabled;
            const tag = enabled ? i18n.t('disabled') : i18n.t('enabled');
            return `
                <div class="history-item recurring-item" data-id="${r.id}">
                    <span class="history-date">${this.escapeHtml(String(r.nextRun || '-'))}</span>
                    <span class="history-reason">${this.escapeHtml(this.describeRule(r))}</span>
                    <span class="history-balance">
                        <button type="button" class="btn btn-secondary" data-action="toggle">${this.escapeHtml(tag)}</button>
                        <button type="button" class="btn btn-danger" data-action="delete">${this.escapeHtml(i18n.t('delete'))}</button>
                    </span>
                </div>
            `;
        }).join('');
    },

    describeRule(r) {
        const freq = r.frequency;
        let freqLabel = freq;
        if (freq === 'daily') freqLabel = i18n.t('freqDaily');
        if (freq === 'weekly') freqLabel = i18n.t('freqWeekly');
        if (freq === 'monthly') freqLabel = i18n.t('freqMonthly');
        if (freq === 'yearly') freqLabel = i18n.t('freqYearly');

        let detail = '';
        if (freq === 'weekly') {
            const map = {
                1: i18n.t('weekdayMon'),
                2: i18n.t('weekdayTue'),
                3: i18n.t('weekdayWed'),
                4: i18n.t('weekdayThu'),
                5: i18n.t('weekdayFri'),
                6: i18n.t('weekdaySat'),
                0: i18n.t('weekdaySun')
            };
            detail = map[Number(r.weekday)] || '';
        }
        if (freq === 'monthly') detail = `${i18n.t('monthDay')} ${Number(r.monthDay || 1)}`;
        if (freq === 'yearly') detail = `${i18n.t('yearDay')} ${Number(r.yearDay || 1)}`;

        if (r.action === 'income') {
            return `${i18n.t('scheduleIncome')} · ${freqLabel}${detail ? ' · ' + detail : ''} · ${App.formatCurrency(Number(r.amount || 0))}${r.note ? ' · ' + r.note : ''}`;
        }
        if (r.action === 'transfer') {
            const fromName = this.cache.accounts.find(a => Number(a.id) === Number(r.fromAccountId || r.accountId))?.name || '-';
            const toName = this.cache.accounts.find(a => Number(a.id) === Number(r.toAccountId))?.name || '-';
            return `${i18n.t('scheduleTransfer')} · ${freqLabel}${detail ? ' · ' + detail : ''} · ${fromName} → ${toName} · ${App.formatCurrency(Number(r.amount || 0))}${r.note ? ' · ' + r.note : ''}`;
        }
        if (r.action === 'dca') {
            const fromName = this.cache.accounts.find(a => Number(a.id) === Number(r.fromAccountId))?.name || '-';
            const invName = this.cache.investments.find(i => Number(i.id) === Number(r.investmentId))?.name || '-';
            return `${i18n.t('dca')} · ${freqLabel}${detail ? ' · ' + detail : ''} · ${fromName} → ${invName} · ${App.formatCurrency(Number(r.amount || 0))}${r.note ? ' · ' + r.note : ''}`;
        }
        return `${freqLabel}${detail ? ' · ' + detail : ''} · ${App.formatCurrency(Number(r.amount || 0))}`;
    },

    async saveFromForm() {
        const kind = document.getElementById('recurringKind')?.value || '';
        const accountId = parseInt(document.getElementById('recurringAccountId')?.value || '', 10) || null;
        const investmentId = parseInt(document.getElementById('recurringInvestmentId')?.value || '', 10) || null;
        const action = document.getElementById('recurringAction')?.value || '';
        const frequency = document.getElementById('recurringFrequency')?.value || 'daily';
        const weekday = parseInt(document.getElementById('recurringWeekday')?.value || '1', 10);
        const monthDay = parseInt(document.getElementById('recurringMonthDay')?.value || '1', 10);
        const yearDay = parseInt(document.getElementById('recurringYearDay')?.value || '1', 10);
        const fromAccountId = parseInt(document.getElementById('recurringFromAccount')?.value || '', 10) || null;
        const toAccountId = parseInt(document.getElementById('recurringToAccount')?.value || '', 10) || null;
        const amount = parseFloat(document.getElementById('recurringAmount')?.value || '0') || 0;
        const note = (document.getElementById('recurringNote')?.value || '').trim();

        if (!amount || amount <= 0) {
            App.showToast(i18n.currentLang === 'zh' ? '请输入有效金额' : 'Please enter a valid amount', 'error');
            return;
        }

        const base = {
            kind,
            action,
            accountId: kind === 'account' ? accountId : null,
            fromAccountId: null,
            toAccountId: null,
            investmentId: kind === 'investment' ? investmentId : null,
            frequency,
            weekday: frequency === 'weekly' ? weekday : null,
            monthDay: frequency === 'monthly' ? monthDay : null,
            yearDay: frequency === 'yearly' ? yearDay : null,
            amount,
            note,
            enabled: true
        };

        if (kind === 'account') {
            if (!accountId) return;
            if (action === 'transfer') {
                if (!toAccountId || Number(toAccountId) === Number(accountId)) {
                    App.showToast(i18n.currentLang === 'zh' ? '请选择转入账户' : 'Select destination account', 'error');
                    return;
                }
                base.fromAccountId = accountId;
                base.toAccountId = toAccountId;
            }
        }

        if (kind === 'investment') {
            if (!investmentId) return;
            if (!fromAccountId) {
                App.showToast(i18n.currentLang === 'zh' ? '请选择转出账户' : 'Select source account', 'error');
                return;
            }
            base.action = 'dca';
            base.fromAccountId = fromAccountId;
        }

        base.nextRun = this.computeInitialNextRun(base);
        const id = await DB.addRecurringRule(base);
        if (id) {
            App.showToast(i18n.t('scheduleSaved'));
            await this.renderList();
        }
    },

    computeInitialNextRun(rule) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const freq = rule.frequency;
        if (freq === 'daily') return this.toDateStr(today);

        if (freq === 'weekly') {
            const target = Number(rule.weekday ?? 1);
            const d = new Date(today);
            while (d.getDay() !== target) d.setDate(d.getDate() + 1);
            return this.toDateStr(d);
        }

        if (freq === 'monthly') {
            const day = Math.min(31, Math.max(1, Number(rule.monthDay || 1)));
            const d = new Date(today);
            const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
            const runDay = Math.min(day, last);
            d.setDate(runDay);
            if (d < today) {
                d.setMonth(d.getMonth() + 1);
                const last2 = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
                d.setDate(Math.min(day, last2));
            }
            return this.toDateStr(d);
        }

        const dayOfYearInput = Math.min(366, Math.max(1, Number(rule.yearDay || 1)));
        const clampForYear = (year) => {
            const isLeap = (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
            const max = isLeap ? 366 : 365;
            return Math.min(dayOfYearInput, max);
        };

        const y = today.getFullYear();
        let d = new Date(y, 0, 1);
        d.setDate(d.getDate() + clampForYear(y) - 1);
        if (d < today) {
            const y2 = y + 1;
            d = new Date(y2, 0, 1);
            d.setDate(d.getDate() + clampForYear(y2) - 1);
        }
        return this.toDateStr(d);
    },

    async toggleRule(id) {
        const rule = await this.getRuleById(id);
        if (!rule) return;
        rule.enabled = !rule.enabled;
        await DB.updateRecurringRule(rule);
        await this.renderList();
    },

    async deleteRule(id) {
        App.showConfirm(i18n.currentLang === 'zh' ? '确定删除该周期任务吗？' : 'Delete this schedule?', async () => {
            await DB.deleteRecurringRule(id);
            App.showToast(i18n.t('scheduleDeleted'));
            await this.renderList();
        });
    },

    async getRuleById(id) {
        const rules = await DB.getAllRecurringRules();
        return (rules || []).find(r => Number(r.id) === Number(id)) || null;
    },

    toDateStr(d) {
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd}`;
    },

    escapeHtml(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    },

    async runDue() {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayStr = this.toDateStr(today);
        const rules = await DB.getAllRecurringRules();
        const enabledRules = (rules || []).filter(r => !!r.enabled);
        if (enabledRules.length === 0) return;

        let changed = false;
        for (const rule of enabledRules) {
            let nextRun = String(rule.nextRun || '');
            if (!nextRun) {
                rule.nextRun = this.computeInitialNextRun(rule);
                nextRun = rule.nextRun;
                await DB.updateRecurringRule(rule);
            }

            let guard = 0;
            while (nextRun && nextRun <= todayStr && guard < 366) {
                const ran = await this.executeRule(rule, nextRun);
                if (!ran) break;
                rule.lastRun = nextRun;
                rule.nextRun = this.computeNextRun(rule, nextRun);
                nextRun = rule.nextRun;
                await DB.updateRecurringRule(rule);
                changed = true;
                guard += 1;
            }
        }

        if (changed) {
            await DB.recordDailySnapshot();
            if (window.App && typeof App.refreshAll === 'function') {
                await App.refreshAll();
            }
        }
    },

    computeNextRun(rule, currentDateStr) {
        const base = new Date(currentDateStr + 'T00:00:00');
        base.setHours(0, 0, 0, 0);
        const freq = rule.frequency;

        if (freq === 'daily') {
            base.setDate(base.getDate() + 1);
            return this.toDateStr(base);
        }

        if (freq === 'weekly') {
            base.setDate(base.getDate() + 7);
            return this.toDateStr(base);
        }

        if (freq === 'monthly') {
            const day = Math.min(31, Math.max(1, Number(rule.monthDay || 1)));
            const d = new Date(base.getFullYear(), base.getMonth() + 1, 1);
            const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
            d.setDate(Math.min(day, last));
            return this.toDateStr(d);
        }

        const dayOfYearInput = Math.min(366, Math.max(1, Number(rule.yearDay || 1)));
        const year = base.getFullYear() + 1;
        const isLeap = (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
        const max = isLeap ? 366 : 365;
        const dayOfYear = Math.min(dayOfYearInput, max);
        const d = new Date(year, 0, 1);
        d.setDate(d.getDate() + dayOfYear - 1);
        return this.toDateStr(d);
    },

    async executeRule(rule, dateStr) {
        if (rule.action === 'income' && rule.accountId) {
            const account = await DB.getAccount(Number(rule.accountId));
            if (!account) return false;
            const prev = Number(account.balance || 0);
            account.balance = prev + Number(rule.amount || 0);
            await DB.updateAccount(account);
            await DB.addTransaction({
                accountId: Number(account.id),
                type: 'recurring_income',
                previousBalance: prev,
                newBalance: account.balance,
                amount: Number(rule.amount || 0),
                reason: rule.note || (i18n.currentLang === 'zh' ? '周期入账' : 'Recurring income'),
                date: dateStr
            });
            return true;
        }

        if (rule.action === 'transfer' && (rule.fromAccountId || rule.accountId) && rule.toAccountId) {
            const fromId = Number(rule.fromAccountId || rule.accountId);
            const toId = Number(rule.toAccountId);
            if (fromId === toId) return false;
            const amount = Number(rule.amount || 0);
            if (!amount || amount <= 0) return false;

            const fromAccount = await DB.getAccount(fromId);
            const toAccount = await DB.getAccount(toId);
            if (!fromAccount || !toAccount) return false;

            const fromPrev = Number(fromAccount.balance || 0);
            const toPrev = Number(toAccount.balance || 0);

            fromAccount.balance = fromPrev - amount;
            toAccount.balance = toPrev + amount;
            await DB.updateAccount(fromAccount);
            await DB.updateAccount(toAccount);

            const note = rule.note || `${i18n.currentLang === 'zh' ? '周期转账' : 'Recurring transfer'}: ${fromAccount.name} → ${toAccount.name}`;
            await DB.addTransaction({
                accountId: fromId,
                type: 'recurring_transfer_out',
                previousBalance: fromPrev,
                newBalance: fromAccount.balance,
                amount: -amount,
                reason: note,
                date: dateStr
            });
            await DB.addTransaction({
                accountId: toId,
                type: 'recurring_transfer_in',
                previousBalance: toPrev,
                newBalance: toAccount.balance,
                amount: amount,
                reason: note,
                date: dateStr
            });
            return true;
        }

        if (rule.action === 'dca' && rule.fromAccountId && rule.investmentId) {
            const fromId = Number(rule.fromAccountId);
            const invId = Number(rule.investmentId);
            const amount = Number(rule.amount || 0);
            if (!amount || amount <= 0) return false;

            const fromAccount = await DB.getAccount(fromId);
            const inv = await DB.getInvestment(invId);
            if (!fromAccount || !inv) return false;

            if (inv.type === 'wealth') {
                const lastAccruedDate = inv.lastAccruedDate
                    || inv.purchaseDate
                    || (inv.createdAt ? String(inv.createdAt).split('T')[0] : dateStr);
                const annualRate = Number(inv.annualInterestRate || 0) || 0;
                const dailyRate = annualRate > 0 ? (annualRate / 100 / 365) : 0;
                const principal = Number(inv.quantity || 0) || 0;
                const prevFactor = Number(inv.currentPrice || 0) || 1;
                const prevAmount = principal > 0 ? (principal * prevFactor) : 0;
                const days = typeof Investments?.diffDays === 'function'
                    ? Investments.diffDays(lastAccruedDate, dateStr)
                    : 0;
                const accruedAmount = (dailyRate > 0 && days > 0)
                    ? (prevAmount * (1 + dailyRate * days))
                    : prevAmount;

                const fromPrev = Number(fromAccount.balance || 0);
                fromAccount.balance = fromPrev - amount;
                await DB.updateAccount(fromAccount);
                await DB.addTransaction({
                    accountId: fromId,
                    type: 'dca_out',
                    previousBalance: fromPrev,
                    newBalance: fromAccount.balance,
                    amount: -amount,
                    reason: rule.note || `${i18n.currentLang === 'zh' ? '定投' : 'DCA'}: ${fromAccount.name} → ${inv.name}`,
                    date: dateStr
                });

                const newPrincipal = principal + amount;
                const newAmount = accruedAmount + amount;
                inv.quantity = newPrincipal;
                inv.costPrice = 1;
                inv.currentPrice = newPrincipal > 0 ? (newAmount / newPrincipal) : 1;
                inv.lastAccruedDate = dateStr;
                await DB.updateInvestment(inv);
                return true;
            }

            const price = Number(inv.currentPrice || 0) || Number(inv.costPrice || 0);
            if (!price || price <= 0) {
                App.showToast(i18n.t('scheduleRunSkipped'), 'error');
                return false;
            }

            const qtyAdd = amount / price;
            const oldQty = Number(inv.quantity || 0);
            const oldCostPrice = Number(inv.costPrice || 0);
            const newQty = oldQty + qtyAdd;
            const newCostPrice = newQty > 0 ? ((oldQty * oldCostPrice) + (qtyAdd * price)) / newQty : oldCostPrice;

            const fromPrev = Number(fromAccount.balance || 0);
            fromAccount.balance = fromPrev - amount;
            await DB.updateAccount(fromAccount);
            await DB.addTransaction({
                accountId: fromId,
                type: 'dca_out',
                previousBalance: fromPrev,
                newBalance: fromAccount.balance,
                amount: -amount,
                reason: rule.note || `${i18n.currentLang === 'zh' ? '定投' : 'DCA'}: ${fromAccount.name} → ${inv.name}`,
                date: dateStr
            });

            inv.quantity = newQty;
            inv.costPrice = newCostPrice;
            await DB.updateInvestment(inv);
            return true;
        }

        return false;
    }
};

const App = {
    currentPage: 'dashboard',
    currencySymbol: '¥',

    /**
     * 初始化应用
     */
    async init() {
        try {
            // 显示加载状态
            this.showLoading();

            // 初始化数据库
            await DB.init();

            // 执行数据迁移
            await DB.migrateData();

            // 初始化国际化
            i18n.init();

            // 初始化设置
            await Settings.init();

            await Recurring.init();
            await Recurring.runDue();

            // 更新货币符号
            const currency = await Settings.getCurrentCurrency();
            this.currencySymbol = Settings.getCurrencySymbol(currency);

            // 初始化各模块
            await Accounts.init();
            await Investments.init();
            await Charts.init();
            await DataManager.init();

            // 更新仪表盘统计
            await this.updateDashboardStats();
            await Charts.updateCharts();

            // 记录当日快照
            await DB.recordDailySnapshot();

            // 绑定全局事件
            this.bindGlobalEvents();

            // 隐藏加载状态
            this.hideLoading();

            console.log('OpenPercento initialized successfully');

        } catch (error) {
            console.error('Initialization error:', error);
            this.hideLoading();
            this.showToast('初始化失败，请刷新页面重试', 'error');
        }
    },

    /**
     * 绑定全局事件
     */
    bindGlobalEvents() {
        // 导航菜单
        document.querySelectorAll('.nav-item[data-page]').forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                this.navigateTo(item.dataset.page);
            });
        });

        // 模态框关闭
        document.querySelectorAll('.modal-close, .modal-cancel, .modal-overlay').forEach(el => {
            el.addEventListener('click', (e) => {
                const modal = e.target.closest('.modal');
                if (modal) {
                    this.closeModal(modal);
                }
            });
        });

        // 键盘快捷键
        document.addEventListener('keydown', (e) => {
            this.handleKeyboardShortcut(e);
        });

        // ESC 关闭模态框
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                const openModal = document.querySelector('.modal:not(.hidden)');
                if (openModal && openModal.id !== 'lockScreen') {
                    this.closeModal(openModal);
                }
            }
        });

        // 确认对话框
        document.getElementById('confirmOk').addEventListener('click', () => {
            if (this.confirmCallback) {
                this.confirmCallback();
            }
            this.closeModal(document.getElementById('confirmModal'));
        });
    },

    /**
     * 处理键盘快捷键
     * @param {KeyboardEvent} e 
     */
    handleKeyboardShortcut(e) {
        // 如果有模态框打开，不处理快捷键
        const openModal = document.querySelector('.modal:not(.hidden)');
        if (openModal && openModal.id !== 'lockScreen') return;

        // Ctrl/Cmd + N: 新建账户
        if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
            e.preventDefault();
            if (this.currentPage === 'accounts') {
                Accounts.openAccountModal();
            } else if (this.currentPage === 'investments') {
                Investments.openInvestmentModal();
            } else {
                Accounts.openAccountModal();
            }
        }

        // Ctrl/Cmd + U: 更新余额
        if ((e.ctrlKey || e.metaKey) && e.key === 'u') {
            e.preventDefault();
            Accounts.openBalanceModal();
        }

        // Ctrl/Cmd + S: 保存（触发表单提交）
        if ((e.ctrlKey || e.metaKey) && e.key === 's') {
            e.preventDefault();
            const openModal = document.querySelector('.modal:not(.hidden)');
            if (openModal) {
                const form = openModal.querySelector('form');
                if (form) {
                    form.dispatchEvent(new Event('submit', { cancelable: true }));
                }
            }
        }

        // 数字键 1-6: 快速导航
        if (!e.ctrlKey && !e.metaKey && !e.altKey) {
            const lockScreen = document.getElementById('lockScreen');
            if (lockScreen && !lockScreen.classList.contains('hidden')) {
                return;
            }
            if (this.currentPage === 'settings') {
                return;
            }
            const pages = ['dashboard', 'accounts', 'investments', 'settings'];
            const num = parseInt(e.key);
            if (num >= 1 && num <= 4) {
                this.navigateTo(pages[num - 1]);
            }
        }
    },

    /**
     * 页面导航
     * @param {string} page 
     */
    navigateTo(page) {
        this.currentPage = page;

        // 更新导航状态
        document.querySelectorAll('.nav-item').forEach(item => {
            item.classList.toggle('active', item.dataset.page === page);
        });

        // 显示对应页面
        document.querySelectorAll('.page').forEach(p => {
            p.classList.remove('active');
        });

        const pageEl = document.getElementById('page' + this.capitalize(page));
        if (pageEl) {
            pageEl.classList.add('active');
        }

        // 页面切换时刷新数据
        this.onPageChange(page);
    },

    /**
     * 页面切换回调
     * @param {string} page 
     */
    async onPageChange(page) {
        switch (page) {
            case 'dashboard':
                await this.updateDashboardStats();
                await Accounts.renderDashboardAccounts();
                await Charts.updateDashboardChart();
                await Charts.updateCharts();
                break;
            case 'accounts':
                await Accounts.renderAccountList();
                break;
            case 'investments':
                await Investments.renderInvestmentList();
                await Investments.updateSummary();
                break;
        }
    },

    /**
     * 更新仪表盘统计数据
     */
    async updateDashboardStats() {
        const stats = await DB.calculateStats();

        // 更新币种符号
        const currency = await Settings.getCurrentCurrency();
        this.currencySymbol = Settings.getCurrencySymbol(currency);

        // 更新仪表盘数值
        document.getElementById('dashboardNetWorth').textContent = this.formatCurrency(stats.netWorth);
        document.getElementById('dashboardAssets').textContent = this.formatCurrency(stats.totalAssets);
        document.getElementById('dashboardLiabilities').textContent = this.formatCurrency(stats.totalLiabilities);
        document.getElementById('dashboardInvestments').textContent = this.formatCurrency(stats.totalInvestmentValue);

        const sidebarNetWorth = document.getElementById('sidebarNetWorth');
        if (sidebarNetWorth) sidebarNetWorth.textContent = this.formatCurrency(stats.netWorth);

        if (typeof Charts?.updateNetWorthAllocationSquare === 'function') {
            await Charts.updateNetWorthAllocationSquare();
        }

        // 计算净资产变化（与上一个快照比较）
        const latestSnapshot = await DB.getLatestSnapshot();
        if (latestSnapshot && latestSnapshot.netWorth !== stats.netWorth) {
            const change = ((stats.netWorth - latestSnapshot.netWorth) / Math.abs(latestSnapshot.netWorth || 1)) * 100;
            const changeEl = document.getElementById('netWorthChange');
            changeEl.textContent = (change >= 0 ? '+' : '') + change.toFixed(2) + '%';
            changeEl.className = 'stat-change ' + (change >= 0 ? 'positive' : 'negative');
        }

        // 更新投资收益率
        const investmentChangeEl = document.getElementById('investmentChange');
        investmentChangeEl.textContent = (stats.investmentProfitRate >= 0 ? '+' : '') + stats.investmentProfitRate.toFixed(2) + '%';
        investmentChangeEl.className = 'stat-change ' + (stats.investmentProfitRate >= 0 ? 'positive' : 'negative');

        await this.renderDashboardReminders();
    },

    async renderDashboardReminders() {
        const container = document.getElementById('dashboardReminders');
        if (!container) return;

        const section = container.closest('.dashboard-section');

        const wealthReminders = typeof Investments?.getWealthReminders === 'function'
            ? await Investments.getWealthReminders()
            : [];

        const creditCardReminders = typeof Accounts?.getCreditCardReminders === 'function'
            ? await Accounts.getCreditCardReminders()
            : [];

        const reminders = [...wealthReminders, ...creditCardReminders].filter(Boolean);
        reminders.sort((a, b) => (Number(a.days) - Number(b.days)) || String(a.date).localeCompare(String(b.date)) || String(a.title).localeCompare(String(b.title)));

        if (reminders.length === 0) {
            container.innerHTML = '';
            section?.classList.add('hidden');
            return;
        }

        section?.classList.remove('hidden');
        container.innerHTML = '';

        const getLevel = (days) => {
            const n = Number(days);
            if (!Number.isFinite(n)) return 'normal';
            if (n <= 1) return 'urgent';
            if (n <= 3) return 'warn';
            return 'normal';
        };

        const wealthIcon = (() => {
            const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#4A6FA5"/><path d="M20 41c8-3 16-3 24 0" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round"/><path d="M22 28h20" stroke="#fff" stroke-width="4" stroke-linecap="round"/><circle cx="24" cy="24" r="3" fill="#fff"/><circle cx="40" cy="24" r="3" fill="#fff"/></svg>`;
            return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
        })();

        const toIconSrc = (icon) => {
            const raw = String(icon || '');
            if (!raw) return '';
            return raw.startsWith('data:') ? raw : `./icons/${encodeURIComponent(raw)}`;
        };

        for (const rem of reminders) {
            const days = Number(rem.days);
            const kind = String(rem.kind || '');
            const level = getLevel(days);

            const item = document.createElement('div');
            item.className = `reminder-item ${level}`;

            const left = document.createElement('div');
            left.className = 'reminder-left';

            const logo = document.createElement('img');
            logo.className = 'reminder-logo';
            logo.alt = '';
            if (kind === 'credit_card') {
                logo.src = toIconSrc(rem.icon);
            } else {
                logo.src = wealthIcon;
            }
            left.appendChild(logo);

            const content = document.createElement('div');
            content.className = 'reminder-content';

            const title = document.createElement('div');
            title.className = 'reminder-title';
            title.textContent = kind === 'credit_card'
                ? (rem.accountName || rem.title || '')
                : (rem.investmentName || rem.title || '');

            const sub = document.createElement('div');
            sub.className = 'reminder-sub';

            const meta = document.createElement('div');
            meta.className = 'reminder-meta';
            meta.textContent = String(rem.date || '');
            sub.appendChild(meta);

            if (kind === 'credit_card' && Number.isFinite(Number(rem.amountDue))) {
                const amount = document.createElement('div');
                amount.className = 'reminder-amount';
                amount.textContent = i18n.currentLang === 'zh'
                    ? `需还 ${App.formatCurrency(Number(rem.amountDue))}`
                    : `Due ${App.formatCurrency(Number(rem.amountDue))}`;
                sub.appendChild(amount);
            }

            content.appendChild(title);
            content.appendChild(sub);

            const right = document.createElement('div');
            right.className = 'reminder-right';

            const badge = document.createElement('div');
            badge.className = 'reminder-badge';

            const badgeDays = document.createElement('div');
            badgeDays.className = 'reminder-badge-days';
            badgeDays.textContent = days === 0
                ? (i18n.currentLang === 'zh' ? '今天' : 'Today')
                : (i18n.currentLang === 'zh' ? `${days}天` : `${days}d`);

            const badgeLabel = document.createElement('div');
            badgeLabel.className = 'reminder-badge-label';
            badgeLabel.textContent = kind === 'credit_card'
                ? (i18n.currentLang === 'zh' ? '还款' : 'Payment')
                : (i18n.currentLang === 'zh' ? '到期' : 'Maturity');

            badge.appendChild(badgeDays);
            badge.appendChild(badgeLabel);
            right.appendChild(badge);

            item.appendChild(left);
            item.appendChild(content);
            item.appendChild(right);
            container.appendChild(item);
        }
    },

    /**
     * 刷新所有数据
     */
    async refreshAll() {
        await this.updateDashboardStats();
        await Accounts.renderAccountList();
        await Accounts.renderDashboardAccounts();
        await Investments.renderInvestmentList();
        await Investments.updateSummary();
        await Charts.updateCharts();
        await Charts.updateDashboardChart();
    },

    /**
     * 格式化货币
     * @param {number} amount 
     * @returns {string}
     */
    formatCurrency(amount) {
        const absAmount = Math.abs(amount);
        const formatted = absAmount.toLocaleString('zh-CN', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });
        return (amount < 0 ? '-' : '') + this.currencySymbol + formatted;
    },

    /**
     * 打开模态框
     * @param {HTMLElement} modal 
     */
    openModal(modal) {
        modal.classList.remove('hidden');
        // 聚焦第一个输入框
        const firstInput = modal.querySelector('input:not([type="hidden"]), select, textarea');
        if (firstInput) {
            setTimeout(() => firstInput.focus(), 100);
        }
    },

    /**
     * 关闭模态框
     * @param {HTMLElement} modal 
     */
    closeModal(modal) {
        modal.classList.add('hidden');
    },

    /**
     * 显示确认对话框
     * @param {string} message 
     * @param {Function} callback 
     */
    showConfirm(message, callback) {
        document.getElementById('confirmMessage').textContent = message;
        this.confirmCallback = callback;
        this.openModal(document.getElementById('confirmModal'));
    },

    /**
     * 显示Toast提示
     * @param {string} message 
     * @param {string} type - 'success' | 'error'
     */
    showToast(message, type = 'success') {
        const toast = document.getElementById('toast');
        toast.textContent = message;
        toast.className = 'toast ' + type;

        // 3秒后自动隐藏
        setTimeout(() => {
            toast.classList.add('hidden');
        }, 3000);
    },

    /**
     * 显示加载状态
     */
    showLoading() {
        document.getElementById('loadingOverlay').classList.remove('hidden');
    },

    /**
     * 隐藏加载状态
     */
    hideLoading() {
        document.getElementById('loadingOverlay').classList.add('hidden');
    },

    /**
     * 首字母大写
     * @param {string} str 
     * @returns {string}
     */
    capitalize(str) {
        return str.charAt(0).toUpperCase() + str.slice(1);
    }
};

// 页面加载完成后初始化应用
document.addEventListener('DOMContentLoaded', () => {
    App.init();
});

// 导出
window.Charts = Charts;
window.App = App;
window.Recurring = Recurring;
