"""Gan nut cua cong tac ngu canh vao lenh dieu khien.

Cong tac ngu canh (scene switch) KHONG phai thiet bi dieu khien duoc. Trong
Home Assistant no hien ra la entity `event.*`: mot thiet bi DAU VAO, khong co
trang thai bat/tat, khong co dich vu nao de goi. `state` cua no la DAU THOI
GIAN cua lan bam gan nhat, va moi lan bam lai doi thanh moc moi.

Nen huong di duy nhat la: nghe entity do doi trang thai, roi tu goi dich vu
len thiet bi dich. Day la viec module nay lam.

Moi KHE gan duoc HAI hanh dong tren cung mot nut, phan biet bang kieu bam -
vi du bam mot lan thi MO dien, bam hai lan thi CAT dien. Mot nut mot hanh
dong thi muon vua bat vua tat phai hy sinh hai nut cho mot thiet bi.

Dich vu goi qua domain `homeassistant` chu khong phai `switch`, de mot khe
nham duoc vao bat ky thu gi: quat, den, dieu hoa, script, va ca scene (nhieu
thiet bi hong ngoai chi vao HA duoc duoi dang scene tap-to-run cua hang).

Ba cho de hong, deu da chan:

1. Home Assistant khoi dong lai. Entity `event.*` khoi phuc moc thoi gian cu,
   sinh ra mot lan doi trang thai tu None -> moc cu. Khong chan thi moi lan
   HA khoi dong lai se tu dong "bam" mot cai - co the la bam vao nut TAT UPS.
   Chan bang hai lop: bo qua khi old_state la None, va bo qua su kien cu hon
   STALE_AFTER giay.

2. Bam nham. Nut nam tren tuong, ai di qua cung cham duoc, ma hanh dong thi
   co the la cat dien ca tu rack. Nen cho chon KIEU BAM thay vi phan ung voi
   moi loai su kien.

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

# Hanh dong -> (dich vu, loai muc tieu). Muc tieu giai ra luc chay.
ACTIONS = {
    "plug_on": ("turn_on", "plug"),
    "plug_off": ("turn_off", "plug"),
    "plug_toggle": ("toggle", "plug"),
    "ups_on": ("turn_on", "ups"),
    "ups_off": ("turn_off", "ups"),
    "ups_toggle": ("toggle", "ups"),
    "target_on": ("turn_on", "target"),
    "target_off": ("turn_off", "target"),
    "target_toggle": ("toggle", "target"),
}

# So khe gan. Doi so nay thi phai doi ca DEFAULT_CONFIG va giao dien.
NUM_BUTTONS = 3

# Hai cap (kieu bam, hanh dong) tren cung mot khe: hau to khoa cau hinh
SLOTS = ("", "2")


# Domain chi "kich hoat" duoc chu khong co turn_on / turn_off.
# homeassistant.turn_on KHONG chay voi `button`: HA tra ve THANH CONG, 0 entity
# doi trang thai, khong mot thong bao loi nao - lenh bien mat trong im lang.
# Da do bang thuc nghiem tren HA 2026.10.1:
#    homeassistant.turn_on  button.x  -> 0 entity doi, service khong nhan duoc gi
#    button.press           button.x  -> 1 entity doi, service chay lenh
PRESS_DOMAINS = {"button": "press", "input_button": "press"}


def activate_service(entity_id: str) -> tuple[str, str]:
    """Dich vu dung de LAM CHO NO XAY RA voi entity nay."""
    domain = entity_id.split(".")[0]
    if domain in PRESS_DOMAINS:
        return domain, PRESS_DOMAINS[domain]
    return "homeassistant", "turn_on"


def is_press_only(entity_id: str) -> bool:
    """Entity chi bam duoc, khong co khai niem bat/tat."""
    return entity_id.split(".")[0] in PRESS_DOMAINS


async def async_activate(hass: HomeAssistant, entity_id: str) -> None:
    """Kich hoat entity bang dung dich vu cua domain do."""
    domain, service = activate_service(entity_id)
    _LOGGER.info("UPS: kich hoat %s bang %s.%s", entity_id, domain, service)
    await hass.services.async_call(
        domain, service, {"entity_id": entity_id}, blocking=False
    )


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
        """{entity_id: [{press, action, slot}, ...]} cho cac cap da day du.

        Mot entity co the duoc gan nhieu lan - cung mot nut, bam mot lan thi
        mo dien con bam hai lan thi cat - nen gom theo entity thay vi 1-1.
        """
        cfg = self.cfg
        out: dict[str, list[dict]] = {}
        for i in range(1, NUM_BUTTONS + 1):
            ent = (cfg.get(f"btn{i}_entity") or "").strip()
            if not ent:
                continue
            for s in SLOTS:
                act = (cfg.get(f"btn{i}_action{s}") or "").strip()
                if act not in ACTIONS:
                    continue
                out.setdefault(ent, []).append({
                    "press": (cfg.get(f"btn{i}_press{s}") or "any").strip(),
                    "action": act,
                    "slot": i,
                })
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

    def _target(self, kind: str, slot: int) -> str | None:
        if kind == "plug":
            return (self.cfg.get("plug_entity") or "").strip() or None
        if kind == "target":
            return (self.cfg.get(f"btn{slot}_target") or "").strip() or None
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
            self.hass.async_create_task(
                self._run(new.entity_id, kind, b["action"], b["slot"])
            )

    async def _run(self, entity_id: str, kind: str, action: str, slot: int) -> None:
        service, target_kind = ACTIONS[action]
        target = self._target(target_kind, slot)
        if not target:
            _LOGGER.warning(
                "UPS: nut %s (%s) muon %s nhung chua biet entity dich. "
                "O cam va thiet bi khac thi chon trong Cai dat; cong tac UPS "
                "thi can thiet bi ESPHome dang online.",
                entity_id, kind or "bam", action,
            )
            return
        if self.hass.states.get(target) is None:
            _LOGGER.warning("UPS: nut %s muon %s nhung %s khong ton tai",
                            entity_id, action, target)
            return
        # Entity chi bam duoc (button) thi khong co khai niem tat/dao. Bao ro
        # thay vi goi mot dich vu khong ton tai roi im lang khong lam gi.
        if is_press_only(target) and service != "turn_on":
            _LOGGER.warning(
                "UPS: nut %s muon '%s' tren %s, nhung %s chi BAM duoc chu khong "
                "tat/dao duoc. Doi hanh dong sang kieu bat/kich hoat.",
                entity_id, action, target, target)
            return
        if service == "turn_on":
            await async_activate(self.hass, target)
            return
        _LOGGER.info("UPS: nut %s (%s) -> homeassistant.%s tren %s",
                     entity_id, kind or "bam", service, target)
        # Goi qua domain `homeassistant` de chay duoc voi moi loai thiet bi:
        # switch, fan, light, climate, script va ca scene.
        await self.hass.services.async_call(
            "homeassistant", service, {"entity_id": target}, blocking=False
        )
