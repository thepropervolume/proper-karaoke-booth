#!/usr/bin/env python3
"""Render the product Markdown's mockup blocks as a Night/Day vector PDF.

Usage: python scripts/generate-mockups.py --source docs/product-specification.md --output /path/to/mockups.pdf
Screen content and palette come from Markdown; optional local logo references are bound by SHA256.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path

import reportlab
from reportlab.lib import colors
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

PAGE_W, PAGE_H = 1296, 756
INVENTORY_PAGE_SIZE = 14
WHITE = colors.HexColor('#f9faf8')
FONT_DIR = Path(reportlab.__file__).parent / 'fonts'
pdfmetrics.registerFont(TTFont('TPV', str(FONT_DIR / 'Vera.ttf')))
pdfmetrics.registerFont(TTFont('TPVBold', str(FONT_DIR / 'VeraBd.ttf')))


def blocks(text: str, kind: str) -> list[dict]:
    pattern = rf'^```{re.escape(kind)}\s*\r?\n(.*?)^```\s*$'
    return [json.loads(match.group(1)) for match in re.finditer(pattern, text, re.MULTILINE | re.DOTALL)]


def load(path: Path) -> tuple[dict, list[dict], str]:
    data = path.read_bytes()
    text = data.decode('utf-8')
    themes, screens = blocks(text, 'mockup-theme'), blocks(text, 'mockup')
    if len(themes) != 1 or not screens:
        raise ValueError('Source must contain exactly one mockup-theme block and at least one mockup block.')
    meta = themes[0]
    if not isinstance(meta, dict) or not all(isinstance(meta.get(key), str) and meta[key].strip() for key in ('product', 'deck_title', 'deck_subtitle')):
        raise ValueError('The mockup theme must name the product and deck.')
    if not isinstance(meta.get('themes'), dict) or set(meta['themes']) != {'Night', 'Day'}:
        raise ValueError('Define exactly Night and Day themes.')
    actions = meta.get('host_actions', ['search', 'display', 'fullscreen', 'settings'])
    if (not isinstance(actions, list) or not actions or len(actions) > 8 or
            not all(action in ('palette', 'search', 'display', 'fullscreen', 'settings') for action in actions) or
            len(set(actions)) != len(actions)):
        raise ValueError('Define a unique list of supported host actions.')
    for palette in meta['themes'].values():
        if not isinstance(palette, dict) or not all(isinstance(palette.get(key), str) and re.fullmatch(r'#[0-9a-fA-F]{6}', palette[key]) for key in ('background', 'panel', 'card', 'line', 'text', 'muted', 'accent', 'selected')):
            raise ValueError('Each theme must define valid six-digit color values.')
    logos = meta.get('brand_logos')
    if logos is not None:
        if not isinstance(logos, dict) or set(logos) != {'Night', 'Day'}:
            raise ValueError('Brand logos must define Night and Day.')
        root = (path.resolve().parent.parent / 'assets' / 'branding').resolve()
        for theme, entry in logos.items():
            if not isinstance(entry, dict) or set(entry) != {'path', 'sha256'} or not isinstance(entry['path'], str) or not isinstance(entry['sha256'], str):
                raise ValueError('Each brand logo needs a local path and SHA256.')
            target = (path.resolve().parent / entry['path']).resolve()
            if target.parent != root or target.name not in ('logo-dark.png', 'logo-light.png') or not target.is_file():
                raise ValueError('Brand logos must use local approved logo PNGs.')
            if target.stat().st_size > 2 * 1024 * 1024 or hashlib.sha256(target.read_bytes()).hexdigest() != entry['sha256']:
                raise ValueError('Brand logo does not match its Markdown SHA256.')
    ids = set()
    for item in screens:
        if not isinstance(item, dict):
            raise ValueError('Each mockup block must be a JSON object.')
        for key in ('id', 'title', 'status', 'description', 'layout', 'detail'):
            if not isinstance(item.get(key), str) or not item[key].strip():
                raise ValueError(f'Missing screen field {key}.')
        if item['id'] in ids or item['status'] not in ('Current', 'Partial', 'Planned'):
            raise ValueError(f"Duplicate ID or invalid status: {item['id']}.")
        if item['layout'] not in ('desktop', 'phones', 'display', 'settings', 'panels'):
            raise ValueError(f"Invalid layout: {item['layout']}.")
        if 'sidebar_search' in item and (not isinstance(item['sidebar_search'], str) or not item['sidebar_search'].strip()):
            raise ValueError(f"Screen {item['id']} needs a sidebar search label.")
        if 'row_sources' in item and (not isinstance(item['row_sources'], list) or not all(isinstance(source, str) for source in item['row_sources'])):
            raise ValueError(f"Screen {item['id']} needs valid result provider identities.")
        if 'provider_colors' in item and (not isinstance(item['provider_colors'], dict) or not all(isinstance(key, str) and isinstance(color, str) and re.fullmatch(r'#[0-9a-fA-F]{6}', color) for key, color in item['provider_colors'].items())):
            raise ValueError(f"Screen {item['id']} needs valid provider colors.")
        if item['layout'] == 'phones':
            if not all(isinstance(item.get(key), list) and len(item[key]) == 2 for key in ('phone_titles', 'phone_subtitles', 'phone_rows')) or not all(isinstance(rows, list) and all(isinstance(row, str) for row in rows) for rows in item['phone_rows']):
                raise ValueError(f"Screen {item['id']} must define two phone panels.")
        elif item['layout'] == 'display':
            if not all(isinstance(item.get(key), str) for key in ('display_title', 'display_subtitle', 'display_next')):
                raise ValueError(f"Screen {item['id']} must define display labels.")
            if 'display_cue' in item and not isinstance(item['display_cue'], str):
                raise ValueError(f"Screen {item['id']} needs a text display cue.")
        else:
            if not all(isinstance(item.get(key), str) for key in ('heading', 'side_heading', 'footer_heading')) or not all(isinstance(item.get(key), list) and all(isinstance(row, str) for row in item[key]) for key in ('rows', 'side_rows', 'footer_rows')):
                raise ValueError(f"Screen {item['id']} must define its headings and rows.")
            if item['layout'] in ('desktop', 'settings') and (not isinstance(item.get('navigation'), list) or not all(isinstance(row, str) for row in item['navigation'])):
                raise ValueError(f"Screen {item['id']} must define navigation.")
        if 'import_actions' in item and (not isinstance(item['import_actions'], list) or len(item['import_actions']) not in (2, 3) or not all(isinstance(action, dict) and action.get('icon') in ('importVideo', 'importFolder', 'importCdg') and isinstance(action.get('label'), str) and action['label'].strip() for action in item['import_actions'])):
            raise ValueError(f"Screen {item['id']} needs two or three valid import actions.")
        if 'host_navigation' in item and (not isinstance(item['host_navigation'], list) or len(item['host_navigation']) > 4 or not all(isinstance(entry, str) and entry.strip() for entry in item['host_navigation'])):
            raise ValueError(f"Screen {item['id']} needs valid host navigation labels.")
        if item['layout'] == 'settings' and (len(item['footer_rows']) < 2 or item.get('selected_navigation') not in item['navigation']):
            raise ValueError(f"Screen {item['id']} needs two footer actions and a selected section.")
        if item['layout'] == 'panels' and not isinstance(item.get('toolbar'), str):
            raise ValueError(f"Screen {item['id']} needs a toolbar label.")
        ids.add(item['id'])
    return meta, screens, hashlib.sha256(data).hexdigest()


def colour(value: str):
    return colors.HexColor(value)


def rect(c, x, y, w, h, fill, radius=0, stroke=None):
    c.setFillColor(colour(fill) if isinstance(fill, str) else fill)
    if stroke:
        c.setStrokeColor(colour(stroke)); c.setLineWidth(.7)
    if radius:
        c.roundRect(x, y, w, h, radius, stroke=int(bool(stroke)), fill=1)
    else:
        c.rect(x, y, w, h, stroke=int(bool(stroke)), fill=1)


def line(c, text, x, y, font='TPV', size=14, fill='#17283d', max_width=None):
    text = str(text).replace('\n', ' ')
    if max_width is not None and stringWidth(text, font, size) > max_width:
        while text and stringWidth(text + '...', font, size) > max_width:
            text = text[:-1]
        text += '...'
    c.setFillColor(colour(fill)); c.setFont(font, size); c.drawString(x, y, text)


def wrapped(c, text, x, y, width, font='TPV', size=13, fill='#51657a', leading=18, max_lines=3):
    words = str(text).split()
    lines, current = [], ''
    for word in words:
        candidate = f'{current} {word}'.strip()
        if current and stringWidth(candidate, font, size) > width:
            lines.append(current); current = word
        else:
            current = candidate
    if current:
        lines.append(current)
    for index, value in enumerate(lines[:max_lines]):
        if index == max_lines - 1 and len(lines) > max_lines:
            value += '...'
        line(c, value, x, y - index * leading, font, size, fill, width)


def inventory_page_count(screen_count: int) -> int:
    return (screen_count + INVENTORY_PAGE_SIZE - 1) // INVENTORY_PAGE_SIZE


def night_screen_page(screen_count: int, screen_index: int) -> int:
    """One-based page number after the cover and all inventory pages."""
    return 2 + inventory_page_count(screen_count) + 2 * screen_index


def inventory_description(c, text: str, x: float, y: float, screen_id: str):
    """Fit the complete description in three lines within an inventory row."""
    width, max_lines, leading = 500, 3, 14
    words = text.split()
    for size in (11, 10, 9, 8, 7):
        lines, current = [], ''
        for original in words:
            word = original
            while word and stringWidth(word, 'TPV', size) > width:
                if current:
                    lines.append(current); current = ''
                end = len(word)
                while stringWidth(word[:end], 'TPV', size) > width:
                    end -= 1
                lines.append(word[:end]); word = word[end:]
            if not word:
                continue
            candidate = f'{current} {word}'.strip()
            if current and stringWidth(candidate, 'TPV', size) > width:
                lines.append(current); current = word
            else:
                current = candidate
        if current:
            lines.append(current)
        if len(lines) <= max_lines:
            for index, value in enumerate(lines):
                line(c, value, x, y - index * leading, size=size, fill='#51657a')
            return
    raise ValueError(f'Screen {screen_id} inventory description is too long to fit without truncation.')


def divider(c, x1, y1, x2, y2, color):
    c.setStrokeColor(colour(color)); c.setLineWidth(.8); c.line(x1, y1, x2, y2)


def badge(c, text, x, y, palette, width=100):
    rect(c, x, y, width, 26, palette['card'], 13)
    line(c, text, x + 12, y + 8, 'TPVBold', 10, palette['accent'], width - 20)


def icon(c, kind, x, y, p):
    """Compact scalable controls; labels and tooltip behavior are in the source spec."""
    rect(c, x, y, 34, 28, p['card'], 5)
    c.setStrokeColor(colour(p['text'])); c.setFillColor(colour(p['text'])); c.setLineWidth(1.6)
    if kind == 'playPause':
        shape = c.beginPath(); shape.moveTo(x + 11, y + 7); shape.lineTo(x + 11, y + 21); shape.lineTo(x + 19, y + 14); shape.close()
        c.drawPath(shape, stroke=0, fill=1); c.rect(x + 22, y + 8, 2, 12, stroke=0, fill=1); c.rect(x + 26, y + 8, 2, 12, stroke=0, fill=1)
    elif kind == 'stop': c.rect(x + 11, y + 8, 12, 12, stroke=0, fill=1)
    elif kind == 'skip':
        shape = c.beginPath(); shape.moveTo(x + 9, y + 8); shape.lineTo(x + 9, y + 20); shape.lineTo(x + 20, y + 14); shape.close()
        c.drawPath(shape, stroke=0, fill=1); c.rect(x + 23, y + 8, 2, 12, stroke=0, fill=1)
    elif kind == 'previous':
        shape = c.beginPath(); shape.moveTo(x + 25, y + 8); shape.lineTo(x + 25, y + 20); shape.lineTo(x + 14, y + 14); shape.close()
        c.drawPath(shape, stroke=0, fill=1); c.rect(x + 9, y + 8, 2, 12, stroke=0, fill=1)
    elif kind == 'importCdg':
        c.circle(x + 17, y + 14, 9, stroke=1, fill=0); c.circle(x + 17, y + 14, 2, stroke=1, fill=0)
        c.line(x + 22, y + 8, x + 29, y + 8); c.line(x + 25.5, y + 4.5, x + 25.5, y + 11.5)
    elif kind == 'importVideo':
        c.roundRect(x + 5, y + 8, 17, 12, 2, stroke=1, fill=0)
        c.line(x + 22, y + 17, x + 28, y + 20); c.line(x + 28, y + 20, x + 28, y + 8); c.line(x + 28, y + 8, x + 22, y + 11)
        c.line(x + 13.5, y + 19, x + 13.5, y + 12); c.line(x + 10.5, y + 15, x + 13.5, y + 12); c.line(x + 16.5, y + 15, x + 13.5, y + 12)
    elif kind == 'importFolder':
        shape = c.beginPath(); shape.moveTo(x + 5, y + 8); shape.lineTo(x + 5, y + 20); shape.lineTo(x + 13, y + 20); shape.lineTo(x + 15, y + 18); shape.lineTo(x + 28, y + 18); shape.lineTo(x + 28, y + 8); shape.close(); c.drawPath(shape, stroke=1, fill=0)
        c.line(x + 17, y + 17, x + 17, y + 10); c.line(x + 14, y + 13, x + 17, y + 10); c.line(x + 20, y + 13, x + 17, y + 10)
    elif kind == 'search': c.circle(x + 15, y + 16, 5, stroke=1, fill=0); c.line(x + 19, y + 12, x + 24, y + 7)
    elif kind == 'palette':
        c.circle(x + 17, y + 14, 8, stroke=1, fill=0)
        for dx, dy in ((-4, 0), (-2, 4), (3, 4)):
            c.circle(x + 17 + dx, y + 14 + dy, 1, stroke=0, fill=1)
    elif kind == 'display': c.roundRect(x + 8, y + 9, 18, 12, 2, stroke=1, fill=0); c.line(x + 17, y + 9, x + 17, y + 6); c.line(x + 13, y + 6, x + 21, y + 6)
    elif kind == 'fullscreen':
        for dx, dy, hx, hy in [(9, 8, 4, 4), (25, 8, -4, 4), (9, 20, 4, -4), (25, 20, -4, -4)]:
            c.line(x + dx, y + dy, x + dx + hx, y + dy); c.line(x + dx, y + dy, x + dx, y + dy + hy)
    elif kind == 'settings':
        c.circle(x + 17, y + 14, 7, stroke=1, fill=0); c.circle(x + 17, y + 14, 2, stroke=1, fill=0)


def page_heading(c, meta, item, theme, page):
    rect(c, 0, 0, PAGE_W, PAGE_H, WHITE)
    line(c, meta['product'], 54, 714, 'TPVBold', 12, '#007fae')
    line(c, f"{item['id']}  {item['title']}", 54, 676, 'TPVBold', 26, '#17283d')
    line(c, theme.upper(), 1100, 681, 'TPVBold', 12, '#51657a')
    status_colors = {'Current': '#dff3e8', 'Partial': '#fff0d2', 'Planned': '#e7ebf5'}
    rect(c, 1153, 672, 92, 27, status_colors[item['status']], 13)
    line(c, item['status'].upper(), 1164, 680, 'TPVBold', 10, '#25384e', 74)
    line(c, item['description'], 55, 650, size=14, fill='#51657a', max_width=1170)
    wrapped(c, item['detail'], 56, 72, 1125, size=12, fill='#51657a', leading=17, max_lines=2)
    line(c, f"{meta['product']}  /  INTERFACE SPECIFICATION", 56, 29, size=9, fill='#6e7b89')
    line(c, str(page), 1225, 29, size=10, fill='#6e7b89')


def top_bar(c, x, y, w, p, title, product, actions):
    rect(c, x, y, w, 44, p['panel'])
    if p.get('_brand_logo'):
        c.drawImage(p['_brand_logo'], x + 14, y + 3, width=150, height=38, preserveAspectRatio=True, anchor='c', mask='auto')
        line(c, title, x + 182, y + 18, size=9, fill=p['muted'])
    else:
        rect(c, x + 17, y + 11, 22, 22, p['accent'], 5)
        line(c, 'TPV', x + 19, y + 17, 'TPVBold', 7, p['background'])
        line(c, product.upper(), x + 49, y + 25, 'TPVBold', 10, p['text'])
        line(c, title, x + 49, y + 11, size=9, fill=p['muted'])
    for index, name in enumerate(actions):
        icon(c, name, x + w - (14 + len(actions) * 40) + index * 40, y + 8, p)


def row(c, x, y, w, text, p, selected=False, height=51):
    if selected:
        rect(c, x, y, w, height - 3, p['selected'], 5)
    parts = text.split(' | ')
    if len(parts) > 1:
        line(c, parts[0], x + 13, y + height - 20, 'TPVBold', 13, p['text'], w - 26)
        line(c, '  |  '.join(parts[1:]), x + 13, y + 9, size=10, fill=p['muted'], max_width=w - 26)
    else:
        line(c, parts[0], x + 13, y + 17, size=12, fill=p['text'], max_width=w - 26)
    divider(c, x + 9, y, x + w - 9, y, p['line'])


def desktop(c, item, p, product, actions, settings=False):
    x, y, w, h = 80, 124, 1136, 500
    rect(c, x, y, w, h, p['background'], 5)
    top_bar(c, x, y + h - 44, w, p, 'KARAOKE HOST', product, actions)
    nav_w = 190
    rect(c, x, y, nav_w, h - 44, p['panel'])
    search_offset = 38 if item.get('sidebar_search') and not settings else 0
    if search_offset:
        rect(c, x + 10, y + h - 85, nav_w - 20, 28, p['card'], 5)
        line(c, item['sidebar_search'], x + 18, y + h - 76, size=9, fill=p['muted'], max_width=nav_w - 36)
    line(c, 'WORKSPACE' if not settings else 'PREFERENCES', x + 18, y + h - 74 - search_offset, 'TPVBold', 10, p['muted'])
    for index, entry in enumerate(item.get('navigation', [])[:8]):
        ny = y + h - 112 - index * 38 - search_offset
        selected = entry == item.get('selected_navigation')
        if selected:
            rect(c, x + 10, ny - 7, nav_w - 20, 30, p['card'], 5)
        line(c, entry, x + 19, ny + 3, 'TPVBold', 12, p['accent'] if selected else p['muted'], nav_w - 36)
    host_entries = item.get('host_navigation', [])
    if host_entries:
        line(c, 'HOST WORKSPACE', x + 18, y + 39 + len(host_entries) * 38, 'TPVBold', 10, p['muted'])
        for index, entry in enumerate(host_entries):
            line(c, entry, x + 19, y + 30 + (len(host_entries) - index - 1) * 38, 'TPVBold', 12, p['muted'], nav_w - 36)
    bx, bw = x + nav_w + 20, w - nav_w - 40
    bottom = 92
    main_w = int(bw * .59)
    divider(c, bx + main_w + 14, y + bottom, bx + main_w + 14, y + h - 45, p['line'])
    line(c, item['heading'], bx + 2, y + h - 80, 'TPVBold', 19, p['text'], main_w)
    import_actions = item.get('import_actions', [])
    for index, action in enumerate(import_actions):
        action_x = bx + main_w - len(import_actions) * 40 + index * 40
        icon(c, action['icon'], action_x, y + h - 90, p)
    rect(c, bx, y + h - 122, main_w, 30, p['card'], 5)
    line(c, item.get('toolbar', 'Settings and controls'), bx + 11, y + h - 112, size=10, fill=p['muted'], max_width=main_w - 20)
    for index, entry in enumerate(item.get('rows', [])[:5]):
        ry = y + h - 176 - index * 51
        row(c, bx, ry, main_w, entry, p, index == 0)
        sources = item.get('row_sources', [])
        color = item.get('provider_colors', {}).get(sources[index]) if index < len(sources) else None
        if color:
            rect(c, bx, ry, 3, 47, color, 1)
    sx, sw = bx + main_w + 28, bw - main_w - 28
    line(c, item['side_heading'], sx, y + h - 80, 'TPVBold', 16, p['text'], sw)
    for index, entry in enumerate(item.get('side_rows', [])[:5]):
        row(c, sx, y + h - 136 - index * 54, sw, entry, p, index == 0, 50)
    rect(c, x + nav_w, y, w - nav_w, bottom, p['panel'])
    line(c, item.get('footer_heading', 'Now Playing').upper(), bx, y + 65, 'TPVBold', 9, p['accent'])
    footer = item.get('footer_rows', [])
    if footer: line(c, footer[0], bx, y + 37, 'TPVBold', 12, p['text'], 240)
    if item.get('transport_icons'):
        for index, name in enumerate(item['transport_icons']): icon(c, name, bx + 260 + index * 43, y + 26, p)
        if len(footer) > 1: line(c, footer[1], bx + max(423, 260 + len(item['transport_icons']) * 43 + 12), y + 37, size=11, fill=p['text'], max_width=300)
    else:
        for index, entry in enumerate(footer[1:3]): line(c, entry, bx + (index + 1) * 260, y + 37, size=12, fill=p['text'], max_width=245)
    divider(c, bx, y + 15, x + w - 34, y + 15, p['line'])


def phones(c, item, p):
    for index in range(2):
        x, y, w, h = 263 + index * 455, 135, 315, 475
        rect(c, x, y, w, h, p['panel'], 22, p['line'])
        rect(c, x + 99, y + h - 20, 117, 5, p['line'], 3)
        line(c, item['phone_titles'][index], x + 20, y + h - 53, 'TPVBold', 16, p['text'], w - 40)
        line(c, item['phone_subtitles'][index], x + 20, y + h - 74, size=10, fill=p['muted'], max_width=w - 40)
        for row_index, entry in enumerate(item['phone_rows'][index][:6]):
            ry = y + h - 137 - row_index * 57
            rect(c, x + 18, ry, w - 36, 48, p['selected'] if row_index == 0 else p['card'], 7)
            parts = entry.split(' | ')
            line(c, parts[0], x + 30, ry + (27 if len(parts) > 1 else 17), 'TPVBold' if row_index == 0 else 'TPV', 11, p['text'], w - 60)
            if len(parts) > 1:
                line(c, '  |  '.join(parts[1:]), x + 30, ry + 10, size=9, fill=p['muted'], max_width=w - 60)
        rect(c, x + 102, y + 14, 111, 4, p['line'], 2)


def display(c, item, p, product):
    x, y, w, h = 115, 140, 1066, 463
    rect(c, x, y, w, h, '#05080d', 8)
    line(c, product.upper(), x + 32, y + h - 39, 'TPVBold', 13, '#dce8f4')
    if cue := item.get('display_cue'):
        rect(c, x + 27, y + h - 95, 152, 33, '#8560f4', 5)
        rect(c, x + 28, y + h - 94, 150, 31, '#19102d', 4)
        line(c, cue, x + 40, y + h - 83, 'TPVBold', 13, '#fffff3', 125)
    line(c, item['display_title'], x + 270, y + 235, 'TPVBold', 35, '#f5fbff', 620)
    line(c, item['display_subtitle'], x + 357, y + 196, size=17, fill='#afc0d2', max_width=500)
    rect(c, x + 28, y + 22, w - 56, 47, '#142233', 7)
    line(c, item['display_next'], x + 48, y + 39, 'TPVBold', 15, '#f0f8ff', w - 100)


def settings_dialog(c, item, p):
    x, y, w, h = 238, 131, 820, 483
    rect(c, x - 75, y - 4, w + 150, h + 8, p['background'], 8)
    rect(c, x, y, w, h, p['panel'], 8, p['line'])
    line(c, item['footer_heading'], x + 27, y + h - 40, 'TPVBold', 22, p['text'])
    yy = y + h - 79
    scale = min(1, (h - 138) / (34 * len(item['navigation']) + 25 * len(item['rows'])))
    for section in item['navigation']:
        is_open = section == item['selected_navigation']
        rect(c, x + 24, yy, w - 48, 29 * scale, p['card'], 4)
        line(c, section, x + 37, yy + 9 * scale, 'TPVBold', 11 * max(.9, scale), p['text'])
        line(c, '-' if is_open else '+', x + w - 47, yy + 8 * scale, 'TPVBold', 14 * max(.9, scale), p['accent'])
        yy -= 34 * scale
        if is_open:
            for entry in item['rows']:
                parts = entry.split(' | ')
                line(c, parts[0], x + 46, yy + 10 * scale, 'TPVBold', 10 * max(.9, scale), p['text'], 250)
                line(c, parts[1] if len(parts) > 1 else '', x + 302, yy + 10 * scale, size=10 * max(.9, scale), fill=p['muted'], max_width=w - 360)
                yy -= 25 * scale
    rect(c, x + w - 245, y + 12, 90, 29, p['card'], 5)
    rect(c, x + w - 145, y + 12, 121, 29, p['accent'], 5)
    line(c, item['footer_rows'][0], x + w - 225, y + 21, 'TPVBold', 10, p['text'])
    line(c, item['footer_rows'][1], x + w - 135, y + 21, 'TPVBold', 10, p['background'], 106)


def panels(c, item, p, product, actions):
    x, y, w, h = 110, 130, 1076, 475
    rect(c, x, y, w, h, p['background'], 8)
    workspace = 'PLANNED HOST WORKSPACE' if item['status'] == 'Planned' else 'EXPERIMENTAL HOST WORKSPACE' if item['status'] == 'Partial' else 'HOST WORKSPACE'
    top_bar(c, x, y + h - 44, w, p, workspace, product, actions)
    line(c, item['heading'], x + 28, y + h - 83, 'TPVBold', 21, p['text'])
    line(c, item['toolbar'], x + 28, y + h - 106, size=12, fill=p['muted'])
    left_w = 660
    for index, entry in enumerate(item['rows'][:5]):
        row(c, x + 22, y + h - 172 - index * 54, left_w, entry, p, index == 0)
    divider(c, x + 702, y + 90, x + 702, y + h - 60, p['line'])
    line(c, item['side_heading'], x + 724, y + h - 87, 'TPVBold', 17, p['text'], 310)
    for index, entry in enumerate(item['side_rows'][:5]):
        row(c, x + 718, y + h - 147 - index * 57, 326, entry, p, index == 0)
    rect(c, x, y, w, 62, p['panel'])
    line(c, item['footer_heading'].upper(), x + 27, y + 38, 'TPVBold', 10, p['accent'])
    line(c, '  /  '.join(item['footer_rows']), x + 27, y + 17, size=11, fill=p['text'], max_width=w - 54)


def cover(c, meta, screens, digest):
    rect(c, 0, 0, PAGE_W, PAGE_H, WHITE)
    rect(c, 0, 0, 28, PAGE_H, '#13bbef')
    line(c, meta['product'], 80, 670, 'TPVBold', 15, '#007fae')
    line(c, meta['deck_title'], 80, 526, 'TPVBold', 42, '#17283d')
    line(c, meta['deck_subtitle'], 82, 487, size=19, fill='#51657a')
    line(c, f'{len(screens)} screen families  /  2 themes', 82, 432, 'TPVBold', 15, '#007fae')
    wrapped(c, 'Current badges identify available surfaces. Partial and Planned screens include future design concepts; they are not claims of shipped features.', 82, 373, 760, size=16, leading=24, max_lines=3)
    line(c, f'Markdown source SHA-256: {digest}', 82, 72, size=10, fill='#6e7b89', max_width=1100)
    c.showPage()


def contents(c, meta, screens):
    pages = inventory_page_count(len(screens))
    for start in range(0, len(screens), INVENTORY_PAGE_SIZE):
        rect(c, 0, 0, PAGE_W, PAGE_H, WHITE)
        line(c, 'Screen inventory', 56, 680, 'TPVBold', 30, '#17283d')
        line(c, 'Each screen appears in Night followed by Day.', 56, 648, size=14, fill='#51657a')
        for index, item in enumerate(screens[start:start + INVENTORY_PAGE_SIZE]):
            column, row_index = divmod(index, 7)
            x, y = 56 + column * 610, 580 - row_index * 72
            line(c, item['id'], x, y, 'TPVBold', 14, '#007fae')
            line(c, item['title'], x + 62, y, 'TPVBold', 15, '#17283d', 410)
            line(c, item['status'].upper(), x + 480, y, 'TPVBold', 10, '#51657a', 100)
            inventory_description(c, item['description'], x + 62, y - 22, item['id'])
        line(c, f"{meta['product']}  /  INTERFACE SPECIFICATION", 56, 29, size=9, fill='#6e7b89')
        c.showPage()
    return pages


def generate(source: Path, output: Path):
    meta, screens, digest = load(source)
    output.parent.mkdir(parents=True, exist_ok=True)
    c = canvas.Canvas(str(output), pagesize=(PAGE_W, PAGE_H), pageCompression=1, invariant=1)
    c.setTitle(meta['deck_title']); c.setAuthor(meta['product'])
    c.setSubject(f'Generated from Markdown SHA-256 {digest}')
    cover(c, meta, screens, digest)
    contents(c, meta, screens)
    page = night_screen_page(len(screens), 0)
    host_actions = meta.get('host_actions', ['search', 'display', 'fullscreen', 'settings'])
    for item in screens:
        for theme in ('Night', 'Day'):
            palette = dict(meta['themes'][theme])
            if meta.get('brand_logos'):
                palette['_brand_logo'] = str((source.resolve().parent / meta['brand_logos'][theme]['path']).resolve())
            page_heading(c, meta, item, theme, page)
            if item['layout'] == 'desktop': desktop(c, item, palette, meta['product'], host_actions)
            elif item['layout'] == 'settings': settings_dialog(c, item, palette)
            elif item['layout'] == 'phones': phones(c, item, palette)
            elif item['layout'] == 'display': display(c, item, palette, meta['product'])
            else: panels(c, item, palette, meta['product'], host_actions)
            c.showPage(); page += 1
    c.save()
    print(f'Generated {page - 1} pages from {len(screens)} Markdown screen blocks: {output}')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    if args.source.resolve() == args.output.resolve():
        raise SystemExit('Source and output must be different files.')
    generate(args.source, args.output)


if __name__ == '__main__':
    main()
