import hashlib
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('mockup_generator', ROOT / 'scripts' / 'generate-mockups.py')
generator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(generator)


class MockupGeneratorTest(unittest.TestCase):
    def test_single_markdown_source_generates_both_themes_deterministically(self):
        colors = {key: '#123456' for key in ('background', 'panel', 'card', 'line', 'text', 'muted', 'accent', 'selected')}
        meta = {'product': 'Test Product', 'deck_title': 'Test Deck', 'deck_subtitle': 'Synthetic', 'themes': {'Night': colors, 'Day': colors}}
        screen = {'id': 'TEST', 'title': 'Singer display', 'status': 'Planned', 'description': 'Synthetic display',
                  'layout': 'display', 'detail': 'Not implemented', 'display_title': 'DEMO', 'display_subtitle': 'Example', 'display_next': 'Next: Sam'}
        content = '# Unrelated specification text\n\n```mockup-theme\n' + json.dumps(meta) + '\n```\n\n```mockup\n' + json.dumps(screen) + '\n```\n'
        with tempfile.TemporaryDirectory(prefix='tpv-mockup-test-') as directory:
            root = Path(directory)
            source, first, second = root / 'spec.md', root / 'one.pdf', root / 'two.pdf'
            source.write_text(content, encoding='utf-8')
            generator.generate(source, first); generator.generate(source, second)
            self.assertEqual(hashlib.sha256(first.read_bytes()).digest(), hashlib.sha256(second.read_bytes()).digest())
            pdf = PdfReader(first)
            self.assertEqual(len(pdf.pages), 4)
            self.assertIn('NIGHT', pdf.pages[2].extract_text())
            self.assertIn('DAY', pdf.pages[3].extract_text())
            self.assertIn('PLANNED', pdf.pages[2].extract_text())
            self.assertIn('DEMO', pdf.pages[2].extract_text())

    def test_missing_and_invalid_blocks_fail_before_creating_pdf(self):
        with tempfile.TemporaryDirectory(prefix='tpv-mockup-test-') as directory:
            root = Path(directory); source, output = root / 'bad.md', root / 'bad.pdf'
            source.write_text('# No mockup data\n', encoding='utf-8')
            with self.assertRaises(ValueError): generator.generate(source, output)
            self.assertFalse(output.exists())
            source.write_text('```mockup-theme\n{}\n```\n\n```mockup\n{}\n```\n', encoding='utf-8')
            with self.assertRaises(ValueError): generator.generate(source, output)
            self.assertFalse(output.exists())

    def test_host_actions_use_markdown_order_and_reject_invalid_icons(self):
        colors = {key: '#123456' for key in ('background', 'panel', 'card', 'line', 'text', 'muted', 'accent', 'selected')}
        actions = ['palette', 'search', 'settings']
        meta = {'product': 'Test Product', 'deck_title': 'Test Deck', 'deck_subtitle': 'Synthetic',
                'themes': {'Night': colors, 'Day': colors}, 'host_actions': actions}
        screen = {'id': 'TEST', 'title': 'Singer display', 'status': 'Planned', 'description': 'Synthetic display',
                  'layout': 'display', 'detail': 'Not implemented', 'display_title': 'DEMO', 'display_subtitle': 'Example', 'display_next': 'Next: Sam'}
        def source_text():
            return '```mockup-theme\n' + json.dumps(meta) + '\n```\n```mockup\n' + json.dumps(screen) + '\n```\n'
        with tempfile.TemporaryDirectory(prefix='tpv-mockup-actions-') as directory:
            source = Path(directory) / 'spec.md'
            source.write_text(source_text(), encoding='utf-8')
            loaded, _, _ = generator.load(source)
            self.assertEqual(loaded['host_actions'], actions)
            with patch.object(generator, 'rect'), patch.object(generator, 'line'), patch.object(generator, 'icon') as draw:
                generator.top_bar(None, 0, 0, 500, colors, 'HOST', 'Test', loaded['host_actions'])
                self.assertEqual([call.args[1] for call in draw.call_args_list], actions)
            meta['host_actions'] = ['palette', 'unsupported']
            source.write_text(source_text(), encoding='utf-8')
            with self.assertRaisesRegex(ValueError, 'host actions'): generator.load(source)
            meta['host_actions'] = ['palette', 'palette']
            source.write_text(source_text(), encoding='utf-8')
            with self.assertRaisesRegex(ValueError, 'host actions'): generator.load(source)


if __name__ == '__main__':
    unittest.main()
