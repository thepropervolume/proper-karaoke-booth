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
    def test_branding_rejects_changed_or_outside_assets_before_creating_pdf(self):
        colors = {key: '#123456' for key in ('background', 'panel', 'card', 'line', 'text', 'muted', 'accent', 'selected')}
        meta = {'product': 'Test', 'deck_title': 'Branding', 'deck_subtitle': 'Synthetic',
                'themes': {'Night': colors, 'Day': colors}}
        screen = {'id': 'TEST', 'title': 'Singer display', 'status': 'Planned', 'description': 'Synthetic',
                  'layout': 'display', 'detail': 'Not implemented', 'display_title': 'DEMO',
                  'display_subtitle': 'Example', 'display_next': 'Next: Sam'}
        with tempfile.TemporaryDirectory(prefix='tpv-brand-reference-test-') as directory:
            root = Path(directory)
            source, output = root / 'docs' / 'spec.md', root / 'mockups.pdf'
            source.parent.mkdir()
            assets = root / 'assets' / 'branding'
            assets.mkdir(parents=True)
            logos = {}
            for theme, name in (('Night', 'logo-dark.png'), ('Day', 'logo-light.png')):
                data = (ROOT / 'assets' / 'branding' / name).read_bytes()
                (assets / name).write_bytes(data)
                logos[theme] = {'path': '../assets/branding/' + name, 'sha256': hashlib.sha256(data).hexdigest()}
            meta['brand_logos'] = logos
            def write_source():
                source.write_text('```mockup-theme\n' + json.dumps(meta) + '\n```\n```mockup\n' +
                                  json.dumps(screen) + '\n```\n', encoding='utf-8')
            write_source()
            generator.generate(source, output)
            self.assertEqual(len(PdfReader(output).pages), 4)
            output.unlink()
            original = (assets / 'logo-dark.png').read_bytes()
            (assets / 'logo-dark.png').write_bytes(original + b'changed')
            with self.assertRaisesRegex(ValueError, 'SHA256'):
                generator.generate(source, output)
            self.assertFalse(output.exists())
            (assets / 'logo-dark.png').write_bytes(original)
            (root / 'logo-dark.png').write_bytes(original)
            logos['Night']['path'] = '../logo-dark.png'
            write_source()
            with self.assertRaisesRegex(ValueError, 'local approved'):
                generator.generate(source, output)
            self.assertFalse(output.exists())

    def test_growing_inventory_paginates_before_the_screen_pages(self):
        colors = {key: '#123456' for key in ('background', 'panel', 'card', 'line', 'text', 'muted', 'accent', 'selected')}
        meta = {'product': 'Test', 'deck_title': 'Inventory', 'deck_subtitle': 'Synthetic', 'themes': {'Night': colors, 'Day': colors}}
        screens = [{'id': f'T{i:02}', 'title': f'Screen {i}', 'status': 'Planned', 'description': 'Synthetic',
                    'layout': 'display', 'detail': 'Not implemented', 'display_title': 'DEMO', 'display_subtitle': 'Example', 'display_next': 'Next: Sam'} for i in range(15)]
        description = ('A carefully moderated singer queue preserves every accepted performance while the host reviews requests, '
                       'coordinates the rotation, checks the singer display, and prepares the next song without interrupting playback.')
        screens[0]['description'] = description
        long_word = 'K' * 110
        screens[1]['description'] = f'An identifier {long_word} remains visible.'
        content = '```mockup-theme\n' + json.dumps(meta) + '\n```\n' + ''.join('```mockup\n' + json.dumps(screen) + '\n```\n' for screen in screens)
        with tempfile.TemporaryDirectory(prefix='tpv-inventory-test-') as directory:
            source, output = Path(directory) / 'spec.md', Path(directory) / 'inventory.pdf'
            source.write_text(content, encoding='utf-8'); generator.generate(source, output)
            pdf = PdfReader(output)
            self.assertEqual(len(pdf.pages), 33)
            inventory = '\n'.join(page.extract_text() for page in pdf.pages[1:3])
            for screen in screens:
                self.assertIn(screen['id'], inventory)
            self.assertIn(description, ' '.join(inventory.split()))
            self.assertIn(long_word, ''.join(inventory.split()))
            self.assertNotIn('...', inventory)
            self.assertIn('Screen inventory', pdf.pages[2].extract_text())
            self.assertIn('NIGHT', pdf.pages[3].extract_text())

    def test_inventory_description_wraps_within_the_row_without_losing_text(self):
        description = ('A long description shows how the host reviews requests and manages singer rotation while preserving '
                       'a staged song and providing a clear explanation of policy restrictions before playback can begin.')
        with patch.object(generator, 'line') as draw:
            generator.inventory_description(None, description, 118, 558, 'TEST')
        lines = draw.call_args_list
        self.assertGreaterEqual(len(lines), 2)
        self.assertLessEqual(len(lines), 3)
        self.assertEqual(' '.join(call.args[1] for call in lines), description)
        for call in lines:
            self.assertGreaterEqual(call.args[3], 530)  # Last baseline stays 22 points above the next row.
            self.assertLessEqual(generator.stringWidth(call.args[1], 'TPV', call.kwargs['size']), 500)
        with self.assertRaisesRegex(ValueError, 'too long'):
            generator.inventory_description(None, 'word ' * 1000, 118, 558, 'TOO_LONG')

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
