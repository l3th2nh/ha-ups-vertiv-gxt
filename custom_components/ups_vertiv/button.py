"""Tat may tinh roi moi cat dien - theo dung thu tu, co cho doi.

Day la viec KHONG duoc lam bang tay bang cach bam hai nut lien tiep. Giua luc
Windows dang ghi not du lieu xuong dia ma cat dien thi hong file he thong, va
khong co gi bao cho biet luc nao thi an toan.

Chuoi nay doi den khi may THAT SU khong con tra loi nua roi mới cat dien, va
neu may khong tat trong han cho thi NO BO CUOC chu khong cat - mot cai PC dang
chay tiep thi hon han mot cai PC bi rut phich giua chung.

Thu tu cat: UPS truoc, o cam sau. Tat UPS lam mach ESP32 chet theo (mach lay
dien tu dau ra cua UPS) nen sau do khong con duong nao ra lenh cho UPS nua -
nhung o cam thi van tat duoc, vi no co dien va WiFi rieng.
"""

from __future__ import annotations

import asyncio
import logging

from homeassistant.components.button import ButtonEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .alerts import DEFAULT_CONFIG, send_notification
from .buttons import UPS_POWER_SUFFIX, find_by_suffix
from .const import DOMAIN
from .pc import DEFAULT_PROBE_PORT, async_alive

_LOGGER = logging.getLogger(__name__)

ENTITY_ID = "button.ups_vertiv_shutdown_all"

# Nhip hoi xem may tat chua
POLL_EVERY = 5


async def async_setup_entry(
    hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback
) -> None:
    async_add_entities([ShutdownAllButton(hass, entry)])


class ShutdownAllButton(ButtonEntity):
    """Mot nut cho ca chuoi: tat PC -> cho -> cat dien."""

    _attr_has_entity_name = False
    _attr_name = "Tắt PC rồi cắt điện"
    _attr_icon = "mdi:power-plug-off"

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry) -> None:
        self.hass = hass
        self.entity_id = ENTITY_ID
        self._attr_unique_id = f"{entry.entry_id}_shutdown_all"
        self._running = False

    @property
    def cfg(self) -> dict:
        stored = self.hass.data.get(DOMAIN, {}).get("config") or {}
        return {**DEFAULT_CONFIG, **stored}

    @property
    def extra_state_attributes(self) -> dict:
        c = self.cfg
        # Hien dung con so SE DUNG, khong phai con so da nhap: _run() ep han
        # cho len toi thieu 30 giay, bao 5 o day la noi doi.
        return {
            "dang_chay": self._running,
            "cho_toi_da_giay": max(30, int(c.get("seq_wait") or 180)),
            "cho_them_giay": max(0, int(c.get("seq_grace") or 20)),
            "cat_gi": c.get("seq_cut") or "none",
        }

    async def async_press(self) -> None:
        if self._running:
            _LOGGER.warning("UPS: chuoi tat may dang chay roi, bo qua lan bam nay")
            return
        self._running = True
        self.async_write_ha_state()
        try:
            await self._run()
        finally:
            self._running = False
            self.async_write_ha_state()

    async def _notify(self, title: str, msg: str, color: str) -> None:
        await send_notification(
            self.hass, self.cfg.get("service", ""), title, msg, "ups_shutdown", color
        )

    async def _turn_off(self, entity_id: str) -> None:
        await self.hass.services.async_call(
            "homeassistant", "turn_off", {"entity_id": entity_id}, blocking=False
        )

    async def _run(self) -> None:
        c = self.cfg
        ip = (c.get("pc_ip") or "").strip()
        port = int(c.get("pc_port") or DEFAULT_PROBE_PORT)
        off_entity = (c.get("pc_off_entity") or "").strip()
        wait = max(30, int(c.get("seq_wait") or 180))
        grace = max(0, int(c.get("seq_grace") or 20))
        cut = (c.get("seq_cut") or "none").strip()

        if not off_entity:
            _LOGGER.warning("UPS: chua chon cach tat PC, khong chay chuoi")
            await self._notify(
                "Không tắt được máy tính",
                "Chưa chọn cách TẮT máy trong Cài đặt, nên chuỗi dừng lại và "
                "KHÔNG cắt điện.", "#ff9800")
            return

        _LOGGER.info("UPS: chuoi tat may - buoc 1, kich hoat %s", off_entity)
        await self.hass.services.async_call(
            "homeassistant", "turn_on", {"entity_id": off_entity}, blocking=False
        )

        if not ip:
            # Khong do duoc thi khong co cach nao biet may tat chua -> dung lai.
            _LOGGER.warning("UPS: chua khai bao IP may tinh, khong biet khi nao "
                            "an toan de cat dien -> dung lai")
            await self._notify(
                "Đã gửi lệnh tắt máy",
                "Chưa khai báo IP nên không biết lúc nào máy tắt xong. "
                "KHÔNG cắt điện — hãy tự cắt sau khi chắc máy đã tắt.", "#ff9800")
            return

        _LOGGER.info("UPS: chuoi tat may - buoc 2, cho may tat (toi da %ss)", wait)
        waited = 0
        while waited < wait:
            await asyncio.sleep(POLL_EVERY)
            waited += POLL_EVERY
            if not await async_alive(ip, port):
                break
        else:
            # Het han ma may van tra loi -> BO CUOC, tuyet doi khong cat dien
            _LOGGER.error("UPS: may van song sau %ss -> KHONG cat dien", wait)
            await self._notify(
                "Máy tính chưa tắt — đã huỷ cắt điện",
                f"Sau {wait} giây máy vẫn trả lời, nên chuỗi dừng lại và KHÔNG "
                "cắt điện. Có thể có ứng dụng đang chặn tắt máy (hộp thoại lưu "
                "file chẳng hạn).", "#f44336")
            return

        _LOGGER.info("UPS: may da ngung tra loi sau %ss, cho them %ss", waited, grace)
        # Ngung tra loi mang la Windows da vao giai doan cuoi, nhung chua chac
        # da ghi xong dia. Cho them mot nhip cho chac.
        await asyncio.sleep(grace)

        if cut == "none":
            await self._notify(
                "Máy tính đã tắt",
                "Chuỗi dừng ở đây vì mục 'Sau khi tắt máy thì' đang để KHÔNG "
                "cắt gì.", "#4caf50")
            return

        # UPS truoc, o cam sau: tat UPS lam mach ESP32 chet theo nen sau do
        # khong ra lenh cho UPS duoc nua, con o cam thi van tat duoc.
        if cut in ("ups", "both"):
            ups = find_by_suffix(self.hass, "switch", UPS_POWER_SUFFIX)
            if ups:
                _LOGGER.info("UPS: chuoi tat may - buoc 3, tat UPS %s", ups)
                await self._turn_off(ups)
                await asyncio.sleep(5)
            else:
                _LOGGER.warning("UPS: khong tim thay cong tac UPS de tat")

        if cut in ("plug", "both"):
            plug = (c.get("plug_entity") or "").strip()
            if plug:
                _LOGGER.info("UPS: chuoi tat may - buoc 4, cat o cam %s", plug)
                await self._turn_off(plug)
            else:
                _LOGGER.warning("UPS: chua chon o cam de cat")

        await self._notify(
            "Đã tắt máy và cắt điện",
            f"Máy tính tắt sau {waited} giây. Đã cắt: "
            + {"ups": "UPS", "plug": "ổ cắm", "both": "UPS và ổ cắm"}.get(cut, cut)
            + ".", "#4caf50")
