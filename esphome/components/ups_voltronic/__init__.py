"""ups_voltronic — doc UPS Voltronic/Megatec (Vertiv, Liebert GXT...) qua RS-232.

Khai bao tat ca cam bien ngay trong khoi component cho gon, thay vi tach ra
nhieu platform rieng. Chi khai bao cai nao can, bo qua cai khong dung.
"""

import esphome.codegen as cg
import esphome.config_validation as cv
from esphome.components import binary_sensor, sensor, text_sensor, uart
from esphome.const import (
    CONF_ID,
    DEVICE_CLASS_BATTERY,
    DEVICE_CLASS_CURRENT,
    DEVICE_CLASS_DURATION,
    DEVICE_CLASS_FREQUENCY,
    DEVICE_CLASS_POWER,
    DEVICE_CLASS_PROBLEM,
    DEVICE_CLASS_TEMPERATURE,
    DEVICE_CLASS_VOLTAGE,
    STATE_CLASS_MEASUREMENT,
    UNIT_AMPERE,
    UNIT_CELSIUS,
    UNIT_HERTZ,
    UNIT_MINUTE,
    UNIT_PERCENT,
    UNIT_VOLT,
    UNIT_WATT,
)

DEPENDENCIES = ["uart"]
AUTO_LOAD = ["sensor", "binary_sensor", "text_sensor"]

ups_voltronic_ns = cg.esphome_ns.namespace("ups_voltronic")
UpsVoltronic = ups_voltronic_ns.class_(
    "UpsVoltronic", cg.PollingComponent, uart.UARTDevice
)

CONF_RATED_WATTS = "rated_watts"
CONF_AUTO_BAUD = "auto_baud"

# key trong YAML -> (ham setter trong C++, schema)
NUMERIC_SENSORS = {
    "battery_level": (
        "set_battery_level",
        sensor.sensor_schema(
            unit_of_measurement=UNIT_PERCENT,
            accuracy_decimals=0,
            device_class=DEVICE_CLASS_BATTERY,
            state_class=STATE_CLASS_MEASUREMENT,
        ),
    ),
    "runtime": (
        "set_runtime",
        sensor.sensor_schema(
            unit_of_measurement=UNIT_MINUTE,
            accuracy_decimals=0,
            device_class=DEVICE_CLASS_DURATION,
            state_class=STATE_CLASS_MEASUREMENT,
        ),
    ),
    "load": (
        "set_load",
        sensor.sensor_schema(
            unit_of_measurement=UNIT_PERCENT,
            accuracy_decimals=0,
            icon="mdi:gauge",
            state_class=STATE_CLASS_MEASUREMENT,
        ),
    ),
    "load_power": (
        "set_load_power",
        sensor.sensor_schema(
            unit_of_measurement=UNIT_WATT,
            accuracy_decimals=0,
            device_class=DEVICE_CLASS_POWER,
            state_class=STATE_CLASS_MEASUREMENT,
        ),
    ),
    "input_voltage": (
        "set_input_voltage",
        sensor.sensor_schema(
            unit_of_measurement=UNIT_VOLT,
            accuracy_decimals=1,
            device_class=DEVICE_CLASS_VOLTAGE,
            state_class=STATE_CLASS_MEASUREMENT,
        ),
    ),
    "output_voltage": (
        "set_output_voltage",
        sensor.sensor_schema(
            unit_of_measurement=UNIT_VOLT,
            accuracy_decimals=1,
            device_class=DEVICE_CLASS_VOLTAGE,
            state_class=STATE_CLASS_MEASUREMENT,
        ),
    ),
    "battery_voltage": (
        "set_battery_voltage",
        sensor.sensor_schema(
            unit_of_measurement=UNIT_VOLT,
            accuracy_decimals=1,
            device_class=DEVICE_CLASS_VOLTAGE,
            state_class=STATE_CLASS_MEASUREMENT,
        ),
    ),
    "input_frequency": (
        "set_input_frequency",
        sensor.sensor_schema(
            unit_of_measurement=UNIT_HERTZ,
            accuracy_decimals=1,
            device_class=DEVICE_CLASS_FREQUENCY,
            state_class=STATE_CLASS_MEASUREMENT,
        ),
    ),
    "output_frequency": (
        "set_output_frequency",
        sensor.sensor_schema(
            unit_of_measurement=UNIT_HERTZ,
            accuracy_decimals=1,
            device_class=DEVICE_CLASS_FREQUENCY,
            state_class=STATE_CLASS_MEASUREMENT,
        ),
    ),
    "output_current": (
        "set_output_current",
        sensor.sensor_schema(
            unit_of_measurement=UNIT_AMPERE,
            accuracy_decimals=1,
            device_class=DEVICE_CLASS_CURRENT,
            state_class=STATE_CLASS_MEASUREMENT,
        ),
    ),
    "temperature": (
        "set_temperature",
        sensor.sensor_schema(
            unit_of_measurement=UNIT_CELSIUS,
            accuracy_decimals=1,
            device_class=DEVICE_CLASS_TEMPERATURE,
            state_class=STATE_CLASS_MEASUREMENT,
        ),
    ),
}

BINARY_SENSORS = {
    "on_battery": (
        "set_on_battery",
        binary_sensor.binary_sensor_schema(device_class=DEVICE_CLASS_PROBLEM),
    ),
    "fault": (
        "set_fault",
        binary_sensor.binary_sensor_schema(device_class=DEVICE_CLASS_PROBLEM),
    ),
    "outlet_p1": (
        "set_outlet_p1",
        binary_sensor.binary_sensor_schema(icon="mdi:power-socket-de"),
    ),
}

TEXT_SENSORS = {
    "status": ("set_status", text_sensor.text_sensor_schema(icon="mdi:power-plug")),
}

_schema = {
    cv.GenerateID(): cv.declare_id(UpsVoltronic),
    # 3000 VA x PF 0.80 = 2400 W (lay tu QMD cua chinh may GXT-3000MTPLUS230)
    cv.Optional(CONF_RATED_WATTS, default=2400.0): cv.positive_float,
    # Manual cua UPS khong ghi toc do baud -> de thiet bi tu quet.
    # Tat khi da biet chac toc do, de khoi doi lung tung luc UPS tam im.
    cv.Optional(CONF_AUTO_BAUD, default=True): cv.boolean,
}
for _key, (_setter, _sch) in {**NUMERIC_SENSORS, **BINARY_SENSORS, **TEXT_SENSORS}.items():
    _schema[cv.Optional(_key)] = _sch

CONFIG_SCHEMA = (
    cv.Schema(_schema)
    .extend(cv.polling_component_schema("15s"))
    .extend(uart.UART_DEVICE_SCHEMA)
)


async def to_code(config):
    var = cg.new_Pvariable(config[CONF_ID])
    await cg.register_component(var, config)
    await uart.register_uart_device(var, config)

    cg.add(var.set_rated_watts(config[CONF_RATED_WATTS]))
    cg.add(var.set_auto_baud(config[CONF_AUTO_BAUD]))

    for key, (setter, _) in NUMERIC_SENSORS.items():
        if key in config:
            sens = await sensor.new_sensor(config[key])
            cg.add(getattr(var, setter)(sens))

    for key, (setter, _) in BINARY_SENSORS.items():
        if key in config:
            bs = await binary_sensor.new_binary_sensor(config[key])
            cg.add(getattr(var, setter)(bs))

    for key, (setter, _) in TEXT_SENSORS.items():
        if key in config:
            ts = await text_sensor.new_text_sensor(config[key])
            cg.add(getattr(var, setter)(ts))
