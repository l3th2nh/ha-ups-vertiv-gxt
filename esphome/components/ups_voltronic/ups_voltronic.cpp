#include "ups_voltronic.h"
#include "esphome/core/log.h"
#include <cstdlib>
#include <cstring>

namespace esphome {
namespace ups_voltronic {

static const char *const TAG = "ups_voltronic";

// Cho toi da bao lau cho mot phan hoi. O 2400 baud, QGS (~60 ky tu) mat ~250ms
// truyen, cong thoi gian UPS xu ly -> 1.5s la rong rai.
static const uint32_t STEP_TIMEOUT_MS = 1500;

static const char *const STEP_CMD[] = {"QMOD", "QGS", "QBV", "QWS", "QSK1"};

const char *UpsVoltronic::mode_alias_(char mode) {
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

void UpsVoltronic::setup() {
  // Xoa rac con lai trong bo dem luc khoi dong
  while (this->available()) this->read();
  ESP_LOGCONFIG(TAG, "ups_voltronic da san sang");
}

void UpsVoltronic::dump_config() {
  ESP_LOGCONFIG(TAG, "UPS Voltronic (giao thuc PI01 qua RS-232):");
  ESP_LOGCONFIG(TAG, "  Cong suat dinh muc: %.0f W", this->rated_watts_);
  LOG_UPDATE_INTERVAL(this);
  this->check_uart_settings(2400);   // canh bao neu baud khac khuyen nghi
}

void UpsVoltronic::send_(const char *cmd) {
  while (this->available()) this->read();   // bo phan hoi cu con sot
  this->write_str(cmd);
  this->write_byte('\r');
}

void UpsVoltronic::start_step_(Step s) {
  this->step_ = s;
  this->buf_len_ = 0;
  this->step_started_ = millis();
  if (s < STEP_DONE) this->send_(STEP_CMD[s]);
}

void UpsVoltronic::update() {
  if (this->running_) {
    ESP_LOGW(TAG, "Vong doc truoc chua xong, bo qua nhip nay");
    return;
  }
  // Bat dau mot vong doc moi
  this->running_ = true;
  this->got_qgs_ = false;
  this->got_qbv_ = false;
  this->has_warning_ = false;
  this->outlet_valid_ = false;
  this->start_step_(STEP_QMOD);
}

void UpsVoltronic::loop() {
  if (!this->running_) return;

  // Doc dan tung byte, khong chan vong lap
  while (this->available()) {
    uint8_t c;
    if (!this->read_byte(&c)) break;
    if (c == '\n') continue;
    if (c == '\r') {
      this->buf_[this->buf_len_] = '\0';
      this->handle_reply_(this->step_, this->buf_);
      Step next = static_cast<Step>(this->step_ + 1);
      if (next >= STEP_DONE) {
        this->publish_all_();
        this->running_ = false;
        this->step_ = STEP_DONE;
      } else {
        this->start_step_(next);
      }
      return;
    }
    if (this->buf_len_ < sizeof(this->buf_) - 1) this->buf_[this->buf_len_++] = (char) c;
  }

  // Het gio cho phan hoi -> bo qua lenh nay, di tiep
  if (millis() - this->step_started_ > STEP_TIMEOUT_MS) {
    ESP_LOGW(TAG, "Khong co phan hoi cho '%s' (thu kiem baud / dao chan TX-RX)",
             STEP_CMD[this->step_]);
    Step next = static_cast<Step>(this->step_ + 1);
    if (next >= STEP_DONE) {
      this->publish_all_();
      this->running_ = false;
      this->step_ = STEP_DONE;
    } else {
      this->start_step_(next);
    }
  }
}

// Tach chuoi theo dau cach, bo qua cac dau cach lien tiep
static int split_fields(char *buf, char *fields[], int max_fields) {
  int count = 0;
  char *p = buf;
  while (*p && count < max_fields) {
    while (*p == ' ') p++;
    if (!*p) break;
    fields[count++] = p;
    while (*p && *p != ' ') p++;
    if (*p) *p++ = '\0';
  }
  return count;
}

void UpsVoltronic::handle_reply_(Step s, const char *reply) {
  if (reply[0] != '(') {
    ESP_LOGW(TAG, "'%s' tra ve khong hop le: '%s'", STEP_CMD[s], reply);
    return;
  }
  if (strncmp(reply, "(NAK", 4) == 0) {
    ESP_LOGD(TAG, "'%s' bi tu choi (NAK) - firmware UPS khong ho tro lenh nay",
             STEP_CMD[s]);
    return;
  }

  char tmp[160];
  strncpy(tmp, reply + 1, sizeof(tmp) - 1);
  tmp[sizeof(tmp) - 1] = '\0';

  switch (s) {
    case STEP_QMOD:
      this->mode_ = tmp[0];
      break;

    case STEP_QGS: {
      // InV InHz OutV OutHz OutA Load% BUS+ BUS- BattV BattCell TempC StatusBits
      char *f[16];
      int n = split_fields(tmp, f, 16);
      if (n < 12) { ESP_LOGW(TAG, "QGS chi co %d truong, can 12", n); break; }
      this->in_v_     = atof(f[0]);
      this->in_hz_    = atof(f[1]);
      this->out_v_    = atof(f[2]);
      this->out_hz_   = atof(f[3]);
      this->out_a_    = atof(f[4]);
      this->load_pct_ = atoi(f[5]);
      this->batt_v_   = atof(f[8]);
      // f[9] la dien ap tung cell, may nay tra "---.-" nen bo qua
      this->temp_c_   = atof(f[10]);
      this->got_qgs_  = true;
      break;
    }

    case STEP_QBV: {
      // BattV SoBinh SoPack DungLuong% SoPhutConLai
      char *f[8];
      int n = split_fields(tmp, f, 8);
      if (n < 5) { ESP_LOGW(TAG, "QBV chi co %d truong, can 5", n); break; }
      this->batt_pct_    = atoi(f[3]);
      this->runtime_min_ = atoi(f[4]);
      this->got_qbv_     = true;
      break;
    }

    case STEP_QWS:
      // 64 ky tu 0/1. Toan '0' = khong canh bao.
      for (const char *p = tmp; *p; p++) {
        if (*p == '1') { this->has_warning_ = true; break; }
      }
      break;

    case STEP_QSK1:
      // O cam lap trinh P1: '1' dang bat / '0' dang tat.
      // UPS TU NGAT o nay sau mot khoang chay pin (tinh nang shed tai).
      if (tmp[0] == '1') { this->outlet_on_ = true;  this->outlet_valid_ = true; }
      else if (tmp[0] == '0') { this->outlet_on_ = false; this->outlet_valid_ = true; }
      break;

    default:
      break;
  }
}

void UpsVoltronic::publish_all_() {
  if (!this->got_qgs_ && !this->got_qbv_) {
    ESP_LOGW(TAG, "Khong doc duoc gi trong vong nay - bo qua, khong day so cu len HA");
    return;
  }

#ifdef USE_SENSOR
  if (this->got_qgs_) {
    if (this->input_voltage_)     this->input_voltage_->publish_state(this->in_v_);
    if (this->input_frequency_)   this->input_frequency_->publish_state(this->in_hz_);
    if (this->output_voltage_)    this->output_voltage_->publish_state(this->out_v_);
    if (this->output_frequency_)  this->output_frequency_->publish_state(this->out_hz_);
    if (this->output_current_)    this->output_current_->publish_state(this->out_a_);
    if (this->load_)              this->load_->publish_state(this->load_pct_);
    if (this->load_power_)
      this->load_power_->publish_state(this->rated_watts_ * this->load_pct_ / 100.0f);
    if (this->battery_voltage_)   this->battery_voltage_->publish_state(this->batt_v_);
    if (this->temperature_)       this->temperature_->publish_state(this->temp_c_);
  }
  if (this->got_qbv_) {
    if (this->battery_level_) this->battery_level_->publish_state(this->batt_pct_);
    if (this->runtime_)       this->runtime_->publish_state(this->runtime_min_);
  }
#endif
#ifdef USE_BINARY_SENSOR
  if (this->on_battery_) this->on_battery_->publish_state(this->mode_ == 'B');
  if (this->fault_)      this->fault_->publish_state(this->has_warning_);
  if (this->outlet_p1_ && this->outlet_valid_) this->outlet_p1_->publish_state(this->outlet_on_);
#endif
#ifdef USE_TEXT_SENSOR
  if (this->status_) this->status_->publish_state(mode_alias_(this->mode_));
#endif
}

}  // namespace ups_voltronic
}  // namespace esphome
