import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('planning_generator', ROOT / 'scripts' / 'generate-planning.py')
generator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(generator)


class PlanningGeneratorTest(unittest.TestCase):
    def test_wrapper_rasterizes_each_night_screen_after_all_inventory_pages(self):
        colors = {key: '#123456' for key in ('background', 'panel', 'card', 'line', 'text', 'muted', 'accent', 'selected')}
        meta = {'product': 'Test', 'deck_title': 'Inventory', 'deck_subtitle': 'Synthetic', 'themes': {'Night': colors, 'Day': colors}}
        with tempfile.TemporaryDirectory(prefix='tpv-planning-test-') as directory:
            root = Path(directory)
            source = root / 'spec.md'
            for count in (1, 14, 15, 28, 29):
                with self.subTest(screen_count=count):
                    screens = [{'id': f'T{i:02}', 'title': f'Screen {i}', 'status': 'Planned', 'description': 'Synthetic',
                                'layout': 'display', 'detail': 'Not implemented', 'display_title': 'DEMO',
                                'display_subtitle': 'Example', 'display_next': 'Next'} for i in range(count)]
                    source.write_text('```mockup-theme\n' + json.dumps(meta) + '\n```\n' +
                                      ''.join('```mockup\n' + json.dumps(screen) + '\n```\n' for screen in screens), encoding='utf-8')
                    with patch('sys.argv', ['generate-planning.py', '--source', str(source), '--output-dir', str(root / 'out')]), \
                         patch.object(generator.shutil, 'which', return_value='/stub/pdftoppm'), \
                         patch.object(generator.subprocess, 'run') as run, \
                         patch.object(generator.shutil, 'copy2'):
                        generator.main()
                    rasterize = [call.args[0] for call in run.call_args_list if call.args[0][0] == '/stub/pdftoppm']
                    first = 2 + (count + 13) // 14
                    self.assertEqual([int(command[command.index('-f') + 1]) for command in rasterize],
                                     [first + 2 * index for index in range(count)])
                    self.assertEqual([Path(command[-1]).name for command in rasterize], [screen['id'] for screen in screens])
                    self.assertTrue(all(command[command.index('-f') + 1] == command[command.index('-l') + 1] for command in rasterize))


if __name__ == '__main__':
    unittest.main()
