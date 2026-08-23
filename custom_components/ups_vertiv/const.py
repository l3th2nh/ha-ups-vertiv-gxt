"""Hang so dung chung cho integration UPS Vertiv."""

DOMAIN = "ups_vertiv"
VERSION = "3.0.3"

PANEL_URL = "ups"
PANEL_TITLE = "UPS"
PANEL_ICON = "mdi:power-plug"

WEBCOMPONENT = "ups-vertiv-panel"
STATIC_URL = f"/{DOMAIN}-frontend"
PANEL_JS = "ups-panel.js"
CARD_JS = "ups-panel-card.js"
