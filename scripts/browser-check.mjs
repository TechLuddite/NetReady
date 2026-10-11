import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

// Real UI checks with controlled probe responses; never contact diagnostic targets.
const origin = 'http://127.0.0.1:4175';
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '4175', '--strictPort'], { stdio: 'pipe' });
let serverOutput = '';
server.stdout.on('data', chunk => { serverOutput += chunk; });
server.stderr.on('data', chunk => { serverOutput += chunk; });
let browser;
const errors = [];
try {
  for (let attempt = 0; ; attempt++) {
    try { if ((await fetch(origin)).ok) break; } catch { /* server is starting */ }
    if (attempt > 100 || server.exitCode !== null) throw new Error(`Preview failed: ${serverOutput}`);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  await context.addInitScript(() => {
    if (window.top !== window) return;
    localStorage.setItem('netready_responsible_networking_accepted', 'true');
    if (!localStorage.getItem('netready_history_v1')) localStorage.setItem('netready_history_v1', JSON.stringify([
      { id: 'old-route', type: 'tracert', timestamp: 1, title: 'Legacy simulated route', summary: 'Invented hops', data: {} },
      { id: 'saved-dns', type: 'dns', timestamp: 2, title: 'Saved measured DNS', summary: 'Saved diagnostic', data: {} },
    ]));
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  const requests = [];
  let geoResponse = { ip: '203.0.113.2', city: 'Example City', success: true };
  await context.route('**/*', async route => {
    const url = route.request().url();
    if (url.startsWith(origin)) return route.continue();
    requests.push(url);
    if (url.includes('cloudflare-dns.com/dns-query') || url.includes('dns.google/resolve')) return route.fulfill({ json: { Status: 0, Answer: [{ name: 'example.com.', type: 1, TTL: 60, data: '203.0.113.2' }] }, headers: { 'access-control-allow-origin': '*' } });
    if (url.startsWith('https://ipwho.is/')) return route.fulfill({ json: geoResponse, headers: { 'access-control-allow-origin': '*' } });
    return route.abort();
  });
  const dashboard = async () => {
    await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
    await page.getByRole('heading', { name: 'Recent diagnostic history' }).waitFor();
  };
  const card = title => page.locator('article').filter({ has: page.getByRole('heading', { name: title, exact: true }) });
  await page.goto(origin);
  assert.equal(await page.locator('article').count(), 18);
  assert.equal(await page.getByText('Network Readiness Score', { exact: true }).count(), 0);
  assert.equal(await page.getByText('Route Model', { exact: true }).count(), 0);
  assert.equal(await page.getByText('Legacy simulated route', { exact: true }).count(), 0);
  assert.equal(await page.getByText('Saved measured DNS', { exact: true }).count(), 1);

  await card('DNS-over-HTTPS Resolver').getByLabel('Domain', { exact: true }).fill('example.com');
  await card('DNS-over-HTTPS Resolver').getByRole('button', { name: 'Resolve', exact: true }).click();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('netready_history_v1')).some(item => item.data?.domain === 'example.com'));
  assert.equal(requests.filter(url => url.includes('name=example.com')).length, 1, 'launch runs DNS exactly once');
  assert.equal(await page.locator('main input[type=text]').inputValue(), 'example.com');
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('netready_history_v1')).some(item => item.id === 'old-route')), true, 'old records preserved in storage');
  await dashboard();
  const beforeOpen = requests.length;
  await card('DNS-over-HTTPS Resolver').getByRole('button', { name: 'Open tool', exact: true }).click();
  await page.waitForTimeout(150);
  assert.equal(requests.length, beforeOpen, 'Open tool does not reuse a launch');
  await dashboard();
  await card('DNS-over-HTTPS Resolver').getByLabel('Domain', { exact: true }).fill('second.example');
  await card('DNS-over-HTTPS Resolver').getByRole('button', { name: 'Resolve', exact: true }).click();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('netready_history_v1')).some(item => item.data?.domain === 'second.example'));
  assert.equal(requests.filter(url => url.includes('name=second.example')).length, 1);

  await dashboard();
  await card('Subnet & CIDR Calculator').getByLabel('IPv4 CIDR').fill('10.20.30.0/invalid');
  await card('Subnet & CIDR Calculator').getByRole('button', { name: 'Calculate', exact: true }).click();
  assert.equal(await page.getByRole('heading', { name: 'Recent diagnostic history' }).count(), 1, 'malformed CIDR cannot launch invalid calculations');
  await card('Subnet & CIDR Calculator').getByLabel('IPv4 CIDR').fill('10.20.30.0/28');
  await card('Subnet & CIDR Calculator').getByRole('button', { name: 'Calculate', exact: true }).click();
  assert.equal(await page.locator('main input[type=text]').inputValue(), '10.20.30.0');
  assert.match(await page.locator('main').innerText(), /10\.20\.30\.0\/28/);
  await dashboard();
  await card('MAC / OUI Lookup').getByLabel('MAC address or prefix').fill('00:1A:2B');
  await card('MAC / OUI Lookup').getByRole('button', { name: 'Look up', exact: true }).click();
  assert.equal(await page.locator('main input[type=text]').inputValue(), '00:1A:2B');

  await dashboard();
  await card('GeoIP & ISP Lookup').getByLabel('IP or hostname (optional)').fill('203.0.113.2');
  await card('GeoIP & ISP Lookup').getByRole('button', { name: 'Look up', exact: true }).click();
  await page.getByText(/Example City/).first().waitFor();
  assert.equal(requests.filter(url => url === 'https://ipwho.is/203.0.113.2').length, 1, 'GeoIP launches only requested target');
  assert.equal(await page.locator('main iframe').count(), 0, 'unknown coordinates do not show a map');
  assert.doesNotMatch(await page.locator('main').innerText(), /0\.0000|\bNO\b/);
  const geo = await page.evaluate(() => JSON.parse(localStorage.getItem('netready_history_v1')).find(item => item.type === 'geoip').data);
  assert.equal(geo.lat, null); assert.equal(geo.isVpn, null);

  geoResponse = { ...geoResponse, latitude: 0, longitude: 0, security: { proxy: false, vpn: false } };
  await page.locator('main form button[type=submit]').click();
  await page.locator('main iframe').waitFor();
  assert.match(await page.locator('main').innerText(), /0\.0000, 0\.0000/);

  // Every configurable tool keeps its primary run control in the input/settings panel.
  const layoutCases = [
    ['Ping & Jitter', /Start Ping Sequence/, 'input[type=text]'],
    ['DNS-over-HTTPS Resolver', /Resolve DNS/, 'input[type=text]'],
    ['Local Port Scanner', /Launch Scan/, 'input[type=text]'],
    ['HTTP Probe', /Probe Endpoint/, 'input[type=text]'],
    ['WebSocket Tester', /Test WebSocket Connection/, 'input[type=text]'],
    ['Edge Path Explorer', /Explore/, 'input[type=text]'],
    ['WebRTC ICE Analyzer', /Inspect ICE Candidates/, 'input[type=text], select'],
    ['Walk & Test', /Start walking/, '#walk-start-spot'],
  ];
  for (const [title, buttonName, selector] of layoutCases) {
    await dashboard();
    await card(title).getByRole('button', { name: 'Open tool', exact: true }).click();
    const input = page.locator(`main ${selector}`).last();
    const button = page.locator('main').getByRole('button', { name: buttonName }).first();
    const inputBox = await input.boundingBox(); const buttonBox = await button.boundingBox();
    assert(inputBox && buttonBox, `${title} controls visible`);
    assert(Math.abs(buttonBox.y - inputBox.y) < 320, `${title} run control beside inputs`);
  }
  await dashboard();
  const beforeGeoOpen = requests.length;
  await card('GeoIP & ISP Lookup').getByRole('button', { name: 'Open tool', exact: true }).click();
  await page.waitForTimeout(150);
  assert.equal(requests.length, beforeGeoOpen, 'opening GeoIP does not run a lookup');
  await dashboard();
  await page.evaluate(() => localStorage.removeItem('netready_responsible_networking_accepted'));
  await card('HTTP Probe').getByLabel('HTTP or HTTPS URL').fill('https://example.com/diagnostic');
  const beforeConsent = requests.length;
  await card('HTTP Probe').getByRole('button', { name: 'Probe', exact: true }).click();
  await page.getByText('Responsible Networking Warning', { exact: true }).waitFor();
  assert.equal(requests.length, beforeConsent, 'dashboard submission retains authorization gate');
  await page.getByText('I confirm that I own or have explicit authorization to scan and test target hosts.', { exact: true }).click();
  await page.getByRole('button', { name: 'Confirm & Continue', exact: true }).click();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('netready_history_v1')).some(item => item.type === 'httpprobe'));
  assert.equal(await page.locator('main input[type=text]').inputValue(), 'https://example.com/diagnostic');
  assert(requests.some(url => url.startsWith('https://example.com/diagnostic')));
  await dashboard();
  await card('Local Port Scanner').getByLabel('Host, subnet or range').fill('127.0.0.1');
  await card('Local Port Scanner').getByLabel('Ports', { exact: true }).fill('1-65535');
  const beforeInvalidScan = requests.length;
  await card('Local Port Scanner').getByRole('button', { name: 'Run test', exact: true }).click();
  await page.locator('main').getByText(/Select at most 1000/).first().waitFor();
  assert.equal(requests.length, beforeInvalidScan, 'oversized ports do not launch a partial scan');
  await dashboard();
  await context.setOffline(true);
  await card('Speed & Bandwidth').getByRole('button', { name: 'Run test', exact: true }).click();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('netready_history_v1')).some(item => item.type === 'speedtest'), { timeout: 60000 });
  const speed = await page.evaluate(() => JSON.parse(localStorage.getItem('netready_history_v1')).find(item => item.type === 'speedtest').data);
  for (const key of ['downloadSpeed', 'uploadSpeed', 'ping', 'jitter', 'bufferbloatScore']) assert.equal(speed[key], null, `offline ${key} unavailable`);
  assert(speed.failures.length > 0);
  assert.equal(errors.length, 0, errors.join('\n'));
  console.log('Browser checks passed: quick launches, history preservation, input/button placement, GeoIP unknown/zero values, offline speed measurements.');
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}
