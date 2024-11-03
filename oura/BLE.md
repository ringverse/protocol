# Oura Ring - BLE protocol

This information is only confirmed for Oura Ring 4. Furter testing is needed for other models.

## General

| Parameter                          | Value         |
| ---------------------------------- | ------------- |
| Channel                            | `0x0004`      |
| Handle (Write Request)             | `0x0015`      |
| Handle (Handle Value Notification) | `0x0012`      |
| Byte order                         | Little endian |

The communication looks as follows:

1. Client sends the request in form of a BLE Write Request, the associated Write Response will be always empty.
2. After the ring processes the request, BLE Handle Value Notification with the data will be sent.

### Request structure

| Field          | Example  | Length | Type  | Notes |
| -------------- | -------- | ------ | ----- | ----- |
| Request tag    | `08`     | 1      | uint8 |       |
| Payload length | `03`     | 1      | uint8 |       |
| Payload        | `000000` | varies | bytes |       |

### Response structure

Response comes in form of `Handle Value Notification`, same format as request.

## Flow

### Reset

### Initial setup

### Data retrieval

### DFU

## Types

### semver

| Field | Example | Length | Type  | Notes |
| ----- | ------- | ------ | ----- | ----- |
| Major | `02`    | 1      | uint8 |       |
| Minor | `00`    | 1      | uint8 |       |
| Patch | `0A`    | 1      | uint8 |       |

## Packets

### 0x01 - Unknown

Write Request handle: 0x0013

No payload, no response observed.

Example: `0100`.

### 0x02 - Unknown

Write Request handle: 0x0004

No payload, no response observed.

Example: `0200`.

### 0x03 - Data Collection

Not observed.

#### 00 - Unknown

#### 01 - Get Page

#### 02 - Configure

#### 03 - Stop

#### 04 - Clear

#### 05 - State

### 0x06 - Set Realtime Measurements

### 0x07 - Set Realtime Measurements (Response)

### 0x08 - Get Firmware Version

| Field   | Example  | Length | Type  | Notes |
| ------- | -------- | ------ | ----- | ----- |
| Unknown | `000000` | 3      | bytes |       |

Example: `0803 0000 00`

### 0x09 - Get Firmware Version (Response)

| Field                   | Example          | Length | Type              | Notes                                                                     |
| ----------------------- | ---------------- | ------ | ----------------- | ------------------------------------------------------------------------- |
| API version             | `0112 01`        | 3      | [semver](#semver) |                                                                           |
| Firmware version        | `0200 02`        | 3      | [semver](#semver) |                                                                           |
| Bootloader version      | `0100 03`        | 3      | [semver](#semver) |                                                                           |
| Bluetooth stack version | `0500 04`        | 3      | [semver](#semver) |                                                                           |
| MAC address             | `1111 2222 3333` | 6      | bytes             | Probably prepending some constant to this, since MAC should be 8 bytes... |

Example: `0912 0112 0102 0002 0100 0305 0004 1111 2222 3333`

### 0x0A - Run Self Test

| Field   | Example     | Length | Type  | Notes |
| ------- | ----------- | ------ | ----- | ----- |
| Unknown | `FFFF FFFF` | 8      | bytes |       |

Example: `0A04 FFFF FFFF`

### 0x0B - Self Test Response

| Field   | Example     | Length | Type  | Notes |
| ------- | ----------- | ------ | ----- | ----- |
| Unknown | `FFFF FFFF` | 8      | bytes |       |

Example: `0B04 FFFF FFFF`

### 0x0C - Get Battery Level

No payload.

Example: `0C00`

### 0x0D - Get Battery Level (Response)

| Field                | Example   | Length | Type  | Notes |
| -------------------- | --------- | ------ | ----- | ----- |
| Battery level        | `64`      | 1      | uint8 |       |
| Charging progress    | `00`      | 1      | uint8 |       |
| Charging recommended | `00`      | 1      | uint8 |       |
| Unknown              | `FFFF FF` | 3      | bytes |       |

Example: `0D06 6400 00FF FFFF`

### 0x0E - Start Firmware Update

| Field | Example | Length | Type  | Notes |
| ----- | ------- | ------ | ----- | ----- |
| Flags | `00`    | 1      | uint8 |       |

### 0x0F - Start Firmware Update (Response)

| Field  | Example | Length | Type                                                                      | Notes |
| ------ | ------- | ------ | ------------------------------------------------------------------------- | ----- |
| Status | `00`    | 1      | uint8 ([Start firmware update response](#start-firmware-update-response)) |       |

### 0x10 - Data retrieval?

TODO: Investigate

### 0x12 - Sync Time

| Field           | Example               | Length | Type   | Notes                                                     |
| --------------- | --------------------- | ------ | ------ | --------------------------------------------------------- |
| Unix timestamp  | `BC61 1000 0000 0000` | 8      | uint64 | seconds                                                   |
| Timezone offset | `04`                  | 1      | uint8  | measured in half-hours from UTC (`getOffset() / 1800000`) |

Example: `1209 BC61 1000 0000 0000 04`

### 0x13 - Sync Time (Response)

TODO: Investigate

Example: `1305 4BED A900 00`

### 0x16 - Set BLE mode

| Field | Example | Length | Type  | Notes |
| ----- | ------- | ------ | ----- | ----- |
| Mode  | `01`    | 1      | uint8 |       |

Example: `1601 01`

### 0x16 - Set BLE mode (Response)

| Field | Example | Length | Type  | Notes |
| ----- | ------- | ------ | ----- | ----- |
| Mode  | `01`    | 1      | uint8 |       |

Example: `1701 01`

### 0x18 - Get Product Info

| Field | Example   | Length | Type  | Notes |
| ----- | --------- | ------ | ----- | ----- |
| Type  | `0800 10` | 3      | bytes |       |

#### 0x140010 - Get Hardware Id (Frodo)

#### 0x180010 - Get Hardware Id (Not Frodo)

#### 0x280009 - Get Product Code (Gandalf/Above)

#### 0x340004 - Get Product Code (Frodo)

#### 0x040010 - Get Serial Number (Old?)

#### 0x080010 - Get Serial Number

Example: `1803 0800 10`

### 0x19 - Get Product Info (Response)

### 0x1A - Factory Reset

No payload.

### 0x1B - Factory Reset (Response)

| Field  | Example | Length | Type   | Notes |
| ------ | ------- | ------ | ------ | ----- |
| Status | `0000`  | 2      | uint16 |       |

### 0x1C - Set Notification

| Field | Example | Length | Type  | Notes |
| ----- | ------- | ------ | ----- | ----- |
| Flags | `3F`    | 1      | uint8 |       |

Example: `1C01 3F`

### 0x1D - Set Notification (Response)

| Field   | Example | Length | Type  | Notes |
| ------- | ------- | ------ | ----- | ----- |
| Unknown | `00`    | 1      | uint8 |       |

Example: `1D01 00`

### 0x20 - Set User Info

| Field          | Example | Length | Type                                      | Notes                                               |
| -------------- | ------- | ------ | ----------------------------------------- | --------------------------------------------------- |
| User info type | `02`    | 1      | uint8 ([User info type](#user-info-type)) |                                                     |
| Data           | `00`    | varies | varies                                    | See: [User info type](#user-info-type) for details. |

### 0x21 - Set User Info (Response)

| Field          | Example | Length | Type                                          | Notes |
| -------------- | ------- | ------ | --------------------------------------------- | ----- |
| User info type | `02`    | 1      | uint8 ([User info type](#user-info-type))     |       |
| Result         | `00`    | 1      | uint8 ([User info result](#user-info-result)) |       |

### 0x24 - Set Auth Key

| Field | Example                                   | Length | Type  | Notes |
| ----- | ----------------------------------------- | ------ | ----- | ----- |
| Key   | `1111 2222 3333 4444 5555 6666 7777 8888` | 16     | bytes |       |

Example: `2410 1111 2222 3333 4444 5555 6666 7777 8888`

### 0x25 - Set Auth Key (Response)

| Field      | Example | Length | Type  | Notes |
| ---------- | ------- | ------ | ----- | ----- |
| Status (?) | `00`    | 1      | uint8 |       |

Example: `2501 00`

### 0x26 - Enable Flight Mode

| Field   | Example | Length | Type  | Notes |
| ------- | ------- | ------ | ----- | ----- |
| Unknown | `6027`  | 2      | bytes |       |

Example: `2602 6027`

### 0x2B - DFU

| Field   | Example                            | Length | Type  | Notes      |
| ------- | ---------------------------------- | ------ | ----- | ---------- |
| Mode    | `01`                               | 1      | uint8 |            |
| Payload | `0200 0000 0000 0000 0000 0000 00` | varies | bytes | See below. |

#### 01 - Reset

No payload.

#### 02 - Start

| Field          | Example           | Length | Type              | Notes |
| -------------- | ----------------- | ------ | ----------------- | ----- |
| Application ID | `02` (TODO: find) | 1      | uint8             |       |
| Version        | `0000 00`         | 3      | [semver](#semver) |       |
| Start address  | `0000 0000`       | 4      | int32             |       |
| Image length   | `0000 0000`       | 4      | int32             |       |

#### 03 - Block Transfer

| Field             | Example           | Length | Type   | Notes |
| ----------------- | ----------------- | ------ | ------ | ----- |
| Application ID    | `02` (TODO: find) | 1      | uint8  |       |
| Block type        | `00`              | 1      | uint8  |       |
| Block index       | `0000`            | 2      | uint16 |       |
| Block size        | `0000`            | 2      | uint16 |       |
| Number of packets | `00`              | 1      | uint8  |       |
| CRC32             | `0000 0000`       | 4      | int32  |       |

#### 04 - Activate

| Field                  | Example           | Length | Type  | Notes |
| ---------------------- | ----------------- | ------ | ----- | ----- |
| Application ID         | `02` (TODO: find) | 1      | uint8 |       |
| CRC32                  | `0000 0000`       | 4      | int32 |       |
| Force flags (optional) | `00`              | 1      | uint8 |       |

### 0x2F - Extended request?

| Field      | Example | Length | Type  | Notes      |
| ---------- | ------- | ------ | ----- | ---------- |
| Request ID | `01`    | 1      | uint8 |            |
| Payload    | `FF`    | varies | bytes | See below. |

#### 0x01 - Get Capabilities

| Field | Example | Length | Type  | Notes |
| ----- | ------- | ------ | ----- | ----- |
| Page  | `FF`    | 1      | uint8 |       |

Example: `2F01 FF`

#### 0x03 - Set bundling status

| Field            | Example | Length | Type  | Notes |
| ---------------- | ------- | ------ | ----- | ----- |
| Bundling enabled | `01`    | 1      | uint8 |       |

Example: `2F02 0301`

#### 0x04 - Set bundling status (response)

| Field            | Example | Length | Type  | Notes |
| ---------------- | ------- | ------ | ----- | ----- |
| Bundling enabled | `01`    | 1      | uint8 |       |

Example: `2F02 0401`

#### 0x20 - Get Feature Status

| Field      | Example | Length | Type                              | Notes |
| ---------- | ------- | ------ | --------------------------------- | ----- |
| Feature ID | `0C`    | 1      | uint8 ([Feature ID](#feature-id)) |       |

Example: `2F02 200C`

#### 0x21 - Get Feature Status (Response)

| Field             | Example | Length | Type                                                            | Notes |
| ----------------- | ------- | ------ | --------------------------------------------------------------- | ----- |
| Feature ID        | `0C`    | 1      | uint8 ([Feature ID](#feature-id))                               |       |
| Mode              | `00`    | 1      | uint8 ([Feature mode](#feature-mode))                           |       |
| Status value      | `00`    | 1      | uint8 ([Feature status value](#feature-status-value))           |       |
| State             | `00`    | 1      | uint8 ([Feature state](#feature-state))                         |       |
| Subscription mode | `00`    | 1      | uint8 ([Feature subscription mode](#feature-subscription-mode)) |       |

Example: `2F06 210C 0000 0000`

#### 0x22 - Set Feature Mode

| Field      | Example | Length | Type                                  | Notes |
| ---------- | ------- | ------ | ------------------------------------- | ----- |
| Feature ID | `0C`    | 1      | uint8 ([Feature ID](#feature-id))     |       |
| Mode       | `00`    | 1      | uint8 ([Feature mode](#feature-mode)) |       |

#### 0x26 - Set Feature Subscription

| Field             | Example | Length | Type                                                            | Notes |
| ----------------- | ------- | ------ | --------------------------------------------------------------- | ----- |
| Feature ID        | `0C`    | 1      | uint8 ([Feature ID](#feature-id))                               |       |
| Subscription mode | `00`    | 1      | uint8 ([Feature subscription mode](#feature-subscription-mode)) |       |

#### 0x27 - Set Feature Subscription (Response)

| Field      | Example | Length | Type                                                                                  | Notes |
| ---------- | ------- | ------ | ------------------------------------------------------------------------------------- | ----- |
| Feature ID | `0C`    | 1      | uint8 ([Feature ID](#feature-id))                                                     |       |
| Result     | `01`    | 1      | uint8 ([Feature set subscription mode result](#feature-set-subscription-mode-result)) |       |

#### 0x29 - Set Feature Parameters

| Field      | Example     | Length | Type                              | Notes |
| ---------- | ----------- | ------ | --------------------------------- | ----- |
| Feature ID | `0C`        | 1      | uint8 ([Feature ID](#feature-id)) |       |
| Bytes      | `0000 0000` | varies | bytes                             |       |

#### 0x2A - Set Feature Parameters (Response)

| Field      | Example | Length | Type                              | Notes |
| ---------- | ------- | ------ | --------------------------------- | ----- |
| Feature ID | `0C`    | 1      | uint8 ([Feature ID](#feature-id)) |       |
| Status     | `00`    | 1      | uint8                             |       |

#### 0x2B - Get Auth Nonce

No payload.

Example: `2F01 2B`

#### 0x2C - Get Auth Nonce (Response)

| Field | Example                                 | Length | Type  | Notes |
| ----- | --------------------------------------- | ------ | ----- | ----- |
| Nonce | `1111 2222 3333 4444 5555 6666 7777 88` | 15     | bytes |       |

Example: `2F10 2C11 1122 2233 3344 4455 5566 6677 7788`

#### 0x2D - Authenticate

| Field           | Example                                   | Length | Type  | Notes |
| --------------- | ----------------------------------------- | ------ | ----- | ----- |
| Encrypted nonce | `1111 2222 3333 4444 5555 6666 7777 8888` | 16     | bytes |       |

Example: `2F11 2D11 1122 2233 3344 4455 5566 6677 7788 88`

Auth nonce is encrypted using AES-CBC (using the key provided in [Set Auth Key](#0x24---set-auth-key) beforehand), with PKCS5 padding.

Auth key can also be retrieved from application data, see: [Storage](./storage.md).

In node.js this can be emulated using AES-ECB with empty IV:

```js
import { createCipheriv } from "crypto";

function encryptNonce(key: Uint8Array, nonce: Uint8Array) {
  const cipher = createCipheriv("aes-128-ecb", key, "");
  cipher.setAutoPadding(true);
  return Buffer.concat([cipher.update(nonce), cipher.final()]);
}
```

#### 0x2F - Authenticate (Response)

| Field | Example | Length | Type                                                    | Notes |
| ----- | ------- | ------ | ------------------------------------------------------- | ----- |
| State | `00`    | 1      | uint8 ([Authentication result](#authentication-result)) |       |

Example: `2F02 2E00`

### 0x28 - Check Sleep Analysis

| Field                | Example | Length | Type  | Notes |
| -------------------- | ------- | ------ | ----- | ----- |
| Force sleep analysis | `00`    | 1      | uint8 |       |

Example: `2801 00`

### 0x29 - Check Sleep Analysis (Response)

| Field  | Example | Length | Type  | Notes |
| ------ | ------- | ------ | ----- | ----- |
| Status | `00`    | 1      | uint8 |       |

Example: `2901 00`

### 0x31 - Set Ring Mode

| Field     | Example | Length | Type                            | Notes |
| --------- | ------- | ------ | ------------------------------- | ----- |
| Ring mode | `00`    | 1      | uint8 ([Ring mode](#ring-mode)) |       |

### 0x32 - Set Ring Mode (Response)

| Field  | Example | Length | Type   | Notes |
| ------ | ------- | ------ | ------ | ----- |
| Status | `0000`  | 2      | uint16 |       |

### 0x37 - Set Manufacturing Info

| Field              | Example     | Length | Type                                                        | Notes |
| ------------------ | ----------- | ------ | ----------------------------------------------------------- | ----- |
| Manufacturing mode | `0300 0000` | 4      | bytes ([Ring manufacturing mode](#ring-manufacturing-mode)) |       |

### 0x38 - Set Manufacturing Info (Response)

| Field  | Example | Length | Type  | Notes |
| ------ | ------- | ------ | ----- | ----- |
| Status | `00`    | 1      | uint8 |       |

### 0x39 - Sync Manufacturing Info

No payload.

### 0x3A - Sync Manufacturing Info (Response)

| Field  | Example | Length | Type  | Notes |
| ------ | ------- | ------ | ----- | ----- |
| Status | `00`    | 1      | uint8 |       |

# Unknown

## Read by Type request?

Read by Type request

Start: 0x0005 - 0x000F

0805 000F 0000 2A

### Value notifications

`1F04 2003 0200`

## Constants

### Ring

#### Ring mode

uint8

| Ring mode                   | Value  |
| --------------------------- | ------ |
| Normal                      | `0x00` |
| Fast heart rate measurement | `0x01` |
| Deep sleep                  | `0x02` |

#### Ring manufacturing mode

uint8

| Ring mode  | Value        |
| ---------- | ------------ |
| Test       | `0x03000000` |
| Production | `0x07000000` |

#### Start firmware update response

uint8

| Authentication result      | Value  |
| -------------------------- | ------ |
| Success                    | `0x00` |
| Battery level too low      | `0x01` |
| Sleep analysis in progress | `0x02` |

### Authentication

#### Authentication result

uint8

| Authentication result         | Value  |
| ----------------------------- | ------ |
| Success                       | `0x00` |
| Authentication error          | `0x01` |
| In factory reset              | `0x02` |
| Not original onboarded device | `0x03` |

### Features

#### Feature ID

uint8

| Feature         | Value  |
| --------------- | ------ |
| Background DFU  | `0x00` |
| Research Data   | `0x01` |
| Daytime HR      | `0x02` |
| Exercise HR     | `0x03` |
| SPO2            | `0x04` |
| Bundling        | `0x05` |
| Encrypted API   | `0x06` |
| Tap to tag      | `0x07` |
| Resting HR      | `0x08` |
| App auth        | `0x09` |
| BLE mode        | `0x0A` |
| Real steps      | `0x0B` |
| Experimental    | `0x0C` |
| CVA PPG Sampler | `0x0D` |

#### Feature mode

uint8

| Feature mode           | Value  |
| ---------------------- | ------ |
| Off                    | `0x00` |
| Automatic              | `0x01` |
| Requested              | `0x02` |
| Requested subscription | `0x03` |

#### Feature status value

uint8

| Status value           | Value  |
| ---------------------- | ------ |
| Off                    | `0x00` |
| On                     | `0x01` |
| Searching              | `0x02` |
| No reliable PPG signal | `0x03` |
| Cold fingers           | `0x04` |
| Too much movements     | `0x05` |
| Identifying signal     | `0x06` |

#### Feature state

uint8

| State          | Value  |
| -------------- | ------ |
| Idle           | `0x00` |
| Scanning       | `0x01` |
| Measuring      | `0x02` |
| Postprocessing | `0x03` |

#### Feature subscription mode

uint8

| Subscription mode | Value  |
| ----------------- | ------ |
| Off               | `0x00` |
| State             | `0x01` |
| Latest            | `0x02` |

#### Feature set subscription mode result

uint8

| Result            | Value  |
| ----------------- | ------ |
| Not supported     | `0x01` |
| Not available     | `0x02` |
| Not in finger     | `0x03` |
| Message too short | `0x04` |
| Low battery       | `0x05` |

### DFU

#### DFU status (uint8)

uint8

| Status                  | Value  |
| ----------------------- | ------ |
| Success                 | `0x00` |
| Incomplete image        | `0x01` |
| Image validation failed | `0x02` |
| Downgrade not allowed   | `0x03` |
| Other error             | `0x04` |
| Battery low             | `0x05` |
| Sleep                   | `0x06` |
| Disabled                | `0x07` |
| Rdata                   | `0x08` |
| Sync time               | `0x09` |

#### DFU block type

uint8

| Type      | Value  |
| --------- | ------ |
| None      | `0x00` |
| EIV       | `0x01` |
| Image     | `0x02` |
| Signature | `0x03` |

### User info

#### User info type

uint8

| User info type | Value  | Data type | Notes                              |
| -------------- | ------ | --------- | ---------------------------------- |
| Gender         | `0x02` | uint8     | Currently unused (always `0x00`)   |
| Height         | `0x03` | uint16    | Currently unused (always `0x0000`) |
| Weight         | `0x04` | uint16    | Currently unused (always `0x0000`) |
| Date of birth  | `0x05` | uint64    | Seems to be a timestamp.           |
| Unit system    | `0x06` | uint8     | Currently unused (always `0x0000`) |

#### User info result

uint8

| User info result             | Value  |
| ---------------------------- | ------ |
| Success                      | `0x00` |
| Invalid start offset address | `0x02` |
| Unknown parameter identifier | `0x03` |
| File system busy             | `0x05` |
