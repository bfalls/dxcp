import json
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

BASE_VALUE = 3


def load_version() -> str:
    version_file = Path(__file__).parent / "VERSION"
    if version_file.exists():
        return version_file.read_text().strip()
    return "0.0.0"


def calculate_result(x: int) -> int:
    return x * BASE_VALUE


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path != "/":
            self.send_response(404)
            self.end_headers()
            return
        version = load_version()
        result = calculate_result(5)
        payload = {
            "version": version,
            "result": result,
        }
        data = json.dumps(payload).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


def main():
    server = HTTPServer(("0.0.0.0", 9001), Handler)
    print("demo-service-2 listening on :9001")
    server.serve_forever()


if __name__ == "__main__":
    main()
