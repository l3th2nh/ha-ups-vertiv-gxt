// ============================================================================
//  ups_protocol.h — Doc UPS Vertiv/Liebert GXT-3000MTPLUS230 qua RS-232.
//
//  Giao thuc Voltronic PI01, da do va kiem chung thuc te qua duong USB-HID:
//    - Lenh la ASCII thuan + CR, KHONG kem CRC (kem CRC bi tra ve NAK)
//    - Phan hoi bat dau bang '(' va ket thuc bang CR
//    - Lenh ghi tra '(ACK' khi chap nhan, '(NAK' khi tu choi
//
//  CANH BAO: KHONG gui cac lenh sau khi dang van hanh binh thuong
//    T / T<nn>          -> kich hoat kiem tra pin (chuyen tai sang pin)
//    S<nn> / S<nn>R<mm> -> HEN GIO TAT UPS, cat dien toan bo tai
// ============================================================================
#pragma once

#include <Arduino.h>

struct UpsStatus {
  bool  valid = false;

  char  mode = '?';              // ma QMOD: L, B, Y, F, E, C, S, P, T, D
  char  modeAlias[16] = "";      // alias ASCII: "Line", "Battery", ...

  // QGS
  float inputVoltage = NAN;
  float inputFreq = NAN;
  float outputVoltage = NAN;
  float outputFreq = NAN;
  float outputCurrent = NAN;
  int   loadPercent = 0;
  float busPositive = NAN;
  float busNegative = NAN;
  float batteryVoltage = NAN;
  float temperature = NAN;
  char  statusBits[20] = "";

  // QBV
  int   batteryPercent = 0;
  int   runtimeMinutes = 0;
  int   batteryCount = 0;
  int   batteryPacks = 0;

  // QWS / QSK1
  bool  hasWarning = false;
  bool  outletP1 = false;
  bool  outletValid = false;

  bool onBattery() const { return mode == 'B'; }
};

// Mo UART toi module MAX3232 o toc do chi dinh
void upsBegin(uint32_t baud);

/**
 * Tu do toc do baud: thu lan luot cac gia tri thuong dung, gui QGS, toc do nao
 * co phan hoi hop le thi tra ve. Tra ve 0 neu khong toc do nao an.
 *
 * Manual KHONG ghi toc do baud nen phai do. Lam trong firmware de khoi phai
 * do bang PC. Ket qua nen luu vao NVS de lan sau khoi do lai.
 *
 * Neu tat ca deu im lang thi van de nam o phan cung, khong phai baud:
 * dau chan sai (thu dao TXD/RXD), hoac cap USB con cam o UPS.
 */
uint32_t upsDetectBaud();

// Danh sach toc do se thu, xep theo kha nang giam dan
extern const uint32_t UPS_BAUD_CANDIDATES[];
extern const size_t   UPS_BAUD_CANDIDATE_COUNT;

// Gui mot lenh, doc phan hoi den khi gap CR.
// Tra ve true neu nhan duoc phan hoi (ke ca "(NAK").
// `out` da bo ky tu CR o cuoi, GIU nguyen dau '(' de goi y phan biet.
bool upsCommand(const char* cmd, char* out, size_t outLen, uint32_t timeoutMs);

// Doc toan bo trang thai (QMOD + QGS + QBV + QWS + QSK1).
// Tra ve false neu khong doc noi QGS hoac QBV (hai lenh bat buoc).
bool upsReadStatus(UpsStatus& s);

// Doi ma QMOD sang alias ASCII. Phan dich sang tieng Viet nam o panel HA,
// KHONG dat tieng Viet trong firmware - giong nguyen tac cua agent Windows.
const char* upsModeAlias(char mode);
