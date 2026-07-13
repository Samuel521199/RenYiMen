#!/bin/bash
# 打包 AI 社媒工作台启动器为 macOS .app
# 运行前确保已安装：pip install rumps py2app

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "📦 检查依赖..."
pip3 install rumps py2app --quiet

echo "📝 生成 setup.py..."
cat > setup.py << 'SETUP'
from setuptools import setup

APP = ['workbench_launcher.py']
DATA_FILES = []
OPTIONS = {
    'argv_emulation': False,
    'plist': {
        'CFBundleName': 'AI工作台',
        'CFBundleDisplayName': 'AI 社媒工作台',
        'CFBundleIdentifier': 'com.aiworkbench.launcher',
        'CFBundleVersion': '1.0.0',
        'CFBundleShortVersionString': '1.0',
        'LSUIElement': True,          # 不在 Dock 显示，只在菜单栏
        'NSHighResolutionCapable': True,
        'LSMinimumSystemVersion': '12.0',
    },
    'packages': ['rumps'],
    'excludes': ['tkinter', 'test', 'unittest'],
    'iconfile': 'AppIcon.icns',       # 如有自定义图标放此处
}

setup(
    app=APP,
    data_files=DATA_FILES,
    options={'py2app': OPTIONS},
    setup_requires=['py2app'],
)
SETUP

echo "🔨 开始打包..."
python3 setup.py py2app --quiet 2>&1 | tail -10

if [ -d "dist/AI工作台.app" ]; then
    echo ""
    echo "✅ 打包成功！"
    echo "   位置：$SCRIPT_DIR/dist/AI工作台.app"
    echo ""
    echo "👉 使用方式："
    echo "   1. 将 'AI工作台.app' 拖入 /Applications 文件夹"
    echo "   2. 双击启动，菜单栏会出现图标"
    echo "   3. 如提示「无法验证开发者」："
    echo "      系统设置 → 隐私与安全性 → 仍要打开"
    echo ""
    open dist/
else
    echo "❌ 打包失败，请检查上方错误信息"
    exit 1
fi
