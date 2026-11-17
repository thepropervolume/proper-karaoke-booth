#!/usr/bin/env python3
"""Render the repository's canonical Markdown specification to a Word file.

Usage: python scripts/generate-specification.py [--source PATH] --output PATH
       [--mockups-dir PATH]
Requires python-docx. The source is authoritative; this script supplies layout
only. Machine-readable mockup fences are omitted from the prose. When supplied,
the mockup directory must contain one PNG named for each screen ID in source
order. Generate these from the Night pages of the PDF built from that source.
"""
from __future__ import annotations

import argparse
import datetime
import json
import os
import re
import tempfile
import zipfile
from pathlib import Path

from docx import Document
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_CELL_VERTICAL_ALIGNMENT
from docx.enum.section import WD_ORIENTATION, WD_SECTION
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Pt, RGBColor

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_SOURCE = ROOT / "docs" / "product-specification.md"
INLINE = re.compile(r"(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\)|\*[^*]+\*)")
HEADING = re.compile(r"^(#{1,6})\s+(.+?)\s*#*\s*$")
ITEM = re.compile(r"^(\s*)([-+*]|\d+[.)])\s+(.+)$")
TABLE_RULE = re.compile(r"^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$")
FENCE = re.compile(r"^\s*```\s*([^\s`]*)\s*$")


def plain(text: str) -> str:
    text = re.sub(r"!\[([^]]*)\]\([^)]+\)", r"\1", text)
    text = re.sub(r"\[([^]]+)\]\([^)]+\)", r"\1", text)
    return text.replace("**", "").replace("`", "").replace("*", "").strip()


def set_font(run, size=None, bold=None, color="20242A", name="Arial"):
    run.font.name = name
    run.font.color.rgb = RGBColor.from_string(color)
    if size is not None:
        run.font.size = Pt(size)
    if bold is not None:
        run.bold = bold
    return run


def add_link(paragraph, label: str, url: str):
    # External HTTPS links remain navigable; relative repository links retain
    # readable text because this generated file may live outside the checkout.
    if not url.startswith(("https://", "http://")):
        set_font(paragraph.add_run(label))
        return
    relation = paragraph.part.relate_to(url, "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink", is_external=True)
    hyperlink = OxmlElement("w:hyperlink")
    hyperlink.set(qn("r:id"), relation)
    run = OxmlElement("w:r")
    properties = OxmlElement("w:rPr")
    color = OxmlElement("w:color"); color.set(qn("w:val"), "175A80"); properties.append(color)
    underline = OxmlElement("w:u"); underline.set(qn("w:val"), "single"); properties.append(underline)
    run.append(properties)
    value = OxmlElement("w:t"); value.text = label; run.append(value)
    hyperlink.append(run); paragraph._p.append(hyperlink)


def inline(paragraph, text: str):
    if re.search(r"!\[[^]]*\]\(|<\s*/?\s*[A-Za-z][^>]*>|~~", re.sub(r"`[^`]+`", "", text)):
        raise ValueError("Unsupported inline Markdown: images, raw HTML and strikethrough are not supported.")
    remainder = INLINE.sub("", text)
    if "**" in remainder or "`" in remainder or re.search(r"\[[^]]+\]\(", remainder):
        raise ValueError("Malformed or unsupported inline Markdown formatting.")
    position = 0
    for match in INLINE.finditer(text):
        if match.start() > position:
            set_font(paragraph.add_run(text[position:match.start()]))
        item = match.group()
        if item.startswith("**"):
            set_font(paragraph.add_run(item[2:-2]), bold=True)
        elif item.startswith("`"):
            set_font(paragraph.add_run(item[1:-1]), size=9, name="Consolas")
        elif item.startswith("["):
            label, url = re.match(r"\[([^]]+)\]\(([^)]+)\)", item).groups()
            add_link(paragraph, label, url)
        else:
            run = set_font(paragraph.add_run(item[1:-1])); run.italic = True
        position = match.end()
    if position < len(text):
        set_font(paragraph.add_run(text[position:]))


def configure(document, document_kind="product"):
    if document_kind not in ("product", "qa"):
        raise ValueError("Choose a product specification or QA guide.")
    section = document.sections[0]
    section.page_width = Inches(8.5); section.page_height = Inches(11)
    section.top_margin = Inches(.75); section.bottom_margin = Inches(.7)
    section.left_margin = Inches(.8); section.right_margin = Inches(.8)
    section.header_distance = Inches(.35); section.footer_distance = Inches(.35)
    styles = document.styles
    normal = styles["Normal"]
    normal.font.name = "Arial"; normal.font.size = Pt(10)
    normal.font.color.rgb = RGBColor.from_string("20242A")
    normal.paragraph_format.space_after = Pt(6)
    normal.paragraph_format.line_spacing = 1.12
    for name, size in (("Title", 25), ("Heading 1", 16), ("Heading 2", 12.5), ("Heading 3", 11), ("Heading 4", 10.5)):
        style = styles[name]
        style.font.name = "Arial"; style.font.size = Pt(size)
        style.font.bold = True; style.font.color.rgb = RGBColor.from_string("000000")
        # python-docx's default template can carry a themed blue Title rule.
        # Keep generated headings plain even when the installed template varies.
        for border in list(style.element.xpath("./w:pPr/w:pBdr")):
            border.getparent().remove(border)
        style.paragraph_format.keep_with_next = True
        style.paragraph_format.space_before = Pt(14 if name == "Heading 1" else 8)
        style.paragraph_format.space_after = Pt(5)
    styles["Title"].paragraph_format.space_before = Pt(8)
    styles["Title"].paragraph_format.space_after = Pt(12)
    for name in ("List Bullet", "List Number"):
        styles[name].font.name = "Arial"; styles[name].font.size = Pt(10)
        styles[name].paragraph_format.space_after = Pt(3)
    header = section.header.paragraphs[0]
    header.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    set_font(header.add_run("THE PROPER VOLUME  /  " + ("QA TEST GUIDE" if document_kind == "qa" else "PRODUCT SPECIFICATION")), size=8, color="000000")
    footer = section.footer.paragraphs[0]
    set_font(footer.add_run("Generated from the repository " + ("QA guide" if document_kind == "qa" else "specification") + "  |  "), size=8, color="59636E")
    field = OxmlElement("w:fldSimple"); field.set(qn("w:instr"), "PAGE"); footer._p.append(field)
    document.core_properties.author = "The Proper Volume"
    document.core_properties.subject = "Karaoke application " + ("QA test guide" if document_kind == "qa" else "product specification")


def cells(line: str) -> list[str]:
    line = line.strip()
    if line.startswith("|"): line = line[1:]
    if line.endswith("|"): line = line[:-1]
    return [part.strip().replace(r"\|", "|") for part in re.split(r"(?<!\\)\|", line)]


def table(document, rows: list[list[str]]):
    width = max(len(row) for row in rows)
    if width > 8:
        raise ValueError("Markdown table has more than eight columns; simplify it for Word.")
    if any(len(row) != width for row in rows):
        raise ValueError("Markdown table rows must have the same number of cells as the header.")
    result = document.add_table(rows=0, cols=width)
    result.style = "Table Grid"
    result.alignment = WD_TABLE_ALIGNMENT.CENTER
    result.autofit = True
    for index, values in enumerate(rows):
        row = result.add_row()
        # Repeat headers and keep individual rows together when flowing to a new page.
        props = row._tr.get_or_add_trPr()
        if index == 0:
            flag = OxmlElement("w:tblHeader"); flag.set(qn("w:val"), "true"); props.append(flag)
        no_split = OxmlElement("w:cantSplit"); props.append(no_split)
        for col, cell in enumerate(row.cells):
            cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
            paragraph = cell.paragraphs[0]; paragraph.paragraph_format.space_after = Pt(3)
            inline(paragraph, values[col] if col < len(values) else "")
            for run in paragraph.runs:
                run.font.size = Pt(8.6 if width >= 5 else 9)
                if index == 0: run.bold = True
            if index == 0:
                cell_props = cell._tc.get_or_add_tcPr()
                shading = OxmlElement("w:shd"); shading.set(qn("w:fill"), "EAF1F6"); cell_props.append(shading)
    document.add_paragraph().paragraph_format.space_after = Pt(2)


def is_block(lines: list[str], index: int) -> bool:
    line = lines[index]
    if not line.strip() or HEADING.match(line) or ITEM.match(line) or FENCE.match(line) or line.lstrip().startswith(">"):
        return True
    return index + 1 < len(lines) and "|" in line and bool(TABLE_RULE.match(lines[index + 1]))


def append_mockups(document, text: str, folder: Path):
    """Add full-page Night references; descriptions come from the source."""
    pattern = r"^```mockup\s*\r?\n(.*?)^```\s*$"
    screens = {}
    for match in re.finditer(pattern, text, re.MULTILINE | re.DOTALL):
        screen = json.loads(match.group(1))
        if not isinstance(screen, dict) or not isinstance(screen.get("id"), str):
            raise ValueError("Each mockup must be a JSON object with a screen ID.")
        if not re.fullmatch(r"[A-Za-z0-9_-]+", screen["id"]):
            raise ValueError(f"Invalid mockup ID: {screen['id']}.")
        if screen["id"] in screens: raise ValueError(f"Duplicate mockup ID: {screen['id']}.")
        screens[screen["id"]] = screen
    if not screens: raise ValueError("No mockup blocks found in Markdown source.")
    for screen_id, screen in screens.items():
        if not screen or not all(isinstance(screen.get(k), str) and screen[k].strip() for k in ("title", "status", "description")):
            raise ValueError(f"Missing mockup or caption fields for {screen_id}.")
        if not (folder / f"{screen_id}.png").is_file():
            raise ValueError(f"Missing mockup image: {folder / (screen_id + '.png')}.")
    section = document.add_section(WD_SECTION.NEW_PAGE)
    section.orientation = WD_ORIENTATION.LANDSCAPE
    section.page_width = Inches(11); section.page_height = Inches(8.5)
    section.top_margin = Inches(.55); section.bottom_margin = Inches(.55)
    section.left_margin = Inches(.55); section.right_margin = Inches(.55)
    for index, screen_id in enumerate(screens):
        if index: document.add_page_break()
        screen = screens[screen_id]
        title = document.add_paragraph(style="Heading 2")
        title.paragraph_format.space_before = Pt(0)
        set_font(title.add_run(f"{screen_id} — {screen['title']} ({screen['status']})"), size=12, bold=True, color="000000")
        paragraph = document.add_paragraph()
        paragraph.paragraph_format.space_after = Pt(2)
        shape = paragraph.add_run().add_picture(str(folder / f"{screen_id}.png"), width=Inches(9.9))
        shape._inline.docPr.set("descr", f"{screen['title']}: {screen['description']}")
        caption = document.add_paragraph()
        caption.paragraph_format.space_after = Pt(0)
        set_font(caption.add_run(f"{screen['description']} Night theme; see the mockup PDF for both themes and full-size detail."), size=9)


def render(source: Path, output: Path, mockups_dir: Path | None = None, document_kind="product"):
    text = source.read_text(encoding="utf-8-sig")
    lines = text.replace("\r\n", "\n").split("\n")
    document = Document(); configure(document, document_kind)
    document.core_properties.title = "The Proper Volume Karaoke Product Specification"
    document.core_properties.created = datetime.datetime(2000, 1, 1)
    document.core_properties.modified = datetime.datetime(2000, 1, 1)
    index = 0; first_title = True; qa_numbering = None
    while index < len(lines):
        line = lines[index]
        if not line.strip(): index += 1; continue
        if re.match(r"^\s*(?:-{3,}|\*{3,}|_{3,})\s*$", line):
            document.add_paragraph().paragraph_format.space_after = Pt(2)
            index += 1; continue
        heading = HEADING.match(line)
        if heading:
            level = len(heading.group(1)); title = plain(heading.group(2))
            if first_title and level == 1:
                paragraph = document.add_paragraph(style="Title"); inline(paragraph, heading.group(2)); first_title = False
                document.core_properties.title = title
            else:
                paragraph = document.add_paragraph(style=f"Heading {min(max(1, level - 1), 4)}"); inline(paragraph, heading.group(2))
            for run in paragraph.runs: run.font.color.rgb = RGBColor.from_string("000000")
            index += 1; continue
        fence = FENCE.match(line)
        if fence:
            language = fence.group(1).lower(); index += 1; block = []
            while index < len(lines) and not re.match(r"^\s*```\s*$", lines[index]):
                block.append(lines[index]); index += 1
            if index >= len(lines): raise ValueError("Unclosed fenced block in Markdown source.")
            index += 1
            if language in ("mockup-data", "mockup-theme", "mockup"): continue
            for content in block:
                paragraph = document.add_paragraph(); paragraph.paragraph_format.left_indent = Inches(.18)
                paragraph.paragraph_format.space_after = Pt(0)
                set_font(paragraph.add_run(content or " "), size=8.5, name="Consolas")
            continue
        if index + 1 < len(lines) and "|" in line and TABLE_RULE.match(lines[index + 1]):
            rows = [cells(line)]; index += 2
            while index < len(lines) and lines[index].strip() and "|" in lines[index]:
                rows.append(cells(lines[index])); index += 1
            table(document, rows); continue
        item = ITEM.match(line)
        if item:
            indent, marker, content = item.groups()
            style = "List Number" if marker[0].isdigit() else "List Bullet"
            paragraph = document.add_paragraph(style=style)
            if document_kind == "qa" and marker[0].isdigit():
                # Each test case has its own steps. Word's shared List Number
                # style otherwise continues numbering across unrelated tests.
                if int(marker[:-1]) == 1 or qa_numbering is None:
                    numbering = document.part.numbering_part.element
                    base_id = document.styles["List Number"].element.pPr.numPr.numId.val
                    base = numbering.xpath(f'./w:num[@w:numId="{base_id}"]')[0]
                    number = numbering.add_num(base.abstractNumId.val)
                    number.add_lvlOverride(ilvl=0).add_startOverride(1)
                    qa_numbering = number.numId
                props = paragraph._p.get_or_add_pPr().get_or_add_numPr()
                props.get_or_add_ilvl().val = 0
                props.get_or_add_numId().val = qa_numbering
                paragraph.paragraph_format.left_indent = Inches(.25)
                paragraph.paragraph_format.first_line_indent = Inches(-.25)
                paragraph.paragraph_format.tab_stops.add_tab_stop(Inches(.25))
            if indent: paragraph.paragraph_format.left_indent = Inches(.25 + min(len(indent), 8) * .10)
            inline(paragraph, content); index += 1; continue
        if line.lstrip().startswith(">"):
            paragraph = document.add_paragraph()
            paragraph.paragraph_format.left_indent = Inches(.25)
            inline(paragraph, line.lstrip()[1:].strip()); index += 1; continue
        paragraph_lines = [line.strip()]; index += 1
        while index < len(lines) and not is_block(lines, index):
            paragraph_lines.append(lines[index].strip()); index += 1
        paragraph = document.add_paragraph(); inline(paragraph, " ".join(paragraph_lines))
    if first_title: raise ValueError("Specification must contain a level-one title.")
    if mockups_dir is not None: append_mockups(document, text, mockups_dir)
    output.parent.mkdir(parents=True, exist_ok=True)
    # python-docx ZIP member timestamps vary by creation time. Normalize member
    # order and timestamps so the same source and tool versions yield the same
    # document bytes, and replace the destination only after the build succeeds.
    raw_name = normalized_name = None
    try:
        with tempfile.NamedTemporaryFile(dir=output.parent, suffix=".docx", delete=False) as raw:
            raw_name = raw.name
        with tempfile.NamedTemporaryFile(dir=output.parent, suffix=".docx", delete=False) as normalized:
            normalized_name = normalized.name
        document.save(raw_name)
        with zipfile.ZipFile(raw_name, "r") as original, zipfile.ZipFile(normalized_name, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as result:
            for name in sorted(original.namelist()):
                info = zipfile.ZipInfo(name, (1980, 1, 1, 0, 0, 0))
                info.compress_type = zipfile.ZIP_DEFLATED
                info.external_attr = 0o600 << 16
                result.writestr(info, original.read(name))
        os.replace(normalized_name, output); normalized_name = None
    finally:
        for name in (raw_name, normalized_name):
            if name:
                try: os.unlink(name)
                except FileNotFoundError: pass


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--mockups-dir", type=Path, help="Directory containing Night PNGs generated from the same Markdown mockup PDF")
    parser.add_argument("--kind", choices=("product", "qa"), default="product", help="Document header and metadata; prose always comes from --source")
    args = parser.parse_args()
    render(args.source, args.output, args.mockups_dir, args.kind)
