#!/usr/bin/env python3
"""Generate both planning documents and their figures from one Markdown file."""

from __future__ import annotations

import argparse
import importlib.util
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=ROOT / 'docs' / 'product-specification.md')
    parser.add_argument('--output-dir', type=Path, required=True)
    parser.add_argument('--pdftoppm', default='pdftoppm', help='Path to Poppler pdftoppm')
    args = parser.parse_args()
    pdftoppm = shutil.which(args.pdftoppm)
    if not pdftoppm:
        parser.error('Poppler pdftoppm is required to prepare the specification figures')

    generator = ROOT / 'scripts' / 'generate-mockups.py'
    spec = importlib.util.spec_from_file_location('planning_mockups', generator)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    _, screens, _ = module.load(args.source)
    for screen in screens:
        if not re.fullmatch(r'[A-Za-z0-9_-]+', screen['id']):
            parser.error(f"Invalid screen ID: {screen['id']!r}")

    args.output_dir.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='tpv-planning-') as temp:
        temp = Path(temp)
        pdf = temp / 'TPV_Karaoke_Mockups_Dark_and_Light_Current.pdf'
        docx = temp / 'TPV_Karaoke_Product_Specification_Current.docx'
        figures = temp / 'figures'
        figures.mkdir()
        subprocess.run([sys.executable, str(generator), '--source', str(args.source), '--output', str(pdf)], check=True)
        for index, screen in enumerate(screens):
            page = str(3 + 2 * index)
            subprocess.run([pdftoppm, '-f', page, '-l', page, '-r', '100', '-png', '-singlefile',
                            str(pdf), str(figures / screen['id'])], check=True)
        subprocess.run([sys.executable, str(ROOT / 'scripts' / 'generate-specification.py'),
                        '--source', str(args.source), '--mockups-dir', str(figures), '--output', str(docx)], check=True)
        for artifact in (pdf, docx):
            destination = args.output_dir / artifact.name
            shutil.copy2(artifact, destination)
            print(f'Generated {destination}')


if __name__ == '__main__':
    main()
