from html.parser import HTMLParser
from pathlib import Path
import re
import unittest
from urllib.parse import unquote, urlsplit


ROOT = Path(__file__).resolve().parents[1]


class Page(HTMLParser):
    def __init__(self, path=None, markup=None):
        super().__init__()
        self.elements = []
        self.feed(markup if markup is not None else path.read_text(encoding="utf-8"))

    def handle_starttag(self, tag, attrs):
        self.elements.append((tag, dict(attrs)))


class FrontendIntegrationTests(unittest.TestCase):
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
        self.assertEqual(scripts, ["./workflow.js", "./app.js"])
        self.assertTrue(any(attrs.get("id") == "app" for _, attrs in page.elements))


if __name__ == "__main__":
    unittest.main()
