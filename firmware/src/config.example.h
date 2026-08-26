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
// UART va chan GPIO do platformio.ini quyet dinh theo tung board, vi ESP32-C3
// KHONG co UART2 va cung khong co GPIO16/17. Xem build_flags trong env tuong ung.
//   ESP32-C3 Super Mini : UART1, RX=GPIO4,  TX=GPIO5
//   ESP32 WROOM-32      : UART2, RX=GPIO16, TX=GPIO17
// Muon doi chan thi sua platformio.ini, khong sua o day.
#ifndef UPS_UART_NUM
  #define UPS_UART_NUM 1
#endif
#ifndef UPS_RX_PIN
  #define UPS_RX_PIN 4
#endif
#ifndef UPS_TX_PIN
  #define UPS_TX_PIN 5
#endif

// Toc do baud: firmware TU DO luc khoi dong roi luu vao NVS, nen gia tri nay
// chi la diem xuat phat khi chua do duoc gi.
#define UPS_BAUD 2400

// --------------------------------------------------------------- Chu ky ---
#define POLL_NORMAL_MS       15000   // dang chay dien luoi
#define POLL_ON_BATTERY_MS    5000   // dang chay pin -> doc day hon
#define CMD_TIMEOUT_MS        2000   // cho phan hoi mot lenh

// ------------------------------------------------------------ Nhat ky ---
#define MAX_EVENTS      30      // so su kien mat dien giu lai (luu vao NVS)

// --------------------------------------------------- Cong suat dinh muc ---
// 3000 VA x PF 0.80 = 2400 W  (lay tu QMD cua chinh may nay)
#define UPS_MAX_WATTS   2400.0f
