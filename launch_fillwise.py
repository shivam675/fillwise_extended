import os
import sys
import time
import socket
import threading
import webbrowser
from pathlib import Path
from urllib.request import urlopen

import uvicorn

HOST = "127.0.0.1"
PORT = 8000


def resource_base_dir() -> Path:
    if getattr(sys, "frozen", False):
        return Path(getattr(sys, "_MEIPASS", Path(sys.executable).parent))
    return Path(__file__).resolve().parent


def wait_for_server(url: str, timeout_sec: int = 45) -> bool:
    start = time.time()
    while time.time() - start < timeout_sec:
        try:
            with urlopen(url, timeout=2):
                return True
        except Exception:
            time.sleep(0.4)
    return False


def run_backend_server() -> None:
    base = resource_base_dir()
    backend_dir = base / "backend"
    if not backend_dir.exists():
        raise FileNotFoundError(f"Backend folder not found: {backend_dir}")

    sys.path.insert(0, str(backend_dir))
    from server import app

    uvicorn.run(app, host=HOST, port=PORT, log_level="info")


def main() -> None:
    t = threading.Thread(target=run_backend_server, daemon=True)
    t.start()

    health_url = f"http://{HOST}:{PORT}/api/health"
    app_url = f"http://{HOST}:{PORT}"

    if wait_for_server(health_url, timeout_sec=60):
        webbrowser.open(app_url)
        print(f"FillWise started at {app_url}")
    else:
        print("Failed to start FillWise backend in time.")
        sys.exit(1)

    try:
        while t.is_alive():
            time.sleep(0.7)
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
