// ============================================================================
//  config.h — CHEP THANH config_local.h ROI SUA, hoac sua thang file nay.
//  config_local.h da bi .gitignore chan (chua mat khau WiFi/MQTT).
// ============================================================================
#pragma once

// ------------------------------------------------------------------ WiFi ---
#define WIFI_SSID       "TEN_WIFI_CUA_BAN"
#define WIFI_PASSWORD   "MAT_KHAU_WIFI"

// ------------------------------------------------------------------ MQTT ---
#define MQTT_HOST       "192.168.0.146"
#define MQTT_PORT       1883
#define MQTT_USER       "TAI_KHOAN_MQTT"
#define MQTT_PASS       "MAT_KHAU_MQTT"
#define MQTT_CLIENT_ID  "ups-vertiv-esp32"

// Giu NGUYEN cac gia tri nay de trung voi agent Windows -> HA khong phai sua gi
#define BASE_TOPIC      "ups/vertiv_gxt3000"
#define DISCOVERY_PREFIX "homeassistant"
#define DEVICE_ID       "vertiv_gxt3000"
#define DEVICE_NAME     "UPS Vertiv GXT-3000MTPLUS230"
#define DEVICE_MODEL    "GXT-3000MTPLUS230 (G3K, 3000VA / 2400W)"
#define DEVICE_MAKER    "Vertiv / Liebert"

// ------------------------------------------------------------- RS-232 UPS ---
// !!! CHUA KIEM CHUNG TREN MAY THAT !!!
// Manual khong ghi toc do baud. 2400 la chuan Megatec/Voltronic pho bien nhat.
// Chay Test-UpsSerial.ps1 tren PC de do, roi sua dung so o day.
#define UPS_BAUD        2400

// Chan noi toi module MAX3232. Doi neu ban dau day khac.
//   MAX3232 VCC -> ESP32 3V3   (KHONG phai 5V)
//   MAX3232 GND -> ESP32 GND
//   MAX3232 TXD -> UPS_RX_PIN
//   MAX3232 RXD -> UPS_TX_PIN
// Nhan TXD/RXD tren module re tien khong thong nhat giua cac hang.
// Neu khong nhan duoc du lieu: DAO hai chan nay.
#define UPS_RX_PIN      16
#define UPS_TX_PIN      17

// --------------------------------------------------------------- Chu ky ---
#define POLL_NORMAL_MS       15000   // dang chay dien luoi
#define POLL_ON_BATTERY_MS    5000   // dang chay pin -> doc day hon
#define CMD_TIMEOUT_MS        2000   // cho phan hoi mot lenh

// ------------------------------------------------------------ Nhat ky ---
#define MAX_EVENTS      30      // so su kien mat dien giu lai (luu vao NVS)

// --------------------------------------------------- Cong suat dinh muc ---
// 3000 VA x PF 0.80 = 2400 W  (lay tu QMD cua chinh may nay)
#define UPS_MAX_WATTS   2400.0f
