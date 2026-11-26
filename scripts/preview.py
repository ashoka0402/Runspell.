from argparse import ArgumentParser
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit


ROOT = Path(__file__).resolve().parents[1]
PUBLIC_FILES = {
    "/": "/index.html",
    "/index.html": "/index.html",
    "/app/": "/app/index.html",
    "/app/index.html": "/app/index.html",
    "/app/app.js": "/app/app.js",
    "/app/clerk-history.js": "/app/clerk-history.js",
    "/app/recorder.js": "/app/recorder.js",
    "/app/style.css": "/app/style.css",
    "/app/workflow.js": "/app/workflow.js",
    "/app/workflow.css": "/app/workflow.css",
    "/app/m0-canvas/canvas.js": "/app/m0-canvas/canvas.js",
    "/relay-source/relay.js": "/relay-source/relay.js",
    "/relay-source/stream.js": "/relay-source/stream.js",
    "/relay-source/style.css": "/relay-source/style.css",
}


class PreviewHandler(SimpleHTTPRequestHandler):
    def send_head(self):
        try:
            url = urlsplit(self.path)
            path = unquote(url.path, errors="strict")
        except ValueError:
            self.send_error(404)
            return None

        if path == "/app":
            self.send_response(301)
            self.send_header("Location", "/app/" + ("?" + url.query if url.query else ""))
            self.send_header("Content-Length", "0")
            self.end_headers()
            return None

        public_path = PUBLIC_FILES.get(path)
        if public_path is None:
            self.send_error(404)
            return None

        target = Path(self.directory).resolve() / public_path.lstrip("/")
        if not target.is_file() or target.resolve() != target:
            self.send_error(404)
            return None

        self.path = public_path
        return super().send_head()


if __name__ == "__main__":
    parser = ArgumentParser(description="Serve Runspell's public preview assets on loopback.")
    parser.add_argument("port", type=int, nargs="?", default=8000)
    args = parser.parse_args()
    handler = partial(PreviewHandler, directory=ROOT)
    with ThreadingHTTPServer(("127.0.0.1", args.port), handler) as server:
        server.serve_forever()
