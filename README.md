# 语音想法整理

手机 H5/PWA 负责录音、查看、删除和收听；云端负责公网入口、数据、队列、DeepSeek 整理和总结；Mac Worker 负责拉取待转写录音并用本地 Whisper `large-v3` 转写。

## 本地开发

```bash
npm install
cp .env.example .env
npm run dev
```

本地默认 `STT_MODE=local`，会尝试调用 `.env` 里的 `WHISPER_BIN`。没有 DeepSeek key 时会使用 mock LLM。

## 云端配置

腾讯云推荐 `.env`：

```bash
NODE_ENV=production
PORT=8787
DATA_DIR=/var/lib/recording-summary
PUBLIC_BASE_URL=https://your-domain.example
CLIENT_ORIGIN=https://your-domain.example

APP_PASSWORD=你的访问密码
SESSION_SECRET=一段足够长的随机字符串

LLM_PROVIDER=deepseek
DEEPSEEK_API_KEY=你的_key
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-v4-flash
DEEPSEEK_PRO_MODEL=deepseek-v4-pro

STT_MODE=remote-worker
WORKER_TOKEN=一段足够长的随机字符串
TTS_PROVIDER=browser
```

云端按当前腾讯云环境使用 `Docker + 现有 Caddy`：

```bash
cd /opt/recording-summary
bash scripts/deploy.sh
```

服务容器绑定宿主机 `127.0.0.1:18787` 用于本机健康检查，同时加入
`drone-v2-prod_default` 网络；现有 V2 Caddy 通过
`scripts/install-caddy-route.sh` 按 `RECORDING_SUMMARY_ORIGIN` 反代到
`recording_summary_app:8787`。
Nginx 示例仍保留在 `deploy/nginx.recording-summary.conf`，仅作为非当前服务器的参考。

## Mac Worker

Mac `.env` 需要：

```bash
WORKER_SERVER_URL=https://your-domain.example
WORKER_TOKEN=与云端一致
WORKER_ID=mac-whisper-worker
WHISPER_BIN=/Volumes/MacStudioSSD/code/Recording-summary/.venv-whisper/bin/whisper
WHISPER_MODEL=large-v3
WHISPER_MODEL_DIR=/Volumes/MacStudioSSD/code/Recording-summary/data/whisper_models
WORKER_TEMP_DIR=/Volumes/MacStudioSSD/code/Recording-summary/data/worker_tmp
```

手动运行：

```bash
npm run worker
```

安装为 launchd 常驻：

```bash
npm run worker:install-launchd
npm run worker:status
npm run worker:logs
```

停止或卸载：

```bash
npm run worker:stop
npm run worker:uninstall-launchd
```

Worker 常驻时只轮询任务；Whisper 只在有转写任务时启动，转写完成后退出。

## GitHub Actions 部署

仓库 secrets：

```text
TENCENT_CLOUD_HOST
TENCENT_CLOUD_USER
TENCENT_CLOUD_SSH_KEY
TENCENT_CLOUD_PORT
RECORDING_SUMMARY_ORIGIN
APP_PASSWORD
SESSION_SECRET
DEEPSEEK_API_KEY
WORKER_TOKEN
```

`TENCENT_CLOUD_PORT` 默认可以不填，等同于 `22`。`RECORDING_SUMMARY_ORIGIN`
用于部署后的公网健康检查，例如 `https://recording.swvictory.com`。
`APP_PASSWORD` 是手机访问登录密码；`SESSION_SECRET` 和 `WORKER_TOKEN`
用足够长的随机字符串；`DEEPSEEK_API_KEY` 用你的 DeepSeek key。

服务器首次准备：

```bash
sudo mkdir -p /opt/recording-summary /var/lib/recording-summary
sudo chown -R "$USER":"$USER" /opt/recording-summary /var/lib/recording-summary
```

之后 push 到 `main` 会自动运行测试、构建，并通过 SSH/rsync 同步代码到
`/opt/recording-summary`，从 GitHub Secrets 生成生产 `.env`，再执行
`scripts/deploy.sh` 构建/重启 Docker 容器。填了 `RECORDING_SUMMARY_ORIGIN`
时，Actions 会自动把该域名路由写入 `/opt/drone_v2/backend/Caddyfile` 并 reload
Caddy。服务器不需要配置 GitHub 读仓库凭据。

如果仓库是 `yinsw-c2e/recording-summary`，Actions secrets 页面是：

```text
https://github.com/yinsw-c2e/recording-summary/settings/secrets/actions
```

## 验证

```bash
npm test
npm run build
```
