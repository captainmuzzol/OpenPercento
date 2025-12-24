# OpenPercento

<p align="center">
  <img src="icons/OpenPercento.PNG" alt="OpenPercento Logo" width="200">
</p>

<p align="center">
  <strong>一个本地优先的极简记账/净资产管理应用</strong>
</p>

<p align="center">
  <a href="#功能特性">功能特性</a> •
  <a href="#安装指南">安装指南</a> •
  <a href="#使用方法">使用方法</a> •
  <a href="#技术栈">技术栈</a> •
  <a href="#贡献指南">贡献指南</a> •
  <a href="#许可证">许可证</a>
</p>

---

## 项目简介

OpenPercento 是一款专注于隐私保护和极简体验的个人财务管理应用。灵感来自Percento APP，并在此基础上优化功能。采用本地优先的设计理念，所有数据默认存储在本地，确保您的财务信息安全可控。支持多账户管理、投资追踪、数据可视化等核心功能，帮助您轻松掌握个人财务状况。

## 功能特性

### 核心功能

- **多账户管理**：支持现金、银行卡、支付宝、微信等多种账户类型
  <img src="icons/工商银行.PNG" alt="工商银行" width="30"> <img src="icons/招商银行.PNG" alt="招商银行" width="30"> <img src="icons/支付宝.PNG" alt="支付宝" width="30"> <img src="icons/微信.PNG" alt="微信" width="30">

- **投资追踪**：记录股票、基金、加密货币等投资产品，实时计算收益率

- **数据可视化**：通过图表直观展示收支趋势和资产分布

- **导入导出**：支持 CSV 格式的数据导入导出，方便数据迁移和备份

- **周期记账**：设置固定周期的收支记录，自动生成记账提醒

- **定投计划**：支持定期定额投资，自动记录定投交易

### 隐私保护

- 本地优先设计，数据默认存储在本地设备
- 支持 SQLite 数据库文件，可自行备份和同步
- 无需注册账号，无需联网即可使用

## 安装指南

### 快速启动

1. **安装 Python 3**：确保您的系统已安装 Python 3.7 或更高版本

2. **启动应用**：
   ```bash
   python3 server.py
   ```

3. **访问应用**：按终端输出打开地址（默认从 `http://127.0.0.1:9000/` 开始自动寻找可用端口）

### 浏览器模式

直接在浏览器中打开 `index.html` 文件即可使用，数据将存储在浏览器的 IndexedDB 中。

## 使用方法

### 数据存储

- **浏览器模式**：数据存储在浏览器本地（IndexedDB）
- **本地服务模式**：数据存储为 SQLite 文件 `openpercento.db`

### 多端同步

在“设置 → 存储 → 数据库位置”中可以切换 `openpercento.db` 的路径。将该文件放到 iCloud Drive（或其它同步目录）并在每台设备运行本地服务，即可实现多端同步。

### 周期记 / 定投

- **周期记**：进入账户详情，点击“周期记”进行设置
- **定投**：进入投资编辑页，点击“定投”进行设置

## 技术栈

- **前端**：HTML5 + CSS3 + JavaScript (ES6+)
- **后端**：Python 3 (Flask)
- **数据库**：IndexedDB (浏览器模式) / SQLite (本地服务模式)
- **图表库**：Chart.js
- **UI 设计**：响应式布局，支持深色模式

## 贡献指南

欢迎提交 Issue 和 Pull Request！

### 开发环境

1. 克隆仓库：
   ```bash
   git clone https://github.com/yourusername/OpenPercento.git
   ```

2. 安装依赖：
   ```bash
   pip install flask
   ```

3. 启动开发服务器：
   ```bash
   python3 server.py
   ```

### 提交规范

- 提交信息使用中文描述
- 遵循 Conventional Commits 规范
- 确保代码风格一致

## 待办：

1. 修复刷新价格时报错的问题
2. 关于投资-理财部分有些问题

## 许可证

MIT License - 详见 [LICENSE](LICENSE) 文件

Copyright (c) 2026 木只

---

<p align="center">
  Made with ❤️ by 木只
</p>

