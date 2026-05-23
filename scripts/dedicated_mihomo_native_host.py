import json
import os
import struct
import subprocess
import sys
import time
from pathlib import Path
from urllib.error import URLError
from urllib.request import urlopen

BASE_DIR = Path(__file__).resolve().parent.parent
HELPER_SCRIPT = BASE_DIR / "scripts" / "dedicated_mihomo_helper.py"
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 18768


def read_message():
    raw_length = sys.stdin.buffer.read(4)
    if not raw_length:
        return None
    length = struct.unpack("<I", raw_length)[0]
    if length <= 0:
        return None
    raw = sys.stdin.buffer.read(length)
    return json.loads(raw.decode("utf-8"))


def write_message(payload):
    encoded = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    sys.stdout.buffer.write(struct.pack("<I", len(encoded)))
    sys.stdout.buffer.write(encoded)
    sys.stdout.buffer.flush()


def normalize_port(value, default=DEFAULT_PORT):
    try:
        numeric = int(str(value or default).strip())
    except (TypeError, ValueError):
        numeric = int(default)
    return max(1, min(65535, numeric))


def helper_status(host=DEFAULT_HOST, port=DEFAULT_PORT, timeout=1.5):
    url = f"http://{host}:{port}/status"
    try:
        with urlopen(url, timeout=timeout) as response:
            body = response.read().decode("utf-8", errors="replace")
            return json.loads(body or "{}")
    except Exception as exc:
        return {"ok": False, "running": False, "error": str(exc)}


def start_helper_server(message):
    host = str(message.get("host") or DEFAULT_HOST).strip() or DEFAULT_HOST
    port = normalize_port(message.get("port"), DEFAULT_PORT)
    status = helper_status(host, port, timeout=0.8)
    if status.get("ok"):
        return {"ok": True, "alreadyRunning": True, "status": status}

    if not HELPER_SCRIPT.exists():
        return {"ok": False, "error": f"Helper script not found: {HELPER_SCRIPT}"}

    creationflags = 0
    if os.name == "nt":
        creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0) | getattr(subprocess, "DETACHED_PROCESS", 0)

    subprocess.Popen(
        [sys.executable, str(HELPER_SCRIPT), "--host", host, "--port", str(port)],
        cwd=str(BASE_DIR),
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        close_fds=True,
        creationflags=creationflags,
    )

    last_status = None
    for _ in range(30):
        time.sleep(0.2)
        last_status = helper_status(host, port, timeout=0.8)
        if last_status.get("ok"):
            return {"ok": True, "alreadyRunning": False, "status": last_status}
    return {
        "ok": False,
        "error": f"Helper did not become ready on http://{host}:{port}",
        "status": last_status or {},
    }


def handle_message(message):
    message_type = str((message or {}).get("type") or "").strip()
    if message_type == "START_DEDICATED_MIHOMO_HELPER_SERVER":
        return start_helper_server(message or {})
    if message_type == "DEDICATED_MIHOMO_HELPER_SERVER_STATUS":
        host = str((message or {}).get("host") or DEFAULT_HOST).strip() or DEFAULT_HOST
        port = normalize_port((message or {}).get("port"), DEFAULT_PORT)
        status = helper_status(host, port, timeout=1.5)
        return {"ok": bool(status.get("ok")), "status": status}
    return {"ok": False, "error": f"Unsupported native message type: {message_type}"}


def main():
    message = read_message()
    if message is None:
        return
    try:
        write_message(handle_message(message))
    except Exception as exc:
        write_message({"ok": False, "error": str(exc)})


if __name__ == "__main__":
    main()
