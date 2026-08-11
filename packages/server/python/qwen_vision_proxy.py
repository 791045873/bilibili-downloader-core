"""
Qwen vision thin proxy.

Node.js owns the full analysis orchestration and sends an OpenAI-style
multimodal request here. This proxy only converts local media paths to the
DashScope Python SDK message format, calls the model, and returns an
OpenAI-style response body.
"""

from __future__ import annotations

import json
import logging
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlparse, unquote

logger = logging.getLogger("qwen_vision_proxy")

def missing_dependency_exit(missing_dependency: str, missing_module: str) -> NoReturn:
    python_dir = Path(__file__).resolve().parent
    sys.stderr.write(
        "Qwen vision proxy is missing Python dependency "
        f"'{missing_dependency}' (module: {missing_module}).\n"
        "Install the proxy dependencies from the repo root with:\n"
        f"  pnpm setup:vision-proxy\n"
        f"  (declared in {python_dir / 'pyproject.toml'})\n"
    )
    raise SystemExit(1)


try:
    import dashscope
    from dashscope import MultiModalConversation
except ModuleNotFoundError as err:
    missing_dependency_exit("dashscope", err.name or "dashscope")

try:
    from dotenv import load_dotenv
except ModuleNotFoundError as err:
    missing_dependency_exit("python-dotenv", err.name or "dotenv")

SERVER_DIR = Path(__file__).resolve().parents[1]
load_dotenv(SERVER_DIR / ".env")

HOST = os.getenv("QWEN_VISION_PROXY_HOST", "127.0.0.1")
PORT = int(os.getenv("QWEN_VISION_PROXY_PORT", "8765"))


def normalize_media_url(value: str) -> str:
    if value.startswith("file://"):
        return value
    if value.startswith("data:") or ";base64," in value.lower():
        raise ValueError("Base64 media input is not allowed")
    parsed = urlparse(value)
    if parsed.scheme in ("http", "https"):
        return value
    return f"file://{unquote(value)}"


def convert_content(content: Any) -> list[dict[str, Any]]:
    if isinstance(content, str):
        return [{"text": content}]

    if not isinstance(content, list):
        raise ValueError("message.content must be a string or a list")

    converted: list[dict[str, Any]] = []
    for item in content:
        if not isinstance(item, dict):
            raise ValueError("message.content item must be an object")

        item_type = item.get("type")
        if item_type == "text":
            converted.append({"text": item.get("text", "")})
            continue

        if item_type == "image_url":
            image_url = item.get("image_url") or {}
            converted.append({"image": normalize_media_url(str(image_url.get("url", "")))})
            continue

        if item_type == "video_url":
            video_url = item.get("video_url") or {}
            converted.append({"video": normalize_media_url(str(video_url.get("url", "")))})
            continue

        raise ValueError(f"unsupported content item type: {item_type}")

    return converted


def convert_messages(messages: Any) -> list[dict[str, Any]]:
    if not isinstance(messages, list):
        raise ValueError("messages must be a list")

    converted: list[dict[str, Any]] = []
    for message in messages:
        if not isinstance(message, dict):
            raise ValueError("message must be an object")
        converted.append({
            "role": message.get("role", "user"),
            "content": convert_content(message.get("content", "")),
        })
    return converted


def get_path(data: Any, path: list[Any]) -> Any:
    current = data
    for key in path:
        if isinstance(current, dict):
            current = current.get(key)
        elif isinstance(key, int) and isinstance(current, list):
            current = current[key] if len(current) > key else None
        else:
            current = getattr(current, key, None)
        if current is None:
            return None
    return current


def extract_text(response: Any) -> str:
    content = get_path(response, ["output", "choices", 0, "message", "content"])
    if content is None:
        content = get_path(response, ["output", "choices", "message", "content"])

    if isinstance(content, str):
        return content
    if isinstance(content, dict):
        text = content.get("text")
        if isinstance(text, str):
            return text
    if isinstance(content, list):
        texts = [item.get("text") for item in content if isinstance(item, dict) and item.get("text")]
        if texts:
            return "\n".join(str(text) for text in texts)

    return json.dumps(response, ensure_ascii=False, default=lambda obj: getattr(obj, "__dict__", str(obj)))


def status_code_of(response: Any) -> int | None:
    value = response.get("status_code") if isinstance(response, dict) else getattr(response, "status_code", None)
    return value if isinstance(value, int) else None


def build_call_options(payload: dict[str, Any]) -> dict[str, Any]:
    options: dict[str, Any] = {}
    for key in ("stream", "enable_thinking", "response_format"):
        if key in payload:
            options[key] = payload[key]
    return options


class VisionProxyHandler(BaseHTTPRequestHandler):
    def do_POST(self) -> None:
        if self.path != "/v1/chat/completions":
            self.send_json(404, {"error": "not found"})
            return

        try:
            content_length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(content_length).decode("utf-8"))
            api_key = os.getenv("DASHSCOPE_API_KEY") or os.getenv("DASH_SCOPE_API_KEY")
            if not api_key:
                raise ValueError("missing environment variable DASHSCOPE_API_KEY or DASH_SCOPE_API_KEY")

            base_http_api_url = os.getenv("DASHSCOPE_BASE_HTTP_API_URL")
            if base_http_api_url:
                dashscope.base_http_api_url = base_http_api_url

            response = MultiModalConversation.call(
                api_key=api_key,
                model=payload.get("model"),
                messages=convert_messages(payload.get("messages")),
                **build_call_options(payload),
            )

            status_code = status_code_of(response)
            if status_code is not None and status_code != 200:
                logger.warning("dashscope call failed: %s %s", getattr(response, "code", None), getattr(response, "message", None))
                self.send_json(502, {
                    "error": "dashscope call failed",
                    "status_code": status_code,
                    "code": getattr(response, "code", None),
                    "message": getattr(response, "message", None),
                })
                return

            self.send_json(200, {
                "choices": [{
                    "message": {
                        "content": extract_text(response),
                    },
                }],
            })
        except Exception as err:  # noqa: BLE001 - thin debug proxy should surface all failures as JSON.
            logger.exception("request failed: %s %s", self.command, self.path)
            self.send_json(500, {"error": str(err)})

    def log_message(self, format: str, *args: Any) -> None:
        logger.info("%s - %s", self.address_string(), format % args)

    def send_json(self, status: int, body: dict[str, Any]) -> None:
        encoded = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)


if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
        stream=sys.stderr,
    )
    server = ThreadingHTTPServer((HOST, PORT), VisionProxyHandler)
    logger.info("Qwen vision proxy listening on http://%s:%s/v1/chat/completions", HOST, PORT)
    server.serve_forever()
