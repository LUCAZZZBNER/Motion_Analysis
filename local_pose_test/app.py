"""Serve the small browser application on this computer; Python performs no inference."""
from __future__ import annotations

import argparse
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import mimetypes
from pathlib import Path
from urllib.parse import unquote, urlsplit
import webbrowser

ROOT = Path(__file__).resolve().parent
GB = 1_000_000_000
ENTRY_FILES = {"index.html", "styles.css", "app.mjs", "core.mjs", "pose-worker.mjs", "pose-view3d.mjs"}


def resource_status() -> dict:
    required = [
        "assets/models/pose_landmarker_lite.task",
        "assets/vendor/tasks-vision/vision_bundle.mjs",
        "assets/vendor/tasks-vision/wasm/vision_wasm_module_internal.js",
        "assets/vendor/tasks-vision/wasm/vision_wasm_module_internal.wasm",
    ]
    missing = [name for name in required if not (ROOT / name).is_file()]
    package_path = ROOT / "assets/vendor/tasks-vision/package.json"
    version = None
    if package_path.is_file():
        version = json.loads(package_path.read_text(encoding="utf-8")).get("version")
    total = sum(p.stat().st_size for p in ROOT.rglob("*") if p.is_file() and p.resolve().is_relative_to(ROOT.resolve()))
    return {"ready": not missing and version == "1.0.1" and total <= 5*GB,
            "missing": missing, "runtime_version": version, "project_bytes": total,
            "disk_limit_bytes": 5*GB, "memory_limit_bytes": GB,
            "provider": "MediaPipe Pose Landmarker Lite / local browser CPU",
            "cloud_inference": False}


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        self.send_header("Origin-Agent-Cluster", "?1")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Permissions-Policy", "camera=(), microphone=()")
        self.send_header("Content-Security-Policy",
            "default-src 'self'; script-src 'self' 'wasm-unsafe-eval' 'unsafe-eval'; "
            "style-src 'self'; img-src 'self' blob: data:; media-src 'self' blob:; "
            "worker-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'")
        super().end_headers()

    def do_GET(self):
        if urlsplit(self.path).path == "/api/status":
            data = json.dumps(resource_status(), ensure_ascii=False).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        else:
            super().do_GET()

    def send_head(self):
        path = unquote(urlsplit(self.path).path).lstrip("/") or "index.html"
        resolved = (ROOT / path).resolve()
        relative = resolved.relative_to(ROOT.resolve()).as_posix() if resolved.is_relative_to(ROOT.resolve()) else ""
        if (not relative or not resolved.is_file()
            or not (relative in ENTRY_FILES or relative.startswith("assets/models/") or relative.startswith("assets/vendor/"))):
            self.send_error(404, "File not available")
            return None
        if path == "index.html" and urlsplit(self.path).path == "/":
            self.path = "/index.html"
        return super().send_head()

    def list_directory(self, path):
        self.send_error(404, "Directory listing disabled")
        return None


def main():
    parser = argparse.ArgumentParser(description="Start the local MediaPipe Lite browser test.")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--no-browser", action="store_true")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    if not 1024 <= args.port <= 65535:
        parser.error("Port must be between 1024 and 65535.")
    status = resource_status()
    if args.check:
        print(json.dumps(status, ensure_ascii=False))
        raise SystemExit(0 if status["ready"] else 1)
    if not status["ready"]:
        raise SystemExit("Local resources are missing, wrong-version, or the project exceeds 5 GB. See README.md.")
    mimetypes.add_type("text/javascript", ".mjs")
    mimetypes.add_type("application/wasm", ".wasm")
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    url = f"http://127.0.0.1:{args.port}"
    print(f"Local pose test: {url}\nPress Ctrl+C to stop.", flush=True)
    if not args.no_browser:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("Stopped.", flush=True)
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
