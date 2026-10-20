"""Bat may tinh bang Wake-on-LAN va kiem tra no con song khong.

Hai viec deu lam truc tiep trong integration, khong goi sang tich hop khac:

- Goi danh thuc chi la mot goi UDP 102 byte, viet tay con it ma hon la bat
  nguoi dung them tich hop `wake_on_lan` roi sua configuration.yaml.
- Kiem tra song/chet bang cach MO MOT KET NOI TCP chu khong phai ping. Ping
  can raw socket, trong container cua Home Assistant thuong thieu quyen do va
  im lang tra ve "khong tra loi" - tuc la bao may tat trong khi no dang chay.
  Mo cong TCP thi khong can quyen gi.
"""

from __future__ import annotations

import asyncio
import logging
import socket

_LOGGER = logging.getLogger(__name__)

# Goi danh thuc theo chuan: 6 byte 0xFF roi lap dia chi MAC 16 lan
_SYNC = b"\xff" * 6
_REPEAT = 16

# Cong hay dung cho Wake-on-LAN. Goi ra ca hai vi tuy card mang.
WOL_PORTS = (9, 7)

# Cong mac dinh de do xem may con song. 445 la SMB cua Windows - luon mo san
# va duoc tuong lua cho phep o profile Private.
DEFAULT_PROBE_PORT = 445
PROBE_TIMEOUT = 2.0


def normalize_mac(mac: str) -> str | None:
    """'10:7B:44:16:25:5D' / '10-7b-44-16-25-5d' / '107b4416255d' -> dang chuan.

    Tra None neu khong phai MAC hop le. Mot ky tu sai trong MAC la du de goi
    danh thuc khong bao gio toi noi, ma khong co thong bao loi nao - nen phai
    chan ngay tu luc nhap.
    """
    if not mac:
        return None
    raw = "".join(c for c in mac if c.isalnum()).lower()
    if len(raw) != 12:
        return None
    try:
        int(raw, 16)
    except ValueError:
        return None
    return ":".join(raw[i : i + 2] for i in range(0, 12, 2)).upper()


def broadcast_for(ip: str) -> str:
    """Suy ra dia chi quang ba /24 tu IP, vi du 192.168.0.220 -> 192.168.0.255.

    Quang ba toan cuc 255.255.255.255 bi nhieu router va nhieu kieu dung mang
    cua container chan; quang ba theo subnet thi di duoc xa hon.
    """
    parts = (ip or "").split(".")
    if len(parts) == 4 and all(p.isdigit() for p in parts):
        return ".".join(parts[:3] + ["255"])
    return "255.255.255.255"


def _send_sync(mac: str, targets: list[str]) -> int:
    """Gui goi danh thuc. Chay trong executor vi socket o day la dong bo."""
    raw = bytes.fromhex(mac.replace(":", ""))
    packet = _SYNC + raw * _REPEAT
    sent = 0
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        for addr in targets:
            for port in WOL_PORTS:
                try:
                    sock.sendto(packet, (addr, port))
                    sent += 1
                except OSError as err:
                    _LOGGER.debug("WoL: khong gui duoc toi %s:%s - %s", addr, port, err)
    finally:
        sock.close()
    return sent


async def async_wake(hass, mac: str, ip: str = "") -> bool:
    """Danh thuc may. Tra True neu gui duoc it nhat mot goi."""
    norm = normalize_mac(mac)
    if not norm:
        _LOGGER.warning("WoL: MAC khong hop le: %r", mac)
        return False
    targets = ["255.255.255.255"]
    sub = broadcast_for(ip)
    if sub not in targets:
        targets.insert(0, sub)
    sent = await hass.async_add_executor_job(_send_sync, norm, targets)
    _LOGGER.info("WoL: da gui %s goi danh thuc toi %s qua %s", sent, norm,
                 ", ".join(targets))
    return sent > 0


async def async_alive(ip: str, port: int = DEFAULT_PROBE_PORT,
                      timeout: float = PROBE_TIMEOUT) -> bool:
    """May co mo cong do khong. Mo duoc ket noi = may dang chay."""
    if not ip:
        return False
    writer = None
    try:
        fut = asyncio.open_connection(ip, port)
        _, writer = await asyncio.wait_for(fut, timeout=timeout)
        return True
    except (OSError, asyncio.TimeoutError):
        return False
    finally:
        if writer is not None:
            writer.close()
            try:
                await writer.wait_closed()
            except OSError:
                pass
