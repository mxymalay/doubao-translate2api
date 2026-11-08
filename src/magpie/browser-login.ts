import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

// Opens Doubao in a dedicated Chromium-family browser window (its own profile, never the
// user's everyday one), waits for the user to sign in themselves, then reads the
// www.doubao.com cookies over the local DevTools port. Nothing bypasses login or captcha.

const LOGIN_URL = "https://www.doubao.com/chat/";
const REQUIRED = ["sessionid", "sid_tt", "uid_tt"];
const POLL_MS = 1500;

const CANDIDATES: Record<string, string[]> = {
  darwin: [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    join(homedir(), "Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
  ],
  win32: [
    join(process.env.PROGRAMFILES ?? "C:\\Program Files", "Google\\Chrome\\Application\\chrome.exe"),
    join(process.env["PROGRAMFILES(X86)"] ?? "C:\\Program Files (x86)", "Google\\Chrome\\Application\\chrome.exe"),
    join(process.env.LOCALAPPDATA ?? "", "Google\\Chrome\\Application\\chrome.exe"),
    join(process.env["PROGRAMFILES(X86)"] ?? "C:\\Program Files (x86)", "Microsoft\\Edge\\Application\\msedge.exe"),
  ],
  linux: ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/microsoft-edge"],
};

export function findBrowser() {
  const override = process.env.DOUBAO_LOGIN_BROWSER;
  if (override && existsSync(override)) return override;
  return (CANDIDATES[process.platform] ?? []).find(path => existsSync(path));
}

export function profileDir() {
  const base = process.platform === "darwin" ? join(homedir(), "Library", "Application Support") :
    process.platform === "win32" ? (process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local")) :
    (process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"));
  return join(base, "doubao-translate-local", "login-profile");
}

const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  const timer = setTimeout(resolve, ms);
  signal?.addEventListener("abort", () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
});

class CDP {
  private id = 0;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  private constructor(private ws: WebSocket) {
    ws.addEventListener("message", event => {
      const msg = JSON.parse(String(event.data));
      const waiter = msg.id !== undefined && this.pending.get(msg.id);
      if (!waiter) return;
      this.pending.delete(msg.id);
      if (msg.error) waiter.reject(new Error(msg.error.message ?? "DevTools error"));
      else waiter.resolve(msg.result);
    });
    ws.addEventListener("close", () => {
      for (const waiter of this.pending.values()) waiter.reject(new Error("Browser closed"));
      this.pending.clear();
    });
  }
  static connect(url: string) {
    return new Promise<CDP>((resolve, reject) => {
      const ws = new WebSocket(url);
      ws.addEventListener("open", () => resolve(new CDP(ws)), { once: true });
      ws.addEventListener("error", () => reject(new Error("Could not connect to the login browser.")), { once: true });
    });
  }
  get open() { return this.ws.readyState === WebSocket.OPEN; }
  send(method: string, params: Record<string, unknown> = {}) {
    if (!this.open) return Promise.reject(new Error("Browser closed"));
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise<any>((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  close() { try { this.ws.close(); } catch { /* already closed */ } }
}

async function devtoolsEndpoint(dir: string, child: ChildProcess, signal: AbortSignal) {
  const file = join(dir, "DevToolsActivePort");
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error("The login browser exited before it was ready. Close other windows using the Doubao login profile and try again.");
    try {
      const [port, path] = (await readFile(file, "utf8")).split("\n");
      if (port && path) return `ws://127.0.0.1:${port.trim()}${path.trim()}`;
    } catch { /* not written yet */ }
    await sleep(150, signal);
  }
  throw new Error("The login browser did not start in time.");
}

interface CdpCookie { name: string; value: string; domain: string; path: string }

function cookieHeader(cookies: CdpCookie[]) {
  // Cookies the browser would send to https://www.doubao.com/ (host + parent domains).
  const relevant = cookies.filter(c => ["www.doubao.com", ".www.doubao.com", ".doubao.com", "doubao.com"].includes(c.domain) && c.path === "/");
  const byName = new Map<string, string>();
  // More specific domain wins on duplicates.
  for (const c of relevant.sort((a, b) => a.domain.length - b.domain.length))
    if (/^[\x21-\x7e]*$/.test(c.value) && /^[\x21-\x3a\x3c\x3e-\x7e]+$/.test(c.name)) byName.set(c.name, c.value);
  if (!REQUIRED.every(name => byName.get(name))) return undefined;
  return [...byName].map(([name, value]) => `${name}=${value}`).join("; ");
}

export interface BrowserLoginOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Return true to accept the cookie, false to keep waiting (e.g. not yet valid). */
  accept?: (cookie: string) => Promise<boolean>;
}

export async function captureDoubaoCookie(options: BrowserLoginOptions = {}) {
  const executable = findBrowser();
  if (!executable) throw new Error("No Chrome, Edge, Brave or Chromium found. Install one, or use “Import Doubao Cookie”.");
  const dir = profileDir();
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await rm(join(dir, "DevToolsActivePort"), { force: true });

  const signal = AbortSignal.any([
    AbortSignal.timeout(options.timeoutMs ?? 5 * 60_000),
    ...(options.signal ? [options.signal] : []),
  ]);
  const child = spawn(executable, [
    `--user-data-dir=${dir}`,
    "--remote-debugging-port=0",
    "--remote-debugging-address=127.0.0.1",
    "--no-first-run",
    "--no-default-browser-check",
    "--new-window",
    LOGIN_URL,
  ], { stdio: "ignore", detached: false });
  child.on("error", () => { /* surfaced via exitCode checks */ });

  let cdp: CDP | undefined;
  try {
    cdp = await CDP.connect(await devtoolsEndpoint(dir, child, signal));
    let lastRejected = "";
    while (true) {
      signal.throwIfAborted();
      if (!cdp.open || child.exitCode !== null) throw new Error("The login window was closed before signing in finished.");
      const { cookies } = await cdp.send("Storage.getCookies") as { cookies: CdpCookie[] };
      const header = cookieHeader(cookies);
      if (header && header !== lastRejected) {
        if (!options.accept || await options.accept(header)) return header;
        lastRejected = header;
      }
      await sleep(POLL_MS, signal);
    }
  } catch (error) {
    if (signal.aborted && !options.signal?.aborted)
      throw new Error("Timed out waiting for Doubao sign-in in the browser.");
    throw error;
  } finally {
    try { await cdp?.send("Browser.close"); } catch { /* ignore */ }
    cdp?.close();
    setTimeout(() => { if (child.exitCode === null) child.kill(); }, 3000).unref?.();
  }
}
