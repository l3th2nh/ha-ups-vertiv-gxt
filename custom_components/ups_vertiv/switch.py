"""Cong tac bat/tat may tinh qua Wake-on-LAN.

Chieu BAT lam duoc tron ven: goi danh thuc la mot goi UDP, khong phu thuoc gi.

Chieu TAT thi KHONG co duong nao chay san. Wake-on-LAN chi biet danh thuc; cat
dien thi khong duoc, va Windows khong nhan lenh tat tu xa neu khong co thu gi
dang nghe san tren may. Nen o day lam giong het cach tich hop `wake_on_lan`
cua Home Assistant: tat = KICH HOAT MOT ENTITY do nguoi dung chon (script,
button, switch...), con cach tat that su thi tuy nguoi dung dung SSH,
HASS.Agent hay gi khac.

Trang thai doc bang cach mo mot ket noi TCP toi may - xem pc.py.
"""

from __future__ import annotations

import logging
from datetime import timedelta

from homeassistant.components.switch import SwitchEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .alerts import DEFAULT_CONFIG
from .const import DOMAIN
from .pc import DEFAULT_PROBE_PORT, async_alive, async_wake, normalize_mac

_LOGGER = logging.getLogger(__name__)

SCAN_INTERVAL = timedelta(seconds=20)

# entity_id dat co dinh de panel do duoc theo hau to, khong phu thuoc ten hien
# thi - nguoi dung doi ten thi entity_id van giu nguyen.
ENTITY_ID = "switch.ups_vertiv_pc_power"


async def async_setup_entry(
    hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback
) -> None:
    async_add_entities([PcPowerSwitch(hass, entry)])


class PcPowerSwitch(SwitchEntity):
    """Bat may bang Wake-on-LAN, tat bang entity do nguoi dung chon."""

    _attr_has_entity_name = False
    _attr_name = "Bật / Tắt PC"
    _attr_icon = "mdi:desktop-tower"

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry) -> None:
        self.hass = hass
        self.entity_id = ENTITY_ID
        self._attr_unique_id = f"{entry.entry_id}_pc_power"
        self._alive = False
        self._configured = False

    @property
    def cfg(self) -> dict:
        stored = self.hass.data.get(DOMAIN, {}).get("config") or {}
        return {**DEFAULT_CONFIG, **stored}

    @property
    def available(self) -> bool:
        """Chua khai bao MAC/IP thi coi nhu khong dung duoc, thay vi bao 'tat'.

        Bao 'tat' khi thuc ra la chua cau hinh se khien nguoi dung bam mai
        khong hieu vi sao khong len.
        """
        return self._configured

    @property
    def is_on(self) -> bool:
        return self._alive

    @property
    def extra_state_attributes(self) -> dict:
        c = self.cfg
        return {
            "mac": normalize_mac(c.get("pc_mac", "")) or "",
            "ip": c.get("pc_ip", ""),
            "probe_port": int(c.get("pc_port") or DEFAULT_PROBE_PORT),
            "off_entity": c.get("pc_off_entity", ""),
        }

    async def async_update(self) -> None:
        c = self.cfg
        ip = (c.get("pc_ip") or "").strip()
        mac = normalize_mac(c.get("pc_mac", ""))
        self._configured = bool(ip and mac)
        if not self._configured:
            self._alive = False
            return
        port = int(c.get("pc_port") or DEFAULT_PROBE_PORT)
        self._alive = await async_alive(ip, port)

    async def async_turn_on(self, **kwargs) -> None:
        c = self.cfg
        ok = await async_wake(self.hass, c.get("pc_mac", ""), c.get("pc_ip", ""))
        if not ok:
            _LOGGER.warning("PC: khong gui duoc goi danh thuc, kiem tra lai MAC")
        # KHONG tu dat is_on = True: may mat 30-60 giay moi len, bao 'bat' ngay
        # la noi doi. De lan do ke tiep xac nhan.

    async def async_turn_off(self, **kwargs) -> None:
        target = (self.cfg.get("pc_off_entity") or "").strip()
        if not target:
            _LOGGER.warning(
                "PC: chua chon cach tat. Wake-on-LAN chi danh thuc duoc, khong "
                "tat duoc. Chon mot script/button lam viec tat trong Cai dat."
            )
            return
        if self.hass.states.get(target) is None:
            _LOGGER.warning("PC: entity tat may %s khong ton tai", target)
            return
        _LOGGER.info("PC: tat may bang %s", target)
        await self.hass.services.async_call(
            "homeassistant", "turn_on", {"entity_id": target}, blocking=False
        )
