"""Gan nut cua cong tac ngu canh vao lenh bat/tat UPS.

Cong tac ngu canh (scene switch) KHONG phai thiet bi dieu khien duoc. Trong
Home Assistant no hien ra la entity `event.*`: mot thiet bi DAU VAO, khong co
trang thai bat/tat, khong co dich vu nao de goi. `state` cua no la DAU THOI
GIAN cua lan bam gan nhat, va moi lan bam lai doi thanh moc moi.

Nen huong di duy nhat la: nghe entity do doi trang thai, roi tu goi dich vu
len thiet bi dich. Day la viec module nay lam.

Ba cho de hong, deu da chan:

1. Home Assistant khoi dong lai. Entity `event.*` khoi phuc moc thoi gian cu,
   sinh ra mot lan doi trang thai tu None -> moc cu. Khong chan thi moi lan
   HA khoi dong lai se tu dong "bam" mot cai - co the la bam vao nut TAT UPS.
   Chan bang hai lop: bo qua khi old_state la None, va bo qua su kien cu hon
   STALE_AFTER giay.

2. Bam nham. Nut nam tren tuong, ai di qua cung cham duoc, ma hanh dong thi
   co the la cat dien ca tu rack. Nen cho chon KIEU BAM (bam don / bam dup /
   giu) thay vi phan ung voi moi loai su kien.

3. Tien to entity khong dong nhat. Thiet bi ESPHome tung duoc doi ten sau khi
   mot so entity da ton tai, nen entity cu giu ten cu con entity moi mang ten
   moi. Do theo HAU TO thay vi ghep tu mot tien to.
"""

from __future__ import annotations

import logging
from datetime import timedelta

from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.event import async_track_state_change_event
from homeassistant.util import dt as dt_util

from .alerts import DEFAULT_CONFIG
from .const import DOMAIN

_LOGGER = logging.getLogger(__name__)

# Su kien cu hon moc nay thi coi nhu tan du sau khi khoi dong lai, khong phai
# nguoi vua bam. Rong tay de khong bo sot cu bam that khi HA dang ban.
STALE_AFTER = timedelta(seconds=60)

# Hau to entity cua cong tac nguon UPS tren thiet bi ESPHome
UPS_POWER_SUFFIX = "_ups_power"

# Hanh dong -> (dich vu, muc tieu). Muc tieu giai ra luc chay, vi o cam do
# nguoi dung chon trong Cai dat con cong tac UPS thi do theo hau to.
ACTIONS = {
    "plug_on": ("turn_on", "plug"),
    "plug_off": ("turn_off", "plug"),
    "plug_toggle": ("toggle", "plug"),
    "ups_on": ("turn_on", "ups"),
    "ups_off": ("turn_off", "ups"),
    "ups_toggle": ("toggle", "ups"),
}

NUM_BUTTONS = 2


def find_by_suffix(hass: HomeAssistant, domain: str, suffix: str) -> str | None:
    """Tim entity theo hau to trong mot domain.

    Khong ghep tu tien to vi tien to co the khong dong nhat giua cac entity:
    thiet bi doi ten sau khi mot so entity da duoc tao thi cai cu giu ten cu.
    """
    for state in hass.states.async_all(domain):
        if state.entity_id.endswith(suffix):
            return state.entity_id
    return None


class UpsButtonEngine:
    """Nghe entity `event.*` cua cong tac ngu canh va goi lenh tuong ung."""

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self._unsub = None
        self._watching: list[str] = []

    @property
    def cfg(self) -> dict:
        stored = self.hass.data.get(DOMAIN, {}).get("config") or {}
        return {**DEFAULT_CONFIG, **stored}

    def _bindings(self) -> dict[str, list[dict]]:
        """{entity_id: [{press, action}, ...]} cho cac nut da cau hinh day du.

        Mot entity co the duoc gan nhieu lan - vi du cung mot nut, bam don thi
        bat o cam con giu thi tat UPS - nen gom theo entity thay vi 1-1.
        """
        cfg = self.cfg
        out: dict[str, list[dict]] = {}
        for i in range(1, NUM_BUTTONS + 1):
            ent = (cfg.get(f"btn{i}_entity") or "").strip()
            act = (cfg.get(f"btn{i}_action") or "").strip()
            if not ent or act not in ACTIONS:
                continue
            out.setdefault(ent, []).append(
                {"press": (cfg.get(f"btn{i}_press") or "any").strip(), "action": act}
            )
        return out

    def start(self) -> None:
        self.refresh_tracking()

    def refresh_tracking(self) -> None:
        """(Doc lai cau hinh va) dang ky theo doi. Goi duoc nhieu lan."""
        watch = sorted(self._bindings())
        if watch == self._watching and self._unsub:
            return

        if self._unsub:
            self._unsub()
            self._unsub = None

        self._watching = watch
        if not watch:
            _LOGGER.debug("UPS: chua gan nut nao cho cong tac ngu canh")
            return

        self._unsub = async_track_state_change_event(self.hass, watch, self._on_event)
        _LOGGER.info("UPS: dang nghe nut bam tren %s", ", ".join(watch))

    def stop(self) -> None:
        if self._unsub:
            self._unsub()
            self._unsub = None
        self._watching = []

    def _target(self, kind: str) -> str | None:
        if kind == "plug":
            return (self.cfg.get("plug_entity") or "").strip() or None
        return find_by_suffix(self.hass, "switch", UPS_POWER_SUFFIX)

    @callback
    def _on_event(self, event) -> None:
        new = event.data.get("new_state")
        old = event.data.get("old_state")
        if new is None or new.state in ("", "unknown", "unavailable"):
            return
        # old_state None = entity vua xuat hien (HA khoi dong lai), KHONG phai
        # vua co nguoi bam. Khong chan thi moi lan HA khoi dong lai se tu bam.
        if old is None or old.state == new.state:
            return

        stamp = dt_util.parse_datetime(new.state)
        if stamp is None:
            _LOGGER.debug("UPS: %s khong phai moc thoi gian: %r",
                          new.entity_id, new.state)
            return
        age = dt_util.utcnow() - stamp
        if age > STALE_AFTER:
            _LOGGER.debug("UPS: bo qua su kien cu %s giay tren %s",
                          int(age.total_seconds()), new.entity_id)
            return

        kind = new.attributes.get("event_type") or ""
        for b in self._bindings().get(new.entity_id, []):
            if b["press"] not in ("any", "", kind):
                continue
            self.hass.async_create_task(self._run(new.entity_id, kind, b["action"]))

    async def _run(self, entity_id: str, kind: str, action: str) -> None:
        service, target_kind = ACTIONS[action]
        target = self._target(target_kind)
        if not target:
            _LOGGER.warning(
                "UPS: nut %s (%s) muon %s nhung chua biet entity dich. "
                "O cam thi chon trong Cai dat; cong tac UPS thi can thiet bi "
                "ESPHome dang online.", entity_id, kind or "bam", action,
            )
            return
        if self.hass.states.get(target) is None:
            _LOGGER.warning("UPS: nut %s muon %s nhung %s khong ton tai",
                            entity_id, action, target)
            return
        _LOGGER.info("UPS: nut %s (%s) -> switch.%s tren %s",
                     entity_id, kind or "bam", service, target)
        await self.hass.services.async_call(
            "switch", service, {"entity_id": target}, blocking=False
        )
