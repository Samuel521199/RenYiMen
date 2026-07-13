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
import sys

PROJECT_DIR = "/Volumes/AIWork/projects/ai-image-workbench"
FRONTEND_URL = "http://localhost:3010"
COMPOSE_CMD = ["docker-compose", "-f", f"{PROJECT_DIR}/docker-compose.yml"]


def run(args, **kwargs):
    return subprocess.run(
        args,
        capture_output=True,
        text=True,
        cwd=PROJECT_DIR,
        **kwargs,
    )


def get_status():
    """返回各服务运行状态 dict"""
    result = run(COMPOSE_CMD + ["ps", "--format", "json"])
    services = {"frontend": False, "backend": False, "db": False, "redis": False}
    if result.returncode == 0 and result.stdout.strip():
        import json
        try:
            data = json.loads(result.stdout)
            if isinstance(data, dict):
                data = [data]
            for svc in data:
                name = svc.get("Service", svc.get("Name", ""))
                state = svc.get("State", svc.get("Status", ""))
                for key in services:
                    if key in name and "running" in state.lower():
                        services[key] = True
        except Exception:
            # 兼容旧版 docker-compose ps 纯文本输出
            for line in result.stdout.splitlines():
                for key in services:
                    if key in line and ("Up" in line or "running" in line):
                        services[key] = True
    return services


def all_running(status):
    return all(status.values())


def any_running(status):
    return any(status.values())


class WorkbenchApp(rumps.App):
    def __init__(self):
        super().__init__(
            name="AI工作台",
            title="🎨",
            quit_button=None,
        )
        self._lock = threading.Lock()
        self._busy = False

        self.open_item = rumps.MenuItem("打开工作台", callback=self.open_browser)
        self.start_item = rumps.MenuItem("启动服务", callback=self.start_services)
        self.stop_item = rumps.MenuItem("停止服务", callback=self.stop_services)
        self.restart_item = rumps.MenuItem("重启服务", callback=self.restart_services)
        self.rebuild_item = rumps.MenuItem("重建并启动（更新代码后）", callback=self.rebuild_services)

        self.status_frontend = rumps.MenuItem("  前端      —")
        self.status_backend = rumps.MenuItem("  后端 API  —")
        self.status_db = rumps.MenuItem("  数据库    —")
        self.status_redis = rumps.MenuItem("  Redis     —")

        for item in [
            self.status_frontend,
            self.status_backend,
            self.status_db,
            self.status_redis,
        ]:
            item.set_callback(None)

        self.quit_item = rumps.MenuItem("退出启动器", callback=rumps.quit_application)

        self.menu = [
            self.open_item,
            None,
            self.start_item,
            self.stop_item,
            self.restart_item,
            self.rebuild_item,
            None,
            "服务状态",
            self.status_frontend,
            self.status_backend,
            self.status_db,
            self.status_redis,
            None,
            self.quit_item,
        ]

        self.timer = rumps.Timer(self.refresh_status, 5)
        self.timer.start()
        self.refresh_status(None)

    def _svc_icon(self, running):
        return "● " if running else "○ "

    def refresh_status(self, _):
        status = get_status()
        labels = {
            "frontend": "前端      ",
            "backend":  "后端 API  ",
            "db":       "数据库    ",
            "redis":    "Redis     ",
        }
        items = {
            "frontend": self.status_frontend,
            "backend":  self.status_backend,
            "db":       self.status_db,
            "redis":    self.status_redis,
        }
        for key, item in items.items():
            icon = self._svc_icon(status[key])
            state = "运行中" if status[key] else "已停止"
            item.title = f"  {icon}{labels[key]} {state}"

        if all_running(status):
            self.title = "🟢"
            self.open_item.set_callback(self.open_browser)
        elif any_running(status):
            self.title = "🟡"
            self.open_item.set_callback(self.open_browser)
        else:
            self.title = "⚫"
            self.open_item.set_callback(None)

    def _set_busy(self, busy, label=None):
        self._busy = busy
        if busy:
            self.title = "⏳"
            self.start_item.set_callback(None)
            self.stop_item.set_callback(None)
            self.restart_item.set_callback(None)
            self.rebuild_item.set_callback(None)
            if label:
                rumps.notification("AI 社媒工作台", label, "", sound=False)
        else:
            self.start_item.set_callback(self.start_services)
            self.stop_item.set_callback(self.stop_services)
            self.restart_item.set_callback(self.restart_services)
            self.rebuild_item.set_callback(self.rebuild_services)
            self.refresh_status(None)

    def open_browser(self, _):
        webbrowser.open(FRONTEND_URL)

    def start_services(self, _):
        def task():
            self._set_busy(True, "正在启动服务...")
            run(COMPOSE_CMD + ["up", "-d"])
            self._set_busy(False)
            rumps.notification("AI 社媒工作台", "✅ 服务已启动", FRONTEND_URL, sound=False)
        threading.Thread(target=task, daemon=True).start()

    def stop_services(self, _):
        def task():
            self._set_busy(True, "正在停止服务...")
            run(COMPOSE_CMD + ["down"])
            self._set_busy(False)
            rumps.notification("AI 社媒工作台", "服务已停止", "", sound=False)
        threading.Thread(target=task, daemon=True).start()

    def restart_services(self, _):
        def task():
            self._set_busy(True, "正在重启服务...")
            run(COMPOSE_CMD + ["restart"])
            self._set_busy(False)
            rumps.notification("AI 社媒工作台", "✅ 服务已重启", FRONTEND_URL, sound=False)
        threading.Thread(target=task, daemon=True).start()

    def rebuild_services(self, _):
        def task():
            self._set_busy(True, "正在重建镜像，可能需要几分钟...")
            run(COMPOSE_CMD + ["up", "-d", "--build"])
            self._set_busy(False)
            rumps.notification("AI 社媒工作台", "✅ 重建完成", FRONTEND_URL, sound=False)
        threading.Thread(target=task, daemon=True).start()


if __name__ == "__main__":
    WorkbenchApp().run()
