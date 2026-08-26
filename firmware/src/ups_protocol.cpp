#include "ups_protocol.h"
#include "config.h"

// UART noi toi module MAX3232. So hieu UART do platformio.ini quyet dinh:
// ESP32-C3 chi co UART0/1 nen KHONG dung duoc UART2 nhu ESP32 co dien.
static HardwareSerial UpsSerial(UPS_UART_NUM);

// 2400 dat truoc: chuan Megatec/Voltronic pho bien nhat
const uint32_t UPS_BAUD_CANDIDATES[]   = { 2400, 9600, 1200, 4800, 19200, 38400 };
const size_t   UPS_BAUD_CANDIDATE_COUNT = sizeof(UPS_BAUD_CANDIDATES) / sizeof(uint32_t);

void upsBegin(uint32_t baud) {
  UpsSerial.end();
  UpsSerial.begin(baud, SERIAL_8N1, UPS_RX_PIN, UPS_TX_PIN);
  UpsSerial.setTimeout(CMD_TIMEOUT_MS);
  delay(120);
  while (UpsSerial.available()) UpsSerial.read();   // xoa rac luc doi toc do
}

uint32_t upsDetectBaud() {
  char buf[128];
  for (size_t i = 0; i < UPS_BAUD_CANDIDATE_COUNT; i++) {
    uint32_t b = UPS_BAUD_CANDIDATES[i];
    upsBegin(b);
    Serial.printf("[ups] thu %6u baud ... ", (unsigned)b);

    // Thu 2 lan: lan dau UPS co the con dang on dinh sau khi doi toc do
    for (int attempt = 0; attempt < 2; attempt++) {
      if (upsCommand("QGS", buf, sizeof(buf), CMD_TIMEOUT_MS)
          && buf[0] == '('
          && strncmp(buf, "(NAK", 4) != 0) {
        Serial.printf("CO PHAN HOI: %s\n", buf);
        return b;
      }
      delay(200);
    }
    Serial.println("im lang");
  }
  return 0;
}

const char* upsModeAlias(char mode) {
  switch (mode) {
    case 'P': return "PowerOn";
    case 'S': return "Standby";
    case 'Y': return "Bypass";
    case 'L': return "Line";
    case 'B': return "Battery";
    case 'T': return "BatteryTest";
    case 'F': return "Fault";
    case 'E': return "ECO";
    case 'C': return "Converter";
    case 'D': return "Shutdown";
    default:  return "Unknown";
  }
}

bool upsCommand(const char* cmd, char* out, size_t outLen, uint32_t timeoutMs) {
  if (!out || outLen == 0) return false;
  out[0] = '\0';

  // Xoa bo dem truoc khi gui, tranh doc nham phan hoi cu
  while (UpsSerial.available()) UpsSerial.read();

  UpsSerial.print(cmd);
  UpsSerial.print('\r');
  UpsSerial.flush();

  size_t n = 0;
  uint32_t start = millis();
  while (millis() - start < timeoutMs) {
    if (!UpsSerial.available()) { delay(5); continue; }
    int c = UpsSerial.read();
    if (c < 0) continue;
    if (c == '\r') { out[n] = '\0'; return n > 0; }
    if (c == '\n') continue;
    if (n < outLen - 1) out[n++] = (char)c;
  }
  out[n] = '\0';
  return false;   // het gio ma chua gap CR
}

// Tach chuoi theo dau cach, bo qua cac dau cach lien tiep.
// Tra ve so truong tach duoc.
static int splitFields(char* buf, char* fields[], int maxFields) {
  int count = 0;
  char* p = buf;
  while (*p && count < maxFields) {
    while (*p == ' ') p++;            // bo dau cach thua
    if (!*p) break;
    fields[count++] = p;
    while (*p && *p != ' ') p++;
    if (*p) *p++ = '\0';
  }
  return count;
}

bool upsReadStatus(UpsStatus& s) {
  char buf[128];
  s = UpsStatus();

  // ------------------------------------------------------------- QMOD ---
  if (upsCommand("QMOD", buf, sizeof(buf), CMD_TIMEOUT_MS) && buf[0] == '(') {
    s.mode = buf[1];
  }
  strncpy(s.modeAlias, upsModeAlias(s.mode), sizeof(s.modeAlias) - 1);

  // -------------------------------------------------------------- QGS ---
  // (InV InHz OutV OutHz OutA Load% BUS+ BUS- BattV BattCell TempC StatusBits
  if (!upsCommand("QGS", buf, sizeof(buf), CMD_TIMEOUT_MS)) return false;
  if (buf[0] != '(' || strncmp(buf, "(NAK", 4) == 0) return false;
  {
    char* fields[16];
    int n = splitFields(buf + 1, fields, 16);
    if (n < 12) return false;
    s.inputVoltage   = atof(fields[0]);
    s.inputFreq      = atof(fields[1]);
    s.outputVoltage  = atof(fields[2]);
    s.outputFreq     = atof(fields[3]);
    s.outputCurrent  = atof(fields[4]);
    s.loadPercent    = atoi(fields[5]);
    s.busPositive    = atof(fields[6]);
    s.busNegative    = atof(fields[7]);
    s.batteryVoltage = atof(fields[8]);
    // fields[9] la dien ap tung cell, may nay tra "---.-" nen bo qua
    s.temperature    = atof(fields[10]);
    strncpy(s.statusBits, fields[11], sizeof(s.statusBits) - 1);
  }

  // -------------------------------------------------------------- QBV ---
  // (BattV SoBinh SoPack DungLuong% SoPhutConLai
  if (!upsCommand("QBV", buf, sizeof(buf), CMD_TIMEOUT_MS)) return false;
  if (buf[0] != '(' || strncmp(buf, "(NAK", 4) == 0) return false;
  {
    char* fields[8];
    int n = splitFields(buf + 1, fields, 8);
    if (n < 5) return false;
    s.batteryCount   = atoi(fields[1]);
    s.batteryPacks   = atoi(fields[2]);
    s.batteryPercent = atoi(fields[3]);
    s.runtimeMinutes = atoi(fields[4]);
  }

  // -------------------------------------------------------------- QWS ---
  // 64 ky tu 0/1. Toan '0' = khong canh bao.
  if (upsCommand("QWS", buf, sizeof(buf), CMD_TIMEOUT_MS) && buf[0] == '(') {
    for (const char* p = buf + 1; *p; p++) {
      if (*p == '1') { s.hasWarning = true; break; }
    }
  }

  // ------------------------------------------------------------- QSK1 ---
  // O cam lap trinh P1: "(1" dang bat / "(0" dang tat.
  // UPS TU NGAT o nay sau mot khoang chay pin (tinh nang shed tai).
  if (upsCommand("QSK1", buf, sizeof(buf), CMD_TIMEOUT_MS) && buf[0] == '(') {
    if (buf[1] == '1') { s.outletP1 = true;  s.outletValid = true; }
    else if (buf[1] == '0') { s.outletP1 = false; s.outletValid = true; }
  }

  s.valid = true;
  return true;
}
