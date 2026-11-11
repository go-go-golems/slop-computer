"""Tests for scripts/reports/publish.py: python3 -m unittest scripts/reports/test_publish.py"""
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import publish as P  # noqa: E402


class PrepareMarkdown(unittest.TestCase):
    def test_front_matter_title_is_taken_and_removed(self):
        t, body = P.prepare_markdown('---\ntitle: "slop v3: Pinboard"\ntags:\n  - a\n---\n\n# Heading\n')
        self.assertEqual(t, "slop v3: Pinboard")
        self.assertEqual(body, "\n# Heading\n")

    def test_no_front_matter(self):
        t, body = P.prepare_markdown("# Only a heading\n\n---\n\ntext\n")
        self.assertIsNone(t)
        self.assertIn("---", body)  # a horizontal rule stays
        self.assertEqual(P.first_heading(body), "Only a heading")

    def test_wikilinks_become_text(self):
        _, body = P.prepare_markdown("see [[PROJ - ZK Tool]] and [[PROJECT REPORT - x#Section|the report]].\n")
        self.assertEqual(body, "see PROJ - ZK Tool and the report.\n")

    def test_embeds_become_images(self):
        _, body = P.prepare_markdown("![[my pic.png]] and ![[b.png|300]]\n")
        self.assertEqual(body, "![](my%20pic.png) and ![](b.png)\n")

    def test_callouts_get_a_label(self):
        _, body = P.prepare_markdown("> [!summary]\n> - one\n\n> [!note]- Folded title\n> text\n")
        self.assertEqual(body, "> **Summary.**\n> - one\n\n> **Note.** Folded title\n> text\n")

    def test_markdown_image_links_are_kept(self):
        _, body = P.prepare_markdown("![](_assets/x.png)\n")
        self.assertEqual(body, "![](_assets/x.png)\n")


class FinishHTML(unittest.TestCase):
    def test_mermaid_blocks_and_script(self):
        page = '<body><pre class="mermaid"><code>graph LR\n  A --&gt; B</code></pre></body>'
        out, n = P.finish_html(page)
        self.assertEqual(n, 1)
        self.assertIn('<pre class="mermaid">graph LR\n  A --&gt; B</pre>', out)
        self.assertIn(P.MERMAID, out)

    def test_no_mermaid_no_script(self):
        out, n = P.finish_html("<body><pre><code>x</code></pre></body>")
        self.assertEqual(n, 0)
        self.assertNotIn("mermaid", out)


@unittest.skipUnless(shutil.which("pandoc"), "pandoc not installed")
class Build(unittest.TestCase):
    def test_markdown_report_is_one_page(self):
        with tempfile.TemporaryDirectory() as d:
            d = Path(d)
            (d / "_assets").mkdir()
            (d / "_assets" / "p.svg").write_text('<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"/>')
            (d / "r.md").write_text('---\ntitle: A report\n---\n# A report\n\n![](_assets/p.svg)\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n```mermaid\ngraph LR\n  A --> B\n```\n\nsee [[Other note|other]]\n')
            out = d / "out"
            out.mkdir()
            title = P.title_of(d / "r.md", None)
            self.assertEqual(title, "A report")
            what = P.build(d / "r.md", title, False, out)
            self.assertEqual(what, "markdown (1 mermaid)")
            page = (out / "index.html").read_text()
            self.assertIn("<title>A report</title>", page)
            self.assertIn("data:image/svg+xml", page)   # the image is inside the page
            self.assertIn("<table>", page)
            self.assertIn('<pre class="mermaid">', page)
            self.assertIn("see other", page)
            self.assertNotIn("[[", page)
            self.assertEqual(sorted(p.name for p in out.iterdir()), ["app.json", "index.html"])
            self.assertIn('"title": "Report"', (out / "app.json").read_text())

    def test_html_title(self):
        with tempfile.TemporaryDirectory() as d:
            f = Path(d) / "x.html"
            f.write_text("<html><head><title>Q3 &amp; more</title></head><body></body></html>")
            self.assertEqual(P.title_of(f, None), "Q3 & more")


if __name__ == "__main__":
    unittest.main()
