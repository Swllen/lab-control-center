# Lab Server Control Center

管理 Linux GPU 服务器的网页控制台：硬件监控、SSH/tmux 终端、文件管理、
训练任务排队、用户磁盘配额和进程查看。

[English](README.md) · [任务说明](docs/JOBS.md) · [配额配置](docs/QUOTAS.md) · [安全说明](SECURITY.md)

## 安装和启动

控制台主机需要 Python 3.12+、uv、Node.js 20.9+ 和 npm。远程服务器需要 SSH
和 Python 3；GPU 监控需要 NVIDIA 驱动。可选工具详见英文 README。

```sh
git clone https://github.com/Swllen/lab-control-center.git
cd lab-control-center/backend
cp .env.example .env
uv sync
cd ../frontend
cp .env.example .env.local
npm ci
```

首次启动默认创建 `admin`。`LCC_ADMIN_PASSWORD` 留空会生成随机密码，写入本机
`backend/data/initial_admin_password.txt`；也可在首次启动前设置强密码。
修改这个变量不会重置已有账号。如果改过用户名，下次登录使用新用户名。

- **本机：** 双击 `start.cmd`。
- **其他电脑：** 双击 `start-lan.cmd`，在设置页“局域网访问”复制地址，另一台
  电脑浏览器直接打开并登录。
- `start.cmd -CheckOnly` 检查环境；`start.cmd -NoBrowser` 不自动打开浏览器。

脚本只启动缺失服务，不停止已有进程。从仅本机模式切到局域网模式，需要先停止
旧服务。局域网启动为当次进程配置当前内网 IP 的允许来源，不修改 env 文件或
防火墙；另一台电脑须能访问主机的 3000 和 8600 两个端口。

## 功能

| 页面 | 用途 |
|---|---|
| Dashboard / Hardware | CPU、内存、每张 GPU、温度、磁盘和网络 |
| Terminals | 标签、分屏、可选 tmux 与重新接入 |
| Files / Transfers | 文件预览、上传下载、服务器间复制 |
| Jobs | 等待空闲 GPU、指定卡、参数扫描、日志、重试与批量删除历史 |
| Disk Quotas | 按用户/文件系统查看用量、软硬限制、宽限期 |
| Processes | PID、用户、CPU、内存、运行时长、命令及筛选 |
| Settings | 账号、外观、AI 助手、局域网地址 |

Jobs 的 GPUs 为 0 表示 CPU-only；**Select GPUs** 勾选具体卡，等所有选中卡空闲
后启动。默认空闲标准为显存 ≤10%、GPU 利用率 ≤15%，且未被本系统任务预留。
没有系统级锁卡，无法阻止其他人手动占用。详见 [Jobs 指南](docs/JOBS.md)。

Cancel 仅停止任务；**Delete selected** 才删除已结束任务的网页历史，不删除
服务器日志、模型或 checkpoint。tmux 需要在服务器安装；普通 shell 在后端重启后
断开，tmux 可重新接入。Jobs 已经启动的程序在远程后台执行，排队启动仍需要后端在线。

配额和进程面板仅管理员可访问；配额工具需要一条只读的免密 sudo 规则，见
[QUOTAS.md](docs/QUOTAS.md)。进程查看不使用 sudo。

## 数据和安全

- 本机 `backend/data/lcc.db`：账号、服务器、任务和传输记录。
- 本机 `backend/data/`：会话签名密钥、AI 配置、数据库备份等私有数据。
- 本机 `logs/`：启动输出；`frontend/logs/`：带 UTC 时间和来源 IP 的访问记录。
- 远程 `~/.lcc/jobs/<任务ID>/`：运行脚本、输出、错误、PID 和退出码。
- 训练结果：由训练命令/配置中的输出路径决定。

这些本地数据/日志被 Git 忽略，手动打包仍须排除。公开源码不代表运行实例安全；
当前没有额外令牌核对、MFA、登录限流或完整审计。统一 Logs 页面仍是占位。
不要直接将开发服务器暴露到公网，完整边界见 [SECURITY.md](SECURITY.md)。

## 验证

```sh
cd backend
uv run python -m unittest discover -s tests
cd ../frontend
npm run typecheck
node --test scripts/request-guard.test.cjs scripts/jobs-bulk-delete.test.cjs
```

完整配置、手动启动、备份和限制见 [英文 README](README.md)。
