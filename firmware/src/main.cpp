// ============================================================================
//  main.cpp — ESP32 doc UPS qua RS-232 va day len Home Assistant bang MQTT.
//
//  NGUYEN TAC: day DUNG topic + payload nhu agent Windows (Ups-Monitor.ps1),
//  nen panel, tab Nhat ky va engine canh bao ben HA khong phai sua gi.
//
//  Firmware chi day SO LIEU va MA (alias) thuan ASCII. Phan chu tieng Viet
//  nam trong ups-panel-card.js - giong het nguyen tac ap dung cho .ps1.
// ============================================================================

#include <Arduino.h>
#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <Preferences.h>
#include <time.h>

#include "config.h"
#include "ups_protocol.h"

// Mui gio Viet Nam (UTC+7, khong co DST)
#define TZ_INFO "ICT-7"

static WiFiClient   wifiClient;
static PubSubClient mqtt(wifiClient);
static Preferences  prefs;

static const String T_STATE  = String(BASE_TOPIC) + "/state";
static const String T_EVENTS = String(BASE_TOPIC) + "/events";
static const String T_AVAIL  = String(BASE_TOPIC) + "/availability";

// ------------------------------------------------------------- nhat ky ---
struct Outage {
  String start, end;
  uint32_t duration_s = 0;
  int   battery_start = 0, battery_end = 0, battery_min = 0;
  float voltage_start = 0, voltage_min = 0;
  int   load_max = 0;
  bool  outlet_shed = false;
  bool  ongoing = false;
};

static JsonDocument gEvents;        // mang cac su kien da ket thuc
static Outage       gCurrent;       // su kien dang dien ra (neu co)
static bool         gInOutage = false;
static bool         gTimeReady = false;

static String nowIso() {
  if (!gTimeReady) return String("");
  time_t t = time(nullptr);
  struct tm tmv;
  localtime_r(&t, &tmv);
  char b[32];
  strftime(b, sizeof(b), "%Y-%m-%dT%H:%M:%S", &tmv);
  return String(b);
}

static void eventsLoad() {
  prefs.begin("ups", true);
  String raw = prefs.getString("events", "[]");
  prefs.end();
  DeserializationError err = deserializeJson(gEvents, raw);
  if (err || !gEvents.is<JsonArray>()) {
    gEvents.clear();
    gEvents.to<JsonArray>();
  }
  Serial.printf("[ups] nap %u su kien tu NVS\n", (unsigned)gEvents.as<JsonArray>().size());
}

static void eventsSave() {
  String out;
  serializeJson(gEvents, out);
  prefs.begin("ups", false);
  prefs.putString("events", out);
  prefs.end();
}

static void eventsPush(const Outage& o) {
  JsonArray arr = gEvents.as<JsonArray>();
  while (arr.size() >= MAX_EVENTS) arr.remove(0);   // bo cai cu nhat
  JsonObject e = arr.add<JsonObject>();
  e["start"]          = o.start;
  e["end"]            = o.end;
  e["duration_s"]     = o.duration_s;
  e["battery_start"]  = o.battery_start;
  e["battery_end"]    = o.battery_end;
  e["battery_min"]    = o.battery_min;
  e["voltage_start"]  = o.voltage_start;
  e["voltage_min"]    = o.voltage_min;
  e["load_max"]       = o.load_max;
  e["outlet_shed"]    = o.outlet_shed;
  e["shutdown_fired"] = false;   // ESP32 khong tat may; PC tu quyet dinh
  e["ongoing"]        = false;
  eventsSave();
}

// -------------------------------------------------------------- MQTT ---
static void publishDiscovery() {
  struct Ent { const char* kind; const char* key; const char* name;
               const char* unit; const char* devCla; const char* stateCla;
               const char* icon; };

  // Giu DUNG danh sach + ten hien thi nhu agent Windows, vi HA sinh entity_id
  // tu ten thiet bi + ten entity (no BO QUA obj_id).
  static const Ent ENTS[] = {
    {"sensor","battery_percent","Battery",          "%",  "battery",    "measurement", nullptr},
    {"sensor","runtime_minutes","Runtime",          "min","duration",   "measurement", nullptr},
    {"sensor","load_percent",   "Load",             "%",  nullptr,      "measurement", "mdi:gauge"},
    {"sensor","load_watts",     "Load Power",       "W",  "power",      "measurement", nullptr},
    {"sensor","input_voltage",  "Input Voltage",    "V",  "voltage",    "measurement", nullptr},
    {"sensor","output_voltage", "Output Voltage",   "V",  "voltage",    "measurement", nullptr},
    {"sensor","battery_voltage","Battery Voltage",  "V",  "voltage",    "measurement", nullptr},
    {"sensor","input_freq",     "Input Frequency",  "Hz", "frequency",  "measurement", nullptr},
    {"sensor","output_freq",    "Output Frequency", "Hz", "frequency",  "measurement", nullptr},
    {"sensor","output_current", "Output Current",   "A",  "current",    "measurement", nullptr},
    {"sensor","temperature",    "Temperature",      "°C","temperature","measurement", nullptr},
    {"sensor","mode_text",      "Status",           nullptr, nullptr,   nullptr,       "mdi:power-plug"},
    {"binary_sensor","on_battery", "On Battery",            nullptr,"problem",nullptr, nullptr},
    {"binary_sensor","has_warning","Fault",                 nullptr,"problem",nullptr, nullptr},
    {"binary_sensor","outlet_p1",  "Programmable Outlet P1",nullptr,nullptr, nullptr, "mdi:power-socket-de"},
  };

  int n = 0;
  for (const Ent& e : ENTS) {
    JsonDocument d;
    d["name"]         = e.name;
    d["uniq_id"]      = String(DEVICE_ID) + "_" + e.key;
    d["obj_id"]       = String("ups_") + e.key;
    d["stat_t"]       = T_STATE;
    d["val_tpl"]      = String("{{ value_json.") + e.key + " }}";
    d["avty_t"]       = T_AVAIL;
    d["pl_avail"]     = "online";
    d["pl_not_avail"] = "offline";
    if (e.unit)     d["unit_of_meas"] = e.unit;
    if (e.devCla)   d["dev_cla"]      = e.devCla;
    if (e.stateCla) d["stat_cla"]     = e.stateCla;
    if (e.icon)     d["ic"]           = e.icon;
    if (strcmp(e.kind, "binary_sensor") == 0) { d["pl_on"] = "ON"; d["pl_off"] = "OFF"; }

    JsonObject dev = d["dev"].to<JsonObject>();
    dev["ids"].to<JsonArray>().add(DEVICE_ID);
    dev["name"] = DEVICE_NAME;
    dev["mdl"]  = DEVICE_MODEL;
    dev["mf"]   = DEVICE_MAKER;
    dev["sw"]   = "esp32-rs232";

    String topic = String(DISCOVERY_PREFIX) + "/" + e.kind + "/" + DEVICE_ID + "/" + e.key + "/config";
    String payload;
    serializeJson(d, payload);
    mqtt.publish(topic.c_str(), payload.c_str(), true);
    n++;
  }

  // Nhat ky su kien: state = thoi diem gan nhat, attributes = ca mang
  {
    JsonDocument d;
    d["name"]         = "Power Events";
    d["uniq_id"]      = String(DEVICE_ID) + "_power_events";
    d["obj_id"]       = "ups_power_events";
    d["stat_t"]       = T_EVENTS;
    d["val_tpl"]      = "{{ value_json.last }}";
    d["json_attr_t"]  = T_EVENTS;
    d["avty_t"]       = T_AVAIL;
    d["pl_avail"]     = "online";
    d["pl_not_avail"] = "offline";
    d["ic"]           = "mdi:history";
    JsonObject dev = d["dev"].to<JsonObject>();
    dev["ids"].to<JsonArray>().add(DEVICE_ID);
    dev["name"] = DEVICE_NAME;
    dev["mdl"]  = DEVICE_MODEL;
    dev["mf"]   = DEVICE_MAKER;
    dev["sw"]   = "esp32-rs232";

    String topic = String(DISCOVERY_PREFIX) + "/sensor/" + DEVICE_ID + "/power_events/config";
    String payload;
    serializeJson(d, payload);
    mqtt.publish(topic.c_str(), payload.c_str(), true);
    n++;
  }

  Serial.printf("[mqtt] da gui discovery cho %d entity\n", n);
}

static void publishEvents() {
  JsonDocument doc;
  JsonArray src = gEvents.as<JsonArray>();
  JsonArray out = doc["events"].to<JsonArray>();
  for (JsonObject e : src) out.add(e);

  if (gInOutage) {
    JsonObject e = out.add<JsonObject>();
    e["start"]          = gCurrent.start;
    e["end"]            = nullptr;
    e["duration_s"]     = gCurrent.duration_s;
    e["battery_start"]  = gCurrent.battery_start;
    e["battery_end"]    = gCurrent.battery_end;
    e["battery_min"]    = gCurrent.battery_min;
    e["voltage_start"]  = gCurrent.voltage_start;
    e["voltage_min"]    = gCurrent.voltage_min;
    e["load_max"]       = gCurrent.load_max;
    e["outlet_shed"]    = gCurrent.outlet_shed;
    e["shutdown_fired"] = false;
    e["ongoing"]        = true;
  }

  // ArduinoJson v7: khong tron MemberProxy voi const char* trong toan tu ba ngoi
  if (out.size()) doc["last"] = out[out.size() - 1]["start"];
  else            doc["last"] = "never";
  doc["count"]   = out.size();
  doc["ongoing"] = gInOutage;

  String payload;
  serializeJson(doc, payload);
  mqtt.publish(T_EVENTS.c_str(), payload.c_str(), true);
}

static void publishState(const UpsStatus& s) {
  JsonDocument d;
  d["timestamp"]       = nowIso();
  d["mode"]            = String(s.mode);
  d["mode_text"]       = s.modeAlias;
  d["on_battery"]      = s.onBattery() ? "ON" : "OFF";
  d["has_warning"]     = s.hasWarning ? "ON" : "OFF";
  d["battery_percent"] = s.batteryPercent;
  d["runtime_minutes"] = s.runtimeMinutes;
  d["load_percent"]    = s.loadPercent;
  d["load_watts"]      = (int)roundf(UPS_MAX_WATTS * s.loadPercent / 100.0f);
  d["input_voltage"]   = s.inputVoltage;
  d["output_voltage"]  = s.outputVoltage;
  d["battery_voltage"] = s.batteryVoltage;
  d["input_freq"]      = s.inputFreq;
  d["output_freq"]     = s.outputFreq;
  d["output_current"]  = s.outputCurrent;
  d["temperature"]     = s.temperature;
  d["status_bits"]     = s.statusBits;
  d["outlet_p1"]       = s.outletValid ? (s.outletP1 ? "ON" : "OFF") : "OFF";

  String payload;
  serializeJson(d, payload);
  mqtt.publish(T_STATE.c_str(), payload.c_str(), true);
}

static bool mqttConnect() {
  if (mqtt.connected()) return true;
  Serial.print("[mqtt] dang ket noi... ");
  bool ok = mqtt.connect(
      MQTT_CLIENT_ID, MQTT_USER, MQTT_PASS,
      T_AVAIL.c_str(), 0, true, "offline");   // Last Will
  if (!ok) {
    Serial.printf("that bai, rc=%d\n", mqtt.state());
    return false;
  }
  Serial.println("OK");
  mqtt.publish(T_AVAIL.c_str(), "online", true);
  publishDiscovery();
  publishEvents();
  return true;
}

// -------------------------------------------------------------- setup ---
void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println("\n[ups] ESP32 UPS bridge khoi dong");

  upsBegin();
  Serial.printf("[ups] UART2 @ %d baud, RX=%d TX=%d\n", UPS_BAUD, UPS_RX_PIN, UPS_TX_PIN);

  eventsLoad();

  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("[wifi] dang ket noi");
  for (int i = 0; i < 60 && WiFi.status() != WL_CONNECTED; i++) {
    delay(500);
    Serial.print('.');
  }
  Serial.println();
  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("[wifi] OK, IP = %s\n", WiFi.localIP().toString().c_str());
    configTzTime(TZ_INFO, "pool.ntp.org", "time.nist.gov");
    for (int i = 0; i < 20 && time(nullptr) < 1700000000; i++) delay(300);
    gTimeReady = time(nullptr) > 1700000000;
    Serial.printf("[time] %s\n", gTimeReady ? nowIso().c_str() : "chua dong bo duoc NTP");
  }

  mqtt.setServer(MQTT_HOST, MQTT_PORT);
  mqtt.setBufferSize(2048);
  mqtt.setKeepAlive(60);
}

// --------------------------------------------------------------- loop ---
void loop() {
  static uint32_t lastPoll = 0;
  static uint32_t pollInterval = POLL_NORMAL_MS;
  static char lastMode = '?';
  static int  failCount = 0;
  static bool lastOutlet = true;

  if (WiFi.status() != WL_CONNECTED) {
    delay(500);
    return;
  }
  if (!mqtt.connected()) {
    static uint32_t lastTry = 0;
    if (millis() - lastTry > 5000) { lastTry = millis(); mqttConnect(); }
  }
  mqtt.loop();

  if (millis() - lastPoll < pollInterval) { delay(20); return; }
  lastPoll = millis();

  UpsStatus s;
  if (!upsReadStatus(s)) {
    failCount++;
    Serial.printf("[ups] khong doc duoc (lan %d)\n", failCount);
    if (failCount == 3) mqtt.publish(T_AVAIL.c_str(), "offline", true);
    return;
  }
  if (failCount) {
    Serial.printf("[ups] doc lai duoc sau %d lan loi\n", failCount);
    failCount = 0;
    mqtt.publish(T_AVAIL.c_str(), "online", true);
  }

  if (s.mode != lastMode) {
    Serial.printf("[ups] doi che do: %c -> %c (%s)\n", lastMode, s.mode, s.modeAlias);
    lastMode = s.mode;
  }

  // O cam P1 bi UPS tu ngat trong luc mat dien
  if (s.outletValid) {
    if (lastOutlet && !s.outletP1 && gInOutage) gCurrent.outlet_shed = true;
    lastOutlet = s.outletP1;
  }

  // ------------------------------------------------------- nhat ky ---
  if (s.onBattery()) {
    if (!gInOutage) {
      gInOutage = true;
      gCurrent = Outage();
      gCurrent.start         = nowIso();
      gCurrent.battery_start = s.batteryPercent;
      gCurrent.battery_end   = s.batteryPercent;
      gCurrent.battery_min   = s.batteryPercent;
      gCurrent.voltage_start = s.batteryVoltage;
      gCurrent.voltage_min   = s.batteryVoltage;
      gCurrent.load_max      = s.loadPercent;
      gCurrent.ongoing       = true;
      Serial.printf("[ups] MAT DIEN LUOI - pin %d%%, %.1fV, con %d phut\n",
                    s.batteryPercent, s.batteryVoltage, s.runtimeMinutes);
    } else {
      if (s.batteryPercent < gCurrent.battery_min) gCurrent.battery_min = s.batteryPercent;
      if (s.batteryVoltage < gCurrent.voltage_min) gCurrent.voltage_min = s.batteryVoltage;
      if (s.loadPercent    > gCurrent.load_max)    gCurrent.load_max    = s.loadPercent;
      gCurrent.battery_end = s.batteryPercent;
      gCurrent.duration_s += pollInterval / 1000;
    }
    pollInterval = POLL_ON_BATTERY_MS;
  } else {
    if (gInOutage) {
      gInOutage = false;
      gCurrent.end      = nowIso();
      gCurrent.ongoing  = false;
      eventsPush(gCurrent);
      Serial.printf("[ups] CO DIEN LAI sau %u giay\n", (unsigned)gCurrent.duration_s);
    }
    pollInterval = POLL_NORMAL_MS;
  }

  publishState(s);
  publishEvents();
}
