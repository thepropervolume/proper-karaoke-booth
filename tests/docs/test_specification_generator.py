import base64
import hashlib
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

from docx import Document

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('specification_generator', ROOT / 'scripts' / 'generate-specification.py')
generator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(generator)

# One-pixel PNG: the generator need not know the content of its derived figures.
PNG = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/aWQAAAAASUVORK5CYII=')


class SpecificationGeneratorTest(unittest.TestCase):
    def test_qa_guide_uses_its_own_labels_and_restarts_each_test_steps(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / 'qa.md'
            source.write_text('# QA guide\n\n## First test\n\n1. Open.\n2. Close.\n\n## Second test\n\n1. Retry.\n2. Check.\n', encoding='utf-8')
            output = root / 'qa.docx'
            generator.render(source, output, document_kind='qa')
            doc = Document(output)
            self.assertIn('QA TEST GUIDE', doc.sections[0].header.paragraphs[0].text)
            self.assertIn('repository QA guide', doc.sections[0].footer.paragraphs[0].text)
            self.assertEqual(doc.core_properties.subject, 'Karaoke application QA test guide')
            steps = [p._p.pPr.numPr.numId.val for p in doc.paragraphs if p.style.name == 'List Number']
            self.assertEqual(steps[0], steps[1])
            self.assertEqual(steps[2], steps[3])
            self.assertNotEqual(steps[0], steps[2])

    def test_figures_and_prose_come_from_markdown(self):
        screen = {'id': 'TEST', 'title': 'Singer view', 'status': 'Planned', 'description': 'A planned singer view'}
        content = '# Test specification\n\nCurrent prose.\n\n```mockup\n' + json.dumps(screen) + '\n```\n'
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / 'source.md'; source.write_text(content, encoding='utf-8')
            (root / 'TEST.png').write_bytes(PNG)
            first, second = root / 'first.docx', root / 'second.docx'
            generator.render(source, first, root)
            generator.render(source, second, root)
            self.assertEqual(hashlib.sha256(first.read_bytes()).digest(), hashlib.sha256(second.read_bytes()).digest())
            doc = Document(first)
            text = '\n'.join(p.text for p in doc.paragraphs)
            self.assertIn('Current prose.', text)
            self.assertIn('Singer view', text)
            self.assertIn('Planned', text)
            self.assertNotIn('"description"', text)
            self.assertEqual(len(doc.inline_shapes), 1)
            self.assertFalse(doc.styles['Title'].element.xpath('./w:pPr/w:pBdr'))
            self.assertTrue(all(str(run.font.color.rgb) == '000000'
                                for run in doc.sections[0].header.paragraphs[0].runs))

    def test_missing_derived_figure_fails(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / 'source.md'
            screen = {'id': 'MISSING', 'title': 'View', 'status': 'Planned', 'description': 'Future view'}
            source.write_text('# Test\n\n```mockup\n' + json.dumps(screen) + '\n```\n', encoding='utf-8')
            output = root / 'out.docx'
            with self.assertRaises(ValueError):
                generator.render(source, output, root)
            self.assertFalse(output.exists())


if __name__ == '__main__':
    unittest.main()
