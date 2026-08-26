// ============================================================================
//  ups_voltronic — doc UPS Vertiv/Liebert GXT (va cac UPS Voltronic/Megatec
//  cung ho) qua RS-232, cho ESPHome.
//
//  Giao thuc PI01, da do va kiem chung thuc te tren GXT-3000MTPLUS230:
//    - Lenh la ASCII thuan + CR, KHONG kem CRC (kem CRC bi tra ve NAK)
//    - Phan hoi bat dau bang '(' va ket thuc bang CR
//    - Lenh ghi tra '(ACK' khi chap nhan, '(NAK' khi tu choi
//
//  KHONG chan vong lap: moi lenh gui xong thi doc dan tung byte qua loop(),
//  het lenh nay moi sang lenh khac. O 2400 baud mot phan hoi mat ~250ms nen
//  neu cho dong bo ca 5 lenh se chan ~2 giay, du de ESPHome canh bao.
//
//  CANH BAO: KHONG gui cac lenh sau khi dang van hanh binh thuong
//    T / T<nn>          -> kich hoat kiem tra pin (chuyen tai sang pin)
//    S<nn> / S<nn>R<mm> -> HEN GIO TAT UPS, cat dien toan bo tai
// ============================================================================
#pragma once

#include "esphome/core/component.h"
#include "esphome/components/uart/uart.h"
#ifdef USE_SENSOR
#include "esphome/components/sensor/sensor.h"
#endif
#ifdef USE_BINARY_SENSOR
#include "esphome/components/binary_sensor/binary_sensor.h"
#endif
#ifdef USE_TEXT_SENSOR
#include "esphome/components/text_sensor/text_sensor.h"
#endif

namespace esphome {
namespace ups_voltronic {

class UpsVoltronic : public PollingComponent, public uart::UARTDevice {
 public:
  void setup() override;
  void loop() override;
  void update() override;
  void dump_config() override;
  float get_setup_priority() const override { return setup_priority::DATA; }

  void set_rated_watts(float w) { this->rated_watts_ = w; }

#ifdef USE_SENSOR
  void set_battery_level(sensor::Sensor *s) { battery_level_ = s; }
  void set_runtime(sensor::Sensor *s) { runtime_ = s; }
  void set_load(sensor::Sensor *s) { load_ = s; }
  void set_load_power(sensor::Sensor *s) { load_power_ = s; }
  void set_input_voltage(sensor::Sensor *s) { input_voltage_ = s; }
  void set_output_voltage(sensor::Sensor *s) { output_voltage_ = s; }
  void set_battery_voltage(sensor::Sensor *s) { battery_voltage_ = s; }
  void set_input_frequency(sensor::Sensor *s) { input_frequency_ = s; }
  void set_output_frequency(sensor::Sensor *s) { output_frequency_ = s; }
  void set_output_current(sensor::Sensor *s) { output_current_ = s; }
  void set_temperature(sensor::Sensor *s) { temperature_ = s; }
#endif
#ifdef USE_BINARY_SENSOR
  void set_on_battery(binary_sensor::BinarySensor *s) { on_battery_ = s; }
  void set_fault(binary_sensor::BinarySensor *s) { fault_ = s; }
  void set_outlet_p1(binary_sensor::BinarySensor *s) { outlet_p1_ = s; }
#endif
#ifdef USE_TEXT_SENSOR
  void set_status(text_sensor::TextSensor *s) { status_ = s; }
#endif

 protected:
  // Trinh tu lenh chay tuan tu, moi vong update() bat dau lai tu dau
  enum Step : uint8_t { STEP_QMOD = 0, STEP_QGS, STEP_QBV, STEP_QWS, STEP_QSK1, STEP_DONE };

  void start_step_(Step s);
  void send_(const char *cmd);
  void handle_reply_(Step s, const char *reply);
  void publish_all_();
  static const char *mode_alias_(char mode);

  float rated_watts_{2400.0f};

  bool     running_{false};
  Step     step_{STEP_DONE};
  uint32_t step_started_{0};
  char     buf_[160];
  uint8_t  buf_len_{0};

  // Gia tri doc duoc trong mot vong
  char  mode_{'?'};
  float in_v_{NAN}, in_hz_{NAN}, out_v_{NAN}, out_hz_{NAN}, out_a_{NAN};
  int   load_pct_{0};
  float batt_v_{NAN}, temp_c_{NAN};
  int   batt_pct_{0}, runtime_min_{0};
  bool  has_warning_{false};
  bool  outlet_on_{false}, outlet_valid_{false};
  bool  got_qgs_{false}, got_qbv_{false};

#ifdef USE_SENSOR
  sensor::Sensor *battery_level_{nullptr};
  sensor::Sensor *runtime_{nullptr};
  sensor::Sensor *load_{nullptr};
  sensor::Sensor *load_power_{nullptr};
  sensor::Sensor *input_voltage_{nullptr};
  sensor::Sensor *output_voltage_{nullptr};
  sensor::Sensor *battery_voltage_{nullptr};
  sensor::Sensor *input_frequency_{nullptr};
  sensor::Sensor *output_frequency_{nullptr};
  sensor::Sensor *output_current_{nullptr};
  sensor::Sensor *temperature_{nullptr};
#endif
#ifdef USE_BINARY_SENSOR
  binary_sensor::BinarySensor *on_battery_{nullptr};
  binary_sensor::BinarySensor *fault_{nullptr};
  binary_sensor::BinarySensor *outlet_p1_{nullptr};
#endif
#ifdef USE_TEXT_SENSOR
  text_sensor::TextSensor *status_{nullptr};
#endif
};

}  // namespace ups_voltronic
}  // namespace esphome
