
import json, os, time, threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

OUT = "/tmp/mockllm"
os.makedirs(OUT, exist_ok=True)
N = {"n": 0}
LOCK = threading.Lock()

def save(body, path):
    with LOCK:
        N["n"] += 1
        i = N["n"]
    with open(os.path.join(OUT, "req-%03d.json" % i), "w") as f:
        json.dump({"path": path, "at": time.time(), "body": body}, f, ensure_ascii=False, indent=1)
    return i

REPLY = os.environ.get("MOCK_REPLY", "MOCK-OK")

class H(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    def log_message(self, *a): pass
    def _read(self):
        n = int(self.headers.get("content-length") or 0)
        return self.rfile.read(n) if n else b""
    def do_POST(self):
        raw = self._read()
        try: body = json.loads(raw or b"{}")
        except Exception: body = {"_raw": raw[:2000].decode("utf-8", "replace")}
        i = save(body, self.path)
        if "count_tokens" in self.path:
            return self._json({"input_tokens": 1})
        model = body.get("model") or "mock-model"
        if body.get("stream"):
            return self._sse(model)
        return self._json(self._msg(model))
    def do_GET(self):
        if self.path.endswith("/models"):
            return self._json({"data": []})
        return self._json({})
    def _msg(self, model, text=None):
        return {"id": "msg_mock", "type": "message", "role": "assistant", "model": model,
                "content": [{"type": "text", "text": text or REPLY}],
                "stop_reason": "end_turn", "stop_sequence": None,
                "usage": {"input_tokens": 10, "output_tokens": 3}}
    def _sse(self, model):
        self.send_response(200)
        self.send_header("content-type", "text/event-stream; charset=utf-8")
        self.send_header("cache-control", "no-cache")
        self.send_header("connection", "close")
        self.end_headers()
        def ev(name, data):
            self.wfile.write(("event: %s\ndata: %s\n\n" % (name, json.dumps(data, ensure_ascii=False))).encode())
            self.wfile.flush()
        start = self._msg(model, "")
        start["content"] = []
        ev("message_start", {"type": "message_start", "message": start})
        ev("content_block_start", {"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}})
        ev("content_block_delta", {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": REPLY}})
        ev("content_block_stop", {"type": "content_block_stop", "index": 0})
        ev("message_delta", {"type": "message_delta", "delta": {"stop_reason": "end_turn", "stop_sequence": None}, "usage": {"output_tokens": 3}})
        ev("message_stop", {"type": "message_stop"})
        self.close_connection = True
    def _json(self, obj, code=200):
        data = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

if __name__ == "__main__":
    port = int(os.environ.get("MOCK_PORT", "8799"))
    print("mock llm on %d, out=%s" % (port, OUT), flush=True)
    ThreadingHTTPServer(("127.0.0.1", port), H).serve_forever()
