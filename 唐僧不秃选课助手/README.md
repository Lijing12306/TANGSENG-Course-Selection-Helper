# 浙江工商大学教务系统 · 自动选课助手

面向 `https://jwxt.zjgsu.edu.cn`（正方教务管理系统 **V-9.0**，`gnmkdm=N253512` 自主选课）的自动选课工具。

- **纯后端脚本 + 本地 Web 控制台**，电脑常开运行
- **零 npm 依赖**，只用 Node.js 内置模块
- 功能：账号密码登录、课程浏览搜索、多门课程同时监控、定时轮询自动抢、抢到通知（本地/浏览器/Webhook）、崩溃恢复

> ⚠️ **免责声明**：本工具仅供 **本人在自己的账号上** 辅助选课使用。请遵守浙江工商大学的选课规定，不要用于多账号代刷、高频压测或任何影响教务系统正常运行的行为。使用风险自负。

---

## 一、快速开始

### 1. 环境

需要 Node.js（≥18）。可以直接用 HBuilderX 自带的：

```
D:\HBuilderX.5.15.2026070915\HBuilderX\plugins\node\node.exe
```

或自行安装 Node.js 后把 `start.cmd` 里的 `NODE` 变量改成 `node`。

### 2. 启动

双击 **`start.cmd`**，或在项目目录执行：

```bash
node src/main.js
```

浏览器会自动打开 `http://127.0.0.1:8787/?token=xxxx`（带上启动时打印的本地令牌）。
控制台只绑定 `127.0.0.1`，不对外网开放。

### 3. 首次使用顺序

| 步骤 | 位置 | 说明 |
|---|---|---|
| 1 | 【设置】 | 填写学号、密码，点「保存设置」 |
| 2 | 【总览】 | 点「立即登录」。**本系统密码登录需要验证码**，会弹出图片，输入后提交 |
| 3 | 【抓包导入】 | 完成一次抓包并「应用」，把选课接口校准（**这一步是抢课的前提**） |
| 4 | 【课程】 | 查询课程，找到目标后点「加入监控」 |
| 5 | 【任务】 | 核对任务条件，设置开抢时间，创建 |
| 6 | 【任务】/【总览】 | 点「启动引擎」开始自动抢课 |

---

## 二、登录方式说明（重要）

实测结论：**浙江工商大学的教务系统密码登录需要图形验证码**（`/jwglxt/kaptcha`），因此：

- **方式 A（推荐）**：在控制台【总览】点「立即登录」，输入弹出的验证码完成登录。登录一次后可维持较长时间会话。
- **方式 B（降级）**：若自动登录被 CAS 或验证码反复阻断，可在浏览器登录教务系统后，
  按 `F12` → Application → Cookies，复制 `JSESSIONID` 和 `route`，
  粘贴到【设置】→「手动 Cookie」并保存。

> 注意：抓包脚本与「手动 Cookie」都不需要你提供密码，安全性更高。

---

## 三、傻瓜式抓包（校准选课接口）

选课接口的参数名无法凭空推断，必须用一次真实抓包确定。**你不需要懂抓包**，按下面 6 步做即可：

1. 浏览器打开并**登录**选课页（地址含 `zzxkyzb_cxZzxkYzbIndex.html`）
2. 按 `F12` → 切到 **Console（控制台）**
3. 在工具的【抓包导入】页点「复制抓包脚本」，粘贴到控制台并回车
   —— 看到绿色 `[capture] 已安装 ✅` 即成功
4. 在控制台执行 `__capMark("选课")`，然后**手动点一次「选课」按钮**，等它出结果
5. 执行 `__capTable()`，看到 `path` 里带 `zzxkyzb` 的 POST 就说明抓到了
6. 执行 `__capCopy()` 复制（或 `__capDownload()` 下载），粘贴回【抓包导入】页 → 点「解析并对比差异」→ 核对后点「应用并标记为已校准」

脚本只记录你手动操作的那一次请求，**不会自动重放、不会自动提交**。

### 如果抓不到

- 抓包脚本记录了 **XHR / fetch / 原生 form 提交** 三类。若什么都没抓到，改用手工方式：
  - `F12` → Network → 勾选 **Preserve log** → 筛选 `Fetch/XHR` → 搜索 `zzxkyzb`
  - 再点一次「选课」，找到新增的 POST 请求
  - 右键该请求 → **Copy → Copy as cURL**，把整段文本粘进【抓包导入】页（同样支持）
- 手工方式需要抄的 4 处：`Request URL`、`Request Method`、`Payload/Form Data` 全部键值对、`Response` 前 300 字。

---

## 四、配置文件

首次启动会自动从 `*.example.json` 生成 `config/config.json`、`config/actions.json`、`config/result-rules.json`。
这三个文件 **已加入 `.gitignore`**，不会含凭据泄露到版本库。

### `config/config.json`

| 字段 | 说明 |
|---|---|
| `account` | 学号（密码请用控制台保存，会加密写入 `data/secrets.json`） |
| `term.xnm` / `term.xqm` | 学年 / 学期，留空则自动从选课首页解析 |
| `engine.requestsPerSecond` | 稳态请求速率（默认 1 次/秒） |
| `engine.maxConcurrentRequests` | 最大并发（默认 2） |
| `engine.defaultIntervalMs` | 常规轮询间隔（默认 3000ms） |
| `engine.dryRun` | 试运行：不真正提交，只记录命中情况 |
| `session.manualCookie` | 手动 Cookie 降级方案 |
| `notify.channels` | 通知通道（见下） |

### `config/actions.json`

**接口动作定义**，抓包导入会自动更新。代码中没有任何选课 URL 字符串，参数不符时只需改这里。

### `config/result-rules.json`

选课结果判定规则（正则）。未命中的响应会记为 `unknown` 并把**原始响应文本**写进日志，
可在【日志】里查看后补充规则，保存即热重载，无需改代码、无需重启。

---

## 五、通知

在 `config/config.json` 的 `notify.channels` 中启用。控制台【设置】有「测试所有已启用通道」。

| 通道 | 配置项 |
|---|---|
| `local` | Windows Toast + 系统提示音（`toast` / `sound`） |
| `browser` | 控制台页面通知（首次需点「开启浏览器通知」授权） |
| `webhook` + `pushplus` | `token` |
| `webhook` + `serverchan` | `sendKey` |
| `webhook` + `wecom` | `webhookKey`（企业微信机器人） |
| `webhook` + `dingtalk` | `accessToken`、可选 `secret`（加签） |
| `webhook` + `bark` | `key` |
| `webhook` + `telegram` | `botToken`、`chatId` |

事件类型：`login-ok` / `login-fail` / `captcha-required` / `course-available` /
`select-success` / `select-fatal` / `task-expired` / `engine-paused`。
`events: ["*"]` 表示全部。

---

## 六、抢课机制与风控

- **时间窗口**：距开抢 `>15s` 用常规间隔；进入 15s 内收紧到 1s；开抢后进入 **burst 模式**（约 700ms），持续 15s 后回落
- **时钟校准**：用响应 `Date` 头校正本机时钟漂移，避免「差 2 秒就抢不到」
- **抖动**：每次调度 ±15% 随机抖动，避免多任务齐发
- **全局限流**：令牌桶 + 并发闸门（默认 1 次/秒、并发 2）
- **自动降速**：遇到「操作过于频繁 / 系统繁忙」→ 全局降速到 0.5 次/秒并冷却 60s
- **三层防重复提交**：
  1. `jxb_id` 级互斥（同一教学班同时只有一个在途选课请求）
  2. 幂等键 + 10s 去重窗口
  3. 提交后回查「已选列表」确认，避免误报成功或重复提交
- **名额不确定时默认「先试一次」**：宁可多提交一次（服务端会回「人数已满」），也不因解析错字段漏过名额

> 请保持默认频率。调高频率既可能被教务系统限流/拉黑，也会影响其他同学，属于违规使用。

---

## 七、命令行工具

```bash
node src/main.js doctor        # 全链路自检：登录页 / RSA 公钥 / 加密 / Cookie
node src/main.js selftest      # RSA 加密自测（不联网）
node src/main.js set-account 20230001 密码   # 加密保存账号
node src/main.js login         # 验证登录（会提示输入验证码）
node src/main.js term          # 解析学年学期
node src/main.js query 数据结构   # 查询课程
node src/main.js selected      # 查看已选课程
node src/main.js select <kchId> <jxbId>   # 手动选课一次
node src/main.js drop   <kchId> <jxbId>   # 手动退课
node src/main.js smoke         # 服务端接口冒烟测试（不联网教务系统）
```

---

## 八、技术实现要点

| 环节 | 实现 |
|---|---|
| 登录 | `GET login_slogin.html` 取 csrftoken → `GET login_getPublicKey.html` 取 RSA 公钥 → 密码 **PKCS#1 v1.5** 加密 → `POST login_slogin.html?time=<ms>` |
| RSA | 纯 JS BigInt 实现（与前端 jsbn 完全一致），另提供「构造 PEM + OpenSSL」备选路径 |
| 验证码 | 服务端返回「验证码输入错误」时自动 `GET /jwglxt/kaptcha` 并把图片回传控制台 |
| Cookie | 零依赖 CookieJar，**必须保留 `JSESSIONID` 与 `route`**（nginx 粘性会话，丢 `route` 会假性掉线） |
| 会话 | 每 60s 探测一次；失效则 single-flight 自动重登；重登遇验证码 → 暂停引擎并通知 |
| 持久化 | `data/state.json` 原子写 + `data/state.jsonl` 事件流；重启先查「已选列表」再决定是否续跑 |

---

## 九、目录结构

```
选课爬虫/
├─ start.cmd                 一键启动
├─ config/                   配置（config/actions/result-rules，含 .example 模板）
├─ data/                     运行时数据（Cookie / 加密凭据 / 任务状态 / 日志）
├─ public/                   控制台前端（纯 HTML + 原生 JS）
│  └─ assets/capture-snippet.js   抓包控制台脚本
├─ src/
│  ├─ core/                  配置 / 日志 / 存储 / 加密 / 错误
│  ├─ http/                  HTTP 客户端 / CookieJar / 限流器 / 模板
│  ├─ auth/                  RSA / 登录 / 会话 / HTML 解析
│  ├─ zf/                    接口执行器 / 课程 / 结果判定
│  ├─ engine/                任务模型 / 调度 / 锁 / 抢课引擎
│  ├─ notify/                通知（本地 / 浏览器 / Webhook）
│  ├─ capture/               抓包导入与 DIFF
│  ├─ server/                HTTP 服务 / SSE / API 路由
│  ├─ cli.js                 命令行
│  └─ main.js                入口
└─ tools/                    doctor / rsa-selftest / smoke-test
```

---

## 十、常见问题

| 现象 | 原因与处理 |
|---|---|
| 登录弹验证码 | **正常现象**，本系统密码登录需要验证码，输入即可 |
| 查询课程提示「接口未校准」 | 先完成【抓包导入】并点「应用」 |
| 查询返回空 / 选课提示参数错误 | 抓包数据与配置不一致，重新抓包导入（只需改 `actions.json`） |
| 频繁提示「操作过于频繁」 | 已自动降速冷却；请勿手动调高频率 |
| 日志出现 `unknown` 判定 | 规则未命中，在【日志】查看原始响应文本，到 `result-rules.json` 补正则 |
| 启动后浏览器没打开 | 手动访问控制台打印的地址（带 `?token=`） |
| 引擎自动暂停 | 通常是重登遇到验证码，到【总览】重新登录后再启动引擎 |

---

## 十一、开机自启（可选）

用 Windows「任务计划程序」新建任务：
- 触发器：**登录时**
- 操作：启动程序 `D:\HBuilderX.5.15.2026070915\HBuilderX\plugins\node\node.exe`，参数 `src\main.js`，起始于项目目录
- 勾选「不管用户是否登录都要运行」按需设置，勾选「隐藏」避免弹窗
