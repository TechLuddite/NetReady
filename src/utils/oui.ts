import { MacLookupResult } from '../types';

// Large built-in database of common OUI prefixes
const OUI_DATABASE: Record<string, string> = {
  '00:00:0C': 'Cisco Systems, Inc.',
  '00:01:42': 'Cisco Systems, Inc.',
  '00:03:93': 'Apple, Inc.',
  '00:05:02': 'Apple, Inc.',
  '00:0A:27': 'Apple, Inc.',
  '00:0C:29': 'VMware, Inc.',
  '00:0E:0C': 'Intel Corporation',
  '00:10:18': 'Broadcom Corp',
  '00:11:32': 'Synology Incorporated',
  '00:13:10': 'Cisco Systems, Inc.',
  '00:14:22': 'Dell Inc.',
  '00:15:5D': 'Microsoft Corporation (Hyper-V)',
  '00:18:01': 'Samsung Electronics',
  '00:1A:11': 'Google LLC',
  '00:1A:2B': 'Ayecom Technology',
  '00:1A:E8': 'Unizhan Communication',
  '00:1B:44': 'SanDisk Corporation',
  '00:1C:42': 'Parallels International GmbH',
  '00:1D:60': 'ASUSTeK Computer Inc.',
  '00:1E:06': 'Wibree Forum',
  '00:1F:3B': 'Intel Corporation',
  '00:21:6A': 'Intel Corporation',
  '00:23:12': 'Apple, Inc.',
  '00:24:8C': 'ASUSTeK Computer Inc.',
  '00:25:90': 'Super Micro Computer, Inc.',
  '00:26:BB': 'Apple, Inc.',
  '00:50:56': 'VMware, Inc.',
  '00:E0:4C': 'Realtek Semiconductor Corp.',
  '08:00:27': 'Oracle Corporation (VirtualBox)',
  '18:66:DA': 'TP-Link Corporation Limited',
  '18:C0:4D': 'Google LLC',
  '1C:1B:0D': 'GIGA-BYTE TECHNOLOGY CO.,LTD.',
  '28:60:00': 'Apple, Inc.',
  '2C:F0:5D': 'Raspberry Pi Trading Ltd',
  '30:9C:23': 'Sony Corporation',
  '30:FD:38': 'Google LLC (Chromecast / Nest)',
  '34:97:F6': 'ASUSTeK Computer Inc.',
  '38:F9:D3': 'Apple, Inc.',
  '3C:06:30': 'Apple, Inc.',
  '3C:7C:3F': 'Huawei Technologies Co., Ltd.',
  '40:B0:34': 'Chevron Corp',
  '40:88:05': 'Motorola Mobility LLC',
  '44:38:39': 'Cumulus Networks',
  '48:2C:6A': 'Samsung Electronics',
  '4C:CC:6A': 'Micro-Star INT\'L CO., LTD. (MSI)',
  '50:C7:BF': 'TP-Link Corporation Limited',
  '52:54:00': 'QEMU / KVM Virtual NIC',
  '54:EE:75': 'Apple, Inc.',
  '58:9E:C6': 'Apple, Inc.',
  '5C:E9:1E': 'Texas Instruments',
  '60:45:BD': 'Google LLC',
  '64:00:6A': 'Dell Inc.',
  '68:D7:9A': 'Ubiquiti Networks Inc.',
  '6C:29:95': 'Intel Corporation',
  '70:85:C2': 'ASUSTeK Computer Inc.',
  '70:B3:D5': 'IEEE Registration Authority',
  '74:83:C2': 'NVIDIA Corporation',
  '74:8D:08': 'Google LLC',
  '78:28:CA': 'MSI Co., Ltd.',
  '7C:10:C9': 'Apple, Inc.',
  '80:2A:A8': 'Ubiquiti Networks Inc.',
  '84:2B:2B': 'Microsoft Corporation (Surface)',
  '88:66:5A': 'Apple, Inc.',
  '8C:85:90': 'Apple, Inc.',
  '90:09:D0': 'Amazon Technologies Inc.',
  '90:2B:34': 'GIGA-BYTE TECHNOLOGY CO.,LTD.',
  '94:9B:2C': 'Samsung Electronics',
  '94:A4:0E': 'Intel Corporation',
  '98:E7:43': 'Dell Inc.',
  'A0:36:9F': 'Intel Corporation',
  'A4:38:35': 'Apple, Inc.',
  'A4:5E:60': 'Amazon Technologies Inc.',
  'AC:15:A2': 'Apple, Inc.',
  'AC:84:C6': 'TP-Link Corporation Limited',
  'AC:BC:32': 'Apple, Inc.',
  'B0:A7:37': 'Apple, Inc.',
  'B4:2E:99': 'Intel Corporation',
  'B8:27:EB': 'Raspberry Pi Foundation',
  'B8:E8:56': 'Apple, Inc.',
  'C0:25:67': 'Apple, Inc.',
  'C0:25:A5': 'Dell Inc.',
  'C4:AD:34': 'Apple, Inc.',
  'CC:96:E5': 'Samsung Electronics',
  'D0:03:4B': 'Apple, Inc.',
  'D0:50:99': 'ASUSTeK Computer Inc.',
  'D4:81:D7': 'Apple, Inc.',
  'D4:F5:EF': 'Amazon Technologies Inc.',
  'DC:A6:32': 'Raspberry Pi Trading Ltd',
  'E0:D5:5E': 'Ubiquiti Networks Inc.',
  'E4:5F:01': 'Raspberry Pi Trading Ltd',
  'E8:94:F6': 'Apple, Inc.',
  'EC:F4:BB': 'Espressif Inc. (ESP32 / ESP8266)',
  'F0:18:98': 'Apple, Inc.',
  'F4:03:7B': 'Cisco Systems, Inc.',
  'F4:D4:88': 'Apple, Inc.',
  'F8:FF:C2': 'Apple, Inc.',
  'FC:EC:DA': 'Ubiquiti Networks Inc.',
};

export function parseAndLookupMac(input: string): MacLookupResult {
  const rawClean = input.replace(/[^a-fA-F0-9]/g, '').toUpperCase();
  
  if (rawClean.length < 6) {
    return {
      mac: input,
      cleanMac: rawClean,
      oui: '',
      vendor: 'Invalid MAC address (needs at least 6 hex characters)',
      addressType: 'Unicast',
      administration: 'Globally Unique (U/L = 0)',
      isKnown: false,
    };
  }

  // Format as XX:XX:XX:XX:XX:XX
  const padded = rawClean.padEnd(12, '0').slice(0, 12);
  const formattedMac = padded.match(/.{1,2}/g)?.join(':') || input;

  const ouiHex = padded.slice(0, 6);
  const ouiFormatted = `${ouiHex.slice(0, 2)}:${ouiHex.slice(2, 4)}:${ouiHex.slice(4, 6)}`;

  // Determine Unicast vs Multicast (1st byte's LSB)
  const firstByte = parseInt(ouiHex.slice(0, 2), 16);
  const isMulticast = (firstByte & 1) === 1;
  const addressType = isMulticast ? 'Multicast' : 'Unicast';

  // Determine Globally Unique vs Locally Administered (1st byte's 2nd LSB)
  const isLocallyAdministered = (firstByte & 2) === 2;
  const administration = isLocallyAdministered
    ? 'Locally Administered (U/L = 1)'
    : 'Globally Unique (U/L = 0)';

  let vendor = OUI_DATABASE[ouiFormatted];
  let isKnown = true;

  if (!vendor) {
    if (isLocallyAdministered) {
      vendor = 'Locally Administered Device (Randomized / Virtual MAC)';
    } else {
      vendor = 'Unknown Vendor (OUI not in offline database)';
      isKnown = false;
    }
  }

  return {
    mac: formattedMac,
    cleanMac: padded,
    oui: ouiFormatted,
    vendor,
    addressType,
    administration,
    isKnown,
  };
}
