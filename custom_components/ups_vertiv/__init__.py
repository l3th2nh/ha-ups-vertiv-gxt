"""UPS Vertiv GXT Panel.

Dang ky mot muc "UPS" tren thanh ben Home Assistant tai duong dan /ups,
va nap luon custom card `ups-panel-card` de dung duoc trong dashboard khac.

Integration nay KHONG tao entity nao. Du lieu UPS do Windows agent
(Ups-Monitor.ps1) day len qua MQTT Discovery.
"""

from __future__ import annotations

import logging
from pathlib import Path

from homeassistant.components import frontend, panel_custom
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant

from .const import (
    CARD_JS,
    DOMAIN,
    PANEL_ICON,
    PANEL_JS,
    PANEL_TITLE,
    PANEL_URL,
    STATIC_URL,
    VERSION,
    WEBCOMPONENT,
)

_LOGGER = logging.getLogger(__name__)


async def _async_register_static(hass: HomeAssistant) -> None:
    """Phuc vu thu muc frontend/ ra duong dan tinh."""
    directory = str(Path(__file__).parent / "frontend")

    try:
        # HA 2024.7+ : API bat dong bo, khong chan event loop
        from homeassistant.components.http import StaticPathConfig

        await hass.http.async_register_static_paths(
            [StaticPathConfig(STATIC_URL, directory, False)]
        )
    except ImportError:  # pragma: no cover - ban HA cu hon
        hass.http.register_static_path(STATIC_URL, directory, False)


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Dung panel khi nguoi dung them integration."""
    store = hass.data.setdefault(DOMAIN, {})

    # Chi dang ky duong dan tinh mot lan cho ca vong doi cua HA
    if not store.get("static_registered"):
        await _async_register_static(hass)
        store["static_registered"] = True

    # Nap card cho moi dashboard -> dung duoc `type: custom:ups-panel-card`
    # o bat ky dashboard nao ma khong phai khai bao resource thu cong.
    if not store.get("card_registered"):
        frontend.add_extra_js_url(hass, f"{STATIC_URL}/{CARD_JS}?v={VERSION}")
        store["card_registered"] = True

    # Neu panel da ton tai (vi du sau khi reload) thi go truoc roi dang ky lai,
    # vi async_register_panel se bao loi khi trung duong dan.
    try:
        frontend.async_remove_panel(hass, PANEL_URL)
    except Exception:  # noqa: BLE001 - panel chua ton tai la chuyen binh thuong
        pass

    await panel_custom.async_register_panel(
        hass,
        webcomponent_name=WEBCOMPONENT,
        frontend_url_path=PANEL_URL,
        module_url=f"{STATIC_URL}/{PANEL_JS}?v={VERSION}",
        sidebar_title=PANEL_TITLE,
        sidebar_icon=PANEL_ICON,
        require_admin=False,
        config={},
    )

    _LOGGER.info("Da dang ky panel UPS tai /%s", PANEL_URL)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Go panel khoi thanh ben khi xoa integration."""
    try:
        frontend.async_remove_panel(hass, PANEL_URL)
    except Exception:  # noqa: BLE001
        _LOGGER.debug("Panel /%s khong con de go", PANEL_URL)
    return True
