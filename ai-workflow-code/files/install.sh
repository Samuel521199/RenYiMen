#!/bin/bash
# 不打包，直接安装为开机自启的后台服务
# 适合不想打包 .app 的情况

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LAUNCHER="$SCRIPT_DIR/workbench_launcher.py"
PLIST="$HOME/Library/LaunchAgents/com.aiworkbench.launcher.plist"

echo "📦 安装依赖..."
pip3 install rumps --quiet

echo "📝 创建启动配置..."
PYTHON_PATH=$(which python3)

cat > "$PLIST" << PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.aiworkbench.launcher</string>
    <key>ProgramArguments</key>
    <array>
        <string>$PYTHON_PATH</string>
        <string>$LAUNCHER</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <false/>
    <key>StandardErrorPath</key>
    <string>$HOME/.aiworkbench_launcher.log</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin</string>
    </dict>
</dict>
</plist>
PLIST

echo "🚀 启动服务..."
launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"

echo ""
echo "✅ 安装完成！菜单栏已出现图标"
echo ""
echo "管理命令："
echo "  停止：launchctl unload $PLIST"
echo "  启动：launchctl load $PLIST"
echo "  卸载：launchctl unload $PLIST && rm $PLIST"
echo "  日志：tail -f ~/.aiworkbench_launcher.log"
