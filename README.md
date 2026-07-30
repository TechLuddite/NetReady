# NetReady 🌐⚡

> **Browser-Native Network Diagnostics Workstation & Local Port Scanner**

NetReady is a modern, high-performance, client-side network diagnostics suite and local port scanner engineered to run 100% inside your browser using standard Web APIs, WebSockets, DNS-over-HTTPS (DoH), and WebRTC ICE probing.

---

## 🛠️ Key Diagnostic Tools

### 1. 📡 Local Port Scanner
- **Target Specification**: Input hostnames, IPv4 addresses, loopback interfaces (`127.0.0.1`), or subnets (`192.168.1.0/24`).
- **Auto-Detect Subnet**: Discovers active local network interfaces using WebRTC candidate gathering.
- **Port Ranges**:
  - **Category Presets**: Web & Dev (`80, 443, 3000, 5000, 8080`), Top 15 Common Ports, Databases (`1433, 3306, 5432, 6379, 27017`), Remote Admin & Mail (`21, 22, 23, 25, 3389, 5900`).
  - **Custom Ports & Ranges**: Flexible input supporting comma-separated ports and ranges (e.g. `80, 443, 3000-3010, 8080`).
- **Socket Probe Engine**: Reports `Open`, `Closed`, or `Filtered` port states with roundtrip latency, target IP/host, service name, and descriptions.

### 2. ⚡ WebRTC Bandwidth & Speed Test
- Probes download/upload capacity, ping latency, and jitter directly from standard web edge endpoints without external plugins.

### 3. 🎯 Multi-Host Ping & Jitter Monitor
- Measures real-time packet round-trip time (RTT), minimum/maximum latency variance, and connection jitter.

### 4. 🔒 DoH DNS Resolver
- Queries domain records (`A`, `AAAA`, `MX`, `TXT`, `NS`, `CNAME`) using DNS-over-HTTPS providers (Cloudflare, Google Public DNS).

### 5. 🌐 WebRTC ICE Candidate Analyzer
- Discovers public WAN IP addresses, internal LAN interface candidates, and NAT traversal topology using STUN servers.

### 6. 🧮 Subnet & CIDR Calculator
- Computes network boundaries, broadcast addresses, usable host counts, netmasks, and IP binary representations for any CIDR notation.

### 7. 🔍 MAC OUI Hardware Vendor Lookup
- Decodes IEEE Organisationally Unique Identifiers (OUIs) to identify network device manufacturers.

### 8. 🛡️ HTTP Security Header Probe
- Inspects HTTP status codes, server headers, and security enforcement headers (`HSTS`, `CORS`, `CSP`, `X-Frame-Options`).

### 9. 🔌 WebSocket Echo & Latency Tester
- Measures WebSocket handshake setup times, message frame roundtrip latency, and echo packet reliability over `ws://` and `wss://`.

### 10. 💾 Persistent LocalStorage History
- All scan results automatically persist in the browser's `localStorage`.
- Search, filter, inspect raw JSON payloads, and export reports in **JSON** or **CSV** formats.

---

## 🚀 Getting Started

### Prerequisites
- **Node.js**: v18.0.0 or higher
- **npm** or **yarn**

### Installation

```bash
# Clone the repository
git clone https://github.com/your-username/netready.git

# Navigate into the workspace
cd netready

# Install dependencies
npm install

# Start the development server
npm run dev
```

The application will launch on `http://localhost:3000`.

### Building for Production

```bash
npm run build
npm run start
```

---

## 🔒 Privacy & Safety Statement

NetReady is engineered with a strict **Privacy-First & Security-First** architecture:
- **100% Client-Side Execution**: All network diagnostics, socket probing, DNS-over-HTTPS lookups, and WebRTC candidate analysis execute strictly within your browser.
- **Zero Server Telemetry**: We do not collect, transmit, store, or analyze any user IP addresses, scan targets, or diagnostic logs.
- **Local Persistence Only**: All scan history, speed test metrics, and configuration options are saved locally in your browser's `localStorage`. Clearing your browser data completely removes all saved records.
- **Ethical Scanning Notice**: Port scanning and network diagnostic probes should only be executed on networks, devices, and hosts that you own or have explicit authorization to audit.

---

## ☕ Developer Support & Donations

If NetReady has saved you time in network troubleshooting or dev environment setup, consider supporting ongoing open-source development!

- ☕ **Buy Me a Coffee**: [buymeacoffee.com/opsvibe](https://buymeacoffee.com/opsvibe)
- 💖 **GitHub Sponsors**: [github.com/sponsors/opsvibe](https://github.com/sponsors/opsvibe)
- 🥤 **Ko-fi**: [ko-fi.com/opsvibe](https://ko-fi.com/opsvibe)
- ⚡ **Crypto / Web3**: `opsvibe.eth` / `0xOpsVibe...`

Your contributions help maintain dependencies, build new diagnostic tools, and keep NetReady 100% free and open-source under AGPL-3.0.

---

## 👏 Shout-Outs & Acknowledgments

Special thanks to the amazing open-source community and tools that make NetReady possible:

- **[Lucide Icons](https://lucide.dev/)**: For clean, modern UI icon set.
- **[Tailwind CSS](https://tailwindcss.com/)**: For rapid utility-first styling architecture.
- **[Vite](https://vitejs.dev/) & [React](https://react.dev/)**: For lightweight, ultra-fast frontend execution.
- **[Cloudflare & Google Public DNS](https://developers.cloudflare.com/1.1.1.1/encryption/dns-over-https/)**: For high-performance, privacy-respecting DoH resolvers.
- **[IEEE OUI Registry](https://standards.ieee.org/products-programs/regauth/oui/)**: For hardware vendor lookup standards.

---

## 🔄 Drift Check & System Integrity

NetReady enforces strict client-side build integrity and zero configuration drift:

- **TypeScript Verification**: `npm run lint` ensures type safety with strict `tsc --noEmit` checks.
- **Deterministic Builds**: `npm run build` produces static bundle outputs in `dist/` with zero server runtime state drift.
- **Browser Standard Consistency**: Fully compliant with modern W3C Web APIs (Fetch API, WebSockets, WebRTC RTCPeerConnection, Storage API).

---

## 🛡️ License

This project is licensed under the **GNU Affero General Public License v3.0 (AGPL-3.0)** - see the [LICENSE](LICENSE) file for details.
