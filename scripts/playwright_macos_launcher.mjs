import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const LOOPBACK = "127.0.0.1";

async function reserveLoopbackPort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, LOOPBACK, resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  return address.port;
}

async function waitForEndpoint(endpoint, expectedUp) {
  let lastError;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`${endpoint}/json/version`, {
        signal: AbortSignal.timeout(1_000),
      });
      if (response.ok === expectedUp) return;
      if (!expectedUp) lastError = new Error(`endpoint still returned ${response.status}`);
    } catch (error) {
      if (!expectedUp) return;
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw lastError || new Error(`CDP endpoint did not become ${expectedUp ? "ready" : "closed"}`);
}

export async function launchTestBrowser({ executablePath } = {}) {
  if (process.env.YW_PLAYWRIGHT_LAUNCHSERVICES !== "1") {
    const browser = await chromium.launch({
      ...(executablePath ? { executablePath } : {}),
      headless: true,
    });
    return {
      browser,
      close: () => browser.close(),
      launcher: "playwright-direct",
    };
  }

  assert.equal(process.platform, "darwin", "LaunchServices browser mode is macOS-only");
  const profileRoot = process.env.YW_PLAYWRIGHT_PROFILE_ROOT;
  assert.ok(profileRoot && path.isAbsolute(profileRoot), "YW_PLAYWRIGHT_PROFILE_ROOT must be absolute");
  mkdirSync(profileRoot, { recursive: true, mode: 0o700 });
  const profile = mkdtempSync(path.join(profileRoot, "brave-"));
  const port = await reserveLoopbackPort();
  const endpoint = `http://${LOOPBACK}:${port}`;

  try {
    execFileSync("/usr/bin/open", [
      "-na",
      process.env.YW_PLAYWRIGHT_APP_NAME || "Brave Browser",
      "--args",
      "--headless=new",
      `--remote-debugging-address=${LOOPBACK}`,
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-networking",
      "--disable-component-update",
      "--disable-sync",
      "--disable-extensions",
      "about:blank",
    ], { stdio: "ignore", timeout: 15_000 });
    await waitForEndpoint(endpoint, true);
    const browser = await chromium.connectOverCDP(endpoint);
    return {
      browser,
      launcher: "macos-launchservices-cdp",
      close: async () => {
        const session = await browser.newBrowserCDPSession();
        try {
          await session.send("Browser.close");
        } catch (error) {
          if (!/target closed|connection closed|browser has been closed/i.test(error.message)) {
            throw error;
          }
        }
        await waitForEndpoint(endpoint, false);
        rmSync(profile, { recursive: true, force: false });
      },
    };
  } catch (error) {
    rmSync(profile, { recursive: true, force: true });
    throw error;
  }
}
