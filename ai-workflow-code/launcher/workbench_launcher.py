#!/usr/bin/env python3
"""
AI 社媒工作台 — macOS 菜单栏启动器
依赖：pip install rumps
"""

import rumps
import subprocess
import threading
import webbrowser
import os
import json

PROJECT_DIR = "/Volumes/AIWork/projects/ai-image-workbench"
FRONTEND_URL = "http://localhost:3010"

def find_compose():
    for p in [
        "/opt/homebrew/bin/docker-compose",
        "/usr/local/bin/docker-compose",
        "/usr/bin/docker-compose",
    ]:
        if os.path.exists(p):
            return p
    return "docker-compose"

def run_cmd(args):
    env = os.environ.copy()
    env["PATH"] = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:" + env.get("PATH", "")
    return subprocess.run(
        args,
        capture_output=True,
        text=True,
        cwd=PROJECT_DIR,
        env=env,
    )

def compose(subcmd):
    bin = find_compose()
    return run_cmd([bin, "-f", f"{PROJECT_DIR}/docker-compose.yml"] + subcmd)

def get_status():
    services = {"frontend": False, "backend": False, "db": False, "redis": False}
    result = compose(["ps"])
    if result.returncode == 0:
        for line in result.stdout.splitlines():
            for key in services:
                if key in line and ("Up" in line or "running" in line):
                    services[key] = True
    return services


class WorkbenchApp(rumps.App):
    def __init__(self):
        super().__init__(name="AI工作台", title="⚫", quit_button=None)
        self._lock = threading.Lock()

        self.open_item    = rumps.MenuItem("打开工作台", callback=self.open_browser)
        self.start_item   = rumps.MenuItem("启动服务",   callback=self.start_services)
        self.stop_item    = rumps.MenuItem("停止服务",   callback=self.stop_services)
        self.restart_item = rumps.MenuItem("重启服务",   callback=self.restart_services)
        self.rebuild_item = rumps.MenuItem("重建并启动（代码更新后）", callback=self.rebuild_services)

        self.s_frontend = rumps.MenuItem("  前端")
        self.s_backend  = rumps.MenuItem("  后端 API")
        self.s_db       = rumps.MenuItem("  数据库")
        self.s_redis    = rumps.MenuItem("  Redis")
        for i in [self.s_frontend, self.s_backend, self.s_db, self.s_redis]:
            i.set_callback(None)

        self.quit_item = rumps.MenuItem("退出启动器", callback=rumps.quit_application)

        self.menu = [
            self.open_item,
            None,
            self.start_item,
            self.stop_item,
            self.restart_item,
            self.rebuild_item,
            None,
            "── 服务状态 ──",
            self.s_frontend,
            self.s_backend,
            self.s_db,
            self.s_redis,
            None,
            self.quit_item,
        ]

        rumps.Timer(self.refresh_status, 5).start()
        self.refresh_status(None)

    def _dot(self, ok):
        return "🟢 " if ok else "⚫ "

    def refresh_status(self, _):
        s = get_status()
        self.s_frontend.title = f"  {self._dot(s['frontend'])}前端       {'运行中' if s['frontend'] else '已停止'}"
        self.s_backend.title  = f"  {self._dot(s['backend'])} 后端 API  {'运行中' if s['backend'] else '已停止'}"
        self.s_db.title       = f"  {self._dot(s['db'])}    数据库   {'运行中' if s['db'] else '已停止'}"
        self.s_redis.title    = f"  {self._dot(s['redis'])} Redis     {'运行中' if s['redis'] else '已停止'}"

        if all(s.values()):
            self.title = "🟢"
        elif any(s.values()):
            self.title = "🟡"
        else:
            self.title = "⚫"

    def open_browser(self, _):
        webbrowser.open(FRONTEND_URL)

    def _run_async(self, label, cmd_args):
        def task():
            old_title = self.title
            self.title = "⏳"
            self.start_item.set_callback(None)
            self.stop_item.set_callback(None)
            compose(cmd_args)
            self.start_item.set_callback(self.start_services)
            self.stop_item.set_callback(self.stop_services)
            self.refresh_status(None)
        threading.Thread(target=task, daemon=True).start()

    def start_services(self, _):
        self._run_async("启动中", ["up", "-d"])

    def stop_services(self, _):
        self._run_async("停止中", ["down"])

    def restart_services(self, _):
        self._run_async("重启中", ["restart"])

    def rebuild_services(self, _):
        self._run_async("重建中", ["up", "-d", "--build"])


if __name__ == "__main__":
    WorkbenchApp().run()
