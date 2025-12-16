# ZenithFlow

ZenithFlow是一个结合GTD、时间盒、番茄时钟与日程管理的个人任务管理工作平台，主要遵循GTD与时间盒的理念，降低拖延与任务多的负担和焦虑。

## 功能特性

### 核心功能
- **任务管理**：创建、编辑、删除任务，支持任务优先级、标签和分类
- **日历视图**：日视图、周视图、月视图，直观展示任务安排
- **时间盒管理**：支持拖动调整任务持续时间，自动对齐时间
- **导航功能**：自定义导航页面，方便访问常用网站
- **统计报表**：任务完成情况统计（待实现）
- **设置功能**：个性化配置（待实现）

### 视图模式
- **工作台**：默认视图，集成日历和任务管理
- **导航**：自定义导航页面，支持添加、编辑和分类管理常用网站

## 技术栈

- **后端**：Python 3.8+，Flask
- **前端**：HTML5，Tailwind CSS，JavaScript
- **数据库**：SQLite
- **其他**：RESTful API

## 安装与运行

### 环境要求
- Python 3.8+
- pip

### 安装步骤

1. 克隆仓库
   ```bash
   git clone https://github.com/huyanghun99/ZenithFlow.git
   cd ZenithFlow
   ```

2. 创建虚拟环境（可选但推荐）
   ```bash
   python -m venv .venv
   ```

3. 激活虚拟环境
   - Windows
     ```bash
     .venv\Scripts\activate
     ```
   - Linux/macOS
     ```bash
     source .venv/bin/activate
     ```

4. 安装依赖
   ```bash
   pip install -r requirements.txt
   ```

5. 运行应用
   ```bash
   python app.py
   ```

6. 访问应用
   打开浏览器访问 http://127.0.0.1:15001

## 项目结构

```
ZenithFlow/
├── app.py              # Flask应用主文件
├── db.sqlite3          # SQLite数据库文件
├── requirements.txt    # 项目依赖
├── README.md           # 项目说明文档
├── static/             # 静态资源目录
│   └── app.js          # 前端JavaScript代码
└── templates/          # HTML模板目录
    ├── index.html      # 工作台页面
    └── nav.html        # 导航页面
```

## 主要功能说明

### 1. 任务管理
- 在工作台页面可以创建、编辑和删除任务
- 支持拖动任务调整时间和位置
- 支持调整任务持续时间
- 任务会自动对齐到5分钟的倍数
- 最小任务持续时间为15分钟

### 2. 日历视图
- **日视图**：按小时展示当天任务
- **周视图**：展示一周的任务安排
- **月视图**：概览当月任务
- 支持在不同视图之间切换

### 3. 导航功能
- 自定义导航页面，方便访问常用网站
- 支持添加、编辑和删除网站链接
- 支持分组管理网站
- 支持导入导出导航数据

## 开发说明

### 后端API

#### 健康检查
- **GET** `/api/health`：检查应用健康状态

#### 应用状态
- **GET** `/api/state`：获取应用状态
- **POST** `/api/state`：保存应用状态

#### 导航数据
- **GET** `/api/nav`：获取导航数据
- **POST** `/api/nav`：保存导航数据

### 前端开发

前端代码主要位于 `static/app.js`，使用原生JavaScript编写，主要功能包括：
- 任务渲染和交互
- 日历视图切换
- 任务拖动和调整
- 导航页面功能

### 数据库结构

使用SQLite数据库，主要包含一个 `kv` 表，用于存储键值对数据：
- `k`：键名
- `v`：值
- `updated_at`：更新时间

## 许可证

Apache License 2.0

## 贡献

欢迎提交Issue和Pull Request！

## 联系方式

如有问题或建议，请通过以下方式联系：
- GitHub Issues：https://github.com/huyanghun99/ZenithFlow/issues

## 更新日志

### v1.0.0
- 初始版本
- 实现任务管理功能
- 实现日历视图（日、周、月）
- 实现导航功能
- 支持任务拖动和调整持续时间
