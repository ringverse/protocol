#!/usr/bin/env node
"use strict";

// =====================================================================
// Reverse-engineered parser for libringeventparser.so (Oura ring events)
// =====================================================================
//
// COMMON RING-EVENT HEADER (type byte in [0x41, 0x84]):
//   off 0     type            uint8
//   off 1     payload_length  uint8   (bytes following this byte; valid 4..18 per Event::validate)
//   off 2..5  ring_timestamp  int32 LE   (ring clock, 100 ms / tick)
//   off 6..   event body
//   total_length = payload_length + 2
//
// APP EVENTS use type byte 0xFE with a different (variable) header; handled minimally.
//
// TIME MAPPING:  utc_ms = mapping.utc + (rt - mapping.ring) * 100   (TimeMapping::rt_to_utc_ms)
//   The library maintains a {ring, utc} mapping seeded by the caller and updated by
//   time_sync_ind (0x42) events. Many events derive per-sample UTC timestamps from it
//   or from Event::utc_time_ms (which the library computes via the same mapping).
//
// All multi-byte integers are little-endian unless noted.

// ---------------------------------------------------------------------
// Type -> handler name map (RingEventParser ctor map @0x4bfc5c)
// ---------------------------------------------------------------------
const EVENT_TYPES = {
  0x41: "ring_start_ind",
  0x42: "time_sync_ind",
  0x43: "debug_event_ind",
  0x45: "state_change_ind",
  0x46: "temp_event",
  0x47: "motion_events",
  0x49: "sleep_summary_1",
  0x4a: "ppg_amplitude_ind",
  0x4c: "sleep_summary_2",
  0x4e: "sleep_phase_details_and_data",
  0x4f: "sleep_summary_3",
  0x50: "activity_info_event",
  0x53: "wear_event",
  0x56: "alert_event",
  0x58: "sleep_summary_4",
  0x5a: "sleep_phase_details_and_data",
  0x5b: "ble_connection_ind",
  0x5d: "hrv_event",
  0x5e: "selftest_event",
  0x60: "ibi_and_amplitude_event",
  0x61: "debug_data",
  0x62: "on_demand_meas",
  0x65: "on_demand_session",
  0x66: "on_demand_motion",
  0x67: "raw_ppg_summary",
  0x68: "raw_ppg_data",
  0x69: "temp_period",
  0x6a: "sleep_period_info",
  0x6b: "motion_period",
  0x6c: "feature_session",
  0x6d: "meas_quality_event",
  0x6e: "spo2_ibi_and_amplitude_event",
  0x6f: "spo2_event",
  0x71: "green_ibi_and_amp_event",
  0x72: "sleep_acm_period",
  0x73: "ehr_trace_event",
  0x74: "ehr_acm_intensity_event",
  0x75: "sleep_temp_event",
  0x76: "bedtime_period",
  0x77: "spo2_dc_event",
  0x79: "selftest_data_event",
  0x7b: "spo2_stable_event",
  0x7c: "spo2_combo_event",
  0x7e: "real_steps_features_1",
  0x7f: "real_steps_features_2",
  0x80: "green_ibi_quality_event",
  0x81: "cva_raw_ppg_data",
  0x82: "scan_start",
  0x83: "scan_end",
};

// ---------------------------------------------------------------------
// Byte view
// ---------------------------------------------------------------------
// Events are accessed through a thin wrapper over the standard
// ArrayBuffer / Uint8Array / DataView APIs. `Bytes` is a Uint8Array
// subclass so parser code can still index it (`b[6]`) and read `.length`,
// while a backing DataView provides the multi-byte little-endian reads.
class Bytes extends Uint8Array {
  static of(input) {
    // Accept Uint8Array / Buffer / ArrayBuffer; copy into a tight buffer.
    if (input instanceof ArrayBuffer) return new Bytes(input.slice(0));
    const src = input instanceof Uint8Array ? input : new Uint8Array(input);
    const out = new Bytes(src.length);
    out.set(src);
    return out;
  }
  get view() {
    // Lazily attach a DataView over this array's backing buffer.
    if (!this._view) {
      this._view = new DataView(this.buffer, this.byteOffset, this.byteLength);
    }
    return this._view;
  }
  toHex(start = 0, end = this.length) {
    let s = "";
    for (let i = start; i < end; i++)
      s += this[i].toString(16).padStart(2, "0");
    return s;
  }
}

// ---------------------------------------------------------------------
// Primitive readers (little-endian, via DataView)
// ---------------------------------------------------------------------
const u8 = (b, o) => b.view.getUint8(o);
const i8 = (b, o) => b.view.getInt8(o);
const u16 = (b, o) => b.view.getUint16(o, true);
const i16 = (b, o) => b.view.getInt16(o, true);
const u32 = (b, o) => b.view.getUint32(o, true);
const i32 = (b, o) => b.view.getInt32(o, true);
const i64 = (b, o) => b.view.getBigInt64(o, true);
const u64 = (b, o) => b.view.getBigUint64(o, true);
// Big-endian variants (DataView's littleEndian flag = false)
const u16be = (b, o) => b.view.getUint16(o, false);
const i16be = (b, o) => b.view.getInt16(o, false);
const u32be = (b, o) => b.view.getUint32(o, false);
const i32be = (b, o) => b.view.getInt32(o, false);
// 24-bit reads: DataView has no native i24/u24, so compose from a 16- + 8-bit
// read at the correct endianness rather than hand-assembling each byte.
const u24 = (b, o) => u16(b, o) | (u8(b, o + 2) << 16); // little-endian
const i24 = (b, o) => (u24(b, o) << 8) >> 8; // sign-extend LE 24-bit
const f = (x) => Math.fround(x);

const UTF8 = new TextDecoder();
const utf8 = (b, start, end) => UTF8.decode(b.subarray(start, end));

// sign-magnitude scaled delta (EventParser::get_scaled_delta @0x4f16dc)
function scaledDelta(raw, scale) {
  const v = (raw << 24) >> 24;
  const mag = Math.abs(v) << (scale & 31);
  return v < 0 ? -mag : mag;
}

// ---------------------------------------------------------------------
// Time mapping: utc_ms = utc + (rt - ring) * 100
// ---------------------------------------------------------------------
function rtToUtcMs(mapping, rt) {
  if (!mapping || !mapping.ring || mapping.utc <= 0) return 0n;
  return (
    BigInt(mapping.utc) + (BigInt(rt >>> 0) - BigInt(mapping.ring >>> 0)) * 100n
  );
}
const B = (v) => (typeof v === "bigint" ? v : BigInt(Math.trunc(v || 0)));

// =====================================================================
// Per-event-type parsers.  ctx = { mapping, utcMs }
//   utcMs = Event::utc_time_ms (caller supplies; defaults to rtToUtcMs(mapping, rt))
// =====================================================================

// 0x41 ring_start_ind @0x4f3a18 — gate len==18
function p_ring_start_ind(b, pl) {
  if (pl !== 18) return { error: "expected length 18" };
  return {
    id40: u32(b, 6) + (b[10] >>> 0) * 2 ** 32, // 5-byte (uint40) id/serial @6..10
    nibble: (b[10] >> 3) & 0xf,
    value32: u32(b, 11),
    f15: b[15],
    f16: b[16],
    f17: b[17],
    f18: b[18],
    f19: b[19],
  };
}

// 0x42 time_sync_ind @0x4f37d0
function p_time_sync_ind(b, pl) {
  const epochSec = Number(i64(b, 6));
  const tz = i8(b, 14); // units of 30 min
  return {
    epoch_seconds: epochSec,
    utc_ms: epochSec * 1000,
    timezone_30min: tz,
    timezone_seconds: tz * 1800,
  };
}

// 0x45 state_change_ind / 0x53 wear_event — parse_state_and_debug_info
function p_state_and_debug(b, pl, key) {
  const out = {};
  out[key] = b[6];
  if (pl > 5) out.debug = utf8(b, 7, 7 + (pl - 5));
  return out;
}

// 0x46 temp_event @0x4fb484 — even len 10..18, int16/100
function p_temp_event(b, pl) {
  if (!(pl >= 10 && pl <= 18 && pl % 2 === 0)) return { error: "bad length" };
  const t = (o) => i16(b, o) / 100;
  return {
    temps: [
      t(6),
      t(8),
      t(10),
      pl > 0x0b ? t(12) : NaN,
      pl > 0x0d ? t(14) : NaN,
      pl > 0x0f ? t(16) : NaN,
      pl === 0x12 ? t(18) : NaN,
    ].filter((v) => !Number.isNaN(v)),
  };
}

// 0x47 motion_events @0x4f2fd0
function p_motion_events(b, pl) {
  const out = {
    field_a: b[6] >> 5,
    field_b: b[6] & 0x1f,
    motion: [i8(b, 7) * 8, i8(b, 8) * 8, i8(b, 9) * 8],
  };
  if (pl >= 9) {
    const x = b[10];
    if ((x >> 6) & 1) return { error: "unexpected bit, FW mismatch" };
    out.field_c = x & 0x3f;
    out.field_d = x >> 7;
    if (pl >= 10) {
      const y = b[11];
      if ((y >> 6) & 1) return { error: "unexpected bit, FW mismatch" };
      out.field_e = y & 0x3f;
    }
  }
  return out;
}

// 0x49 sleep_summary_1 @0x50014c
function p_sleep_summary_1(b, pl, ctx) {
  const startOff = u16(b, 6),
    endOff = u16(b, 8);
  const base = rtToUtcMs(ctx.mapping, i32(b, 2));
  return {
    start_offset_min: startOff,
    end_offset_min: endOff,
    start_utc_ms: (base - B(startOff) * 60000n).toString(),
    end_utc_ms: (base - B(endOff) * 60000n).toString(),
  };
}

// 0x4c sleep_summary_2 @0x5002dc — gate len==18
function p_sleep_summary_2(b, pl) {
  if (pl !== 18) return { error: "expected length 18" };
  return {
    field_a: i64(b, 6).toString(),
    field_b: i16(b, 0xe),
    field_c: i32(b, 0x10),
  };
}

// 0x4f sleep_summary_3 @0x500484 — gate len==15
function p_sleep_summary_3(b, pl) {
  if (pl !== 15) return { error: "expected length 15" };
  return {
    f0: b[6] >> 3,
    f1: b[7] >> 3,
    f2: (u16(b, 8) >> 3) & 0xff,
    f3: i32(b, 0xa),
    f4: i16(b, 0xe),
    f5: b[0x10],
  };
}

// 0x58 sleep_summary_4 @0x500658 — gate len==11
function p_sleep_summary_4(b, pl) {
  if (pl !== 11) return { error: "expected length 11" };
  return { f0: i32(b, 6), f1: i16(b, 0xa), f2: b[0xc] };
}

// 0x4e / 0x5a sleep_phase_details_and_data @0x501ba4 — gate len>=19, 2-bit phase samples
function p_sleep_phase_details(b, pl) {
  if (pl < 19) return { error: "expected length >= 19" };
  const header = b[6];
  const phases = [];
  for (let i = 7; i <= pl + 1; i++) {
    const x = b[i];
    phases.push((x >> 6) & 3, (x >> 4) & 3, (x >> 2) & 3, x & 3);
  }
  return { header, phases };
}

// 0x72 sleep_acm_period @0x4fb234 — gate len==16
function p_sleep_acm_period(b, pl) {
  if (pl !== 16) return { error: "expected length 16" };
  const a = (whole, num, den) => f(whole + num / den);
  return {
    values: [
      a(b[7], b[6], 255),
      a(b[9], b[8], 255),
      a(b[0xb], b[0xa], 255),
      f((b[0xd] >> 4) + (b[0xc] | ((b[0xd] & 0xf) << 8)) / 4095),
      f((b[0xf] >> 4) + (b[0xe] | ((b[0xf] & 0xf) << 8)) / 4095),
      f((b[0x11] >> 4) + (b[0x10] | ((b[0x11] & 0xf) << 8)) / 4095),
    ],
  };
}

// 0x75 sleep_temp_event @0x4faa38 — even len 6..18, u16/100, 30 s spacing
function p_sleep_temp_event(b, pl, ctx) {
  if (!(pl >= 6 && pl < 20 && pl % 2 === 0)) return { error: "bad length" };
  const count = (pl - 4) >> 1;
  const t0 = B(ctx.utcMs) - B(count - 1) * 30000n;
  const samples = [];
  for (let i = 0; i < count; i++) {
    samples.push({
      time_ms: (t0 + B(i) * 30000n).toString(),
      value: f(u16(b, 6 + i * 2) / 100),
    });
  }
  return { samples };
}

// 0x50 activity_info_event @0x4fec04 — len 6..18, piecewise scale (rodata consts unknown)
function p_activity_info_event(b, pl) {
  if (!(pl >= 6 && pl < 19)) return { error: "bad length" };
  // Scale constants live in .rodata @0x37c308/0x310/0x320 (not resolved); report raw bytes.
  const n = pl - 5;
  const raw = [];
  for (let i = 0; i < n; i++) raw.push(b[7 + i]);
  return {
    mode: b[6],
    raw_values: raw,
    note: "values use unresolved rodata scale constants",
  };
}

// 0x6d meas_quality_event @0x4fad98 — gate len==17
function p_meas_quality_event(b, pl, ctx) {
  if (pl !== 17) return { error: "expected length 17" };
  const type = i8(b, 6);
  let count, withFlag;
  if (type === 0) {
    count = 4;
    withFlag = false;
  } else if (type === 1) {
    count = 3;
    withFlag = true;
  } else return { error: "bad measurement type" };
  const t0 = B(ctx.utcMs) - B(count - 1) * 180000n;
  let p = 7;
  const samples = [];
  for (let i = 0; i < count; i++) {
    const val = i24(b, p); // signed 24-bit LE
    p += 3;
    let flag = 0;
    if (withFlag) {
      flag = b[p];
      p += 1;
    }
    samples.push({
      time_ms: (t0 + B(i) * 180000n).toString(),
      value: val,
      flag,
    });
  }
  return { type, samples };
}

// 0x4a ppg_amplitude_ind @0x501150 — gate len>=6
function p_ppg_amplitude_ind(b, pl) {
  if (pl < 6) return { error: "expected length >= 6" };
  return { amplitude: f(u16(b, 6) / 65535) };
}

// 0x56 alert_event @0x4fbc1c
function p_alert_event(b, pl) {
  return { alert_type: b[6] };
}

// 0x5d hrv_event @0x4fb840 — even len 6..16, 5-minute spacing
function p_hrv_event(b, pl, ctx) {
  if (!(pl - 6 < 0xb && pl % 2 === 0)) return { error: "bad length" };
  const base = B(ctx.utcMs);
  const n = (pl - 4) >> 1;
  const samples = [];
  for (let k = 0; k < n; k++) {
    samples.push({
      time_ms: (base - B(n - 1 - k) * 300000n).toString(),
      b1: b[6 + 2 * k],
      b2: b[7 + 2 * k],
    });
  }
  return { samples };
}

// 0x69 temp_period @0x4fb6bc — gate len==6
function p_temp_period(b, pl) {
  if (pl !== 6) return { error: "expected length 6" };
  return { temperature: i16(b, 6) / 100 };
}

// 0x76 bedtime_period @0x4f2e60
function p_bedtime_period(b, pl, ctx) {
  const startRt = u32(b, 6),
    endRt = u32(b, 10);
  return {
    start_rt: startRt,
    end_rt: endRt,
    start_utc_ms: rtToUtcMs(ctx.mapping, startRt).toString(),
    end_utc_ms: rtToUtcMs(ctx.mapping, endRt).toString(),
  };
}

// 0x60 ibi_and_amplitude_event @0x4fa76c — gate len==18
function p_ibi_and_amplitude(b, pl, ctx) {
  if (pl !== 0x12) return { ibis: [] };
  const b2 = b[6],
    b3 = b[7],
    b13 = b[8],
    b6 = b[9],
    b9 = b[10],
    b11 = b[11],
    b4 = b[0xc],
    b8 = b[0xd],
    b15 = b[0xe],
    b7 = b[0xf],
    b10 = b[0x10],
    b12 = b[0x11],
    b14 = b[0x12],
    b5 = b[0x13];
  const n = b5 & 0x0f;
  const shift = n === 7 ? 0 : n + 1;
  const ds = [
    (b12 & 1) | (b11 << 3) | ((b5 >> 3) & 6),
    (b10 & 1) | (b9 << 3) | ((b5 >> 5) & 6),
    (b6 << 3) | (b7 & 1) | ((b14 & 3) << 1),
    (b15 & 1) | (b13 << 3) | ((b14 >> 1) & 6),
    (b8 & 1) | (b3 << 3) | ((b14 >> 3) & 6),
    (b4 & 1) | (b2 << 3) | ((b14 >> 5) & 6),
  ];
  const as = [
    (b12 >> 1) << shift,
    (b10 >> 1) << shift,
    (b7 >> 1) << shift,
    (b15 >> 1) << shift,
    (b8 >> 1) << shift,
    (b4 >> 1) << shift,
  ];
  let t = B(ctx.utcMs);
  const ibis = [];
  for (let i = 0; i < 6; i++) {
    t -= B(ds[i]);
    ibis.push({ time_ms: t.toString(), ibi: ds[i], amplitude: as[i] });
  }
  return { shift, ibis };
}

// 0x71 green_ibi_and_amp_event @0x503960 — gate len==18
function p_green_ibi_and_amp(b, pl, ctx) {
  if (pl !== 0x12) return { error: "expected length 18" };
  const b13 = b[0x13];
  if ((b13 >> 3) & 1) return { error: "unexpected bit, FW mismatch" };
  const s = b13 & 7;
  const shift = s === 7 ? 0 : s + 1;
  const b12 = b[0x12];
  const ds = [
    (b[0x10] & 1) | (b[10] << 3) | ((b13 >> 5) & 6),
    (b[0xf] & 1) | (b[9] << 3) | ((b12 & 3) << 1),
    (b[0xe] & 1) | (b[8] << 3) | ((b12 >> 1) & 6),
    (b[0xd] & 1) | (b[7] << 3) | ((b12 >> 3) & 6),
    (b[0xc] & 1) | (b[6] << 3) | ((b12 >> 5) & 6),
  ];
  const as = [
    (b[0xc] >> 1) << shift,
    (b[0xd] >> 1) << shift,
    (b[0xe] >> 1) << shift,
    (b[0xf] >> 1) << shift,
    (b[0x10] >> 1) << shift,
  ];
  let t = B(ctx.utcMs);
  const ibis = [{ time_ms: t.toString(), ibi: 0, amplitude: as[0] }];
  for (let i = 0; i < 5; i++) {
    t -= B(ds[i]);
    ibis.push({ time_ms: t.toString(), ibi: ds[i], amplitude: as[i] });
  }
  return { shift, ibis };
}

// 0x6e spo2_ibi_and_amplitude_event @0x503438 — gate len==17
function p_spo2_ibi_and_amplitude(b, pl, ctx) {
  if (pl !== 0x11) return { error: "expected length 17" };
  const hdr = b[6];
  const flag = hdr >> 7,
    mode = hdr & 0x0f,
    shift = (hdr >> 4) & 7;
  const ibiBytes = [b[0xb], b[0xa], b[9], b[8], b[7]];
  let t = B(ctx.utcMs);
  const ibis = [];
  for (let i = 0; i < 5; i++) {
    const ibi = ibiBytes[i] * 8;
    ibis.push({ time_ms: t.toString(), ibi });
    t -= B(ibi);
  }
  const amps = [
    b[0xc] << 3,
    b[0xd] << shift,
    b[0xe] << shift,
    b[0xf] << shift,
    b[0x10] << shift,
    b[0x11] << shift,
    b[0x12] << shift,
  ];
  return { flag, mode, shift, ibis, amplitudes: amps };
}

// 0x6f spo2_event @0x500ce0 — len 5..18
function p_spo2_event(b, pl, ctx) {
  const n = pl - 5;
  if (n > 0xd) return { error: "bad length" };
  const status = b[6] & 0x0f;
  const spo2_base = (b[6] >> 4) << 7;
  let count = n;
  if (b[pl + 1] === 0xff) count = pl - 6; // 0xFF terminator
  const base = rtToUtcMs(ctx.mapping, i32(b, 2));
  const samples = [];
  for (let i = 1; i <= count; i++) {
    samples.push({
      time_ms: (base - B(count - i) * 1000n).toString(),
      value: b[6 + i],
    });
  }
  return { spo2_base, status, samples };
}

// 0x7b spo2_stable_event @0x505e98 — gate len==6, BE uint16
function p_spo2_stable_event(b, pl) {
  if (pl !== 6) return { error: "expected length 6" };
  return { value: u16be(b, 6) };
}

// 0x77 spo2_dc_event @0x505ab4 + decode_spo2_dc_event_bytes @0x505838
function p_spo2_dc_event(b, pl, ctx) {
  const hdrByte = b[6];
  const hdr = (hdrByte >> 7) | ((hdrByte & 0x0f) << 8);
  const scale = (hdrByte >> 4) & 3;
  const hasBase = (hdrByte >> 6) & 1;
  const N = pl - 5;
  const utc = B(ctx.utcMs);
  const samples = [];
  let acc = 0,
    start = 0;
  if (hasBase) {
    acc = u24(b, 7);
    const firstAdj = N > 2 ? ((pl + 0xf8) & 0xff) * 1000 : 0;
    samples.push({ time_ms: (utc - B(firstAdj)).toString(), value: acc });
    start = 3;
  } else if (pl === 5) {
    return { hdr, scale, samples };
  }
  for (let i = start; i < N; i++) {
    acc += scaledDelta(b[i + 7], scale);
    const adj = ((pl + 0xfa - i) & 0xff) * 1000;
    samples.push({ time_ms: (utc - B(adj)).toString(), value: acc });
  }
  return { hdr, scale, hasBase: !!hasBase, samples };
}

// 0x7c spo2_combo_event @0x506148 — gate len in {12,18}; dense bit-pack (raw reported)
function p_spo2_combo_event(b, pl) {
  if (pl !== 0x0c && pl !== 0x12) return { error: "expected length 12 or 18" };
  // Heavy bit-packing producing {uint64 packed, int32 amp(+0x39000000 bias)} records.
  // Report the raw body; full unpack is documented in EVENTS notes.
  const records = pl === 0x0c ? 1 : 2;
  return {
    records,
    flag: pl === 0x0c ? !!(b[0xd] & 1) : undefined,
    body: b.toHex(6, pl + 2),
  };
}

// 0x80 green_ibi_quality_event @0x501764 — needs DHR session; per 2 bytes
function p_green_ibi_quality(b, pl, ctx) {
  if (!(pl >= 4 && pl <= 0x12)) return { error: "bad length" };
  const count = (pl - 4) >> 1;
  // Running accumulator lives in session state; standalone we start from utcMs.
  let t = B(ctx.utcMs);
  const samples = [];
  for (let i = 0; i < count; i++) {
    const b0 = b[6 + 2 * i],
      b1 = b[7 + 2 * i];
    const delta = (b0 << 3) | (b1 & 7);
    samples.push({
      time_ms: t.toString(),
      ibi_delta: delta,
      quality_a: (b1 >> 3) & 3,
      quality_b: b1 >> 5,
    });
    t += B(delta);
  }
  return { samples };
}

// 0x73 ehr_trace_event / 0x74 ehr_acm_intensity_event — variable; raw body
// 0x5b ble_connection_ind — multiple subtypes; raw body
// 0x6b motion_period @0x500800 — 12-bit period + 2-bit symbols
function p_motion_period(b, pl) {
  if (!(pl >= 19 && pl <= 31)) return { error: "bad length" };
  const period = ((b[6] << 8) | (b[6] >> 6)) & 0x0fff;
  const symbols = [];
  const firstCount = (b[6] >> 4) & 3;
  for (let j = 0; j < firstCount; j++) symbols.push((b[7] >> (6 - 2 * j)) & 3);
  for (let i = 1; i < pl - 5; i++) {
    const x = b[7 + i];
    for (let j = 0; j < 4; j++) symbols.push((x >> (6 - 2 * j)) & 3);
  }
  return { period, symbols };
}

// 0x68 raw_ppg_data @0x4fe4e4 — delta stream, accumulated (needs session scale)
function p_raw_ppg_data(b, pl, ctx) {
  if (!(pl >= 19 && pl <= 32)) return { error: "bad length" };
  const scale = ctx.ppgScale || 0; // set by raw_ppg_summary in session state
  let acc = ctx.ppgAcc || 0;
  const count = pl - 4;
  const samples = [];
  for (let i = 0; i < count; i++) {
    acc += scaledDelta(b[6 + i], scale);
    samples.push(acc);
  }
  return { samples, scale };
}

// 0x67 raw_ppg_summary @0x5036f8 — gate len 12 or 13
function p_raw_ppg_summary(b, pl, ctx) {
  if (pl !== 12 && pl !== 13) return { error: "expected length 12 or 13" };
  let type = b[10];
  if (type - 1 > 1) type = 0;
  const scale = pl === 12 ? b[13] : 0;
  return {
    start_utc_ms: rtToUtcMs(ctx.mapping, u32(b, 6)).toString(),
    type,
    scale,
    field16: u16(b, 0xb),
  };
}

// 0x81 cva_raw_ppg_data @0x4fdf68 — delta / 24-bit-abs stream (needs session)
function p_cva_raw_ppg_data(b, pl, ctx) {
  const count = pl - 4;
  return {
    count,
    body: b.toHex(6, pl + 2),
    note: "delta+24bit-abs stream; needs session state",
  };
}

// 0x82 scan_start @0x503ce8 — gate len 13..18
function p_scan_start(b, pl) {
  if (!(pl >= 13 && pl <= 18)) return { error: "bad length" };
  const id12 = u16(b, 6) & 0x0fff;
  const nibble = b[7] >> 4;
  const n = (pl - 6) & 0xff;
  return { id12, nibble, data: b.toHex(8, 8 + n) };
}

// 0x83 scan_end @0x504358 — format-dependent records
function p_scan_end(b, pl) {
  const format = b[6] >> 6;
  const recordType = b[6] & 0x0f;
  const scale = format === 1 ? b[7] : b[7] / 10;
  const records = [];
  if (format === 1) {
    if (pl < 7)
      return {
        format,
        recordType,
        scale,
        records: [{ value16: 0xffff, value8: 0 }],
      };
    const n = (pl - 6) & 0xff;
    for (let k = 0; k + 3 <= n; k += 3) {
      records.push({ value16: u16(b, 8 + k), value8: b[10 + k] });
    }
  } else {
    if ((pl & 0x1d) !== 8) return { error: "expected length 8 or 10" };
    const count = (pl - 6) >> 1;
    for (let k = 0; k < count; k++) {
      records.push({
        value16: (b[8 + 2 * k] << 8) | 0xff,
        value8: b[9 + 2 * k],
      });
    }
  }
  return { format, recordType, scale: f(scale), records };
}

// 0x5e selftest_event @0x5012d8 — two 16-bit bitmasks -> set bit indices
function p_selftest_event(b, pl) {
  const maskA = u16(b, 6),
    maskB = u16(b, 8);
  const A = [],
    C = [];
  for (let i = 0; i < 16; i++) {
    if (maskA & (1 << i)) A.push(i);
    if (maskB & (1 << i)) C.push(i);
  }
  return { maskA, maskB, listA: A, listB: C };
}

// 0x79 selftest_data_event @0x502f14 — subtype-dispatched (header reported)
function p_selftest_data_event(b, pl) {
  const subtype = b[6];
  const out = { subtype };
  if (pl === 13 && subtype === 1) {
    out.kind = "summary";
    out.resultA = i32(b, 7);
    out.resultB = i32(b, 0xb);
  } else if (pl === 8 && subtype === 2) {
    out.kind = "detailed";
    out.id = b[7];
    out.value = u16(b, 8);
  } else if (subtype === 3 && pl >= 7 && pl <= 18) {
    out.kind = "data";
    out.id = b[7];
    out.body = b.toHex(8, pl + 2);
  } else {
    out.error = "invalid subtype or length";
  }
  return out;
}

// 0x6c feature_session @0x4fd430 — feature + status + subtype
function p_feature_session(b, pl) {
  if (pl < 6) return { error: "bad length" };
  const feature = b[6],
    status = b[7];
  if (status > 0x0c) return { error: "bad status" };
  const out = { feature, status };
  switch (feature) {
    case 0:
    case 1:
      out.kind = "daytime_hr_v1";
      if (pl === 7) out.version = b[8];
      break;
    case 2:
      out.kind = "spo2_v1";
      if (pl >= 7) out.version = b[8];
      break;
    case 3:
      if (pl === 10) {
        out.kind = "exercise_hr_v1";
        out.a = u16(b, 8);
        out.b = b[10];
        out.c = b[11];
      } else if (pl === 11) {
        out.kind = "exercise_hr_v2";
        out.algo = b[8];
        out.value = u32(b, 9);
      } else out.error = "bad EHR length";
      break;
    case 0x0b:
      out.kind = "real_steps_v1";
      if (pl === 7) out.version = b[8];
      break;
    case 0x0d:
      out.kind = "cva_ppg_sampler_v1";
      if (pl === 9) {
        out.version = b[8];
        out.sample_rate_hz = b[9] < 5 ? 50 + 50 * b[9] : null;
        out.averaging_idx = b[10];
      }
      break;
    case 0x0c:
      out.kind = "passthrough";
      break;
    default:
      out.error = "unknown feature";
  }
  return out;
}

// 0x62 on_demand_meas @0x504f34 — len 5..12, progressive
function p_on_demand_meas(b, pl) {
  if (pl < 5 || pl > 12) return { error: "expected length 5..12" };
  const out = { field0: u24(b, 6) };
  if (pl >= 8) out.f1 = f(u16(b, 9) / 10);
  if (pl >= 10) out.b1 = b[0xb];
  if (pl >= 11) out.f2 = f(b[0xc] / 10);
  if (pl >= 12) out.b2 = b[0xd];
  return out;
}

// 0x65 on_demand_session @0x504b68 — len 5..13, progressive
function p_on_demand_session(b, pl) {
  if (pl < 5 || pl > 13) return { error: "expected length 5..13" };
  const bytes = [];
  for (let i = 6; i <= Math.min(0xc, pl); i++) bytes.push(b[i]);
  const out = { bytes };
  if (pl >= 13) out.word = u16(b, 0xd);
  return out;
}

// 0x66 on_demand_motion @0x5052bc — len 5..16, raw copy
function p_on_demand_motion(b, pl) {
  if (pl < 5 || pl > 16) return { error: "expected length 5..16" };
  return { raw: b.toHex(6, pl + 2) };
}

// 0x7e/0x7f real_steps_features — bit-packed across two paired events (raw reported)
function p_real_steps_features(b, pl) {
  if (pl !== 0x12) return { error: "expected length 18" };
  return {
    body: b.toHex(6, pl + 2),
    note: "bit-packed; combined across features_1+features_2",
  };
}

// Debug / diagnostics: 0x43 debug_event_ind, 0x61 debug_data, 0x5b ble_connection_ind,
// 0x73 ehr_trace_event, 0x74 ehr_acm_intensity_event — many subtypes; body reported raw.
function p_raw_body(b, pl) {
  return { body: b.toHex(6, pl + 2) };
}

// ---------------------------------------------------------------------
// Dispatch table
// ---------------------------------------------------------------------
const PARSERS = {
  0x41: p_ring_start_ind,
  0x42: p_time_sync_ind,
  0x45: (b, pl) => p_state_and_debug(b, pl, "state"),
  0x46: p_temp_event,
  0x47: p_motion_events,
  0x49: p_sleep_summary_1,
  0x4a: p_ppg_amplitude_ind,
  0x4c: p_sleep_summary_2,
  0x4e: p_sleep_phase_details,
  0x4f: p_sleep_summary_3,
  0x50: p_activity_info_event,
  0x53: (b, pl) => p_state_and_debug(b, pl, "wear_state"),
  0x56: p_alert_event,
  0x58: p_sleep_summary_4,
  0x5a: p_sleep_phase_details,
  0x5d: p_hrv_event,
  0x5e: p_selftest_event,
  0x60: p_ibi_and_amplitude,
  0x62: p_on_demand_meas,
  0x65: p_on_demand_session,
  0x66: p_on_demand_motion,
  0x67: p_raw_ppg_summary,
  0x68: p_raw_ppg_data,
  0x69: p_temp_period,
  0x6a: p_sleep_period_info,
  0x6b: p_motion_period,
  0x6c: p_feature_session,
  0x6d: p_meas_quality_event,
  0x6e: p_spo2_ibi_and_amplitude,
  0x6f: p_spo2_event,
  0x71: p_green_ibi_and_amp,
  0x72: p_sleep_acm_period,
  0x75: p_sleep_temp_event,
  0x76: p_bedtime_period,
  0x77: p_spo2_dc_event,
  0x79: p_selftest_data_event,
  0x7b: p_spo2_stable_event,
  0x7c: p_spo2_combo_event,
  0x7e: p_real_steps_features,
  0x7f: p_real_steps_features,
  0x80: p_green_ibi_quality,
  0x81: p_cva_raw_ppg_data,
  0x82: p_scan_start,
  0x83: p_scan_end,
  // Raw-body (diagnostics / multi-subtype):
  0x43: p_raw_body,
  0x61: p_raw_body,
  0x5b: p_raw_body,
  0x73: p_raw_body,
  0x74: p_raw_body,
};

// 0x6a sleep_period_info @0x4f3260
function p_sleep_period_info(b, pl) {
  return {
    c0: i8(b, 6),
    c6: i8(b, 7),
    c7: i8(b, 8),
    c8: i8(b, 9),
    field_a: b[10] / 8,
    field_b: b[11] / 8,
    motion_seconds: b[0xc],
    sleep_state: i8(b, 0xd),
    field_e: u16(b, 0xe) / 65536,
  };
}

// =====================================================================
// Public API
// =====================================================================
function parseEvent(input, ctx = {}) {
  const b = Bytes.of(input);
  const type = b[0];
  if (type === 0xfe) return { type: "0xfe", name: "app_event", raw: b.toHex() };

  const payloadLength = b[1];
  const totalLength = payloadLength + 2;
  const ringTimestamp = i32(b, 2);
  const name = EVENT_TYPES[type] || "unknown";

  const mapping = ctx.mapping;
  const utcMs =
    ctx.utcMs !== undefined ? ctx.utcMs : rtToUtcMs(mapping, ringTimestamp);
  const localCtx = { ...ctx, utcMs };

  const out = {
    type: "0x" + type.toString(16),
    name,
    payload_length: payloadLength,
    total_length: totalLength,
    ring_timestamp: ringTimestamp,
    utc_ms: (typeof utcMs === "bigint" ? utcMs : BigInt(utcMs || 0)).toString(),
  };

  const fn = PARSERS[type];
  if (fn) {
    try {
      out.data = fn(b, payloadLength, localCtx);
    } catch (e) {
      out.data = { error: String((e && e.message) || e) };
    }
  } else {
    out.body = b.toHex(6, totalLength);
  }
  return out;
}

function parseStream(input, ctx = {}) {
  const b = Bytes.of(input);
  const events = [];
  let off = 0;
  while (off + 2 <= b.length) {
    const total = b[off] === 0xfe ? b.length - off : b[off + 1] + 2;
    if (off + total > b.length) break;
    events.push(parseEvent(b.subarray(off, off + total), ctx));
    off += total;
  }
  return events;
}

function hexToBuf(s) {
  const hex = s.replace(/\s+/g, "");
  const out = new Bytes(hex.length >> 1);
  for (let i = 0; i < out.length; i++)
    out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

const EXAMPLES = [
  "6E 11 57 1A 83 00 C2 37 3A 4E FA 9C C8 00 12 C4 00 4A 1A",
  "60 12 E3 19 83 00 FA 2E 55 61 FA 5C 00 D4 DC FE 00 02 3D 26",
  "77 09 D9 19 83 00 C5 AA AA B2 00",
];

if (require.main === module) {
  for (const hex of EXAMPLES) {
    const buf = hexToBuf(hex);
    console.log("=== " + hex + " ===");
    console.log(JSON.stringify(parseEvent(buf), null, 2));
    console.log();
  }
}

module.exports = { parseEvent, parseStream, hexToBuf, rtToUtcMs, EVENT_TYPES };
