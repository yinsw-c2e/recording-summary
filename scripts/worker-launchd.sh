#!/usr/bin/env bash
set -euo pipefail

LABEL="com.yinswc.recording-summary-worker"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG_DIR="$HOME/Library/Logs"
NODE_BIN="$(command -v npm)"

write_plist() {
  mkdir -p "$HOME/Library/LaunchAgents" "$LOG_DIR"
  cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>WorkingDirectory</key>
  <string>$ROOT</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE_BIN</string>
    <string>run</string>
    <string>worker</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>$LOG_DIR/recording-summary-worker.out.log</string>
  <key>StandardErrorPath</key>
  <string>$LOG_DIR/recording-summary-worker.err.log</string>
</dict>
</plist>
PLIST
}

case "${1:-status}" in
  install)
    write_plist
    launchctl unload "$PLIST" >/dev/null 2>&1 || true
    launchctl load "$PLIST"
    ;;
  uninstall)
    launchctl unload "$PLIST" >/dev/null 2>&1 || true
    rm -f "$PLIST"
    ;;
  start)
    test -f "$PLIST" || write_plist
    launchctl load "$PLIST" >/dev/null 2>&1 || true
    launchctl kickstart -k "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true
    ;;
  stop)
    launchctl unload "$PLIST" >/dev/null 2>&1 || true
    ;;
  status)
    launchctl print "gui/$(id -u)/$LABEL" 2>/dev/null || true
    ;;
  logs)
    tail -n 120 "$LOG_DIR/recording-summary-worker.out.log" "$LOG_DIR/recording-summary-worker.err.log" 2>/dev/null || true
    ;;
  *)
    echo "usage: $0 install|uninstall|start|stop|status|logs" >&2
    exit 1
    ;;
esac
