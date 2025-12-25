/**
 * OpenPercento - 账户管理模块
 * 多账户创建/编辑/删除/分组，复式转账，余额更新
 */

const makeSvgDataUri = (svg) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

const LEGACY_APPSTORE_ICON_URI = makeSvgDataUri(`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#4A6FA5"/><text x="32" y="42" font-size="30" text-anchor="middle" fill="#fff" font-family="Arial">A</text></svg>`);

const DEFAULT_ICON_URIS = {
    cash: makeSvgDataUri(`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#4A6FA5"/><text x="32" y="42" font-size="30" text-anchor="middle" fill="#fff" font-family="Arial">¥</text></svg>`),
    card: makeSvgDataUri(`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#4A6FA5"/><rect x="12" y="20" width="40" height="26" rx="6" fill="#fff" opacity="0.95"/><rect x="16" y="26" width="32" height="4" rx="2" fill="#4A6FA5" opacity="0.9"/><rect x="16" y="36" width="18" height="4" rx="2" fill="#4A6FA5" opacity="0.5"/></svg>`),
    appstore: 'AppStore.PNG',
    house: makeSvgDataUri(`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#4A6FA5"/><path d="M16 30 L32 18 L48 30 V48 a4 4 0 0 1-4 4 H20 a4 4 0 0 1-4-4 Z" fill="#fff" opacity="0.95"/><rect x="28" y="38" width="8" height="14" rx="2" fill="#4A6FA5" opacity="0.7"/></svg>`),
    car: makeSvgDataUri(`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#4A6FA5"/><path d="M18 38l4-10a4 4 0 0 1 4-3h12a4 4 0 0 1 4 3l4 10v8a3 3 0 0 1-3 3h-1a3 3 0 0 1-3-3v-1H25v1a3 3 0 0 1-3 3h-1a3 3 0 0 1-3-3z" fill="#fff" opacity="0.95"/><circle cx="24" cy="45" r="3" fill="#4A6FA5" opacity="0.7"/><circle cx="40" cy="45" r="3" fill="#4A6FA5" opacity="0.7"/></svg>`),
    lend: makeSvgDataUri(`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#4A6FA5"/><path d="M20 34h18l-6-6 3-3 12 12-12 12-3-3 6-6H20z" fill="#fff" opacity="0.95"/></svg>`),
    loan: makeSvgDataUri(`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#4A6FA5"/><path d="M44 30H20a6 6 0 0 0 0 12h16a4 4 0 0 1 0 8H22v-4h14a4 4 0 0 0 0-8H20a10 10 0 0 1 0-20h24z" fill="#fff" opacity="0.95"/></svg>`),
    payable: makeSvgDataUri(`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#4A6FA5"/><rect x="18" y="16" width="28" height="36" rx="6" fill="#fff" opacity="0.95"/><rect x="22" y="24" width="20" height="4" rx="2" fill="#4A6FA5" opacity="0.6"/><rect x="22" y="32" width="16" height="4" rx="2" fill="#4A6FA5" opacity="0.45"/><rect x="22" y="40" width="18" height="4" rx="2" fill="#4A6FA5" opacity="0.35"/></svg>`),
    other: makeSvgDataUri(`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#4A6FA5"/><circle cx="22" cy="32" r="4" fill="#fff"/><circle cx="32" cy="32" r="4" fill="#fff"/><circle cx="42" cy="32" r="4" fill="#fff"/></svg>`)
};

const Accounts = {
    currentGroup: 'all',
    isEditMode: false,
    _pendingDrag: null,
    _activeDrag: null,
    _dragMoveHandler: null,
    _dragEndHandler: null,
    _suppressClickUntil: 0,
    groupConfig: {
        current: {
            labelKey: 'groupCurrent',
            sub: [
                { id: 'cash', labelKey: 'subCash' },
                { id: 'wechat', labelKey: 'subWeChat' },
                { id: 'alipay', labelKey: 'subAlipay' },
                { id: 'appstore', labelKey: 'subAppStore' },
                { id: 'savings_card', labelKey: 'subSavingsCard' },
                { id: 'other', labelKey: 'subOther' }
            ]
        },
        fixed: {
            labelKey: 'groupFixed',
            sub: [
                { id: 'house', labelKey: 'subHouse' },
                { id: 'car', labelKey: 'subCar' },
                { id: 'other_fixed', labelKey: 'subOtherFixed' }
            ]
        },
        receivable: {
            labelKey: 'groupReceivable',
            sub: [
                { id: 'lend', labelKey: 'subLend' },
                { id: 'other_receivable', labelKey: 'subOtherReceivable' }
            ]
        },
        liability: {
            labelKey: 'groupLiability',
            sub: [
                { id: 'credit_card', labelKey: 'subCreditCard' },
                { id: 'loan', labelKey: 'subLoan' },
                { id: 'payable', labelKey: 'subPayable' },
                { id: 'other_liability', labelKey: 'subOtherLiability' }
            ]
        }
    },
    iconOptions: [
        { value: '', labelZh: '无', labelEn: 'None' },
        { value: DEFAULT_ICON_URIS.cash, labelZh: '现金', labelEn: 'Cash' },
        { value: DEFAULT_ICON_URIS.card, labelZh: '银行卡', labelEn: 'Card' },
        { value: DEFAULT_ICON_URIS.appstore, labelZh: 'AppStore', labelEn: 'AppStore' },
        { value: DEFAULT_ICON_URIS.house, labelZh: '房产', labelEn: 'House' },
        { value: DEFAULT_ICON_URIS.car, labelZh: '汽车', labelEn: 'Car' },
        { value: DEFAULT_ICON_URIS.lend, labelZh: '借出', labelEn: 'Lend' },
        { value: DEFAULT_ICON_URIS.loan, labelZh: '贷款', labelEn: 'Loan' },
        { value: DEFAULT_ICON_URIS.payable, labelZh: '应付款', labelEn: 'Payable' },
        { value: DEFAULT_ICON_URIS.other, labelZh: '其它', labelEn: 'Other' },
        { value: '中国银行.PNG', labelZh: '中国银行', labelEn: 'Bank of China' },
        { value: '农业银行.PNG', labelZh: '农业银行', labelEn: 'ABC' },
        { value: '工商银行.PNG', labelZh: '工商银行', labelEn: 'ICBC' },
        { value: '建设银行.PNG', labelZh: '建设银行', labelEn: 'CCB' },
        { value: '招商银行.PNG', labelZh: '招商银行', labelEn: 'CMB' },
        { value: '民泰银行.PNG', labelZh: '民泰银行', labelEn: 'Mintai Bank' },
        { value: '微信.PNG', labelZh: '微信', labelEn: 'WeChat' },
        { value: '支付宝.PNG', labelZh: '支付宝', labelEn: 'Alipay' },
        { value: '京东.PNG', labelZh: '京东', labelEn: 'JD' }
    ],

    /**
     * 初始化账户模块
     */
    async init() {
        this.bindEvents();
        await this.migrateLegacyIcons();
        await this.renderAccountList();
        await this.renderDashboardAccounts();
    },

    async migrateLegacyIcons() {
        const accounts = await DB.getAllAccounts();
        const pendingUpdates = (accounts || []).filter(a => a && (
            a.icon === LEGACY_APPSTORE_ICON_URI ||
            a.icon === './icons/AppStore.PNG' ||
            a.icon === 'icons/AppStore.PNG'
        ));
        for (const account of pendingUpdates) {
            await DB.updateAccount({ ...account, icon: 'AppStore.PNG' });
        }
    },

    /**
     * 绑定事件
     */
    bindEvents() {
        document.getElementById('btnEditAccounts')?.addEventListener('click', () => {
            this.toggleEditMode();
        });

        document.getElementById('accountGroupSelector')?.addEventListener('click', (e) => {
            const btn = e.target.closest('button');
            if (!btn) return;

            const level = btn.dataset.level;
            if (level === 'primary') {
                const primary = btn.dataset.group;
                this.setPrimaryGroup(primary);
                return;
            }

            if (level === 'secondary') {
                const fullGroup = btn.dataset.group;
                this.setSecondaryGroup(fullGroup);
            }
        });

        document.getElementById('accountIcon')?.addEventListener('change', () => {
            this.updateIconPreview();
        });
        // 添加账户按钮
        document.getElementById('btnAddAccount').addEventListener('click', () => {
            this.openAccountModal();
        });

        // 快速更新余额按钮
        document.getElementById('btnQuickUpdate').addEventListener('click', () => {
            this.openBalanceModal();
        });

        // 账户分组筛选
        document.getElementById('accountGroupTabs').addEventListener('click', (e) => {
            if (e.target.classList.contains('filter-tab')) {
                document.querySelectorAll('#accountGroupTabs .filter-tab').forEach(tab => {
                    tab.classList.remove('active');
                });
                e.target.classList.add('active');
                this.currentGroup = e.target.dataset.group;
                this.renderAccountList();
            }
        });

        document.getElementById('accountList')?.addEventListener('pointerdown', (e) => {
            this.onAccountListPointerDown(e);
        });

        // 账户表单提交
        document.getElementById('accountForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            await this.saveAccount();
        });

        // 余额更新表单提交
        document.getElementById('balanceForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            await this.updateBalance();
        });

        // 转账表单提交
        document.getElementById('transferForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            await this.executeTransfer();
        });

        // 账户选择变化时更新原余额显示
        document.getElementById('balanceAccount').addEventListener('change', async (e) => {
            const accountId = parseInt(e.target.value);
            if (accountId) {
                const account = await DB.getAccount(accountId);
                if (account) {
                    document.getElementById('previousBalance').value = App.formatCurrency(account.balance);
                    document.getElementById('previousBalance').dataset.raw = String(account.balance);
                    const newBalanceEl = document.getElementById('newBalance');
                    if (newBalanceEl) newBalanceEl.value = String(account.balance);
                    const deltaAmountEl = document.getElementById('balanceDeltaAmount');
                    if (deltaAmountEl) deltaAmountEl.value = '';
                }
            }
        });

        document.getElementById('balanceDeltaAmount')?.addEventListener('input', () => {
            this.syncNewBalanceFromDelta();
        });
        document.getElementById('balanceDeltaDirection')?.addEventListener('change', () => {
            this.syncNewBalanceFromDelta();
        });
        document.getElementById('newBalance')?.addEventListener('input', () => {
            const deltaAmountEl = document.getElementById('balanceDeltaAmount');
            if (!deltaAmountEl) return;
            if (deltaAmountEl.value) deltaAmountEl.value = '';
        });

        // 查看全部链接
        document.querySelectorAll('.link-more[data-page]').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                App.navigateTo(link.dataset.page);
            });
        });

        document.getElementById('btnManageAccountRecurring')?.addEventListener('click', async () => {
            const modal = document.getElementById('accountDetailModal');
            const accountId = parseInt(modal?.dataset?.accountId || '', 10);
            if (!accountId) return;
            await Recurring.openForAccount(accountId);
        });
    },

    toggleEditMode() {
        this.isEditMode = !this.isEditMode;
        document.body.classList.toggle('accounts-edit-mode', this.isEditMode);
        this.updateEditButtonUI();
        if (!this.isEditMode) {
            this.hideTrashBin();
        }
    },

    updateEditButtonUI() {
        const btn = document.getElementById('btnEditAccounts');
        if (!btn) return;
        const labelEl = btn.querySelector('span');
        if (!labelEl) return;
        if (this.isEditMode) {
            labelEl.removeAttribute('data-i18n');
            labelEl.textContent = i18n.t('done');
        } else {
            labelEl.setAttribute('data-i18n', 'sort');
            labelEl.textContent = i18n.t('sort');
        }
    },

    getTrashBinEl() {
        return document.getElementById('dragTrashBin');
    },

    showTrashBin(active = false) {
        const el = this.getTrashBinEl();
        if (!el) return;
        el.classList.remove('hidden');
        el.classList.toggle('active', !!active);
    },

    hideTrashBin() {
        const el = this.getTrashBinEl();
        if (!el) return;
        el.classList.add('hidden');
        el.classList.remove('active');
    },

    onAccountListPointerDown(e) {
        if (!this.isEditMode) return;
        if (this._pendingDrag || this._activeDrag) return;

        const card = e.target.closest('.account-card');
        if (!card) return;
        if (e.target.closest('.account-actions')) return;

        const pointerId = e.pointerId;
        this._pendingDrag = {
            pointerId,
            card,
            startX: e.clientX,
            startY: e.clientY
        };

        this._dragMoveHandler = (evt) => this.onAccountListPointerMove(evt);
        this._dragEndHandler = (evt) => this.onAccountListPointerUp(evt);

        document.addEventListener('pointermove', this._dragMoveHandler, { passive: false });
        document.addEventListener('pointerup', this._dragEndHandler, { passive: true });
        document.addEventListener('pointercancel', this._dragEndHandler, { passive: true });
    },

    onAccountListPointerMove(e) {
        if (this._pendingDrag && e.pointerId !== this._pendingDrag.pointerId) return;
        if (this._activeDrag && e.pointerId !== this._activeDrag.pointerId) return;

        if (this._pendingDrag && !this._activeDrag) {
            const dx = e.clientX - this._pendingDrag.startX;
            const dy = e.clientY - this._pendingDrag.startY;
            if (Math.hypot(dx, dy) < 6) return;
            e.preventDefault();
            this.beginAccountDrag(e, this._pendingDrag.card);
            this._pendingDrag = null;
        }

        if (!this._activeDrag) return;

        e.preventDefault();
        const { card, offsetX, offsetY } = this._activeDrag;
        card.style.left = (e.clientX - offsetX) + 'px';
        card.style.top = (e.clientY - offsetY) + 'px';

        const trash = this.getTrashBinEl();
        const trashRect = trash ? trash.getBoundingClientRect() : null;
        const overTrash = !!trashRect &&
            e.clientX >= trashRect.left && e.clientX <= trashRect.right &&
            e.clientY >= trashRect.top && e.clientY <= trashRect.bottom;
        this.showTrashBin(overTrash);

        const list = document.getElementById('accountList');
        if (!list) return;

        const listRect = list.getBoundingClientRect();
        const insideList = e.clientX >= listRect.left && e.clientX <= listRect.right &&
            e.clientY >= listRect.top && e.clientY <= listRect.bottom;

        if (!insideList) return;

        const el = document.elementFromPoint(e.clientX, e.clientY);
        const targetCard = el?.closest?.('.account-card');
        if (!targetCard || targetCard === card) return;
        if (!list.contains(targetCard)) return;

        const targetRect = targetCard.getBoundingClientRect();
        const after = e.clientY > (targetRect.top + targetRect.height / 2);
        const placeholder = this._activeDrag.placeholder;
        if (!placeholder) return;

        if (after) {
            if (targetCard.nextSibling !== placeholder) {
                list.insertBefore(placeholder, targetCard.nextSibling);
            }
        } else {
            if (targetCard.previousSibling !== placeholder) {
                list.insertBefore(placeholder, targetCard);
            }
        }
    },

    async onAccountListPointerUp(e) {
        if (this._pendingDrag && e.pointerId === this._pendingDrag.pointerId) {
            this._pendingDrag = null;
        }

        const active = this._activeDrag;
        if (!active || e.pointerId !== active.pointerId) {
            this.cleanupDragListeners();
            return;
        }

        const trash = this.getTrashBinEl();
        const trashRect = trash ? trash.getBoundingClientRect() : null;
        const overTrash = !!trashRect &&
            e.clientX >= trashRect.left && e.clientX <= trashRect.right &&
            e.clientY >= trashRect.top && e.clientY <= trashRect.bottom;

        const accountId = Number(active.card.dataset.id);
        this.endAccountDrag();
        this._suppressClickUntil = Date.now() + 400;

        if (overTrash && accountId) {
            await this.confirmDeleteAccount(accountId);
            return;
        }

        await this.persistAccountOrderFromDom();
        await this.renderDashboardAccounts();
    },

    beginAccountDrag(e, card) {
        const list = document.getElementById('accountList');
        if (!list) return;

        const rect = card.getBoundingClientRect();
        const placeholder = document.createElement('div');
        placeholder.className = 'account-card-placeholder';
        placeholder.style.height = rect.height + 'px';

        list.insertBefore(placeholder, card);

        const offsetX = e.clientX - rect.left;
        const offsetY = e.clientY - rect.top;

        card.classList.add('dragging');
        card.style.position = 'fixed';
        card.style.width = rect.width + 'px';
        card.style.left = rect.left + 'px';
        card.style.top = rect.top + 'px';
        card.style.zIndex = '10000';
        card.style.pointerEvents = 'none';

        document.body.appendChild(card);
        document.body.classList.add('is-dragging');

        this._activeDrag = { pointerId: e.pointerId, card, placeholder, offsetX, offsetY };
        this.showTrashBin(false);
    },

    endAccountDrag() {
        const active = this._activeDrag;
        if (!active) return;

        const { card, placeholder } = active;

        card.classList.remove('dragging');
        card.style.position = '';
        card.style.width = '';
        card.style.left = '';
        card.style.top = '';
        card.style.zIndex = '';
        card.style.pointerEvents = '';

        placeholder.parentNode?.insertBefore(card, placeholder);
        placeholder.remove();

        this._activeDrag = null;
        document.body.classList.remove('is-dragging');
        this.hideTrashBin();
        this.cleanupDragListeners();
    },

    cleanupDragListeners() {
        if (this._dragMoveHandler) document.removeEventListener('pointermove', this._dragMoveHandler);
        if (this._dragEndHandler) {
            document.removeEventListener('pointerup', this._dragEndHandler);
            document.removeEventListener('pointercancel', this._dragEndHandler);
        }
        this._dragMoveHandler = null;
        this._dragEndHandler = null;
    },

    async getAccountOrder() {
        const raw = await DB.getSetting('accountOrder', null);
        if (Array.isArray(raw)) return raw.map(n => Number(n)).filter(n => Number.isFinite(n));
        if (typeof raw === 'string') {
            try {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) return parsed.map(n => Number(n)).filter(n => Number.isFinite(n));
            } catch { }
        }
        return [];
    },

    async saveAccountOrder(order) {
        await DB.saveSetting('accountOrder', order);
    },

    async ensureAccountOrder(accounts) {
        const ids = (accounts || []).map(a => Number(a?.id)).filter(n => Number.isFinite(n));
        const idSet = new Set(ids);
        let order = await this.getAccountOrder();

        if (!Array.isArray(order) || order.length === 0) {
            const groupOrder = ['current', 'fixed', 'receivable', 'liability'];
            const sorted = (accounts || []).slice().sort((a, b) => {
                const orderA = groupOrder.indexOf(this.normalizeGroup(a.group).primary);
                const orderB = groupOrder.indexOf(this.normalizeGroup(b.group).primary);
                if ((orderA === -1 ? 999 : orderA) !== (orderB === -1 ? 999 : orderB)) {
                    return (orderA === -1 ? 999 : orderA) - (orderB === -1 ? 999 : orderB);
                }
                const idA = Number(a?.id) || 0;
                const idB = Number(b?.id) || 0;
                return idA - idB;
            });
            order = sorted.map(a => Number(a.id)).filter(n => Number.isFinite(n));
        }

        const next = [];
        const seen = new Set();
        for (const id of order) {
            const num = Number(id);
            if (!Number.isFinite(num)) continue;
            if (!idSet.has(num)) continue;
            if (seen.has(num)) continue;
            next.push(num);
            seen.add(num);
        }
        for (const id of ids) {
            if (!seen.has(id)) next.push(id);
        }

        if (next.length !== order.length || next.some((v, i) => v !== order[i])) {
            await this.saveAccountOrder(next);
        }

        return next;
    },

    sortAccountsByOrder(accounts, order) {
        const pos = new Map();
        (order || []).forEach((id, idx) => pos.set(Number(id), idx));
        return (accounts || []).slice().sort((a, b) => {
            const idA = Number(a?.id);
            const idB = Number(b?.id);
            const pa = pos.has(idA) ? pos.get(idA) : 1e9;
            const pb = pos.has(idB) ? pos.get(idB) : 1e9;
            if (pa !== pb) return pa - pb;
            return idA - idB;
        });
    },

    async getOrderedAccounts() {
        const accounts = await DB.getAllAccounts();
        const order = await this.ensureAccountOrder(accounts);
        return this.sortAccountsByOrder(accounts, order);
    },

    async appendAccountToOrder(accountId) {
        const id = Number(accountId);
        if (!Number.isFinite(id)) return;
        const accounts = await DB.getAllAccounts();
        const order = await this.ensureAccountOrder(accounts);
        if (order.includes(id)) return;
        order.push(id);
        await this.saveAccountOrder(order);
    },

    async removeAccountFromOrder(accountId) {
        const id = Number(accountId);
        if (!Number.isFinite(id)) return;
        const order = await this.getAccountOrder();
        const next = (order || []).filter(x => Number(x) !== id);
        await this.saveAccountOrder(next);
    },

    async persistAccountOrderFromDom() {
        const list = document.getElementById('accountList');
        if (!list) return;
        const visibleIds = Array.from(list.querySelectorAll('.account-card'))
            .map(el => Number(el.dataset.id))
            .filter(n => Number.isFinite(n));
        if (visibleIds.length === 0) return;

        const order = await this.getAccountOrder();
        const visibleSet = new Set(visibleIds);

        const firstIdx = (order || []).reduce((min, id, idx) => {
            if (visibleSet.has(Number(id))) return Math.min(min, idx);
            return min;
        }, Number.POSITIVE_INFINITY);

        const cleaned = (order || []).map(n => Number(n)).filter(n => Number.isFinite(n));
        const withoutVisible = cleaned.filter(id => !visibleSet.has(id));

        if (firstIdx === Number.POSITIVE_INFINITY) {
            await this.saveAccountOrder(withoutVisible.concat(visibleIds));
            return;
        }

        const before = cleaned.slice(0, firstIdx).filter(id => !visibleSet.has(id));
        const after = cleaned.slice(firstIdx).filter(id => !visibleSet.has(id));
        await this.saveAccountOrder(before.concat(visibleIds, after));
    },

    normalizeGroup(group) {
        const raw = String(group || '').trim();
        if (raw.includes('/')) {
            const [primary, secondary] = raw.split('/');
            if (this.groupConfig[primary]?.sub?.some(s => s.id === secondary)) {
                return { primary, secondary, full: `${primary}/${secondary}` };
            }
        }

        const legacyMap = {
            cash: { primary: 'current', secondary: 'cash' },
            bank: { primary: 'current', secondary: 'savings_card' },
            crypto: { primary: 'current', secondary: 'other' },
            investment: { primary: 'current', secondary: 'other' },
            liability: { primary: 'liability', secondary: 'other_liability' }
        };

        const mapped = legacyMap[raw];
        if (mapped) return { ...mapped, full: `${mapped.primary}/${mapped.secondary}` };

        return { primary: 'current', secondary: 'other', full: 'current/other' };
    },

    isLiabilityGroup(group) {
        return this.normalizeGroup(group).primary === 'liability';
    },

    getGroupLabel(group) {
        const { primary, secondary } = this.normalizeGroup(group);
        const primaryKey = this.groupConfig[primary]?.labelKey || primary;
        const secondaryKey = this.groupConfig[primary]?.sub?.find(s => s.id === secondary)?.labelKey || secondary;
        const primaryLabel = i18n.t(primaryKey);
        const secondaryLabel = i18n.t(secondaryKey);
        return `${primaryLabel} · ${secondaryLabel}`;
    },

    renderSecondaryGroup(primary, activeSecondary = null) {
        const container = document.getElementById('accountGroupSecondary');
        if (!container) return;

        const config = this.groupConfig[primary] || this.groupConfig.current;
        const firstSecondary = config.sub[0]?.id || 'cash';
        const secondary = activeSecondary && config.sub.some(s => s.id === activeSecondary) ? activeSecondary : firstSecondary;

        container.innerHTML = config.sub.map((s, idx) => {
            const full = `${primary}/${s.id}`;
            const active = s.id === secondary || (idx === 0 && !activeSecondary);
            return `<button type="button" class="filter-tab ${active ? 'active' : ''}" data-level="secondary" data-group="${full}" data-i18n="${s.labelKey}">${i18n.t(s.labelKey)}</button>`;
        }).join('');

        container.classList.add('open');
        container.style.maxHeight = container.scrollHeight + 'px';
        if (typeof i18n.updateUI === 'function') i18n.updateUI();

        const fullGroup = `${primary}/${secondary}`;
        document.getElementById('accountGroup').value = fullGroup;
        this.updateAccountModalExtras(fullGroup);
    },

    setPrimaryGroup(primary) {
        document.querySelectorAll('#accountGroupSelector .type-btn[data-level="primary"]').forEach(b => {
            b.classList.toggle('active', b.dataset.group === primary);
        });
        this.renderSecondaryGroup(primary);
    },

    setSecondaryGroup(fullGroup) {
        document.querySelectorAll('#accountGroupSecondary .filter-tab').forEach(b => {
            b.classList.toggle('active', b.dataset.group === fullGroup);
        });
        document.getElementById('accountGroup').value = fullGroup;
        this.updateAccountModalExtras(fullGroup);
    },

    updateAccountModalExtras(fullGroup) {
        const { primary, secondary } = this.normalizeGroup(fullGroup);
        const showCreditFields = primary === 'liability' && secondary === 'credit_card';

        const logoGroup = document.getElementById('accountLogoGroup');
        const creditFields = document.getElementById('creditCardFields');

        if (logoGroup) {
            logoGroup.classList.remove('hidden');
            this.ensureIconOptions();
            const iconSelect = document.getElementById('accountIcon');
            if (iconSelect && !iconSelect.value) {
                iconSelect.value = this.getDefaultIconForGroup(`${primary}/${secondary}`);
                this.updateIconPreview();
            }
        }

        if (creditFields) {
            creditFields.classList.toggle('hidden', !showCreditFields);
            if (!showCreditFields) {
                const billing = document.getElementById('billingDay');
                const repayment = document.getElementById('repaymentDay');
                if (billing) billing.value = '';
                if (repayment) repayment.value = '';
            }
        }

        this.updateAccountBalanceUnit(fullGroup);
    },

    updateAccountBalanceUnit(fullGroup) {
        const { primary } = this.normalizeGroup(fullGroup);
        const input = document.getElementById('accountBalance');
        const hint = document.getElementById('accountBalanceUnitHint');
        if (!input) return;

        const desiredUnit = primary === 'fixed' ? 'wan' : 'yuan';
        const currentUnit = input.dataset.unit || 'yuan';

        const currentValue = parseFloat(input.value);
        if (desiredUnit !== currentUnit && Number.isFinite(currentValue)) {
            if (desiredUnit === 'wan' && currentUnit === 'yuan') {
                input.value = String(currentValue / 10000);
            } else if (desiredUnit === 'yuan' && currentUnit === 'wan') {
                input.value = String(currentValue * 10000);
            }
        }

        input.dataset.unit = desiredUnit;
        if (hint) {
            hint.textContent = desiredUnit === 'wan'
                ? (i18n.currentLang === 'zh' ? '单位：万元' : 'Unit: 10k')
                : '';
        }
    },

    ensureIconOptions() {
        const select = document.getElementById('accountIcon');
        if (!select) return;
        const lang = i18n.currentLang === 'en' ? 'en' : 'zh';
        if (select.dataset.ready === '1' && select.dataset.lang === lang) return;

        const optionsHtml = this.iconOptions.map(opt => {
            const label = i18n.currentLang === 'zh' ? opt.labelZh : opt.labelEn;
            return `<option value="${opt.value}">${label}</option>`;
        }).join('');

        select.innerHTML = optionsHtml;
        select.dataset.ready = '1';
        select.dataset.lang = lang;
        this.updateIconPreview();
    },

    updateIconPreview() {
        const select = document.getElementById('accountIcon');
        const preview = document.getElementById('accountIconPreview');
        if (!select || !preview) return;

        const filename = select.value;
        if (!filename) {
            preview.classList.add('hidden');
            preview.removeAttribute('src');
            preview.removeAttribute('alt');
            return;
        }

        preview.src = filename.startsWith('data:') ? filename : `./icons/${encodeURIComponent(filename)}`;
        preview.alt = filename;
        preview.classList.remove('hidden');
    },

    getDefaultIconForGroup(fullGroup) {
        const { secondary } = this.normalizeGroup(fullGroup);
        if (secondary === 'wechat') return '微信.PNG';
        if (secondary === 'alipay') return '支付宝.PNG';
        if (secondary === 'cash') return DEFAULT_ICON_URIS.cash;
        if (secondary === 'appstore') return DEFAULT_ICON_URIS.appstore;
        if (secondary === 'savings_card') return DEFAULT_ICON_URIS.card;
        if (secondary === 'house') return DEFAULT_ICON_URIS.house;
        if (secondary === 'car') return DEFAULT_ICON_URIS.car;
        if (secondary === 'lend') return DEFAULT_ICON_URIS.lend;
        if (secondary === 'loan') return DEFAULT_ICON_URIS.loan;
        if (secondary === 'payable') return DEFAULT_ICON_URIS.payable;
        return DEFAULT_ICON_URIS.other;
    },

    /**
     * 渲染账户列表
     */
    async renderAccountList() {
        const container = document.getElementById('accountList');
        let accounts = await this.getOrderedAccounts();
        const allTransactions = await DB.getAllTransactions();
        const txByAccountId = new Map();
        for (const t of allTransactions) {
            const accountId = Number(t?.accountId);
            if (!accountId) continue;
            if (!txByAccountId.has(accountId)) txByAccountId.set(accountId, []);
            txByAccountId.get(accountId).push(t);
        }

        // 按分组筛选
        if (this.currentGroup !== 'all') {
            accounts = accounts.filter(a => this.normalizeGroup(a.group).primary === this.currentGroup);
        }

        if (accounts.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <p class="muted">${i18n.currentLang === 'zh' ? '暂无账户，点击添加' : 'No accounts yet'}</p>
                </div>
            `;
            return;
        }

        container.innerHTML = accounts.map(account => this.renderAccountCard(account, txByAccountId.get(account.id) || [])).join('');

        // 绑定卡片事件
        container.querySelectorAll('.account-card').forEach(card => {
            const accountId = parseInt(card.dataset.id);

            // 点击卡片查看详情
            card.addEventListener('click', (e) => {
                if (Date.now() < this._suppressClickUntil) return;
                if (this.isEditMode) return;
                if (!e.target.closest('.account-actions')) {
                    this.showAccountDetail(accountId);
                }
            });

            // 编辑按钮
            card.querySelector('.btn-edit').addEventListener('click', (e) => {
                e.stopPropagation();
                this.openAccountModal(accountId);
            });

            // 更新余额按钮
            card.querySelector('.btn-update').addEventListener('click', (e) => {
                e.stopPropagation();
                this.openBalanceModal(accountId);
            });

            // 转账按钮
            card.querySelector('.btn-transfer').addEventListener('click', (e) => {
                e.stopPropagation();
                this.openTransferModal(accountId);
            });

            // 删除按钮
            card.querySelector('.btn-delete').addEventListener('click', (e) => {
                e.stopPropagation();
                this.confirmDeleteAccount(accountId);
            });
        });
    },

    /**
     * 渲染单个账户卡片
     * @param {Object} account 
     * @returns {string}
     */
    renderAccountCard(account, transactions = []) {
        const groupLabel = this.getGroupLabel(account.group);
        const isLiability = this.isLiabilityGroup(account.group);
        const balanceClass = isLiability ? 'liability' : (account.balance >= 0 ? '' : 'negative');
        const icon = account.icon || this.getDefaultIconForGroup(account.group);
        const iconHtml = icon ? `<img class="account-logo" src="${icon.startsWith('data:') ? icon : `./icons/${encodeURIComponent(icon)}`}" alt="">` : '';
        const trendHtml = this.generateMiniBalanceTrendSvg(account.balance, transactions);

        return `
            <div class="account-card" data-id="${account.id}">
                <div class="account-info">
                    <div class="account-name-row">
                        ${iconHtml}
                        <span class="account-name">${this.escapeHtml(account.name)}</span>
                    </div>
                    <span class="account-group-tag">${groupLabel}</span>
                </div>
                <div class="account-trend">${trendHtml}</div>
                <div class="account-balance ${balanceClass}">
                    ${App.formatCurrency(account.balance)}
                </div>
                <div class="account-actions">
                    <button class="account-action-btn btn-update" title="${i18n.t('updateBalance')}">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="16" height="16">
                            <polyline points="23,4 23,10 17,10"/>
                            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
                        </svg>
                    </button>
                    <button class="account-action-btn btn-transfer" title="${i18n.t('transfer')}">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="16" height="16">
                            <polyline points="17,1 21,5 17,9"/>
                            <path d="M3 11V9a4 4 0 0 1 4-4h14"/>
                            <polyline points="7,23 3,19 7,15"/>
                            <path d="M21 13v2a4 4 0 0 1-4 4H3"/>
                        </svg>
                    </button>
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

    generateMiniBalanceTrendSvg(currentBalance, transactions) {
        const points = [];
        for (const t of (transactions || [])) {
            const date = String(t?.date || '').slice(0, 10);
            const nb = Number(t?.newBalance);
            if (!date || !Number.isFinite(nb)) continue;
            points.push({ date, balance: nb, id: Number(t?.id) || 0 });
        }

        points.sort((a, b) => (a.date.localeCompare(b.date) || (a.id - b.id)));

        const lastByDate = new Map();
        for (const p of points) lastByDate.set(p.date, p.balance);

        const series = Array.from(lastByDate.entries())
            .sort((a, b) => a[0].localeCompare(b[0]))
            .slice(-30)
            .map(([, balance]) => balance);

        if (series.length < 2) {
            return `<svg class="mini-trend" width="60" height="30" viewBox="0 0 60 30" xmlns="http://www.w3.org/2000/svg"><polyline fill="none" stroke="rgba(148, 163, 184, 0.6)" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" points="0,15 60,15"/></svg>`;
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

        const pointsText = series.map((v, i) => {
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
        const salt = points.length ? (Number(points[points.length - 1].id) || 0) : 0;
        const gradientId = `balance-trend-grad-${salt}-${series.length}`;
        const areaPoints = [`0,${bottomY}`, ...pointsText, `60,${bottomY}`].join(' ');
        const linePoints = pointsText.join(' ');

        return `<svg class="mini-trend" width="60" height="30" viewBox="0 0 60 30" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="${gradientId}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${strokeColor}" stop-opacity="0.18"/><stop offset="100%" stop-color="${strokeColor}" stop-opacity="0"/></linearGradient></defs><polygon fill="url(#${gradientId})" points="${areaPoints}"/><polyline fill="none" stroke="${strokeColor}" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" points="${linePoints}"/></svg>`;
    },

    /**
     * 渲染仪表盘账户列表
     */
    async renderDashboardAccounts() {
        const container = document.getElementById('dashboardAccountList');
        const accounts = await this.getOrderedAccounts();

        if (accounts.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <p class="muted">${i18n.currentLang === 'zh' ? '暂无账户' : 'No accounts'}</p>
                </div>
            `;
            return;
        }

        const displayAccounts = accounts.slice(0, 5);
        container.innerHTML = displayAccounts.map(account => this.renderMiniAccountCard(account)).join('');
    },

    /**
     * 渲染迷你账户卡片
     * @param {Object} account 
     * @returns {string}
     */
    renderMiniAccountCard(account) {
        const isLiability = this.isLiabilityGroup(account.group);
        const balanceClass = isLiability ? 'liability' : (account.balance >= 0 ? '' : 'negative');
        const icon = account.icon || this.getDefaultIconForGroup(account.group);
        const src = icon ? (icon.startsWith('data:') ? icon : `./icons/${encodeURIComponent(icon)}`) : '';
        const title = `${account.name} · ${App.formatCurrency(account.balance)}`;

        return `
            <div class="account-card-mini">
                <img class="account-mini-logo ${balanceClass}" src="${src}" alt="" title="${this.escapeHtml(title)}">
                <div class="account-mini-amount ${balanceClass}">${App.formatCurrency(account.balance)}</div>
            </div>
        `;
    },

    /**
     * 打开账户编辑模态框
     * @param {number} accountId 
     */
    async openAccountModal(accountId = null) {
        const modal = document.getElementById('accountModal');
        const title = document.getElementById('accountModalTitle');
        const form = document.getElementById('accountForm');

        form.reset();
        document.getElementById('accountId').value = '';
        document.getElementById('accountIcon')?.removeAttribute('data-ready');
        this.updateIconPreview();
        const includeToggle = document.getElementById('includeInNetWorth');
        if (includeToggle) includeToggle.checked = true;

        let initialPrimary = 'current';
        let initialSecondary = 'cash';
        let initialIcon = null;
        let initialBillingDay = null;
        let initialRepaymentDay = null;
        let initialIncludeInNetWorth = true;
        let initialBalance = 0;

        if (accountId) {
            const account = await DB.getAccount(accountId);
            if (account) {
                title.textContent = i18n.t('editAccount');
                document.getElementById('accountId').value = account.id;
                document.getElementById('accountName').value = account.name;
                initialBalance = Number(account.balance) || 0;
                document.getElementById('accountNote').value = account.note || '';

                const normalized = this.normalizeGroup(account.group);
                initialPrimary = normalized.primary;
                initialSecondary = normalized.secondary;
                initialIcon = account.icon || null;
                initialBillingDay = account.billingDay != null ? account.billingDay : null;
                initialRepaymentDay = account.repaymentDay != null ? account.repaymentDay : null;
                initialIncludeInNetWorth = account.includeInNetWorth == null ? true : !!account.includeInNetWorth;

                document.querySelectorAll('#accountGroupSelector .type-btn[data-level="primary"]').forEach(btn => {
                    btn.classList.toggle('active', btn.dataset.group === initialPrimary);
                });
            }
        } else {
            title.textContent = i18n.t('addAccount');
            document.querySelectorAll('#accountGroupSelector .type-btn[data-level="primary"]').forEach((btn, idx) => {
                btn.classList.toggle('active', idx === 0);
            });
        }

        App.openModal(modal);

        this.renderSecondaryGroup(initialPrimary, initialSecondary);
        document.getElementById('accountGroup').value = `${initialPrimary}/${initialSecondary}`;

        const balanceEl = document.getElementById('accountBalance');
        if (balanceEl) {
            this.updateAccountBalanceUnit(`${initialPrimary}/${initialSecondary}`);
            const unit = balanceEl.dataset.unit || 'yuan';
            balanceEl.value = unit === 'wan' ? String(initialBalance / 10000) : String(initialBalance);
        }
        if (includeToggle) includeToggle.checked = initialIncludeInNetWorth;

        if (initialIcon) {
            this.ensureIconOptions();
            const iconSelect = document.getElementById('accountIcon');
            if (iconSelect) iconSelect.value = initialIcon;
            this.updateIconPreview();
        }

        const billing = document.getElementById('billingDay');
        const repayment = document.getElementById('repaymentDay');
        if (billing && initialBillingDay != null) billing.value = String(initialBillingDay);
        if (repayment && initialRepaymentDay != null) repayment.value = String(initialRepaymentDay);
    },

    /**
     * 保存账户
     */
    async saveAccount() {
        const id = document.getElementById('accountId').value;
        const name = document.getElementById('accountName').value.trim();
        const group = document.getElementById('accountGroup').value;
        const balanceEl = document.getElementById('accountBalance');
        const rawBalance = parseFloat(balanceEl?.value);
        const unit = balanceEl?.dataset?.unit || 'yuan';
        const balance = Number.isFinite(rawBalance) ? (unit === 'wan' ? rawBalance * 10000 : rawBalance) : 0;
        const note = document.getElementById('accountNote').value.trim();
        const { primary, secondary, full } = this.normalizeGroup(group);
        const rawIcon = document.getElementById('accountIcon')?.value || '';
        const includeInNetWorth = document.getElementById('includeInNetWorth')?.checked !== false;
        const billingDayValue = parseInt(document.getElementById('billingDay')?.value, 10);
        const repaymentDayValue = parseInt(document.getElementById('repaymentDay')?.value, 10);
        const billingDay = Number.isFinite(billingDayValue) ? billingDayValue : null;
        const repaymentDay = Number.isFinite(repaymentDayValue) ? repaymentDayValue : null;

        if (!name) {
            App.showToast(i18n.currentLang === 'zh' ? '请输入账户名称' : 'Please enter account name', 'error');
            return;
        }

        const isCreditCard = primary === 'liability' && secondary === 'credit_card';

        try {
            if (id) {
                // 更新账户
                const existingAccount = await DB.getAccount(parseInt(id));
                if (!existingAccount) return;
                const icon = rawIcon ? rawIcon : (existingAccount?.icon || this.getDefaultIconForGroup(full));
                const accountData = {
                    name,
                    group: full,
                    balance,
                    note,
                    icon,
                    includeInNetWorth,
                    billingDay: isCreditCard ? billingDay : null,
                    repaymentDay: isCreditCard ? repaymentDay : null
                };
                accountData.id = parseInt(id);
                accountData.createdAt = existingAccount.createdAt;
                await DB.updateAccount(accountData);

                // 如果余额有变化，记录交易
                if (existingAccount.balance !== balance) {
                    await DB.addTransaction({
                        accountId: parseInt(id),
                        type: 'adjustment',
                        previousBalance: existingAccount.balance,
                        newBalance: balance,
                        amount: balance - existingAccount.balance,
                        reason: i18n.currentLang === 'zh' ? '账户编辑' : 'Account edit',
                        date: new Date().toISOString().split('T')[0]
                    });
                }
            } else {
                // 新建账户
                const icon = rawIcon ? rawIcon : this.getDefaultIconForGroup(full);
                const accountData = {
                    name,
                    group: full,
                    balance,
                    note,
                    icon,
                    includeInNetWorth,
                    billingDay: isCreditCard ? billingDay : null,
                    repaymentDay: isCreditCard ? repaymentDay : null
                };
                const accountId = await DB.addAccount(accountData);
                await this.appendAccountToOrder(accountId);

                // 记录初始余额
                if (balance !== 0) {
                    await DB.addTransaction({
                        accountId: accountId,
                        type: 'initial',
                        previousBalance: 0,
                        newBalance: balance,
                        amount: balance,
                        reason: i18n.currentLang === 'zh' ? '初始余额' : 'Initial balance',
                        date: new Date().toISOString().split('T')[0]
                    });
                }
            }

            App.closeModal(document.getElementById('accountModal'));
            App.showToast(i18n.t('accountSaved'));

            // 刷新视图
            await this.renderAccountList();
            await this.renderDashboardAccounts();
            await App.updateDashboardStats();
            await DB.recordDailySnapshot();

        } catch (error) {
            console.error('Error saving account:', error);
            App.showToast(i18n.currentLang === 'zh' ? '保存失败' : 'Save failed', 'error');
        }
    },

    /**
     * 打开余额更新模态框
     * @param {number} accountId 
     */
    async openBalanceModal(accountId = null) {
        const modal = document.getElementById('balanceModal');
        const form = document.getElementById('balanceForm');
        const select = document.getElementById('balanceAccount');

        form.reset();
        const deltaDirEl = document.getElementById('balanceDeltaDirection');
        if (deltaDirEl) deltaDirEl.value = 'in';

        // 填充账户选择
        const accounts = await DB.getAllAccounts();
        select.innerHTML = accounts.map(a =>
            `<option value="${a.id}">${this.escapeHtml(a.name)}</option>`
        ).join('');

        // 设置默认日期为今天
        document.getElementById('changeDate').value = new Date().toISOString().split('T')[0];

        if (accountId) {
            select.value = accountId;
            const account = await DB.getAccount(accountId);
            if (account) {
                document.getElementById('previousBalance').value = App.formatCurrency(account.balance);
                document.getElementById('previousBalance').dataset.raw = String(account.balance);
                document.getElementById('newBalance').value = String(account.balance);
            }
        } else if (accounts.length > 0) {
            select.value = accounts[0].id;
            document.getElementById('previousBalance').value = App.formatCurrency(accounts[0].balance);
            document.getElementById('previousBalance').dataset.raw = String(accounts[0].balance);
            document.getElementById('newBalance').value = String(accounts[0].balance);
        }

        App.openModal(modal);
    },

    syncNewBalanceFromDelta() {
        const deltaAmountEl = document.getElementById('balanceDeltaAmount');
        const deltaDirEl = document.getElementById('balanceDeltaDirection');
        const newBalanceEl = document.getElementById('newBalance');
        const prevEl = document.getElementById('previousBalance');
        if (!deltaAmountEl || !deltaDirEl || !newBalanceEl || !prevEl) return;

        const rawPrev = parseFloat(prevEl.dataset.raw);
        if (!Number.isFinite(rawPrev)) return;

        const delta = parseFloat(deltaAmountEl.value);
        if (!Number.isFinite(delta) || delta <= 0) return;

        const sign = deltaDirEl.value === 'out' ? -1 : 1;
        newBalanceEl.value = String(rawPrev + sign * delta);
    },

    /**
     * 更新余额
     */
    async updateBalance() {
        const accountId = parseInt(document.getElementById('balanceAccount').value);
        const reason = document.getElementById('changeReason').value.trim();
        const date = document.getElementById('changeDate').value;
        const deltaAmountEl = document.getElementById('balanceDeltaAmount');
        const deltaDirEl = document.getElementById('balanceDeltaDirection');

        if (!accountId) {
            App.showToast(i18n.currentLang === 'zh' ? '请填写完整信息' : 'Please fill in all fields', 'error');
            return;
        }

        try {
            const account = await DB.getAccount(accountId);
            if (!account) return;

            const previousBalance = account.balance;
            let newBalance = NaN;

            const deltaAmount = deltaAmountEl ? parseFloat(deltaAmountEl.value) : NaN;
            const deltaDir = deltaDirEl ? String(deltaDirEl.value || '') : '';
            if (Number.isFinite(deltaAmount) && deltaAmount > 0 && (deltaDir === 'in' || deltaDir === 'out')) {
                const sign = deltaDir === 'out' ? -1 : 1;
                newBalance = previousBalance + sign * deltaAmount;
            } else {
                newBalance = parseFloat(document.getElementById('newBalance').value);
            }

            if (!Number.isFinite(newBalance)) {
                App.showToast(i18n.currentLang === 'zh' ? '请填写完整信息' : 'Please fill in all fields', 'error');
                return;
            }

            // 更新账户余额
            account.balance = newBalance;
            await DB.updateAccount(account);

            // 记录交易
            await DB.addTransaction({
                accountId: accountId,
                type: 'update',
                previousBalance: previousBalance,
                newBalance: newBalance,
                amount: newBalance - previousBalance,
                reason: reason || (i18n.currentLang === 'zh' ? '余额更新' : 'Balance update'),
                date: date
            });

            App.closeModal(document.getElementById('balanceModal'));
            App.showToast(i18n.t('balanceUpdated'));

            // 刷新视图
            await this.renderAccountList();
            await this.renderDashboardAccounts();
            await App.updateDashboardStats();
            await DB.recordDailySnapshot();

        } catch (error) {
            console.error('Error updating balance:', error);
            App.showToast(i18n.currentLang === 'zh' ? '更新失败' : 'Update failed', 'error');
        }
    },

    /**
     * 打开转账模态框
     * @param {number} fromAccountId 
     */
    async openTransferModal(fromAccountId = null) {
        const modal = document.getElementById('transferModal');
        const form = document.getElementById('transferForm');
        const fromSelect = document.getElementById('fromAccount');
        const toSelect = document.getElementById('toAccount');

        form.reset();

        // 填充账户选择
        const accounts = await DB.getAllAccounts();
        const options = accounts.map(a =>
            `<option value="${a.id}">${this.escapeHtml(a.name)} (${App.formatCurrency(a.balance)})</option>`
        ).join('');

        fromSelect.innerHTML = options;
        toSelect.innerHTML = options;

        // 设置默认日期
        document.getElementById('transferDate').value = new Date().toISOString().split('T')[0];

        if (fromAccountId) {
            fromSelect.value = fromAccountId;
        }

        App.openModal(modal);
    },

    /**
     * 执行转账（复式记账）
     */
    async executeTransfer() {
        const fromAccountId = parseInt(document.getElementById('fromAccount').value);
        const toAccountId = parseInt(document.getElementById('toAccount').value);
        const amount = parseFloat(document.getElementById('transferAmount').value);
        const note = document.getElementById('transferNote').value.trim();
        const date = document.getElementById('transferDate').value;

        if (fromAccountId === toAccountId) {
            App.showToast(i18n.currentLang === 'zh' ? '转出和转入账户不能相同' : 'From and To accounts cannot be the same', 'error');
            return;
        }

        if (!amount || amount <= 0) {
            App.showToast(i18n.currentLang === 'zh' ? '请输入有效金额' : 'Please enter a valid amount', 'error');
            return;
        }

        try {
            const fromAccount = await DB.getAccount(fromAccountId);
            const toAccount = await DB.getAccount(toAccountId);

            if (!fromAccount || !toAccount) return;

            const fromPrevBalance = fromAccount.balance;
            const toPrevBalance = toAccount.balance;

            // 更新转出账户
            fromAccount.balance -= amount;
            await DB.updateAccount(fromAccount);

            // 更新转入账户
            toAccount.balance += amount;
            await DB.updateAccount(toAccount);

            const transferNote = note || `${i18n.currentLang === 'zh' ? '转账' : 'Transfer'}: ${fromAccount.name} → ${toAccount.name}`;

            // 记录转出交易
            await DB.addTransaction({
                accountId: fromAccountId,
                type: 'transfer_out',
                previousBalance: fromPrevBalance,
                newBalance: fromAccount.balance,
                amount: -amount,
                reason: transferNote,
                relatedAccountId: toAccountId,
                date: date
            });

            // 记录转入交易
            await DB.addTransaction({
                accountId: toAccountId,
                type: 'transfer_in',
                previousBalance: toPrevBalance,
                newBalance: toAccount.balance,
                amount: amount,
                reason: transferNote,
                relatedAccountId: fromAccountId,
                date: date
            });

            App.closeModal(document.getElementById('transferModal'));
            App.showToast(i18n.t('transferCompleted'));

            // 刷新视图
            await this.renderAccountList();
            await this.renderDashboardAccounts();
            await App.updateDashboardStats();
            await DB.recordDailySnapshot();

        } catch (error) {
            console.error('Error executing transfer:', error);
            App.showToast(i18n.currentLang === 'zh' ? '转账失败' : 'Transfer failed', 'error');
        }
    },

    /**
     * 显示账户详情
     * @param {number} accountId 
     */
    async showAccountDetail(accountId) {
        const account = await DB.getAccount(accountId);
        if (!account) return;

        const modal = document.getElementById('accountDetailModal');
        const title = document.getElementById('accountDetailTitle');
        const summary = document.getElementById('accountDetailSummary');
        const historyList = document.getElementById('accountHistoryList');

        title.textContent = account.name;
        modal.dataset.accountId = String(accountId);

        const groupLabel = this.getGroupLabel(account.group);
        const isLiability = this.isLiabilityGroup(account.group);

        summary.innerHTML = `
            <div class="detail-item">
                <span class="label">${i18n.t('currentBalance')}</span>
                <span class="value ${isLiability ? 'liability' : ''}">${App.formatCurrency(account.balance)}</span>
            </div>
            <div class="detail-item">
                <span class="label">${i18n.t('accountGroup')}</span>
                <span class="value">${groupLabel}</span>
            </div>
            ${account.billingDay != null ? `
                <div class="detail-item">
                    <span class="label">${i18n.t('billingDay')}</span>
                    <span class="value">${this.escapeHtml(String(account.billingDay))}</span>
                </div>
            ` : ''}
            ${account.repaymentDay != null ? `
                <div class="detail-item">
                    <span class="label">${i18n.t('repaymentDay')}</span>
                    <span class="value">${this.escapeHtml(String(account.repaymentDay))}</span>
                </div>
            ` : ''}
            ${account.note ? `
                <div class="detail-item" style="grid-column: span 2;">
                    <span class="label">${i18n.t('note')}</span>
                    <span class="value">${this.escapeHtml(account.note)}</span>
                </div>
            ` : ''}
        `;

        // 获取交易记录
        const transactions = await DB.getTransactionsByAccount(accountId);

        if (transactions.length === 0) {
            historyList.innerHTML = `<p class="muted">${i18n.currentLang === 'zh' ? '暂无记录' : 'No records'}</p>`;
        } else {
            historyList.innerHTML = transactions.map(t => {
                const changeClass = t.amount >= 0 ? 'positive' : 'negative';
                const changeSign = t.amount >= 0 ? '+' : '';
                return `
                    <div class="history-item">
                        <span class="history-date">${t.date}</span>
                        <span class="history-reason">${this.escapeHtml(t.reason || '-')}</span>
                        <span class="history-balance">
                            ${App.formatCurrency(t.newBalance)}
                            <span class="history-change ${changeClass}">${changeSign}${App.formatCurrency(t.amount)}</span>
                        </span>
                    </div>
                `;
            }).join('');
        }

        App.openModal(modal);
    },

    /**
     * 确认删除账户
     * @param {number} accountId 
     */
    async confirmDeleteAccount(accountId) {
        const account = await DB.getAccount(accountId);
        if (!account) return;

        App.showConfirm(
            i18n.t('confirmDeleteAccount') + ` (${account.name})`,
            async () => {
                try {
                    await DB.deleteAccount(accountId);
                    await this.removeAccountFromOrder(accountId);
                    App.showToast(i18n.t('accountDeleted'));

                    await this.renderAccountList();
                    await this.renderDashboardAccounts();
                    await App.updateDashboardStats();
                    await DB.recordDailySnapshot();

                } catch (error) {
                    console.error('Error deleting account:', error);
                    App.showToast(i18n.currentLang === 'zh' ? '删除失败' : 'Delete failed', 'error');
                }
            }
        );
    },

    diffDays(fromDate, toDate) {
        const fromMs = Date.parse(`${fromDate}T00:00:00`);
        const toMs = Date.parse(`${toDate}T00:00:00`);
        if (Number.isNaN(fromMs) || Number.isNaN(toMs)) return 0;
        return Math.max(0, Math.floor((toMs - fromMs) / 86400000));
    },

    getNextMonthlyDateIso(todayIso, dayOfMonth) {
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(todayIso || ''));
        if (!m) return null;
        const y = parseInt(m[1], 10);
        const mo = parseInt(m[2], 10);
        const d = parseInt(m[3], 10);
        if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return null;

        const desired = parseInt(dayOfMonth, 10);
        if (!Number.isFinite(desired) || desired < 1) return null;

        const pad2 = (n) => String(n).padStart(2, '0');
        const daysInMonth = (yy, mm1to12) => new Date(yy, mm1to12, 0).getDate();

        const clampDay = (yy, mm1to12, dd) => {
            const dim = daysInMonth(yy, mm1to12);
            return Math.max(1, Math.min(dd, dim));
        };

        const candidateDay = clampDay(y, mo, desired);
        let candidate = `${y}-${pad2(mo)}-${pad2(candidateDay)}`;
        if (candidate > todayIso) return candidate;

        const nextMo = mo === 12 ? 1 : (mo + 1);
        const nextY = mo === 12 ? (y + 1) : y;
        const nextDay = clampDay(nextY, nextMo, desired);
        candidate = `${nextY}-${pad2(nextMo)}-${pad2(nextDay)}`;
        return candidate;
    },

    async getCreditCardReminders() {
        const accounts = await DB.getAllAccounts();
        const today = new Date().toISOString().split('T')[0];
        const reminders = [];

        for (const account of accounts) {
            const { primary, secondary } = this.normalizeGroup(account.group);
            if (primary !== 'liability' || secondary !== 'credit_card') continue;
            const balance = Number(account.balance);
            if (!Number.isFinite(balance) || balance >= 0) continue;
            if (account.repaymentDay == null) continue;

            const repaymentDate = this.getNextMonthlyDateIso(today, account.repaymentDay);
            if (!repaymentDate) continue;

            const todayMs = Date.parse(`${today}T00:00:00`);
            const repaymentMs = Date.parse(`${repaymentDate}T00:00:00`);
            if (Number.isNaN(todayMs) || Number.isNaN(repaymentMs)) continue;
            const days = Math.floor((repaymentMs - todayMs) / 86400000);
            if (days < 0 || days > 7) continue;

            const title = i18n.currentLang === 'zh'
                ? `信用卡还款提醒：${account.name}`
                : `Credit card payment reminder: ${account.name}`;

            const meta = i18n.currentLang === 'zh'
                ? (days === 0 ? `今天还款 · ${repaymentDate}` : `${days}天后还款 · ${repaymentDate}`)
                : (days === 0 ? `Payment today · ${repaymentDate}` : `Payment in ${days} day(s) · ${repaymentDate}`);

            reminders.push({
                kind: 'credit_card',
                days,
                date: repaymentDate,
                title,
                meta,
                accountId: Number(account.id),
                accountName: String(account.name || ''),
                icon: account.icon || this.getDefaultIconForGroup(account.group),
                amountDue: Math.abs(balance)
            });
        }

        return reminders;
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
window.Accounts = Accounts;
