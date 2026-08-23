"""UPS Vertiv GXT Panel.

- Đăng ký mục "UPS" trên thanh bên Home Assistant tại /ups
- Nạp luôn custom card `ups-panel-card` để dùng được ở dashboard khác
- Chạy engine cảnh báo nền: tự gửi thông báo khi mất điện / pin yếu / có điện lại,
  cấu hình ngay trong panel (KHÔNG cần viết YAML)

Integration này KHÔNG tạo entity nào. Dữ liệu UPS do agent trên máy Windows
(Ups-Monitor.ps1) đẩy lên qua MQTT Discovery.
"""

from __future__ import annotations

import logging
from datetime import timedelta
from pathlib import Path

import voluptuous as vol

from homeassistant.components import frontend, panel_custom, websocket_api
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.event import async_track_time_interval
from homeassistant.helpers.storage import Store

from .alerts import DEFAULT_CONFIG, UpsAlertEngine, resolve_entities, send_notification
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

# Entity MQTT có thể xuất hiện muộn hơn integration -> dò lại định kỳ
RETRACK_INTERVAL = timedelta(seconds=30)


async def _async_register_static(hass: HomeAssistant) -> None:
    """Phục vụ thư mục frontend/ ra đường dẫn tĩnh."""
    directory = str(Path(__file__).parent / "frontend")
    try:
        # HA 2024.7+ : API bất đồng bộ, không chặn event loop
        from homeassistant.components.http import StaticPathConfig

        await hass.http.async_register_static_paths(
            [StaticPathConfig(STATIC_URL, directory, False)]
        )
    except ImportError:  # pragma: no cover - bản HA cũ hơn
        hass.http.register_static_path(STATIC_URL, directory, False)


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Dựng panel + engine cảnh báo khi người dùng thêm integration."""
    store = hass.data.setdefault(DOMAIN, {})

    # ------------------------------------------------------ cấu hình lưu bền ---
    if "store" not in store:
        cfg_store = Store(hass, 1, DOMAIN)
        store["store"] = cfg_store
        loaded = await cfg_store.async_load() or {}
        store["config"] = {**DEFAULT_CONFIG, **loaded}

    # -------------------------------------------------------- file tĩnh ---
    if not store.get("static_registered"):
        await _async_register_static(hass)
        store["static_registered"] = True

    # Nạp card cho mọi dashboard -> dùng được `type: custom:ups-panel-card`
    # ở bất kỳ dashboard nào mà không phải khai báo resource thủ công.
    if not store.get("card_registered"):
        frontend.add_extra_js_url(hass, f"{STATIC_URL}/{CARD_JS}?v={VERSION}")
        store["card_registered"] = True

    # ------------------------------------------------------------- panel ---
    if PANEL_URL not in hass.data.get(frontend.DATA_PANELS, {}):
        await panel_custom.async_register_panel(
            hass,
            webcomponent_name=WEBCOMPONENT,
            frontend_url_path=PANEL_URL,
            module_url=f"{STATIC_URL}/{PANEL_JS}?v={VERSION}",
            sidebar_title=PANEL_TITLE,
            sidebar_icon=PANEL_ICON,
            require_admin=False,
            config={"version": VERSION},
        )

    # --------------------------------------------------------- WebSocket ---
    if not store.get("ws_registered"):
        store["ws_registered"] = True
        websocket_api.async_register_command(hass, ws_get)
        websocket_api.async_register_command(hass, ws_save)
        websocket_api.async_register_command(hass, ws_test)

    # ------------------------------------------------------------ engine ---
    if not store.get("engine"):
        engine = UpsAlertEngine(hass)
        engine.start()
        store["engine"] = engine

        async def _retrack(_now):
            engine.refresh_tracking()

        store["retrack_unsub"] = async_track_time_interval(
            hass, _retrack, RETRACK_INTERVAL
        )

    _LOGGER.info("UPS Vertiv: panel tại /%s, engine cảnh báo đã chạy", PANEL_URL)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Gỡ panel và dừng engine khi xoá integration."""
    store = hass.data.get(DOMAIN, {})

    if store.get("retrack_unsub"):
        store["retrack_unsub"]()
        store["retrack_unsub"] = None
    if store.get("engine"):
        store["engine"].stop()
        store["engine"] = None

    if PANEL_URL in hass.data.get(frontend.DATA_PANELS, {}):
        frontend.async_remove_panel(hass, PANEL_URL)
    return True


# ============================== WebSocket ==============================
@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/get"})
@websocket_api.async_response
async def ws_get(hass: HomeAssistant, connection, msg) -> None:
    """Panel đọc cấu hình cảnh báo + tình trạng dò entity."""
    store = hass.data.get(DOMAIN, {})
    ents = resolve_entities(hass)
    connection.send_result(
        msg["id"],
        {
            "config": {**DEFAULT_CONFIG, **(store.get("config") or {})},
            "entities": ents,
            "version": VERSION,
        },
    )


@websocket_api.websocket_command(
    {vol.Required("type"): f"{DOMAIN}/save", vol.Required("config"): dict}
)
@websocket_api.async_response
async def ws_save(hass: HomeAssistant, connection, msg) -> None:
    """Panel lưu cấu hình cảnh báo."""
    store = hass.data.setdefault(DOMAIN, {})
    cfg = {**DEFAULT_CONFIG, **msg["config"]}
    store["config"] = cfg
    if store.get("store"):
        await store["store"].async_save(cfg)
    # Đổi cấu hình có thể đổi entity cần theo dõi
    if store.get("engine"):
        store["engine"].refresh_tracking()
    connection.send_result(msg["id"], {"ok": True})


@websocket_api.websocket_command(
    {vol.Required("type"): f"{DOMAIN}/test", vol.Optional("service"): str}
)
@websocket_api.async_response
async def ws_test(hass: HomeAssistant, connection, msg) -> None:
    """Bắn một thông báo thử để kiểm tra dịch vụ đã chọn."""
    store = hass.data.get(DOMAIN, {})
    cfg = {**DEFAULT_CONFIG, **(store.get("config") or {})}
    service = msg.get("service", cfg.get("service", ""))
    ok, detail = await send_notification(
        hass,
        service,
        "🔔 Thử thông báo UPS",
        "Nếu bạn đọc được tin này thì cảnh báo mất điện sẽ tới đúng nơi.",
        "ups_test",
        "#03a9f4",
    )
    connection.send_result(msg["id"], {"ok": ok, "detail": detail})
