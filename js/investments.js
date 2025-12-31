/**
 * OpenPercento - 投资管理模块
 * 股票/基金/加密货币管理，API对接，盈亏计算
 */

const Investments = {
    currentType: 'all',
    sortDirection: 'desc',
    _investmentDetailPage: 1,
    _investmentDetailTotalPages: 1,

    // API 配置
    apis: {
        // CoinGecko API（加密货币）
        crypto: 'https://api.coingecko.com/api/v3',

        // 天天基金网 API（基金）
        fund: 'https://fundgz.1234567.com.cn/js',

        // 新浪财经 API（股票）
        stock: 'https://hq.sinajs.cn/list=',
    },

    // 常用加密货币代码映射
    cryptoSymbols: {
        'BTC': 'bitcoin',
        'ETH': 'ethereum',
        'USDT': 'tether',
        'BNB': 'binancecoin',
        'SOL': 'solana',
        'XRP': 'ripple',
        'USDC': 'usd-coin',
        'ADA': 'cardano',
        'DOGE': 'dogecoin',
        'TRX': 'tron',
        'TON': 'the-open-network',
        'AVAX': 'avalanche-2',
        'SHIB': 'shiba-inu',
        'DOT': 'polkadot',
        'LINK': 'chainlink',
        'MATIC': 'matic-network',
        'UNI': 'uniswap',
        'LTC': 'litecoin',
        'BCH': 'bitcoin-cash',
        'ATOM': 'cosmos',
    },

    /**
     * 初始化投资模块
     */
    async init() {
        this.bindEvents();
        const today = new Date().toISOString().split('T')[0];
        await this.accrueWealthInvestments(today);
        await this.renderInvestmentList();
        await this.updateSummary();
        this.updateSortButtonUI();

        // 初始化定时价格更新
        this.initPriceUpdateTimer();
    },

    /**
     * 绑定事件
     */
    bindEvents() {
        // 添加投资按钮
        document.getElementById('btnAddInvestment').addEventListener('click', () => {
            this.openInvestmentModal();
        });

        document.getElementById('btnSortInvestments')?.addEventListener('click', () => {
            this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
            this.updateSortButtonUI();
            this.renderInvestmentList();
        });

        // 刷新价格按钮
        document.getElementById('btnRefreshPrices').addEventListener('click', async () => {
            await this.refreshAllPrices();
        });

        // 投资类型筛选
        document.getElementById('investmentTypeTabs').addEventListener('click', (e) => {
            if (e.target.classList.contains('filter-tab')) {
                document.querySelectorAll('#investmentTypeTabs .filter-tab').forEach(tab => {
                    tab.classList.remove('active');
                });
                e.target.classList.add('active');
                this.currentType = e.target.dataset.type;
                this.renderInvestmentList();
            }
        });

        // 投资表单提交
        document.getElementById('investmentForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            await this.saveInvestment();
        });

        document.getElementById('btnManageInvestmentDca')?.addEventListener('click', async () => {
            const investmentId = parseInt(document.getElementById('investmentId')?.value || '', 10);
            if (!investmentId) {
                App.showToast(i18n.currentLang === 'zh' ? '请先保存该投资，再设置定投' : 'Save this investment before adding DCA', 'error');
                return;
            }
            await Recurring.openForInvestment(investmentId);
        });

        document.getElementById('btnManageInvestmentRecurring')?.addEventListener('click', async () => {
            const modal = document.getElementById('investmentDetailModal');
            const investmentId = parseInt(modal?.dataset?.investmentId || '', 10);
            if (!investmentId) return;
            await Recurring.openForInvestment(investmentId);
        });

        // 投资类型按钮选择（仅在模态框打开时绑定，避免初始化时元素不存在）
        // 移到 openInvestmentModal 中处理

        // 代码输入框失焦时自动获取信息（仅在模态框打开时绑定）
        // 移到 openInvestmentModal 中处理
    },

    /**
     * 渲染投资列表
     */
    async renderInvestmentList() {
        const container = document.getElementById('investmentList');
        let investments = await DB.getAllInvestments();

        // 按类型筛选
        if (this.currentType !== 'all') {
            investments = investments.filter(inv => inv.type === this.currentType);
        }

        investments.sort((a, b) => {
            const av = Number(a?.quantity || 0) * Number(a?.currentPrice || 0);
            const bv = Number(b?.quantity || 0) * Number(b?.currentPrice || 0);
            if (av === bv) return (Number(a?.id || 0) - Number(b?.id || 0));
            return this.sortDirection === 'asc' ? (av - bv) : (bv - av);
        });

        if (investments.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <p class="muted">${i18n.currentLang === 'zh' ? '暂无投资记录，点击添加' : 'No investments yet'}</p>
                </div>
            `;
            return;
        }

        const cardsHtml = await Promise.all(investments.map(inv => this.renderInvestmentCard(inv)));
        container.innerHTML = cardsHtml.join('');

        // 绑定卡片事件
        container.querySelectorAll('.investment-card').forEach(card => {
            const investmentId = parseInt(card.dataset.id);

            card.addEventListener('click', () => {
                this.showInvestmentDetail(investmentId);
            });

            // 编辑
            card.querySelector('.btn-edit')?.addEventListener('click', (e) => {
                e.stopPropagation();
                this.openInvestmentModal(investmentId);
            });

            // 删除
            card.querySelector('.btn-delete')?.addEventListener('click', (e) => {
                e.stopPropagation();
                this.confirmDeleteInvestment(investmentId);
            });
        });
    },

    updateSortButtonUI() {
        const btn = document.getElementById('btnSortInvestments');
        if (!btn) return;
        const labelEl = btn.querySelector('span');
        if (!labelEl) return;
        const key = this.sortDirection === 'asc' ? 'sortAsc' : 'sortDesc';
        labelEl.setAttribute('data-i18n', key);
        labelEl.textContent = i18n.t(key);
    },

    /**
     * 渲染投资卡片
     * @param {Object} inv 
     * @returns {string}
     */
    async renderInvestmentCard(inv) {
        const marketValue = inv.quantity * inv.currentPrice;
        const cost = inv.quantity * inv.costPrice;
        const profit = marketValue - cost;
        const profitRate = cost > 0 ? (profit / cost * 100) : 0;

        const profitClass = profit >= 0 ? 'positive' : 'negative';
        const profitSign = profit >= 0 ? '+' : '';

        const typeLabels = {
            stock: i18n.t('typeStock'),
            fund: i18n.t('typeFund'),
            crypto: i18n.t('typeCrypto'),
            wealth: i18n.t('typeWealth')
        };

        const isWealth = inv.type === 'wealth';
        const secondaryText = isWealth
            ? `${typeLabels[inv.type]} · ${(inv.wealthProductType === 'irregular' ? i18n.t('wealthIrregular') : i18n.t('wealthRegular'))} · ${(parseFloat(inv.annualInterestRate) || 0).toFixed(2)}%`
            : `${this.escapeHtml(inv.symbol)} · ${typeLabels[inv.type]}`;

        const priceValueText = isWealth ? App.formatCurrency(profit) : App.formatCurrency(inv.currentPrice);
        const priceLabelText = isWealth ? (i18n.currentLang === 'zh' ? '累计收益' : 'Interest') : (i18n.currentLang === 'zh' ? '当前价' : 'Current');

        // 生成迷你折线图
        const trendHtml = await this.generateMiniTrendChart(inv.id, inv.type, inv.symbol);

        return `
            <div class="investment-card" data-id="${inv.id}">
                <div class="investment-info">
                    <span class="investment-name">${this.escapeHtml(inv.name)}</span>
                    <span class="investment-code">${secondaryText}</span>
                </div>
                <div class="investment-price">
                    <span class="investment-current-price">${priceValueText}</span>
                    <span class="investment-price-change muted">${priceLabelText}</span>
                </div>
                <div class="investment-holding">
                    <span class="investment-value">${App.formatCurrency(marketValue)}</span>
                </div>
                <div class="investment-profit ${profitClass}">
                    <span class="investment-profit-amount">${profitSign}${App.formatCurrency(profit)}</span>
                    <span class="investment-profit-rate">${profitSign}${profitRate.toFixed(2)}%</span>
                </div>
                <div class="investment-trend">
                    ${trendHtml}
                </div>
                <div class="account-actions">
                    <button class="account-action-btn btn-edit" title="${i18n.t('edit')}">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="16" height="16">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                        </svg>
                    </button>
                    <button class="account-action-btn btn-delete danger" title="${i18n.t('delete')}">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="16" height="16">
                            <polyline points="3,6 5,6 21,6"/>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                        </svg>
                    </button>
                </div>
            </div>
        `;
    },

    /**
     * 生成迷你趋势图
     * @param {number} investmentId 
     * @param {string} type 
     * @param {string} symbol 
     * @returns {string}
     */
    async generateMiniTrendChart(investmentId, type, symbol) {
        try {
            const investment = await DB.getInvestment(investmentId);
            if (!investment) {
                return this.getEmptyTrendSvg(investmentId, symbol);
            }

            // 获取最近30天的价格历史
            const endDate = new Date();
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - 30);

            const history = await DB.getPriceHistoryByInvestment(
                investmentId,
                startDate.toISOString().split('T')[0],
                endDate.toISOString().split('T')[0]
            );

            if (history.length < 2) {
                return this.getEmptyTrendSvg(investmentId, symbol);
            }

            const series = history
                .slice()
                .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')))
                .slice(-30)
                .map(h => Number(h.price))
                .filter(v => Number.isFinite(v));

            if (series.length < 2) {
                return this.getEmptyTrendSvg(investmentId, symbol);
            }

            const minV = Math.min(...series);
            const maxV = Math.max(...series);
            const rawRange = maxV - minV;
            const pad = rawRange > 0 ? (rawRange * 0.08) : (Math.max(1, Math.abs(maxV)) * 0.02);
            const paddedMin = minV - pad;
            const paddedMax = maxV + pad;
            const range = (paddedMax - paddedMin) || 1;

            const topY = 2;
            const bottomY = 28;

            const points = series.map((v, i) => {
                const x = series.length === 1 ? 0 : (i / (series.length - 1)) * 60;
                const ratio = (v - paddedMin) / range;
                const y = bottomY - ratio * (bottomY - topY);
                const yClamped = Math.max(1, Math.min(29, y));
                return `${x.toFixed(2)},${yClamped.toFixed(2)}`;
            });

            const first = series[0];
            const last = series[series.length - 1];
            const delta = (Number.isFinite(first) && Number.isFinite(last)) ? (last - first) : 0;
            const strokeColor = delta >= 0 ? 'var(--color-up)' : 'var(--color-down)';
            const gradientId = `trend-grad-${investmentId}`;
            const linePoints = points.join(' ');
            const areaPoints = [`0,${bottomY}`, ...points, `60,${bottomY}`].join(' ');

            return `<svg width="60" height="30" viewBox="0 0 60 30" data-investment-id="${investmentId}" data-symbol="${symbol}" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="${gradientId}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${strokeColor}" stop-opacity="0.18"/><stop offset="100%" stop-color="${strokeColor}" stop-opacity="0"/></linearGradient></defs><polygon fill="url(#${gradientId})" points="${areaPoints}"/><polyline fill="none" stroke="${strokeColor}" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" points="${linePoints}"/></svg>`;
        } catch (error) {
            console.error('Error generating trend chart:', error);
            return this.getEmptyTrendSvg(investmentId, symbol);
        }
    },

    getEmptyTrendSvg(investmentId, symbol) {
        return `<svg width="60" height="30" viewBox="0 0 60 30" data-investment-id="${investmentId}" data-symbol="${symbol}" xmlns="http://www.w3.org/2000/svg"><polyline fill="none" stroke="rgba(148, 163, 184, 0.9)" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" points="0,15 60,15"/></svg>`;
    },

    /**
     * 初始化投资价格历史
     * @param {Object} investment 
     * @param {number} currentPrice 
     */
    async initPriceHistory(investment, currentPrice) {
        const today = new Date().toISOString().split('T')[0];

        // 检查今天是否已有价格记录
        const existing = await DB.getPriceHistoryByDate(investment.id, today);

        if (!existing) {
            await DB.addPriceHistory({
                investmentId: investment.id,
                date: today,
                price: currentPrice,
                type: investment.type,
                symbol: investment.symbol
            });
        }
    },

    /**
     * 更新投资价格历史
     * @param {Object} investment 
     * @param {number} currentPrice 
     */
    async updatePriceHistory(investment, currentPrice) {
        const today = new Date().toISOString().split('T')[0];

        // 检查今天是否已有价格记录
        const existing = await DB.getPriceHistoryByDate(investment.id, today);

        if (existing) {
            // 更新现有记录
            await DB.updatePriceHistory({
                ...existing,
                price: currentPrice,
                updatedAt: new Date().toISOString()
            });
        } else {
            // 添加新记录
            await DB.addPriceHistory({
                investmentId: investment.id,
                date: today,
                price: currentPrice,
                type: investment.type,
                symbol: investment.symbol
            });
        }
    },

    /**
     * 更新投资汇总
     */
    async updateSummary() {
        const investments = await DB.getAllInvestments();

        let totalMarketValue = 0;
        let totalCost = 0;
        let yesterdayProfit = 0;
        let yesterdayProfitCount = 0;

        const today = new Date();
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = yesterday.toISOString().split('T')[0];

        for (const inv of (investments || [])) {
            totalMarketValue += inv.quantity * inv.currentPrice;
            totalCost += inv.quantity * inv.costPrice;
            try {
                const h = await DB.getPriceHistoryByDate(Number(inv.id), yesterdayStr);
                const prev = Number(h?.price);
                if (Number.isFinite(prev)) {
                    yesterdayProfit += (Number(inv.quantity || 0) * (Number(inv.currentPrice || 0) - prev));
                    yesterdayProfitCount++;
                }
            } catch { }
        }

        const totalProfit = totalMarketValue - totalCost;
        const profitRate = totalCost > 0 ? (totalProfit / totalCost * 100) : 0;

        document.getElementById('totalMarketValue').textContent = App.formatCurrency(totalMarketValue);
        document.getElementById('totalCost').textContent = App.formatCurrency(totalCost);

        const profitEl = document.getElementById('totalProfitLoss');
        profitEl.textContent = (totalProfit >= 0 ? '+' : '') + App.formatCurrency(totalProfit);
        profitEl.className = 'value ' + (totalProfit >= 0 ? 'positive' : 'negative');

        const rateEl = document.getElementById('profitRate');
        rateEl.textContent = (profitRate >= 0 ? '+' : '') + profitRate.toFixed(2) + '%';
        rateEl.className = 'value ' + (profitRate >= 0 ? 'positive' : 'negative');

        const yEl = document.getElementById('yesterdayProfitLoss');
        if (yEl) {
            if (yesterdayProfitCount <= 0) {
                yEl.textContent = '--';
                yEl.className = 'value muted';
            } else {
                yEl.textContent = (yesterdayProfit >= 0 ? '+' : '') + App.formatCurrency(yesterdayProfit);
                yEl.className = 'value ' + (yesterdayProfit >= 0 ? 'positive' : 'negative');
            }
        }

        // 更新仪表盘投资数据
        document.getElementById('dashboardInvestments').textContent = App.formatCurrency(totalMarketValue);
        const changeEl = document.getElementById('investmentChange');
        changeEl.textContent = (profitRate >= 0 ? '+' : '') + profitRate.toFixed(2) + '%';
        changeEl.className = 'stat-change ' + (profitRate >= 0 ? 'positive' : 'negative');
    },

    /**
     * 更新输入框提示
     * @param {string} type 
     */
    updatePlaceholders(type) {
        const codeInput = document.getElementById('symbolCode');

        if (type === 'wealth') {
            codeInput.placeholder = i18n.currentLang === 'zh' ? '无需填写' : 'Not required';
        } else if (type === 'crypto') {
            codeInput.placeholder = i18n.currentLang === 'zh' ? '如：BTC, ETH, SOL' : 'e.g., BTC, ETH, SOL';
        } else if (type === 'stock') {
            codeInput.placeholder = i18n.currentLang === 'zh' ? '如：sh600519, sz000001, 0700.HK' : 'e.g., sh600519, sz000001, 0700.HK';
        } else {
            codeInput.placeholder = i18n.currentLang === 'zh' ? '如：009272, 110011' : 'e.g., 009272, 110011';
        }
    },

    diffDays(fromDate, toDate) {
        const fromMs = Date.parse(`${fromDate}T00:00:00`);
        const toMs = Date.parse(`${toDate}T00:00:00`);
        if (Number.isNaN(fromMs) || Number.isNaN(toMs)) return 0;
        return Math.max(0, Math.floor((toMs - fromMs) / 86400000));
    },

    async accrueWealthInvestments(today) {
        const investments = await DB.getAllInvestments();
        const wealthInvestments = investments.filter(inv => inv.type === 'wealth');
        if (wealthInvestments.length === 0) return 0;

        let updatedCount = 0;
        for (const inv of wealthInvestments) {
            const lastAccruedDate = inv.lastAccruedDate
                || inv.purchaseDate
                || (inv.createdAt ? String(inv.createdAt).split('T')[0] : today);
            const days = this.diffDays(lastAccruedDate, today);
            if (days <= 0) continue;

            const annualRate = parseFloat(inv.annualInterestRate) || 0;
            const dailyRate = annualRate > 0 ? (annualRate / 100 / 365) : 0;

            const principal = Number(inv.quantity || 0);
            if (!principal || principal <= 0) continue;

            const prevFactor = parseFloat(inv.currentPrice);
            const baseFactor = Number.isFinite(prevFactor) && prevFactor > 0 ? prevFactor : 1;
            const prevAmount = principal * baseFactor;
            const newAmount = dailyRate > 0 ? (prevAmount * (1 + dailyRate * days)) : prevAmount;
            const newFactor = principal > 0 ? (newAmount / principal) : baseFactor;

            const next = {
                ...inv,
                costPrice: 1,
                currentPrice: newFactor,
                lastAccruedDate: today
            };

            await DB.updateInvestment(next);
            await this.updatePriceHistory(next, newFactor);
            updatedCount++;
        }

        return updatedCount;
    },

    syncInvestmentFormForType(type) {
        const isWealth = type === 'wealth';

        const symbolGroup = document.getElementById('symbolCode')?.closest('.form-group');
        const symbolInput = document.getElementById('symbolCode');
        const nameDisplay = document.getElementById('symbolNameDisplay');
        const nameInput = document.getElementById('symbolName');
        const btnEditName = document.getElementById('btnEditName');

        const costGroup = document.getElementById('costPrice')?.closest('.form-group');
        const costDisplay = document.getElementById('costPriceDisplay');
        const costInput = document.getElementById('costPrice');
        const btnEditCost = document.getElementById('btnEditCost');

        const qtyRow = document.getElementById('investmentQuantity')?.closest('.form-row');
        const dcaBtn = document.getElementById('btnManageInvestmentDca');

        const wealthFields = document.getElementById('wealthFields');
        const wealthPrincipalGroup = document.getElementById('wealthPrincipalGroup');
        const wealthPrincipal = document.getElementById('wealthPrincipal');
        const wealthCurrentAmountGroup = document.getElementById('wealthCurrentAmountGroup');
        const wealthCurrentAmount = document.getElementById('wealthCurrentAmount');
        const wealthMaturityGroup = document.getElementById('wealthMaturityGroup');
        const wealthMaturityDate = document.getElementById('wealthMaturityDate');
        const wealthProductType = document.getElementById('wealthProductType');

        if (isWealth) {
            symbolGroup?.classList.add('hidden');
            if (symbolInput) {
                symbolInput.required = false;
                symbolInput.disabled = true;
                if (!symbolInput.value.trim()) {
                    symbolInput.value = 'WL';
                }
            }

            wealthFields?.classList.remove('hidden');
            wealthPrincipalGroup?.classList.remove('hidden');
            wealthCurrentAmountGroup?.classList.remove('hidden');
            wealthPrincipal?.removeAttribute('required');

            const productType = wealthProductType?.value || 'regular';
            const showMaturity = productType === 'regular';
            wealthMaturityGroup?.classList.toggle('hidden', !showMaturity);
            if (wealthMaturityDate) {
                if (showMaturity) {
                    wealthMaturityDate.setAttribute('required', 'required');
                } else {
                    wealthMaturityDate.removeAttribute('required');
                    wealthMaturityDate.value = '';
                }
            }

            qtyRow?.classList.add('hidden');

            costGroup?.classList.add('hidden');
            if (costInput) {
                costInput.required = false;
                costInput.disabled = true;
                costInput.value = 1;
            }
            if (costDisplay) costDisplay.textContent = App.formatCurrency(1);
            btnEditCost?.classList.add('hidden');
            if (costInput) costInput.classList.add('hidden');
            if (costDisplay) costDisplay.classList.remove('hidden');

            nameDisplay?.classList.add('hidden');
            btnEditName?.classList.add('hidden');
            nameInput?.classList.remove('hidden');

            if (dcaBtn) dcaBtn.classList.remove('hidden');
            wealthCurrentAmount?.removeAttribute('required');
        } else {
            symbolGroup?.classList.remove('hidden');
            if (symbolInput) {
                symbolInput.disabled = false;
                symbolInput.required = true;
            }

            wealthFields?.classList.add('hidden');
            wealthPrincipalGroup?.classList.add('hidden');
            wealthCurrentAmountGroup?.classList.add('hidden');
            wealthPrincipal?.removeAttribute('required');
            wealthMaturityGroup?.classList.add('hidden');
            wealthMaturityDate?.removeAttribute('required');

            qtyRow?.classList.remove('hidden');
            costGroup?.classList.remove('hidden');
            if (costInput) {
                costInput.disabled = false;
                costInput.required = true;
            }

            nameDisplay?.classList.remove('hidden');
            btnEditName?.classList.remove('hidden');
            nameInput?.classList.add('hidden');

            btnEditCost?.classList.remove('hidden');

            if (dcaBtn) dcaBtn.classList.remove('hidden');
        }
    },

    /**
     * 打开投资编辑模态框
     * @param {number} investmentId 
     */
    async openInvestmentModal(investmentId = null) {
        const modal = document.getElementById('investmentModal');
        const title = document.getElementById('investmentModalTitle');
        const form = document.getElementById('investmentForm');

        form.reset();
        document.getElementById('investmentId').value = '';

        // 设置默认购买日期为今天
        const today = new Date().toISOString().split('T')[0];
        document.getElementById('purchaseDate').value = today;

        // 重置显示字段
        document.getElementById('symbolNameDisplay').textContent = '未获取';
        document.getElementById('costPriceDisplay').textContent = '--';
        document.getElementById('symbolNameDisplay').classList.remove('hidden');
        document.getElementById('costPriceDisplay').classList.remove('hidden');
        document.getElementById('btnEditName').classList.remove('hidden');
        document.getElementById('btnEditCost').classList.remove('hidden');
        document.getElementById('symbolName').classList.add('hidden');
        document.getElementById('costPrice').classList.add('hidden');

        // 绑定模态框内的事件（只绑定一次）
        if (!this.modalEventsBound) {
            this.bindModalEvents();
            this.modalEventsBound = true;
        }

        if (investmentId) {
            const inv = await DB.getInvestment(investmentId);
            if (inv) {
                title.textContent = i18n.t('editInvestment');
                document.getElementById('investmentId').value = inv.id;
                document.getElementById('symbolCode').value = inv.symbol;
                document.getElementById('investmentQuantity').value = inv.quantity;
                document.getElementById('holdingAmount').value = (inv.quantity * inv.costPrice).toFixed(2);
                document.getElementById('investmentNote').value = inv.note || '';

                // 设置购买日期
                document.getElementById('purchaseDate').value = inv.purchaseDate || (inv.type === 'wealth' ? '' : today);

                // 设置类型按钮
                document.querySelectorAll('#investmentTypeSelector .type-btn').forEach(btn => {
                    btn.classList.toggle('active', btn.dataset.type === inv.type);
                });
                document.getElementById('investmentType').value = inv.type;

                // 设置名称和成本价
                document.getElementById('symbolNameDisplay').textContent = inv.name;
                document.getElementById('symbolName').value = inv.name;
                document.getElementById('costPriceDisplay').textContent = App.formatCurrency(inv.costPrice);
                document.getElementById('costPrice').value = inv.costPrice;

                this.updatePlaceholders(inv.type);
                this.syncInvestmentFormForType(inv.type);
                if (inv.type === 'wealth') {
                    document.getElementById('wealthProductType').value = inv.wealthProductType || 'regular';
                    document.getElementById('annualInterestRate').value = inv.annualInterestRate == null ? '' : inv.annualInterestRate;
                    document.getElementById('wealthMaturityDate').value = inv.maturityDate || '';
                    document.getElementById('wealthPrincipal').value = inv.quantity || '';
                    document.getElementById('wealthCurrentAmount').value = (Number(inv.quantity || 0) * (Number(inv.currentPrice || 0) || 1)).toFixed(2);
                    this.syncInvestmentFormForType('wealth');
                }
            }
        } else {
            title.textContent = i18n.t('addInvestment');
            // 默认选中基金
            document.querySelectorAll('#investmentTypeSelector .type-btn').forEach((btn, idx) => {
                btn.classList.toggle('active', btn.dataset.type === 'fund');
            });
            document.getElementById('investmentType').value = 'fund';
            this.updatePlaceholders('fund');
            this.syncInvestmentFormForType('fund');
        }

        App.openModal(modal);
    },

    /**
     * 绑定模态框内的事件
     */
    bindModalEvents() {
        // 投资类型按钮选择
        document.getElementById('investmentTypeSelector')?.addEventListener('click', (e) => {
            const btn = e.target.closest('.type-btn');
            if (btn) {
                document.querySelectorAll('#investmentTypeSelector .type-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                document.getElementById('investmentType').value = btn.dataset.type;
                this.updatePlaceholders(btn.dataset.type);
                this.syncInvestmentFormForType(btn.dataset.type);
            }
        });

        document.getElementById('wealthProductType')?.addEventListener('change', () => {
            if (document.getElementById('investmentType')?.value === 'wealth') {
                this.syncInvestmentFormForType('wealth');
            }
        });

        const wealthPrincipalEl = document.getElementById('wealthPrincipal');
        const wealthCurrentAmountEl = document.getElementById('wealthCurrentAmount');
        const annualRateEl = document.getElementById('annualInterestRate');
        const purchaseDateEl = document.getElementById('purchaseDate');

        const syncWealthPrincipalFromCurrentAmount = () => {
            if (document.getElementById('investmentType')?.value !== 'wealth') return;
            const currentAmount = parseFloat(wealthCurrentAmountEl?.value || '') || 0;
            if (currentAmount <= 0) return;
            const existingPrincipal = parseFloat(wealthPrincipalEl?.value || '') || 0;
            if (existingPrincipal > 0) return;
            const annualRate = parseFloat(annualRateEl?.value || '') || 0;
            const start = (purchaseDateEl?.value || '').trim();
            const today = new Date().toISOString().split('T')[0];
            let principal = currentAmount;
            if (annualRate > 0 && start) {
                const days = this.diffDays(start, today);
                const dailyRate = annualRate / 100 / 365;
                const factor = 1 + dailyRate * days;
                principal = factor > 0 ? (currentAmount / factor) : currentAmount;
            }
            if (wealthPrincipalEl) wealthPrincipalEl.value = principal.toFixed(2);
        };

        wealthCurrentAmountEl?.addEventListener('input', syncWealthPrincipalFromCurrentAmount);
        annualRateEl?.addEventListener('input', syncWealthPrincipalFromCurrentAmount);
        purchaseDateEl?.addEventListener('change', syncWealthPrincipalFromCurrentAmount);

        wealthPrincipalEl?.addEventListener('input', () => {
            if (document.getElementById('investmentType')?.value !== 'wealth') return;
            const principal = parseFloat(wealthPrincipalEl.value || '') || 0;
            const currentAmount = parseFloat(wealthCurrentAmountEl?.value || '') || 0;
            if (principal > 0 && currentAmount <= 0 && wealthCurrentAmountEl) {
                wealthCurrentAmountEl.value = principal.toFixed(2);
            }
        });

        // 编辑名称按钮
        document.getElementById('btnEditName')?.addEventListener('click', () => {
            const display = document.getElementById('symbolNameDisplay');
            const input = document.getElementById('symbolName');
            display.classList.add('hidden');
            document.getElementById('btnEditName').classList.add('hidden');
            input.classList.remove('hidden');
            input.focus();
        });

        // 编辑成本价按钮
        document.getElementById('btnEditCost')?.addEventListener('click', () => {
            const display = document.getElementById('costPriceDisplay');
            const input = document.getElementById('costPrice');
            display.classList.add('hidden');
            document.getElementById('btnEditCost').classList.add('hidden');
            input.classList.remove('hidden');
            input.focus();
        });

        // 代码输入框失焦时自动获取信息
        document.getElementById('symbolCode')?.addEventListener('blur', async () => {
            const type = document.getElementById('investmentType').value;
            const code = document.getElementById('symbolCode').value.trim();
            const nameInput = document.getElementById('symbolName');

            // 如果代码不为空且名称为空，自动获取
            if (type !== 'wealth' && code && !nameInput.value.trim()) {
                await this.autoFetchSymbolInfo();
            }
        });

        // 持仓数量和持有金额的双向计算
        document.getElementById('investmentQuantity')?.addEventListener('input', (e) => {
            const quantity = parseFloat(e.target.value) || 0;
            const costPrice = parseFloat(document.getElementById('costPrice').value) || 0;
            if (quantity > 0 && costPrice > 0) {
                document.getElementById('holdingAmount').value = (quantity * costPrice).toFixed(2);
            }
        });

        document.getElementById('holdingAmount')?.addEventListener('input', (e) => {
            const amount = parseFloat(e.target.value) || 0;
            const costPrice = parseFloat(document.getElementById('costPrice').value) || 0;
            if (amount > 0 && costPrice > 0) {
                document.getElementById('investmentQuantity').value = (amount / costPrice).toFixed(4);
            }
        });

        // 成本价变化时也重新计算
        document.getElementById('costPrice')?.addEventListener('input', () => {
            const quantity = parseFloat(document.getElementById('investmentQuantity').value);
            const amount = parseFloat(document.getElementById('holdingAmount').value);
            const costPrice = parseFloat(document.getElementById('costPrice').value) || 0;

            if (costPrice > 0) {
                if (quantity > 0) {
                    document.getElementById('holdingAmount').value = (quantity * costPrice).toFixed(2);
                } else if (amount > 0) {
                    document.getElementById('investmentQuantity').value = (amount / costPrice).toFixed(4);
                }
            }
        });
    },

    /**
     * 保存投资
     */
    async saveInvestment() {
        const id = document.getElementById('investmentId').value;
        const type = document.getElementById('investmentType').value;
        let purchaseDate = document.getElementById('purchaseDate').value;
        const note = document.getElementById('investmentNote').value.trim();

        let name = document.getElementById('symbolName').value.trim();
        let symbol = document.getElementById('symbolCode').value.trim().toUpperCase();
        let quantity = parseFloat(document.getElementById('investmentQuantity').value) || 0;
        let costPrice = parseFloat(document.getElementById('costPrice').value) || 0;
        let wealthProductType = null;
        let annualInterestRate = 0;
        let lastAccruedDate = null;
        let maturityDate = null;
        let wealthCurrentAmount = 0;

        if (type === 'wealth') {
            wealthProductType = document.getElementById('wealthProductType').value || 'regular';
            annualInterestRate = parseFloat(document.getElementById('annualInterestRate').value) || 0;
            const principal = parseFloat(document.getElementById('wealthPrincipal').value) || 0;
            wealthCurrentAmount = parseFloat(document.getElementById('wealthCurrentAmount')?.value || '') || 0;
            maturityDate = (document.getElementById('wealthMaturityDate')?.value || '').trim() || null;
            const today = new Date().toISOString().split('T')[0];
            if (!purchaseDate) {
                purchaseDate = today;
                const purchaseDateEl = document.getElementById('purchaseDate');
                if (purchaseDateEl) purchaseDateEl.value = today;
            }
            quantity = principal > 0 ? principal : 0;
            if (quantity <= 0 && wealthCurrentAmount > 0) {
                if (annualInterestRate > 0 && purchaseDate) {
                    const dailyRate = annualInterestRate / 100 / 365;
                    const days = this.diffDays(purchaseDate, today);
                    const factor = 1 + dailyRate * days;
                    quantity = factor > 0 ? (wealthCurrentAmount / factor) : wealthCurrentAmount;
                } else {
                    quantity = wealthCurrentAmount;
                }
            }
            costPrice = 1;
            if (!symbol) symbol = `WL${Date.now()}`;
            lastAccruedDate = wealthCurrentAmount > 0 ? today : (purchaseDate ? purchaseDate : null);
        } else {
            if (quantity === 0) {
                const amount = parseFloat(document.getElementById('holdingAmount').value) || 0;
                if (amount > 0 && costPrice > 0) {
                    quantity = amount / costPrice;
                }
            }
        }

        if (type === 'wealth' && wealthProductType === 'regular' && !maturityDate) {
            App.showToast(i18n.currentLang === 'zh' ? '请填写到期时间' : 'Please enter maturity date', 'error');
            return;
        }

        if (!name || !symbol || quantity <= 0 || costPrice <= 0 || (type !== 'wealth' && !purchaseDate)) {
            App.showToast(i18n.currentLang === 'zh' ? '请填写完整信息' : 'Please fill in all fields', 'error');
            return;
        }

        let currentPrice = type === 'wealth' ? 1 : costPrice;
        if (type === 'wealth') {
            const principal = Number(quantity || 0);
            if (principal > 0 && wealthCurrentAmount > 0) {
                currentPrice = wealthCurrentAmount / principal;
            }
        }
        const investmentData = { type, name, symbol, quantity, costPrice, currentPrice, purchaseDate: purchaseDate || null, note, wealthProductType, annualInterestRate, maturityDate, lastAccruedDate };

        try {
            if (id) {
                const existing = await DB.getInvestment(parseInt(id));
                investmentData.id = parseInt(id);
                investmentData.createdAt = existing.createdAt;
                investmentData.currentPrice = type === 'wealth' ? (parseFloat(existing.currentPrice) || 1) : existing.currentPrice;
                if (type === 'wealth') {
                    const currentAmount = parseFloat(document.getElementById('wealthCurrentAmount')?.value || '') || 0;
                    const principal = Number(investmentData.quantity || 0);
                    if (principal > 0 && currentAmount > 0) {
                        investmentData.currentPrice = currentAmount / principal;
                    }
                    investmentData.lastAccruedDate = currentAmount > 0 ? investmentData.lastAccruedDate : (existing.lastAccruedDate || investmentData.lastAccruedDate);
                }
                await DB.updateInvestment(investmentData);
            } else {
                const newId = await DB.addInvestment(investmentData);
                investmentData.id = newId;

                // 初始化价格历史记录
                await this.initPriceHistory(investmentData, investmentData.currentPrice);
            }

            App.closeModal(document.getElementById('investmentModal'));
            App.showToast(i18n.t('investmentSaved'));

            await this.renderInvestmentList();
            await this.updateSummary();
            await App.updateDashboardStats();
            await DB.recordDailySnapshot();

        } catch (error) {
            console.error('Error saving investment:', error);
            App.showToast(i18n.currentLang === 'zh' ? '保存失败' : 'Save failed', 'error');
        }
    },

    async getWealthReminders() {
        const investments = await DB.getAllInvestments();
        const today = new Date().toISOString().split('T')[0];
        const reminders = [];

        for (const inv of investments) {
            if (inv.type !== 'wealth') continue;
            if ((inv.wealthProductType || 'regular') !== 'regular') continue;
            const maturity = String(inv.maturityDate || '').slice(0, 10);
            if (!maturity) continue;

            const todayMs = Date.parse(`${today}T00:00:00`);
            const maturityMs = Date.parse(`${maturity}T00:00:00`);
            if (Number.isNaN(todayMs) || Number.isNaN(maturityMs)) continue;
            const days = Math.floor((maturityMs - todayMs) / 86400000);
            if (days < 0 || days > 7) continue;

            const title = i18n.currentLang === 'zh'
                ? `理财到期提醒：${inv.name}`
                : `Maturity reminder: ${inv.name}`;

            const meta = i18n.currentLang === 'zh'
                ? (days === 0 ? `今天到期 · ${maturity}` : `${days}天后到期 · ${maturity}`)
                : (days === 0 ? `Matures today · ${maturity}` : `Matures in ${days} day(s) · ${maturity}`);

            reminders.push({
                kind: 'wealth',
                days,
                date: maturity,
                title,
                meta,
                investmentId: Number(inv.id),
                investmentName: String(inv.name || ''),
                currentAmount: Number(inv.quantity || 0) * Number(inv.currentPrice || 0)
            });
        }

        return reminders;
    },

    /**
     * 自动获取标的信息（名称和价格）
     */
    async autoFetchSymbolInfo() {
        const type = document.getElementById('investmentType').value;
        const code = document.getElementById('symbolCode').value.trim().toUpperCase();

        if (!code) return;
        if (type === 'wealth') return;

        try {
            let info = null;

            if (type === 'crypto') {
                info = await this.fetchCryptoInfo(code);
            } else if (type === 'stock') {
                info = await this.fetchStockInfo(code);
            } else if (type === 'fund') {
                info = await this.fetchFundInfo(code);
            }

            if (info) {
                if (info.name) {
                    // 更新显示值和隐藏输入框
                    document.getElementById('symbolNameDisplay').textContent = info.name;
                    document.getElementById('symbolName').value = info.name;
                }
                if (info.price !== null && info.price !== undefined) {
                    // 更新成本价显示和隐藏输入框
                    document.getElementById('costPriceDisplay').textContent = App.formatCurrency(info.price);
                    document.getElementById('costPrice').value = info.price;
                }
            }
        } catch (error) {
            console.error('Auto fetch error:', error);
            // 静默失败，不弹提示，用户可手动输入
        }
    },

    /**
     * 获取加密货币信息
     * @param {string} symbol 
     * @returns {Promise<Object|null>}
     */
    async fetchCryptoInfo(symbol) {
        const coinId = this.cryptoSymbols[symbol] || symbol.toLowerCase();

        try {
            const response = await fetch(
                `${this.apis.crypto}/simple/price?ids=${coinId}&vs_currencies=cny&include_market_cap=false`
            );

            if (!response.ok) return null;

            const data = await response.json();

            if (data[coinId] && data[coinId].cny) {
                return {
                    name: this.getCryptoName(symbol),
                    price: data[coinId].cny
                };
            }

            return null;
        } catch (error) {
            console.error('Crypto API error:', error);
            return null;
        }
    },

    /**
     * 获取加密货币名称
     * @param {string} symbol 
     * @returns {string}
     */
    getCryptoName(symbol) {
        const names = {
            'BTC': '比特币',
            'ETH': '以太币',
            'USDT': '泰达币',
            'BNB': '币安币',
            'SOL': 'Solana',
            'XRP': 'Ripple',
            'USDC': 'USD Coin',
            'ADA': 'Cardano',
            'DOGE': '狗狗币',
            'TRX': '波场',
        };
        return names[symbol] || symbol;
    },

    /**
     * 获取股票信息
     * @param {string} code 
     * @returns {Promise<Object|null>}
     */
    async fetchStockInfo(code) {
        try {
            // 处理代码格式：sh600519, sz000001, 0700.HK
            let apiCode = code.toLowerCase();

            // 港股处理
            if (code.includes('.HK')) {
                apiCode = 'hk' + code.replace('.HK', '').replace('.hk', '');
            }
            // A股处理：如果没有sh/sz前缀，默认为sh
            else if (!code.toLowerCase().startsWith('sh') && !code.toLowerCase().startsWith('sz')) {
                // 6开头是sh，0/3开头是sz
                if (code.startsWith('6')) {
                    apiCode = 'sh' + code;
                } else {
                    apiCode = 'sz' + code;
                }
            }

            return await this.fetchStockInfoJSONP(apiCode);

        } catch (error) {
            console.error('Stock API error:', error);
            return null;
        }
    },

    /**
     * 使用JSONP获取股票信息
     * @param {string} code 
     * @returns {Promise<Object|null>}
     */
    async fetchStockInfoJSONP(code) {
        return new Promise((resolve) => {
            const script = document.createElement('script');
            let resolved = false;

            script.src = `${this.apis.stock}${code}&_=${Date.now()}`;

            script.onerror = () => {
                if (!resolved) {
                    resolved = true;
                    if (script.parentNode) {
                        document.body.removeChild(script);
                    }
                    resolve(null);
                }
            };

            script.onload = () => {
                if (!resolved) {
                    try {
                        // 新浪返回格式：var hq_str_sh600519="贵州茅台,xxx,xxx,43.50,..."
                        const scriptContent = script.textContent || script.innerHTML || '';
                        const match = scriptContent.match(/"([^"]+)"/);

                        if (match && match[1]) {
                            const parts = match[1].split(',');
                            if (parts.length > 3 && parts[0]) {
                                resolved = true;
                                const stockInfo = {
                                    name: parts[0], // 股票名称
                                    price: parseFloat(parts[3]) || 0 // 当前价格
                                };

                                setTimeout(() => {
                                    if (script.parentNode) {
                                        document.body.removeChild(script);
                                    }
                                }, 100);

                                resolve(stockInfo);
                                return;
                            }
                        }
                    } catch (e) {
                        console.error('Parse stock data error:', e);
                    }

                    resolved = true;
                    if (script.parentNode) {
                        document.body.removeChild(script);
                    }
                    resolve(null);
                }
            };

            // 设置超时
            setTimeout(() => {
                if (!resolved) {
                    resolved = true;
                    if (script.parentNode) {
                        document.body.removeChild(script);
                    }
                    resolve(null);
                }
            }, 5000);

            document.body.appendChild(script);
        });
    },

    /**
     * 获取基金信息
     * @param {string} code 
     * @returns {Promise<Object|null>}
     */
    async fetchFundInfo(code) {
        return new Promise((resolve) => {
            const fundCode = String(code || '').trim();
            if (!fundCode) {
                resolve(null);
                return;
            }

            if (!this._fundJsonpPending) this._fundJsonpPending = Object.create(null);
            if (!this._fundJsonpPending[fundCode]) this._fundJsonpPending[fundCode] = [];

            if (!window.jsonpgz || !window.jsonpgz.__openpercentoDispatcher) {
                const dispatcher = (data) => {
                    try {
                        const codeFromPayload = String(data?.fundcode || '').trim();
                        if (!codeFromPayload) return;
                        const list = this._fundJsonpPending?.[codeFromPayload];
                        if (!list || list.length === 0) return;
                        const callbacks = list.slice(0);
                        this._fundJsonpPending[codeFromPayload] = [];
                        callbacks.forEach(cb => {
                            try { cb(data); } catch { }
                        });
                    } catch { }
                };
                dispatcher.__openpercentoDispatcher = true;
                window.jsonpgz = dispatcher;
            }

            let finished = false;
            const script = document.createElement('script');
            script.src = `${this.apis.fund}/${fundCode}.js?rt=${Date.now()}`;

            const cleanup = () => {
                if (script.parentNode) script.parentNode.removeChild(script);
            };

            const finish = (value) => {
                if (finished) return;
                finished = true;
                cleanup();
                resolve(value);
            };

            const cb = (data) => {
                if (!data || !data.name) {
                    finish(null);
                    return;
                }
                const estimatedPrice = parseFloat(data.gsz);
                const navPrice = parseFloat(data.dwjz);
                const price = (estimatedPrice && estimatedPrice > 0) ? estimatedPrice : navPrice;
                if (!price || price <= 0) {
                    finish(null);
                    return;
                }
                finish({ name: data.name, price });
            };

            this._fundJsonpPending[fundCode].push(cb);

            script.onerror = () => {
                const list = this._fundJsonpPending?.[fundCode] || [];
                this._fundJsonpPending[fundCode] = list.filter(fn => fn !== cb);
                finish(null);
            };

            setTimeout(() => {
                const list = this._fundJsonpPending?.[fundCode] || [];
                this._fundJsonpPending[fundCode] = list.filter(fn => fn !== cb);
                finish(null);
            }, 5000);

            document.body.appendChild(script);
        });
    },

    /**
     * 获取当前价格（从 API）
     */
    async fetchCurrentPrice() {
        const type = document.getElementById('investmentType').value;
        const symbol = document.getElementById('symbolCode').value.trim().toUpperCase();

        if (!symbol) {
            App.showToast(i18n.currentLang === 'zh' ? '请先输入代码' : 'Please enter symbol first', 'error');
            return;
        }

        App.showLoading();

        try {
            // 先尝试自动获取信息
            await this.autoFetchSymbolInfo();

            const currentPrice = document.getElementById('currentPrice').value;

            if (currentPrice && parseFloat(currentPrice) > 0) {
                App.showToast(i18n.currentLang === 'zh' ? '价格获取成功' : 'Price fetched');
            } else {
                App.showToast(i18n.t('fetchPriceError'), 'error');
            }

        } catch (error) {
            console.error('Error fetching price:', error);
            App.showToast(i18n.t('fetchPriceError'), 'error');
        }

        App.hideLoading();
    },

    /**
     * 初始化定时价格更新
     */
    initPriceUpdateTimer() {
        this.ensureDailyAutoUpdate().catch(error => console.error('Auto update check error:', error));
        if (this._priceUpdateIntervalId) {
            clearInterval(this._priceUpdateIntervalId);
        }
        this._priceUpdateIntervalId = setInterval(() => {
            this.ensureDailyAutoUpdate().catch(error => console.error('Auto update check error:', error));
        }, 60 * 60 * 1000);

        if (!this._visibilityListenerBound) {
            document.addEventListener('visibilitychange', () => {
                if (!document.hidden) {
                    this.ensureDailyAutoUpdate().catch(error => console.error('Auto update check error:', error));
                }
            });
            this._visibilityListenerBound = true;
        }
    },

    async ensureDailyAutoUpdate() {
        const now = new Date();
        const phase = now.getHours() >= 15 ? 'afterClose' : 'beforeClose';
        const y = now.getFullYear();
        const m = String(now.getMonth() + 1).padStart(2, '0');
        const d = String(now.getDate()).padStart(2, '0');
        const bucket = `${y}-${m}-${d}-${phase}`;

        const lastBucket = await DB.getSetting('lastAutoPriceUpdateBucket', null);
        if (lastBucket === bucket) return;

        const lastAttemptAt = await DB.getSetting('lastAutoPriceUpdateAttemptAt', null);
        if (lastAttemptAt) {
            const lastAttemptMs = Date.parse(lastAttemptAt);
            if (!Number.isNaN(lastAttemptMs) && (Date.now() - lastAttemptMs) < 5 * 60 * 1000) {
                return;
            }
        }

        await DB.saveSetting('lastAutoPriceUpdateAttemptAt', new Date().toISOString());
        await this.autoUpdatePrices(bucket);
    },

    /**
     * 自动更新价格
     */
    async autoUpdatePrices(currentBucket = null) {
        try {
            console.log('Auto updating investment prices...');

            const investments = await DB.getAllInvestments();

            if (investments.length === 0) {
                return;
            }

            const today = new Date().toISOString().split('T')[0];
            let updatedCount = 0;

            updatedCount += await this.accrueWealthInvestments(today);

            // 获取所有加密货币ID
            const cryptoInvestments = investments.filter(inv => inv.type === 'crypto');

            if (cryptoInvestments.length > 0) {
                const coinIds = cryptoInvestments.map(inv =>
                    this.cryptoSymbols[inv.symbol] || inv.symbol.toLowerCase()
                );

                try {
                    const response = await fetch(
                        `${this.apis.crypto}/simple/price?ids=${coinIds.join(',')}&vs_currencies=cny`
                    );

                    if (response.ok) {
                        const data = await response.json();

                        for (const inv of cryptoInvestments) {
                            const coinId = this.cryptoSymbols[inv.symbol] || inv.symbol.toLowerCase();
                            if (data[coinId] && data[coinId].cny) {
                                const newPrice = data[coinId].cny;

                                // 更新投资的当前价格
                                inv.currentPrice = newPrice;
                                await DB.updateInvestment(inv);

                                // 更新价格历史记录
                                await this.updatePriceHistory(inv, newPrice);
                                updatedCount++;
                            }
                        }
                    }
                } catch (error) {
                    console.error('Auto update crypto prices error:', error);
                }
            }

            const otherInvestments = investments.filter(inv => inv.type !== 'crypto' && inv.type !== 'wealth');
            for (const inv of otherInvestments) {
                try {
                    let info = null;
                    if (inv.type === 'fund') {
                        info = await this.fetchFundInfo(inv.symbol);
                    } else if (inv.type === 'stock') {
                        info = await this.fetchStockInfo(inv.symbol);
                    }

                    if (info && info.price && info.price > 0) {
                        inv.currentPrice = info.price;
                        await DB.updateInvestment(inv);
                        await this.updatePriceHistory(inv, info.price);
                        updatedCount++;
                    }
                } catch (error) {
                    console.error('Auto update price error:', error);
                }
            }

            // 更新汇总和仪表盘
            if (updatedCount > 0) {
                await DB.saveSetting('lastAutoPriceUpdateDate', today);
                if (currentBucket) {
                    await DB.saveSetting('lastAutoPriceUpdateBucket', currentBucket);
                }
                await DB.saveSetting('lastAutoPriceUpdateAt', new Date().toISOString());
                await this.renderInvestmentList();
                await this.updateSummary();
                await App.updateDashboardStats();
            }
            try {
                await DB.recordDailySnapshot();
            } catch (error) {
                console.error('Record daily snapshot error:', error);
            }

            console.log('Auto price update completed');
        } catch (error) {
            console.error('Auto price update error:', error);
        }
    },

    /**
     * 刷新所有投资价格
     */
    async refreshAllPrices() {
        const investments = await DB.getAllInvestments();

        if (investments.length === 0) {
            App.showToast(i18n.currentLang === 'zh' ? '暂无投资记录' : 'No investments', 'error');
            return;
        }

        App.showLoading();

        let updatedCount = 0;
        const today = new Date().toISOString().split('T')[0];

        updatedCount += await this.accrueWealthInvestments(today);

        // 获取所有加密货币ID
        const cryptoInvestments = investments.filter(inv => inv.type === 'crypto');

        if (cryptoInvestments.length > 0) {
            const coinIds = cryptoInvestments.map(inv =>
                this.cryptoSymbols[inv.symbol] || inv.symbol.toLowerCase()
            );

            try {
                const response = await fetch(
                    `${this.apis.crypto}/simple/price?ids=${coinIds.join(',')}&vs_currencies=cny`
                );

                if (response.ok) {
                    const data = await response.json();

                    for (const inv of cryptoInvestments) {
                        const coinId = this.cryptoSymbols[inv.symbol] || inv.symbol.toLowerCase();
                        if (data[coinId] && data[coinId].cny) {
                            const newPrice = data[coinId].cny;

                            // 更新投资的当前价格
                            inv.currentPrice = newPrice;
                            await DB.updateInvestment(inv);

                            // 更新价格历史记录
                            await this.updatePriceHistory(inv, newPrice);

                            updatedCount++;
                        }
                    }
                }
            } catch (error) {
                console.error('Batch crypto API error:', error);
            }
        }

        const otherInvestments = investments.filter(inv => inv.type !== 'crypto' && inv.type !== 'wealth');
        for (const inv of otherInvestments) {
            try {
                let info = null;
                if (inv.type === 'fund') {
                    info = await this.fetchFundInfo(inv.symbol);
                } else if (inv.type === 'stock') {
                    info = await this.fetchStockInfo(inv.symbol);
                }

                if (info && info.price && info.price > 0) {
                    inv.currentPrice = info.price;
                    await DB.updateInvestment(inv);
                    await this.updatePriceHistory(inv, info.price);
                    updatedCount++;
                }
            } catch (error) {
                console.error('Refresh price error:', error);
            }
        }

        App.hideLoading();

        if (updatedCount > 0) {
            App.showToast(i18n.t('pricesRefreshed') + ` (${updatedCount})`);
            await DB.saveSetting('lastAutoPriceUpdateDate', today);
            const now = new Date();
            const phase = now.getHours() >= 15 ? 'afterClose' : 'beforeClose';
            const y = now.getFullYear();
            const m = String(now.getMonth() + 1).padStart(2, '0');
            const d = String(now.getDate()).padStart(2, '0');
            await DB.saveSetting('lastAutoPriceUpdateBucket', `${y}-${m}-${d}-${phase}`);
            await DB.saveSetting('lastAutoPriceUpdateAt', new Date().toISOString());
            await this.renderInvestmentList();
            await this.updateSummary();
            await App.updateDashboardStats();
        } else {
            App.showToast(i18n.currentLang === 'zh' ? '无可更新的价格' : 'No prices updated');
        }
        try {
            await DB.recordDailySnapshot();
        } catch (error) {
            console.error('Record daily snapshot error:', error);
        }
    },

    /**
     * 确认删除投资
     * @param {number} investmentId 
     */
    async confirmDeleteInvestment(investmentId) {
        const inv = await DB.getInvestment(investmentId);
        if (!inv) return;

        App.showConfirm(
            i18n.t('confirmDeleteInvestment') + ` (${inv.name})`,
            async () => {
                try {
                    await DB.deleteInvestment(investmentId);
                    App.showToast(i18n.t('investmentDeleted'));

                    await this.renderInvestmentList();
                    await this.updateSummary();
                    await App.updateDashboardStats();
                    await DB.recordDailySnapshot();

                } catch (error) {
                    console.error('Error deleting investment:', error);
                    App.showToast(i18n.currentLang === 'zh' ? '删除失败' : 'Delete failed', 'error');
                }
            }
        );
    },

    async showInvestmentDetail(investmentId) {
        const investment = await DB.getInvestment(investmentId);
        if (!investment) return;

        const modal = document.getElementById('investmentDetailModal');
        const title = document.getElementById('investmentDetailTitle');
        const summary = document.getElementById('investmentDetailSummary');
        const historyList = document.getElementById('investmentHistoryList');
        const btnRecurring = document.getElementById('btnManageInvestmentRecurring');
        const prevBtn = document.getElementById('investmentHistoryPrev');
        const nextBtn = document.getElementById('investmentHistoryNext');
        const pageInfo = document.getElementById('investmentHistoryPageInfo');

        title.textContent = investment.name;
        modal.dataset.investmentId = String(investmentId);

        const marketValue = investment.quantity * investment.currentPrice;
        const cost = investment.quantity * investment.costPrice;
        const profit = marketValue - cost;
        const profitRate = cost > 0 ? (profit / cost * 100) : 0;

        const profitClass = profit >= 0 ? 'positive' : 'negative';
        const profitSign = profit >= 0 ? '+' : '';

        const typeLabels = {
            stock: i18n.t('typeStock'),
            fund: i18n.t('typeFund'),
            crypto: i18n.t('typeCrypto'),
            wealth: i18n.t('typeWealth')
        };

        const isWealth = investment.type === 'wealth';
        const priceLabel = isWealth ? (i18n.currentLang === 'zh' ? '累计收益' : 'Interest') : (i18n.currentLang === 'zh' ? '当前价' : 'Current');
        const priceValue = isWealth ? App.formatCurrency(profit) : App.formatCurrency(investment.currentPrice);

        summary.innerHTML = `
            <div class="detail-item">
                <span class="label">${i18n.currentLang === 'zh' ? '类型' : 'Type'}</span>
                <span class="value">${typeLabels[investment.type]}</span>
            </div>
            <div class="detail-item">
                <span class="label">${i18n.currentLang === 'zh' ? '代码' : 'Code'}</span>
                <span class="value">${this.escapeHtml(investment.symbol)}</span>
            </div>
            <div class="detail-item">
                <span class="label">${priceLabel}</span>
                <span class="value">${priceValue}</span>
            </div>
            <div class="detail-item">
                <span class="label">${i18n.currentLang === 'zh' ? '持仓' : 'Quantity'}</span>
                <span class="value">${investment.quantity.toFixed(4)}</span>
            </div>
            <div class="detail-item">
                <span class="label">${i18n.currentLang === 'zh' ? '成本价' : 'Cost Price'}</span>
                <span class="value">${App.formatCurrency(investment.costPrice)}</span>
            </div>
            <div class="detail-item">
                <span class="label">${i18n.currentLang === 'zh' ? '市值' : 'Market Value'}</span>
                <span class="value">${App.formatCurrency(marketValue)}</span>
            </div>
            <div class="detail-item">
                <span class="label">${i18n.currentLang === 'zh' ? '盈亏' : 'Profit/Loss'}</span>
                <span class="value ${profitClass}">${profitSign}${App.formatCurrency(profit)}</span>
            </div>
            <div class="detail-item">
                <span class="label">${i18n.currentLang === 'zh' ? '盈亏率' : 'Profit Rate'}</span>
                <span class="value ${profitClass}">${profitSign}${profitRate.toFixed(2)}%</span>
            </div>
            ${investment.purchaseDate ? `
                <div class="detail-item">
                    <span class="label">${i18n.currentLang === 'zh' ? '购买日期' : 'Purchase Date'}</span>
                    <span class="value">${investment.purchaseDate}</span>
                </div>
            ` : ''}
            ${isWealth && investment.wealthProductType ? `
                <div class="detail-item">
                    <span class="label">${i18n.currentLang === 'zh' ? '产品类型' : 'Product Type'}</span>
                    <span class="value">${investment.wealthProductType === 'regular' ? (i18n.currentLang === 'zh' ? '定期' : 'Regular') : (i18n.currentLang === 'zh' ? '活期' : 'Irregular')}</span>
                </div>
            ` : ''}
            ${isWealth && investment.annualInterestRate ? `
                <div class="detail-item">
                    <span class="label">${i18n.currentLang === 'zh' ? '年利率' : 'Annual Rate'}</span>
                    <span class="value">${investment.annualInterestRate}%</span>
                </div>
            ` : ''}
            ${isWealth && investment.maturityDate ? `
                <div class="detail-item">
                    <span class="label">${i18n.currentLang === 'zh' ? '到期日期' : 'Maturity Date'}</span>
                    <span class="value">${investment.maturityDate}</span>
                </div>
            ` : ''}
            ${investment.note ? `
                <div class="detail-item" style="grid-column: span 2;">
                    <span class="label">${i18n.t('note')}</span>
                    <span class="value">${this.escapeHtml(investment.note)}</span>
                </div>
            ` : ''}
        `;

        this._investmentDetailPage = 1;

        await this._renderInvestmentHistory(investment, historyList, prevBtn, nextBtn, pageInfo);

        prevBtn.onclick = async () => {
            if (this._investmentDetailPage > 1) {
                this._investmentDetailPage--;
                await this._renderInvestmentHistory(investment, historyList, prevBtn, nextBtn, pageInfo);
            }
        };

        nextBtn.onclick = async () => {
            if (this._investmentDetailPage < this._investmentDetailTotalPages) {
                this._investmentDetailPage++;
                await this._renderInvestmentHistory(investment, historyList, prevBtn, nextBtn, pageInfo);
            }
        };

        btnRecurring.onclick = async () => {
            await Recurring.openForInvestment(investmentId);
        };

        App.openModal(modal);
    },

    async _renderInvestmentHistory(investment, historyList, prevBtn, nextBtn, pageInfo) {
        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - 90);

        const history = await DB.getPriceHistoryByInvestment(
            investment.id,
            startDate.toISOString().split('T')[0],
            endDate.toISOString().split('T')[0]
        );

        const pageSize = 6;
        this._investmentDetailTotalPages = Math.ceil(history.length / pageSize) || 1;

        if (this._investmentDetailPage > this._investmentDetailTotalPages) {
            this._investmentDetailPage = this._investmentDetailTotalPages;
        }

        const startIndex = (this._investmentDetailPage - 1) * pageSize;
        const endIndex = startIndex + pageSize;
        const pageHistory = history.slice(startIndex, endIndex);

        const isWealth = investment.type === 'wealth';

        if (history.length === 0) {
            historyList.innerHTML = `<p class="muted">${i18n.currentLang === 'zh' ? '暂无记录' : 'No records'}</p>`;
        } else {
            historyList.innerHTML = pageHistory
                .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')))
                .map(h => {
                    const price = Number(h.price);
                    const marketValueAtDate = investment.quantity * price;
                    const costAtDate = investment.quantity * investment.costPrice;
                    const profitAtDate = marketValueAtDate - costAtDate;
                    const profitClass = profitAtDate >= 0 ? 'positive' : 'negative';
                    const profitSign = profitAtDate >= 0 ? '+' : '';

                    return `
                        <div class="history-item">
                            <span class="history-date">${h.date}</span>
                            <span class="history-reason">${isWealth ? (i18n.currentLang === 'zh' ? '利息累计' : 'Interest') : (i18n.currentLang === 'zh' ? '价格更新' : 'Price Update')}</span>
                            <span class="history-balance">
                                ${App.formatCurrency(marketValueAtDate)}
                                <span class="history-change ${profitClass}">${profitSign}${App.formatCurrency(profitAtDate)}</span>
                            </span>
                        </div>
                    `;
                }).join('');
        }

        pageInfo.textContent = `${this._investmentDetailPage} / ${this._investmentDetailTotalPages}`;
        prevBtn.disabled = this._investmentDetailPage <= 1;
        nextBtn.disabled = this._investmentDetailPage >= this._investmentDetailTotalPages;
    },

    /**
     * HTML转义
     * @param {string} str 
     * @returns {string}
     */
    escapeHtml(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }
};

// 导出
window.Investments = Investments;
