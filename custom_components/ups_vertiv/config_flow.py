"""Config flow cho UPS Vertiv GXT Panel.

Khong co tham so nao can nhap - chi bam Submit la panel duoc dung len.
"""

from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant.config_entries import ConfigFlow, ConfigFlowResult

from .const import DOMAIN


class UpsVertivConfigFlow(ConfigFlow, domain=DOMAIN):
    """Chi cho phep mot ban duy nhat."""

    VERSION = 1

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Buoc duy nhat: xac nhan."""
        if self._async_current_entries():
            return self.async_abort(reason="single_instance_allowed")

        if user_input is None:
            return self.async_show_form(step_id="user", data_schema=vol.Schema({}))

        return self.async_create_entry(title="UPS Vertiv GXT Panel", data={})
