import argparse
import json
import os
import shutil
import signal
import subprocess
import time
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen

DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 18768
DEFAULT_CONTROLLER_HOST = "127.0.0.1"
DEFAULT_CONTROLLER_PORT = 9197
DEFAULT_MIXED_PORT = 7898
DEFAULT_SECRET = "gujumpgate-dedicated"
DEFAULT_GROUP_NAME = "GLOBAL"
BASE_DIR = Path(__file__).resolve().parent.parent
DEFAULT_WORK_DIR = BASE_DIR / ".runtime" / "dedicated-mihomo"
REQUEST_TIMEOUT_SECONDS = 10

STATE = {
    "process": None,
    "config": {},
    "startedAt": 0,
}


def compact(value, limit=500):
    return str(value or "").replace("\r", " ").replace("\n", " ").strip()[:limit]


def normalize_port(value, default):
    try:
        numeric = int(str(value if value is not None and str(value).strip() else default).strip())
    except (TypeError, ValueError):
        numeric = int(default)
    return max(1, min(65535, numeric))


def normalize_url(value, field_name):
    raw = str(value or "").strip()
    if not raw:
        raise RuntimeError(f"Missing {field_name}")
    parsed = urlparse(raw)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise RuntimeError(f"Invalid {field_name}: {raw}")
    return raw


def normalize_work_dir(value):
    raw = str(value or "").strip()
    target = Path(raw).expanduser() if raw else DEFAULT_WORK_DIR
    if not target.is_absolute():
        target = BASE_DIR / target
    target.mkdir(parents=True, exist_ok=True)
    (target / "providers").mkdir(parents=True, exist_ok=True)
    return target.resolve()


def resolve_mihomo_binary(raw_path=""):
    explicit = str(raw_path or os.environ.get("MIHOMO_PATH") or "").strip().strip('"')
    candidates = []
    if explicit:
        candidates.append(explicit)
    for name in ["mihomo", "mihomo.exe", "clash-meta", "clash-meta.exe", "clash", "clash.exe"]:
        found = shutil.which(name)
        if found:
            candidates.append(found)
    for candidate in candidates:
        path = Path(candidate).expanduser()
        if path.exists() and path.is_file():
            return str(path.resolve())
    raise RuntimeError("Mihomo binary not found. Set mihomoPath or MIHOMO_PATH.")


def yaml_quote(value):
    return json.dumps(str(value or ""), ensure_ascii=False)


def build_config_text(config):
    subscription_url = normalize_url(config.get("subscriptionUrl"), "subscriptionUrl")
    controller_host = str(config.get("controllerHost") or DEFAULT_CONTROLLER_HOST).strip() or DEFAULT_CONTROLLER_HOST
    controller_port = normalize_port(config.get("controllerPort"), DEFAULT_CONTROLLER_PORT)
    mixed_port = normalize_port(config.get("mixedPort"), DEFAULT_MIXED_PORT)
    secret = str(config.get("secret") or DEFAULT_SECRET).strip() or DEFAULT_SECRET
    group_name = str(config.get("groupName") or DEFAULT_GROUP_NAME).strip() or DEFAULT_GROUP_NAME
    return "\n".join([
        "allow-lan: false",
        "mode: global",
        "log-level: info",
        f"mixed-port: {mixed_port}",
        f"external-controller: {controller_host}:{controller_port}",
        f"secret: {yaml_quote(secret)}",
        "unified-delay: true",
        "tcp-concurrent: true",
        "",
        "profile:",
        "  store-selected: true",
        "",
        "proxy-providers:",
        "  airport:",
        "    type: http",
        f"    url: {yaml_quote(subscription_url)}",
        "    path: ./providers/airport.yaml",
        "    interval: 3600",
        "    health-check:",
        "      enable: true",
        "      interval: 300",
        "      url: http://www.gstatic.com/generate_204",
        "",
        "proxy-groups:",
        f"  - name: {yaml_quote(group_name)}",
        "    type: select",
        "    use:",
        "      - airport",
        "",
        "rules:",
        f"  - MATCH,{group_name}",
        "",
    ])


def is_process_running():
    process = STATE.get("process")
    return bool(process and process.poll() is None)


def request_controller(path="/version", config=None):
    runtime_config = config or STATE.get("config") or {}
    controller_host = str(runtime_config.get("controllerHost") or DEFAULT_CONTROLLER_HOST).strip() or DEFAULT_CONTROLLER_HOST
    controller_port = normalize_port(runtime_config.get("controllerPort"), DEFAULT_CONTROLLER_PORT)
    secret = str(runtime_config.get("secret") or DEFAULT_SECRET).strip() or DEFAULT_SECRET
    url = f"http://{controller_host}:{controller_port}{path}"
    headers = {"Accept": "application/json"}
    if secret:
        headers["Authorization"] = f"Bearer {secret}"
    request = Request(url, headers=headers)
    with urlopen(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
        raw = response.read().decode("utf-8", errors="replace")
        try:
            payload = json.loads(raw or "{}")
        except json.JSONDecodeError:
            payload = {"raw": raw}
        return {"ok": True, "status": response.getcode(), "url": url, "payload": payload}


def wait_controller_ready(config):
    deadline = time.time() + 8
    last_error = ""
    while time.time() < deadline:
        try:
            return request_controller("/version", config)
        except Exception as exc:
            last_error = str(exc)
            time.sleep(0.5)
    raise RuntimeError(f"Dedicated Mihomo controller is not ready: {last_error}")


def stop_process():
    process = STATE.get("process")
    if process and process.poll() is None:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)
    STATE["process"] = None
    return True


def start_process(payload):
    stop_process()
    work_dir = normalize_work_dir(payload.get("workDir"))
    mihomo_path = resolve_mihomo_binary(payload.get("mihomoPath"))
    config = {
        "subscriptionUrl": normalize_url(payload.get("subscriptionUrl"), "subscriptionUrl"),
        "mihomoPath": mihomo_path,
        "workDir": str(work_dir),
        "controllerHost": str(payload.get("controllerHost") or DEFAULT_CONTROLLER_HOST).strip() or DEFAULT_CONTROLLER_HOST,
        "controllerPort": normalize_port(payload.get("controllerPort"), DEFAULT_CONTROLLER_PORT),
        "mixedPort": normalize_port(payload.get("mixedPort"), DEFAULT_MIXED_PORT),
        "secret": str(payload.get("secret") or DEFAULT_SECRET).strip() or DEFAULT_SECRET,
        "groupName": str(payload.get("groupName") or DEFAULT_GROUP_NAME).strip() or DEFAULT_GROUP_NAME,
    }
    config_path = work_dir / "config.yaml"
    config_path.write_text(build_config_text(config), encoding="utf-8")
    process = subprocess.Popen(
        [mihomo_path, "-d", str(work_dir), "-f", str(config_path)],
        cwd=str(work_dir),
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )
    STATE["process"] = process
    STATE["config"] = {**config, "configPath": str(config_path)}
    STATE["startedAt"] = int(time.time() * 1000)
    ready = wait_controller_ready(config)
    return {
        "ok": True,
        "running": True,
        "pid": process.pid,
        "controllerUrl": f"http://{config['controllerHost']}:{config['controllerPort']}",
        "mixedPort": str(config["mixedPort"]),
        "localProxyHost": "127.0.0.1",
        "secret": config["secret"],
        "groupName": config["groupName"],
        "workDir": config["workDir"],
        "configPath": str(config_path),
        "version": ready.get("payload"),
    }


def status_payload():
    running = is_process_running()
    config = STATE.get("config") or {}
    payload = {
        "ok": True,
        "running": running,
        "pid": STATE["process"].pid if running else None,
        "startedAt": STATE.get("startedAt") or 0,
        "config": {key: value for key, value in config.items() if key != "subscriptionUrl"},
    }
    if config:
        payload.update({
            "controllerUrl": f"http://{config.get('controllerHost', DEFAULT_CONTROLLER_HOST)}:{config.get('controllerPort', DEFAULT_CONTROLLER_PORT)}",
            "mixedPort": str(config.get("mixedPort") or DEFAULT_MIXED_PORT),
            "localProxyHost": "127.0.0.1",
            "secret": str(config.get("secret") or DEFAULT_SECRET),
            "groupName": str(config.get("groupName") or DEFAULT_GROUP_NAME),
        })
    if running:
        try:
            payload["controller"] = request_controller("/version", config)
        except Exception as exc:
            payload["controllerError"] = compact(exc)
    return payload


def json_response(handler, status, payload):
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.send_header("Access-Control-Allow-Headers", "Content-Type")
    handler.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
    handler.end_headers()
    handler.wfile.write(body)


def read_json_payload(handler):
    length = int(handler.headers.get("Content-Length", "0") or 0)
    raw = handler.rfile.read(length) if length > 0 else b"{}"
    return json.loads(raw.decode("utf-8") or "{}")


class DedicatedMihomoHandler(BaseHTTPRequestHandler):
    def log_message(self, _format, *args):
        return

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()

    def do_GET(self):
        if urlparse(self.path).path in {"/", "/health", "/status"}:
            json_response(self, 200, status_payload())
            return
        json_response(self, 404, {"ok": False, "error": f"Unsupported path: {self.path}"})

    def do_POST(self):
        try:
            payload = read_json_payload(self)
            request_path = urlparse(self.path).path
            if request_path == "/start":
                json_response(self, 200, start_process(payload))
                return
            if request_path == "/stop":
                stop_process()
                json_response(self, 200, {"ok": True, "running": False})
                return
            if request_path == "/status":
                json_response(self, 200, status_payload())
                return
            json_response(self, 404, {"ok": False, "error": f"Unsupported path: {self.path}"})
        except Exception as exc:
            traceback.print_exc()
            json_response(self, 500, {"ok": False, "error": compact(exc)})


def resolve_server_config(argv=None):
    parser = argparse.ArgumentParser(description="Start GuJumpgate dedicated Mihomo helper.")
    parser.add_argument("--host", default=os.environ.get("DEDICATED_MIHOMO_HELPER_HOST") or DEFAULT_HOST)
    parser.add_argument("--port", default=os.environ.get("DEDICATED_MIHOMO_HELPER_PORT") or DEFAULT_PORT)
    args = parser.parse_args(argv)
    return str(args.host or DEFAULT_HOST).strip() or DEFAULT_HOST, normalize_port(args.port, DEFAULT_PORT)


def main(argv=None):
    host, port = resolve_server_config(argv)
    server = ThreadingHTTPServer((host, port), DedicatedMihomoHandler)
    print(f"Dedicated Mihomo helper listening on http://{host}:{port}", flush=True)
    print(f"Default work dir: {DEFAULT_WORK_DIR}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        stop_process()
        server.server_close()


if __name__ == "__main__":
    main()
