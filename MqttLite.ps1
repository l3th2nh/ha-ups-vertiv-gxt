# MqttLite.ps1 - MQTT 3.1.1 client toi gian, thuan .NET, khong can cai dat gi.
# Ho tro: CONNECT (username/password + Last Will), PUBLISH QoS0 (retain),
#         SUBSCRIBE, doc goi PUBLISH den (de nhan lenh dieu khien), PINGREQ, DISCONNECT.

$MqttLiteCSharp = @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Net.Sockets;
using System.Text;
using System.Threading;

public class MqttLite : IDisposable {
  private TcpClient _c;
  private NetworkStream _s;
  private int _pid = 1;

  public string LastError   = "";
  public string LastTopic   = "";
  public string LastPayload = "";

  // ------------------------------------------------------------ helpers ----
  private static void WriteLen(List<byte> b, int len) {
    do { int d = len % 128; len /= 128; if (len > 0) d |= 128; b.Add((byte)d); } while (len > 0);
  }
  private static void WriteStr(List<byte> b, string s) {
    byte[] d = Encoding.UTF8.GetBytes(s);
    b.Add((byte)(d.Length >> 8)); b.Add((byte)(d.Length & 0xFF)); b.AddRange(d);
  }
  private void Send(byte header, List<byte> body) {
    var pkt = new List<byte>(); pkt.Add(header); WriteLen(pkt, body.Count); pkt.AddRange(body);
    _s.Write(pkt.ToArray(), 0, pkt.Count); _s.Flush();
  }
  private int ReadRemainingLength() {
    int mult = 1, value = 0, b;
    do {
      b = _s.ReadByte();
      if (b < 0) return -1;
      value += (b & 127) * mult;
      mult *= 128;
      if (mult > 128 * 128 * 128) return -1;
    } while ((b & 128) != 0);
    return value;
  }
  private byte[] ReadExact(int n) {
    byte[] buf = new byte[n];
    int got = 0;
    while (got < n) {
      int r = _s.Read(buf, got, n - got);
      if (r <= 0) return null;
      got += r;
    }
    return buf;
  }

  // ------------------------------------------------------------ connect ----
  public bool Connect(string host, int port, string clientId, string user, string pass,
                      string willTopic, string willPayload, int keepAliveSec, int timeoutMs) {
    try {
      _c = new TcpClient();
      _c.SendTimeout = timeoutMs; _c.ReceiveTimeout = timeoutMs;
      var ar = _c.BeginConnect(host, port, null, null);
      if (!ar.AsyncWaitHandle.WaitOne(timeoutMs)) { LastError = "connect timeout"; return false; }
      _c.EndConnect(ar);
      _s = _c.GetStream();
      _s.ReadTimeout = timeoutMs; _s.WriteTimeout = timeoutMs;

      var vh = new List<byte>();
      WriteStr(vh, "MQTT");
      vh.Add(0x04);
      byte flags = 0x02;
      bool hasWill = !string.IsNullOrEmpty(willTopic);
      if (hasWill) { flags |= 0x04; flags |= 0x20; }
      if (!string.IsNullOrEmpty(user)) flags |= 0x80;
      if (!string.IsNullOrEmpty(pass)) flags |= 0x40;
      vh.Add(flags);
      vh.Add((byte)(keepAliveSec >> 8)); vh.Add((byte)(keepAliveSec & 0xFF));

      var pl = new List<byte>();
      WriteStr(pl, clientId);
      if (hasWill) { WriteStr(pl, willTopic); WriteStr(pl, willPayload); }
      if (!string.IsNullOrEmpty(user)) WriteStr(pl, user);
      if (!string.IsNullOrEmpty(pass)) WriteStr(pl, pass);

      var body = new List<byte>(); body.AddRange(vh); body.AddRange(pl);
      Send(0x10, body);

      byte[] rb = new byte[4];
      int got = 0;
      while (got < 4) { int n = _s.Read(rb, got, 4 - got); if (n <= 0) break; got += n; }
      if (got < 4 || rb[0] != 0x20) { LastError = "khong nhan duoc CONNACK"; return false; }
      if (rb[3] != 0x00) {
        string[] m = { "OK", "sai protocol version", "clientId bi tu choi", "server unavailable",
                       "sai username/password", "khong duoc phep (not authorized)" };
        LastError = "CONNACK rc=" + rb[3] + (rb[3] < m.Length ? " (" + m[rb[3]] + ")" : "");
        return false;
      }
      return true;
    } catch (Exception e) { LastError = e.Message; return false; }
  }

  // ------------------------------------------------------------ publish ----
  public bool Publish(string topic, string payload, bool retain) {
    try {
      var body = new List<byte>();
      WriteStr(body, topic);
      body.AddRange(Encoding.UTF8.GetBytes(payload));
      byte hdr = 0x30; if (retain) hdr |= 0x01;
      Send(hdr, body);
      return true;
    } catch (Exception e) { LastError = e.Message; return false; }
  }

  // ---------------------------------------------------------- subscribe ----
  public bool Subscribe(string topicFilter, byte qos) {
    try {
      var body = new List<byte>();
      int id = _pid++; if (_pid > 65000) _pid = 1;
      body.Add((byte)(id >> 8)); body.Add((byte)(id & 0xFF));
      WriteStr(body, topicFilter);
      body.Add(qos);
      Send(0x82, body);   // SUBSCRIBE: type 8, flags 0010 bat buoc
      return true;
    } catch (Exception e) { LastError = e.Message; return false; }
  }

  /// <summary>
  /// Doi toi timeoutMs de nhan mot goi PUBLISH tu broker.
  /// Tra ve true neu co message (doc o LastTopic / LastPayload).
  /// Cac goi khac (SUBACK, PINGRESP...) duoc bo qua trong im lang.
  /// Ham nay cung dong vai tro "sleep" trong vong lap chinh.
  /// </summary>
  public bool TryReadMessage(int timeoutMs) {
    var sw = Stopwatch.StartNew();
    try {
      while (sw.ElapsedMilliseconds < timeoutMs) {
        if (_s == null) return false;
        if (!_s.DataAvailable) { Thread.Sleep(25); continue; }

        int b0 = _s.ReadByte();
        if (b0 < 0) { LastError = "broker dong ket noi"; return false; }
        int rem = ReadRemainingLength();
        if (rem < 0) { LastError = "remaining-length hong"; return false; }
        byte[] body = rem > 0 ? ReadExact(rem) : new byte[0];
        if (body == null) { LastError = "doc thieu du lieu"; return false; }

        int type = (b0 >> 4) & 0x0F;
        if (type == 3) {                       // PUBLISH
          if (body.Length < 2) continue;
          int tl = (body[0] << 8) | body[1];
          if (body.Length < 2 + tl) continue;
          LastTopic = Encoding.UTF8.GetString(body, 2, tl);
          int off = 2 + tl;
          int qos = (b0 >> 1) & 0x03;
          if (qos > 0) off += 2;               // bo qua packet id
          LastPayload = (off <= body.Length)
            ? Encoding.UTF8.GetString(body, off, body.Length - off) : "";
          return true;
        }
        // type 9 = SUBACK, 13 = PINGRESP, ... -> bo qua
      }
      return false;
    } catch (Exception e) { LastError = e.Message; return false; }
  }

  public bool Ping() {
    try { _s.Write(new byte[] { 0xC0, 0x00 }, 0, 2); _s.Flush(); return true; }
    catch (Exception e) { LastError = e.Message; return false; }
  }

  public bool IsConnected { get { try { return _c != null && _c.Connected; } catch { return false; } } }

  public void Dispose() {
    try { if (_s != null) { _s.Write(new byte[] { 0xE0, 0x00 }, 0, 2); _s.Flush(); } } catch { }
    try { if (_s != null) _s.Close(); } catch { }
    try { if (_c != null) _c.Close(); } catch { }
    _s = null; _c = null;
  }
}
'@

if (-not ([System.Management.Automation.PSTypeName]'MqttLite').Type) {
  Add-Type -TypeDefinition $MqttLiteCSharp
}
