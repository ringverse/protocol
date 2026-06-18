# Oura Ring Event Format

> [!CAUTION]
> The following documentation (and the parse.js file) are AI generated. The information in this document has not been fully verified.
> 
> I'm working on verifying the information manually and I plan on rewriting the documentation to provide a more readable document in the near future.
> 
> The information presented here might be out of date, since the experiment was performed on an older version of `libringeventparser.so` (APK version 6.2.0).

Reverse-engineered reference for the binary event stream parsed by
`libringeventparser.so` (`com.ouraring.ringeventparser`).

The on-wire format is a **custom binary TLV** with per-type bit-packed payloads.
Protocol Buffers (the `rep::` namespace inside the library) are used **only for
output** — serializing parsed results back to Java in a `rep::RingData` message.
They are *not* the wire format.

---

## 1. Common header

Every **ring event** (type byte in the range `0x41`–`0x84`) begins with a fixed
6-byte header:

| Offset | Size | Field            | Notes                                            |
|-------:|-----:|------------------|--------------------------------------------------|
| 0      | 1    | `type`           | Event type (see table below)                     |
| 1      | 1    | `payload_length` | Bytes following this byte; valid `4`–`18`         |
| 2      | 4    | `ring_timestamp` | `int32` little-endian, ring clock (100 ms / tick) |
| 6      | …    | `body`           | Type-specific payload                            |

`total_length = payload_length + 2`

> The original hint ("bytes 3–4 are a timestamp") was close — the timestamp is
> actually a **4-byte `int32`** at offset 2, not a 2-byte value.

**App events** use type byte `0xFE` and a different, variable-length header.

### Validation rules (from `Event::validate`)

- A ring event is valid when `payload_length` is in `[4, 0x12]` and the type is
  in `[0x41, 0x84]`.
- App events are identified by type `0xFE`.

---

## 2. Time mapping

The ring reports a relative clock (`ring_timestamp`, 100 ms ticks). Absolute UTC
is derived from a `{ring, utc}` mapping that the host seeds and the firmware
refreshes via `time_sync_ind` (`0x42`):

```
utc_ms = mapping.utc + (ring_timestamp - mapping.ring) * 100
```

(`TimeMapping::rt_to_utc_ms`). Many multi-sample events compute per-sample UTC by
walking **backward** from the event's UTC by a fixed spacing interval. When no
mapping is supplied, the parser emits relative offsets instead of absolute time.

### Shared helpers

- **`scaledDelta(raw, scale)`** (`get_scaled_delta`): decodes one **8-bit**
  sign-magnitude byte — bit `[7]` is not a two's-complement sign; instead the
  byte is read as `int8` and its magnitude is shifted:
  `v = (int8)raw; mag = |v| << scale; return v < 0 ? -mag : mag`. `scale` is the
  per-event shift exponent (typically 2–3 bits wide). Used by the delta-encoded
  sample streams (`spo2_dc`, `raw_ppg_data`, `cva_raw_ppg_data`).

---

## 3. Event type catalog

| Type   | Name                            | Category        | Status        |
|--------|---------------------------------|-----------------|---------------|
| `0x41` | `ring_start_ind`                | System          | Decoded       |
| `0x42` | `time_sync_ind`                 | System          | Decoded       |
| `0x43` | `debug_event_ind`               | Diagnostics     | Raw body      |
| `0x45` | `state_change_ind`              | System          | Decoded       |
| `0x46` | `temp_event`                    | Temperature     | Decoded       |
| `0x47` | `motion_events`                 | Motion          | Decoded       |
| `0x49` | `sleep_summary_1`               | Sleep           | Decoded       |
| `0x4a` | `ppg_amplitude_ind`             | Cardio / PPG    | Decoded       |
| `0x4c` | `sleep_summary_2`               | Sleep           | Decoded       |
| `0x4e` | `sleep_phase_details_and_data`  | Sleep           | Decoded       |
| `0x4f` | `sleep_summary_3`               | Sleep           | Decoded       |
| `0x50` | `activity_info_event`           | Activity        | Partial¹      |
| `0x53` | `wear_event`                    | System          | Decoded       |
| `0x56` | `alert_event`                   | System          | Decoded       |
| `0x58` | `sleep_summary_4`               | Sleep           | Decoded       |
| `0x5a` | `sleep_phase_details_and_data`  | Sleep           | Decoded       |
| `0x5b` | `ble_connection_ind`            | Diagnostics     | Raw body      |
| `0x5d` | `hrv_event`                     | Cardio          | Decoded       |
| `0x5e` | `selftest_event`                | Self-test       | Decoded       |
| `0x60` | `ibi_and_amplitude_event`       | Cardio / PPG    | Decoded       |
| `0x61` | `debug_data`                    | Diagnostics     | Raw body      |
| `0x62` | `on_demand_meas`                | On-demand       | Decoded       |
| `0x65` | `on_demand_session`             | On-demand       | Decoded       |
| `0x66` | `on_demand_motion`              | On-demand       | Raw body      |
| `0x67` | `raw_ppg_summary`               | Cardio / PPG    | Decoded       |
| `0x68` | `raw_ppg_data`                  | Cardio / PPG    | Partial²      |
| `0x69` | `temp_period`                   | Temperature     | Decoded       |
| `0x6a` | `sleep_period_info`             | Sleep           | Decoded       |
| `0x6b` | `motion_period`                 | Motion          | Decoded       |
| `0x6c` | `feature_session`               | Session         | Decoded       |
| `0x6d` | `meas_quality_event`            | Quality         | Decoded       |
| `0x6e` | `spo2_ibi_and_amplitude_event`  | SpO2 / PPG      | Decoded       |
| `0x6f` | `spo2_event`                    | SpO2            | Decoded       |
| `0x71` | `green_ibi_and_amp_event`       | Cardio / PPG    | Decoded       |
| `0x72` | `sleep_acm_period`              | Sleep           | Decoded       |
| `0x73` | `ehr_trace_event`               | Diagnostics     | Raw body      |
| `0x74` | `ehr_acm_intensity_event`       | Diagnostics     | Raw body      |
| `0x75` | `sleep_temp_event`              | Temperature     | Decoded       |
| `0x76` | `bedtime_period`                | Sleep           | Decoded       |
| `0x77` | `spo2_dc_event`                 | SpO2 / PPG      | Decoded       |
| `0x79` | `selftest_data_event`           | Self-test       | Decoded       |
| `0x7b` | `spo2_stable_event`             | SpO2            | Decoded       |
| `0x7c` | `spo2_combo_event`              | SpO2 / PPG      | Partial³      |
| `0x7e` | `real_steps_features_1`         | Activity        | Partial³      |
| `0x7f` | `real_steps_features_2`         | Activity        | Partial³      |
| `0x80` | `green_ibi_quality_event`       | Cardio / PPG    | Decoded⁴      |
| `0x81` | `cva_raw_ppg_data`              | Cardio / PPG    | Partial²      |
| `0x82` | `scan_start`                    | Scan            | Decoded       |
| `0x83` | `scan_end`                      | Scan            | Decoded       |
| `0xFE` | `app_event`                     | App             | Raw           |

¹ Uses unresolved `.rodata` scale constants — raw values reported.
² Delta stream needs session scale/accumulator from the matching summary event.
³ Heavy bit-packing / cross-event state — raw body reported with notes.
⁴ Running accumulator lives in DHR session state; standalone decode starts fresh.

---

## 4. Event details

### System & lifecycle

#### `0x41` ring_start_ind
Fixed length 18. Emitted at session start.
- `id40` — **40-bit** (uint40) device id/serial, bytes 6–10
  (`uint32@6 + (byte10 << 32)`)
- `nibble` — byte 10 bits `[6:3]` (**4 bits**, overlapping the top of `id40`)
- `value32` — `uint32` at offset 11
- `f15..f19` — trailing config bytes (15–19)

#### `0x42` time_sync_ind
Carries the absolute clock used to anchor the time mapping.
- `epoch_seconds` — `int64` LE at offset 6 (**64-bit**) → `utc_ms`
- `timezone_30min` — `int8` at byte 14, signed offset in 30-minute units
  → `timezone_seconds` (`× 1800`)

#### `0x45` state_change_ind / `0x53` wear_event
- `state` / `wear` — status byte at offset 6
- `debug` — optional trailing UTF-8 string when `payload_length > 5`

#### `0x56` alert_event
- `alert_type` — single byte at offset 6

---

### Temperature

#### `0x46` temp_event
Even length 10–18. Up to 7 samples, each `int16 / 100` °C.
- `temps[]` — array of temperatures

#### `0x69` temp_period
Length 6. Single aggregated temperature.
- `temperature` — `int16 / 100` °C

#### `0x75` sleep_temp_event
Even length 6–18, **30-second** sample spacing.
- `samples[]` — `{ time_ms, value }`, value = `uint16 / 100` °C; timestamps walk
  back from event UTC

---

### Motion & activity

#### `0x47` motion_events
Byte 6 packs two fields:

| Byte | Bits      | Field     | Width |
|------|-----------|-----------|-------|
| 6    | `[7:5]`   | `field_a` | 3     |
| 6    | `[4:0]`   | `field_b` | 5     |

- `motion[]` — three `int8 × 8` axis magnitudes (bytes 7, 8, 9)
- optional extra bytes (FW-version gated):
  - byte 10: bit `[6]` reserved (set → firmware mismatch), `field_c` = bits `[5:0]`
    (6), `field_d` = bit `[7]` (1)
  - byte 11: bit `[6]` reserved, `field_e` = bits `[5:0]` (6)

#### `0x6b` motion_period
Length 19–31. A 12-bit period followed by a stream of 2-bit motion symbols.
- `period` — 12 bits assembled from byte 6 (`(b6 << 8 | b6 >> 6) & 0xFFF`)
- the upper 2 bits of byte 6 (`[5:4]`) give the count of leading 2-bit symbols
  carried in byte 7
- `symbols[]` — **2-bit** codes, 4 per byte (MSB-first) for bytes 8…, plus the
  partial leading symbols from byte 7

#### `0x72` sleep_acm_period
Length 16. Six fixed-point activity-count values:
- values 0–2: `whole(8) + frac(8)/255` — each from a byte pair (frac, whole)
- values 3–5: `whole(4) + frac(12)/4095` — each from a byte pair where the high
  nibble (4 bits) is the whole part and the remaining **12 bits** are the fraction

#### `0x50` activity_info_event ¹
Length 6–18. Piecewise-scaled metrics.
- `mode` — byte 6
- `raw_values[]` — remaining bytes (scale constants in unresolved `.rodata`)

---

### Sleep

#### `0x49` sleep_summary_1
- `start_offset_min` / `end_offset_min` — uint16 minutes before event time
- `start_utc_ms` / `end_utc_ms` — derived absolute window

#### `0x4c` sleep_summary_2 (len 18)
- `field_a` (int64), `field_b` (int16), `field_c` (int32)

#### `0x4f` sleep_summary_3 (len 15)
- `f0` — byte 6 `>> 3` (top 5 bits)
- `f1` — byte 7 `>> 3` (top 5 bits)
- `f2` — `(uint16@8 >> 3) & 0xFF` (8 bits taken from bits `[10:3]`)
- `f3` (int32), `f4` (int16), `f5` (byte)

#### `0x58` sleep_summary_4 (len 11)
- `f0` (int32), `f1` (int16), `f2` (byte)

#### `0x4e` / `0x5a` sleep_phase_details_and_data (len ≥ 19)
- `header` — byte 6 (8 bits)
- `phases[]` — **2-bit** sleep-phase codes, 4 per byte, MSB-first
  (`[7:6]`, `[5:4]`, `[3:2]`, `[1:0]`) across all body bytes from offset 7

#### `0x6a` sleep_period_info
- `c0`,`c6`,`c7`,`c8` — signed int8 metrics (bytes 6–9)
- `field_a`,`field_b` — `uint8 / 8.0` floats (bytes 10, 11; 5.3 fixed-point)
- `motion_seconds` — uint8 (byte 12)
- `sleep_state` — int8 (byte 13)
- `field_e` — `uint16 / 65536` float (bytes 14–15; 0.16 fixed-point)

#### `0x76` bedtime_period
- `start_rt`/`end_rt` — uint32 ring timestamps
- `start_utc_ms`/`end_utc_ms` — mapped to UTC

---

### Cardio / PPG (heart rate, IBI)

#### `0x4a` ppg_amplitude_ind (len ≥ 6)
- `amplitude` — `uint16 / 65535` normalized

#### `0x5d` hrv_event
Even length 6–16, **5-minute** spacing.
- `samples[]` — `{ time_ms, b1, b2 }`, timestamps walk back from event UTC

#### `0x60` ibi_and_amplitude_event (len 18)
Six inter-beat intervals (IBI) with amplitudes, densely bit-packed across the 14
body bytes (offsets 6–19, here numbered `b2`…`b15`/`b5` per the firmware's
interleaved layout). The byte order is scrambled; the parser rebuilds each value.

- **`shift`** — amplitude exponent, from the low nibble (`[3:0]`, 4 bits) of the
  last body byte: `n = byte & 0xF; shift = (n == 7) ? 0 : n + 1`.
- **`ibi[i]`** — each IBI is an **11-bit** value reassembled from three pieces:
  1 low bit (the LSB of one amplitude byte), 8 middle bits (a full byte `<< 3`),
  and 2 high bits taken from a 2-bit field of the trailing pack byte
  (`>> 3`/`>> 5`/`& 3` etc.). Result range 0–2047 ms.
- **`amplitude[i]`** — a **7-bit** mantissa (the top bits `[7:1]` of an
  amplitude byte) left-shifted by `shift`.
- `ibis[]` — `{ time_ms, ibi, amplitude }`; timestamps walk backward from event
  UTC by each IBI in turn.

#### `0x71` green_ibi_and_amp_event (len 18)
Green-LED variant of the above: **5** IBI deltas + **6** amplitudes.
- byte 19 (`b13`): bit `[3]` is reserved (set → firmware mismatch); `shift` from
  bits `[2:0]` (3 bits): `s = byte & 7; shift = (s == 7) ? 0 : s + 1`.
- each `ibi` is an **11-bit** value: 1 low bit + 8-bit byte `<< 3` + a 2-bit
  high field from the pack byte.
- each `amplitude` is a **7-bit** mantissa (`byte >> 1`) `<< shift`.
- `ibis[]` — first record is amplitude-only (`ibi = 0`).

#### `0x6e` spo2_ibi_and_amplitude_event (len 17)
Header byte 6 is bit-packed:

| Byte | Bits    | Field   | Width |
|------|---------|---------|-------|
| 6    | `[7]`   | `flag`  | 1     |
| 6    | `[6:4]` | `shift` | 3     |
| 6    | `[3:0]` | `mode`  | 4     |

- `ibis[]` — 5 records; each `ibi = byte × 8` (a **8-bit** count scaled ×8,
  i.e. 3-bit left shift), read from bytes 11→7 (reverse order).
- `amplitudes[]` — 7 values; the first is `byte << 3`, the rest are
  `byte << shift` (each an 8-bit mantissa shifted by `shift`).

#### `0x80` green_ibi_quality_event ⁴
Length 4–18, **2 bytes per sample**. Each pair packs:

| Bits across the pair       | Field        | Width |
|----------------------------|--------------|-------|
| `b0[7:0]` + `b1[2:0]`      | `ibi_delta`  | 11    |
| `b1[4:3]`                  | `quality_a`  | 2     |
| `b1[7:5]`                  | `quality_b`  | 3     |

- `ibi_delta` = `(b0 << 3) | (b1 & 7)` — an **11-bit** running delta.
- `samples[]` — `{ time_ms, ibi_delta, quality_a, quality_b }`.

#### `0x67` raw_ppg_summary (len 12 or 13)
Header for a following `raw_ppg_data` stream.
- `start_utc_ms`, `type`, `scale`, `field16`

#### `0x68` raw_ppg_data ²
Delta-encoded raw PPG. Needs `scale`/accumulator from the summary.
- `samples[]` — accumulated values

#### `0x81` cva_raw_ppg_data ²
Continuous-variable raw PPG (delta + 24-bit-absolute stream); needs session state.
- `count`, `body` (raw)

---

### SpO2 (blood-oxygen)

#### `0x6f` spo2_event
Length 5–18, **1-second** spacing, optional `0xFF` terminator. Byte 6 is packed:

| Byte | Bits    | Field                  | Width |
|------|---------|------------------------|-------|
| 6    | `[7:4]` | `spo2_base` (`<< 7`)   | 4     |
| 6    | `[3:0]` | `status`               | 4     |

- `samples[]` — `{ time_ms, value }`, one `uint8` value per second (from offset 7).

#### `0x77` spo2_dc_event
DC-channel stream. Header byte 6 is packed (and also surfaced as `hdr`, a 9-bit
value = `[7] | ([3:0] << 8)`):

| Byte | Bits    | Field      | Width | Meaning                          |
|------|---------|------------|-------|----------------------------------|
| 6    | `[7]`   | (hdr LSB)  | 1     | low bit folded into `hdr`        |
| 6    | `[6]`   | `hasBase`  | 1     | a 24-bit absolute base follows   |
| 6    | `[5:4]` | `scale`    | 2     | shift applied to each delta       |

- If `hasBase`: bytes 7–9 are a **24-bit** little-endian absolute base value.
- Remaining bytes are a **sign-magnitude 8-bit** delta stream (see `scaledDelta`),
  each scaled by `scale` and accumulated.
- `samples[]` — `{ time_ms, value }` accumulated from the base.

#### `0x7b` spo2_stable_event (len 6)
- `value` — **big-endian** `uint16` (bytes 6–7).

#### `0x7c` spo2_combo_event ³ (len 12 or 18)
Dense bit-packing producing `{ uint64 packed, int32 amp (+0x39000000 bias) }`
records — each record packs a **64-bit** field plus a **32-bit** amplitude with a
fixed `0x39000000` bias. 1 record at len 12, 2 at len 18; at len 12 the LSB
(`[0]`) of byte 13 is a `flag`.
- `records`, optional `flag`, `body` (raw — full unpack not yet implemented).

---

### Quality & on-demand

#### `0x6d` meas_quality_event (len 17)
**3-minute** spacing. `type` is `int8` at byte 6, then per-sample **signed 24-bit
little-endian** values:
- `type == 0` → 4 samples, each 3 bytes (no flag)
- `type == 1` → 3 samples, each 3-byte value + 1 `uint8` flag byte
- `samples[]` — `{ time_ms, value, flag }`

#### `0x62` on_demand_meas (len 5–12)
Progressive fields as length grows.
- `field0` (uint24), optional `f1`,`b1`,`f2`,`b2`

#### `0x65` on_demand_session (len 5–13)
- `bytes[]` and optional trailing `word` (uint16)

#### `0x66` on_demand_motion (len 5–16)
- `raw` — raw body bytes

---

### Sessions, self-test & scan

#### `0x6c` feature_session
Feature lifecycle / capability negotiation.
- `feature`, `status`, `kind` (e.g. `daytime_hr_v1`, `spo2_v1`,
  `exercise_hr_v1/v2`, `real_steps_v1`, `cva_ppg_sampler_v1`, `passthrough`)
- feature-specific fields (version, algorithm, sample-rate, etc.)

#### `0x5e` selftest_event
- `maskA`/`maskB` — two **16-bit** little-endian bitmasks (bytes 6–7 and 8–9);
  each set bit index (0–15) is listed in `listA`/`listB`.

#### `0x79` selftest_data_event
Subtype-dispatched on byte 6:
- subtype 1 (len 13) → `summary` `{ resultA, resultB }`
- subtype 2 (len 8) → `detailed` `{ id, value }`
- subtype 3 → `data` `{ id, body }`

#### `0x82` scan_start (len 13–18)
- `id12` — `uint16@6 & 0x0FFF` (low **12 bits**)
- `nibble` — byte 7 `>> 4` (high **4 bits**)
- `data` — remaining bytes (raw)

#### `0x83` scan_end
Byte 6 is packed: `format` = bits `[7:6]` (2), `recordType` = bits `[3:0]` (4).
- `scale` — byte 7 (`/10` when `format != 1`)
- `records[]` — `{ value16, value8 }`; record layout depends on `format`

---

### Activity (steps)

#### `0x7e` / `0x7f` real_steps_features_1 / _2 ³ (len 18)
Bit-packed step features combined across the paired `_1` + `_2` events.
- `body` (raw), to be merged across both events

---

### Diagnostics (raw body)

These carry large, multi-subtype diagnostic trees that are reported as raw hex
(`body`) rather than fully decoded, as they fall outside core sensor data:

- `0x43` debug_event_ind
- `0x61` debug_data
- `0x5b` ble_connection_ind
- `0x73` ehr_trace_event
- `0x74` ehr_acm_intensity_event

---

## 5. Worked examples

```
6A 0E E4 19 83 00 8A 36 3F 17 7A 22 11 00 F2 1C
└┬ └┬ └────┬───── └──────────┬──────────────────
 │  │      │                  └ body (sleep_period_info)
 │  │      └ ring_timestamp = 0x008319E4 = 8591844
 │  └ payload_length = 0x0E = 14  (total 16)
 └ type 0x6A sleep_period_info
→ { c0:-118, c6:54, c7:63, c8:23, field_a:15.25, field_b:4.25,
    motion_seconds:17, sleep_state:0, field_e:0.1130… }

60 12 E3 19 83 00 …   type 0x60 ibi_and_amplitude, len 18, ts 8591843
→ 6 IBI samples with amplitudes, timestamps walking backward

77 09 D9 19 83 00 C5 AA AA B2 00   type 0x77 spo2_dc, len 9, ts 8591833
→ 24-bit base + delta stream
```

---

## 6. Parser API (`parse.js`)

Built on the standard `ArrayBuffer` / `Uint8Array` / `DataView` APIs.
`parseEvent` / `parseStream` accept any `Uint8Array` (including a Node `Buffer`)
or an `ArrayBuffer`.

```js
const { parseEvent, parseStream, hexToBuf } = require("./parse.js");

// With a time mapping (recommended) for absolute UTC:
const ctx = { mapping: { ring: 8591800, utc: 1700000000000 } };
const ev  = parseEvent(hexToBuf("60 12 E3 19 83 00 …"), ctx);

// Any Uint8Array / ArrayBuffer works as input:
const ev2 = parseEvent(new Uint8Array([0x77, 0x09, /* … */]), ctx);

// A back-to-back stream of events:
const evs = parseStream(bytes, ctx);
```

Each result has the shape:

```js
{
  type: "0x60",
  name: "ibi_and_amplitude_event",
  payload_length: 18,
  total_length: 20,
  ring_timestamp: 8591843,
  utc_ms: "1700000004300",   // "0" when no mapping supplied
  data: { … }                // or `body` (raw hex) for raw-body types
}
```
