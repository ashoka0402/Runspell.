from functools import partial
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
from html.parser import HTMLParser
from pathlib import Path
import re
import sys
from tempfile import TemporaryDirectory
from threading import Thread
import unittest
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]

if __name__ == "__main__":
    sys.path.insert(0, str(ROOT))

from scripts.preview import PUBLIC_FILES, PreviewHandler


class Page(HTMLParser):
    def __init__(self, path=None, markup=None):
        super().__init__()
        self.elements = []
        self.feed(markup if markup is not None else path.read_text(encoding="utf-8"))

    def handle_starttag(self, tag, attrs):
        self.elements.append((tag, dict(attrs)))


class FrontendIntegrationTests(unittest.TestCase):
    def test_preview_serves_only_public_assets(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            for name in ("index.html", "app/index.html", "app/m0-canvas/canvas.js",
                         "relay-source/style.css", ".env", ".git/config", "server/source.ts"):
                path = root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text("fixture", encoding="utf-8")

            handler = partial(PreviewHandler, directory=directory)
            with ThreadingHTTPServer(("127.0.0.1", 0), handler) as server:
                thread = Thread(target=server.serve_forever, daemon=True)
                thread.start()
                connection = HTTPConnection("127.0.0.1", server.server_port, timeout=5)
                try:
                    for url in ("/", "/app/", "/app/m0-canvas/canvas.js", "/relay-source/style.css?cache=1"):
                        with self.subTest(url=url):
                            connection.request("GET", url)
                            response = connection.getresponse()
                            self.assertEqual(response.status, 200)
                            self.assertEqual(response.read(), b"fixture")

                    connection.request("GET", "/app")
                    response = connection.getresponse()
                    self.assertEqual(response.status, 301)
                    self.assertEqual(response.getheader("Location"), "/app/")
                    response.read()

                    for url in ("/.env", "/%2eenv", "/.git/config", "/server/source.ts",
                                "/app/%2e%2e/.env", "/app/%2e%2e%5c.env",
                                "/app/%252e%252e/.env", "/relay-source/"):
                        with self.subTest(url=url):
                            connection.request("GET", url)
                            response = connection.getresponse()
                            self.assertEqual(response.status, 404)
                            self.assertNotIn(b"fixture", response.read())

                    connection.request("HEAD", "/.env")
                    response = connection.getresponse()
                    self.assertEqual(response.status, 404)
                    self.assertEqual(response.read(), b"")
                finally:
                    connection.close()
                    server.shutdown()
                    thread.join()

    def test_local_assets_and_navigation_targets_exist(self):
        for entry in (ROOT / "index.html", ROOT / "app/index.html"):
            page = Page(entry)
            for tag, attrs in page.elements:
                reference = attrs.get("src") if tag == "script" else attrs.get("href")
                if not reference:
                    continue
                url = urlsplit(reference)
                if url.scheme or url.netloc:
                    continue
                with self.subTest(page=entry.relative_to(ROOT), target=reference):
                    target = (entry.parent / unquote(url.path)).resolve() if url.path else entry
                    if target.is_dir():
                        target /= "index.html"
                    self.assertTrue(target.is_relative_to(ROOT), reference)
                    self.assertTrue(target.is_file(), reference)
                    self.assertIn("/" + target.relative_to(ROOT).as_posix(), PUBLIC_FILES)
                    if url.fragment and not url.fragment.startswith("/"):
                        ids = {attrs.get("id") for _, attrs in Page(target).elements}
                        self.assertIn(unquote(url.fragment), ids)

    def test_workspace_entry_and_return_home(self):
        landing = Page(ROOT / "index.html")
        workspace_links = [attrs for tag, attrs in landing.elements
                           if tag == "a" and attrs.get("href") == "app/#/overview"]
        self.assertGreaterEqual(len(workspace_links), 3, "Nav, hero and footer should open the workspace")
        script = (ROOT / "app/app.js").read_text(encoding="utf-8")
        logo = re.search(r'<a class="logo"[^>]*>', script)
        self.assertIsNotNone(logo)
        attrs = Page(markup=logo.group()).elements[0][1]
        self.assertEqual(attrs["href"], "../")
        self.assertIn("home", attrs.get("aria-label", "").lower())

    def test_workspace_loads_workflow_before_application(self):
        page = Page(ROOT / "app/index.html")
        scripts = [attrs["src"] for tag, attrs in page.elements if tag == "script"]
        self.assertEqual(scripts, ["./workflow.js", "./clerk-history.js", "./recorder.js", "./app.js"])
        self.assertTrue(any(attrs.get("id") == "app" for _, attrs in page.elements))


if __name__ == "__main__":
    unittest.main()
