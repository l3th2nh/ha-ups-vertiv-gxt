"""Hang so dung chung cho integration UPS Vertiv."""

import json
from pathlib import Path


def _read_version() -> str:
    """Doc version tu manifest.json thay vi chep tay vao day.

    VERSION di thang vao query string cua file JS (`?v=...`). No tung bi ghim
    cung o "4.0.0" suot nhieu ban phat hanh, nen URL khong bao gio doi va trinh
    duyet cu dung ban JS da cache. Tren may tinh khong ai nhan ra vi Ctrl+F5 bo
    qua cache; tren app dien thoai thi khong co Ctrl+F5, nen panel dung yen o
    ban cu hang thang troi.

    Doc tu manifest.json de chi con DUNG MOT cho phai sua khi phat hanh.
    """
    try:
        with open(Path(__file__).parent / "manifest.json", encoding="utf-8") as fh:
            return str(json.load(fh)["version"])
    except (OSError, ValueError, KeyError):
        return "0"


DOMAIN = "ups_vertiv"
VERSION = _read_version()

PANEL_URL = "ups"
PANEL_TITLE = "UPS"
PANEL_ICON = "mdi:power-plug"

WEBCOMPONENT = "ups-vertiv-panel"
STATIC_URL = f"/{DOMAIN}-frontend"
PANEL_JS = "ups-panel.js"
CARD_JS = "ups-panel-card.js"
