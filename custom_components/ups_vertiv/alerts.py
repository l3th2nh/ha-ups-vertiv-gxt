"""Engine cảnh báo chạy nền trong Home Assistant.

Theo dõi các entity UPS (do thiết bị ESPHome đẩy lên) và tự gửi thông báo
tới điện thoại. Cấu hình nằm trong panel, lưu vào /config/.storage — KHÔNG cần
viết YAML.

Đặt tên file là alerts.py chứ không phải notify.py: HA sẽ hiểu nhầm notify.py
là một notify platform của integration và cố nạp nó theo cách khác.
"""

from __future__ import annotations

import logging

from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.event import async_track_state_change_event

from .const import DOMAIN, PANEL_URL

_LOGGER = logging.getLogger(__name__)

# Khoá dùng để dò tiền tố: đủ hiếm để không đụng entity khác trong nhà
PROBE_SUFFIX = "_output_current"

# Nguồn dữ liệu là thiết bị ESPHome (ups-vertiv). HA sinh entity_id từ tên
# thiết bị + tên entity, ví dụ: sensor.ups_vertiv_battery
SUFFIX = {
    "on_battery": ("binary_sensor", "_on_battery"),
    "outlet_p1": ("binary_sensor", "_outlet_p1"),
    "battery": ("sensor", "_battery"),
    "runtime": ("sensor", "_runtime"),
    "load_power": ("sensor", "_load_power"),
    "status": ("sensor", "_status"),
}

DEFAULT_CONFIG = {
    "enabled": True,
    "service": "",           # rỗng = hiện thông báo trong HA
    "outage": True,
    "restore": True,
    "batt_warn": True,
    "batt_warn_at": 50,
    "batt_crit": True,
    "batt_crit_at": 25,
    "shed": True,
}


def resolve_entities(hass: HomeAssistant) -> dict:
    """Dò entity_id thật của bộ UPS. Trả về {} nếu chưa có entity nào."""
    prefix = None
    for state in hass.states.async_all("sensor"):
        eid = state.entity_id
        if eid.endswith(PROBE_SUFFIX):
            prefix = eid[len("sensor.") : -len(PROBE_SUFFIX)]
            break
    if not prefix:
        return {}
    return {
        key: f"{domain}.{prefix}{suf}" for key, (domain, suf) in SUFFIX.items()
    }


def _num(hass: HomeAssistant, entity_id: str | None):
    if not entity_id:
        return None
    st = hass.states.get(entity_id)
    if not st or st.state in ("unknown", "unavailable", "", None):
        return None
    try:
        return float(st.state)
    except (ValueError, TypeError):
        return None


async def _persistent(hass: HomeAssistant, title: str, message: str) -> None:
    await hass.services.async_call(
        "persistent_notification",
        "create",
        {"title": title, "message": message, "notification_id": f"{DOMAIN}_alert"},
        blocking=False,
    )


async def send_notification(
    hass: HomeAssistant, service: str, title: str, message: str, tag: str, color: str
) -> tuple[bool, str]:
    """Gửi thông báo, chịu được nhiều kiểu dịch vụ, luôn có đường lui.

    - Rỗng hoặc persistent_notification.* -> hiện trong HA
    - notify.<x> kiểu cũ (mobile_app_x)   -> nhận {title, message, data}
    - notify entity (HA mới)              -> notify.send_message + target
    - Lỗi bất kỳ                          -> rơi về persistent để không mất báo
    """
    deeplink = {"url": f"/{PANEL_URL}", "clickAction": f"/{PANEL_URL}"}
    extra = {
        "tag": tag,
        "channel": "UPS",
        "importance": "high",
        "color": color,
        **deeplink,
    }

    if not service or service.startswith("persistent_notification"):
        await _persistent(hass, title, message)
        return True, "Đã hiện thông báo trong HA"

    domain, _, name = service.partition(".")
    try:
        # notify.<x> kiểu cũ
        if (
            domain == "notify"
            and name
            and name != "send_message"
            and hass.services.has_service("notify", name)
        ):
            await hass.services.async_call(
                "notify",
                name,
                {"title": title, "message": message, "data": extra},
                blocking=True,
            )
            return True, f"Đã gửi qua {service}"

        # notify entity trên HA mới
        if (
            service.startswith("notify.")
            and hass.states.get(service) is not None
            and hass.services.has_service("notify", "send_message")
        ):
            await hass.services.async_call(
                "notify",
                "send_message",
                {"title": title, "message": message},
                blocking=True,
                target={"entity_id": service},
            )
            return True, f"Đã gửi tới {service}"

        raise ValueError(f"dịch vụ '{service}' không dùng được")
    except Exception as err:  # noqa: BLE001
        _LOGGER.warning("UPS: gửi thông báo qua '%s' lỗi (%s) -> dùng persistent", service, err)
        await _persistent(
            hass,
            title,
            f"{message}\n\n(Không gửi được qua '{service}'. Chọn dịch vụ khác trong tab Cài đặt.)",
        )
        return False, f"Lỗi '{service}': {err}"


class UpsAlertEngine:
    """Bám theo thay đổi trạng thái và bắn thông báo đúng lúc."""

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self._unsub = None
        self._ents: dict = {}
        # Cờ theo TỪNG lần mất điện, reset khi có điện lại
        self._warned = False
        self._crited = False

    @property
    def cfg(self) -> dict:
        stored = self.hass.data.get(DOMAIN, {}).get("config") or {}
        return {**DEFAULT_CONFIG, **stored}

    def start(self) -> None:
        self.refresh_tracking()

    def refresh_tracking(self) -> None:
        """(Dò lại entity và) đăng ký theo dõi. Gọi được nhiều lần."""
        ents = resolve_entities(self.hass)
        if not ents:
            _LOGGER.debug("UPS: chưa thấy entity nào, sẽ thử lại sau")
            return
        if ents == self._ents and self._unsub:
            return

        if self._unsub:
            self._unsub()
            self._unsub = None

        self._ents = ents
        watch = [ents["on_battery"], ents["battery"], ents["outlet_p1"]]
        self._unsub = async_track_state_change_event(self.hass, watch, self._on_change)
        _LOGGER.info("UPS: đang theo dõi cảnh báo trên %s", ", ".join(watch))

    def stop(self) -> None:
        if self._unsub:
            self._unsub()
            self._unsub = None

    @callback
    def _on_change(self, event) -> None:
        self.hass.async_create_task(self._handle(event))

    async def _handle(self, event) -> None:
        cfg = self.cfg
        if not cfg.get("enabled"):
            return

        eid = event.data.get("entity_id")
        old = event.data.get("old_state")
        new = event.data.get("new_state")
        if new is None or new.state in ("unknown", "unavailable"):
            return
        old_s = old.state if old else None
        if old_s == new.state:
            return

        e = self._ents
        svc = cfg.get("service", "")

        pin = _num(self.hass, e.get("battery"))
        runtime = _num(self.hass, e.get("runtime"))
        watt = _num(self.hass, e.get("load_power"))

        def fmt(v, unit, digits=0):
            return "–" if v is None else f"{v:.{digits}f} {unit}"

        # ------------------------------------------------------ mất điện ---
        if eid == e.get("on_battery"):
            if new.state == "on" and old_s == "off":
                self._warned = False
                self._crited = False
                if cfg.get("outage"):
                    await send_notification(
                        self.hass, svc,
                        "⚡ Mất điện lưới",
                        f"UPS đang chạy pin. Pin {fmt(pin, '%')}, "
                        f"dự phòng khoảng {fmt(runtime, 'phút')}, tải {fmt(watt, 'W')}.",
                        "ups_nguon", "#f44336",
                    )
            elif new.state == "off" and old_s == "on":
                self._warned = False
                self._crited = False
                if cfg.get("restore"):
                    outlet = self.hass.states.get(e.get("outlet_p1", ""))
                    them = ", ổ cắm P1 vẫn đang ngắt" if outlet and outlet.state == "off" else ""
                    await send_notification(
                        self.hass, svc,
                        "✅ Đã có điện lưới",
                        f"UPS trở lại chạy điện lưới. Pin còn {fmt(pin, '%')}{them}.",
                        "ups_nguon", "#4caf50",
                    )
            return

        # ------------------------------------------------------- pin yếu ---
        if eid == e.get("battery"):
            on_batt = self.hass.states.get(e.get("on_battery", ""))
            if not on_batt or on_batt.state != "on" or pin is None:
                return

            crit_at = float(cfg.get("batt_crit_at", 25))
            warn_at = float(cfg.get("batt_warn_at", 50))

            if cfg.get("batt_crit") and pin <= crit_at and not self._crited:
                self._crited = True
                self._warned = True   # đã tới mức nguy cấp thì bỏ qua mức cảnh báo
                await send_notification(
                    self.hass, svc,
                    f"🚨 Pin UPS còn {pin:.0f}% — máy tính sắp tự tắt",
                    f"Máy tính sẽ tự tắt an toàn khi chạm ngưỡng đã đặt. "
                    f"Dự phòng khoảng {fmt(runtime, 'phút')}.",
                    "ups_pin", "#f44336",
                )
            elif cfg.get("batt_warn") and pin <= warn_at and not self._warned:
                self._warned = True
                await send_notification(
                    self.hass, svc,
                    f"🔋 Pin UPS còn {pin:.0f}%",
                    f"Vẫn đang mất điện. Dự phòng khoảng {fmt(runtime, 'phút')} nữa.",
                    "ups_pin", "#ff9800",
                )
            return

        # -------------------------------------------------- UPS ngắt ổ P1 ---
        if eid == e.get("outlet_p1"):
            if new.state == "off" and old_s == "on" and cfg.get("shed"):
                await send_notification(
                    self.hass, svc,
                    "🔌 UPS đã ngắt ổ cắm P1",
                    "Các thiết bị cắm ở dãy P1 vừa mất điện. UPS làm vậy để dành pin "
                    "cho tải quan trọng.",
                    "ups_o_p1", "#ff9800",
                )
