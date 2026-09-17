/** 复用正式 Vite 页面和本机 Chrome 的客户端浏览器 proof 运行器。 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const clientRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CDP_COMMAND_TIMEOUT_MS = 45_000;

/** 進行中的瀏覽器 proof 清理註冊表；全域關機時逐一呼叫其 memoized teardown。 */
const activeClientBrowserProofCleanups = new Set();
let closingAllClientBrowserProofs = false;

function logProof(message) {
  process.stdout.write(`[browser-proof] ${message}\n`);
}

export function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitFor(probe, label, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    const remaining = deadline - Date.now();
    try {
      const value = await Promise.race([
        Promise.resolve().then(probe),
        delay(remaining).then(() => {
          const error = new Error(`等待${label}超时`);
          error.name = 'WaitTimeout';
          throw error;
        }),
      ]);
      if (value) return value;
    } catch (error) {
      if (error?.name === 'WaitTimeout' || Date.now() >= deadline) {
        throw new Error(`等待${label}超时${lastError ? `：${lastError.message}` : ''}`);
      }
      lastError = error;
    }
    await delay(50);
  }
  throw new Error(`等待${label}超时${lastError ? `：${lastError.message}` : ''}`);
}

/** 收集本机 Chrome/Chromium 可执行文件候选路径，覆盖 Linux 容器与 Windows 开发机。 */
export function chromeExecutableCandidates() {
  const programFiles = process.env.ProgramFiles ?? process.env.PROGRAMFILES;
  const programFilesX86 = process.env['ProgramFiles(x86)'] ?? process.env['PROGRAMFILES(X86)'];
  const localAppData = process.env.LOCALAPPDATA;
  return [
    process.env.CHROME_BIN,
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
    '/usr/lib/chromium/chromium',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/opt/google/chrome/google-chrome',
    '/opt/google/chrome/chrome',
    // Windows 开发机常见安装位置（正斜杠路径 Windows API 同样接受；Linux 上探测不到会自动跳过）。
    programFiles && `${programFiles}/Google/Chrome/Application/chrome.exe`,
    programFilesX86 && `${programFilesX86}/Google/Chrome/Application/chrome.exe`,
    localAppData && `${localAppData}/Google/Chrome/Application/chrome.exe`,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
  ].filter(Boolean);
}

async function findChromeExecutable() {
  for (const candidate of chromeExecutableCandidates()) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // 继续检查下一个本机 Chrome 路径。
    }
  }
  throw new Error('未找到可用于客户端布局 proof 的 Chrome');
}

class CdpClient {
  constructor(url) {
    this.url = url;
    this.socket = null;
    this.nextId = 1;
    this.pending = new Map();
    this.touchEmulationEnabled = false;
  }

  async connect() {
    const socket = new WebSocket(this.url);
    this.socket = socket;
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(`${message.error.code}: ${message.error.message}`));
      else pending.resolve(message.result ?? {});
    });
    socket.addEventListener('close', () => {
      for (const pending of this.pending.values()) pending.reject(new Error('Chrome CDP 连接意外关闭'));
      this.pending.clear();
    });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`连接 Chrome CDP 超时 ${CDP_COMMAND_TIMEOUT_MS}ms`)), CDP_COMMAND_TIMEOUT_MS);
      socket.addEventListener('open', () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
      socket.addEventListener('error', () => {
        clearTimeout(timer);
        reject(new Error('无法连接 Chrome CDP'));
      }, { once: true });
    });
  }

  send(method, params = {}) {
    assert(this.socket?.readyState === WebSocket.OPEN, 'Chrome CDP 尚未连接');
    const id = this.nextId;
    this.nextId += 1;
    // 超时时附带调用端堆栈，避免只看到 timer 内部帧而无法定位卡住的调用点。
    const callerStack = new Error(`Chrome CDP caller: ${method}`).stack;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Chrome CDP 超时 ${CDP_COMMAND_TIMEOUT_MS}ms：${method}\n调用端堆栈:\n${callerStack}`));
      }, CDP_COMMAND_TIMEOUT_MS);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? '浏览器表达式执行失败');
    }
    return result.result?.value;
  }

  async setTouchEmulationEnabled(enabled) {
    if (this.touchEmulationEnabled === enabled) return;
    await this.send('Emulation.setTouchEmulationEnabled', { enabled, maxTouchPoints: 5 });
    this.touchEmulationEnabled = enabled;
  }

  close() {
    this.socket?.close();
    this.socket = null;
  }
}

async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([once(child, 'exit'), delay(2_000)]);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
    await once(child, 'exit');
  }
}

async function readDevToolsPort(profileDir) {
  return waitFor(async () => {
    const content = await readFile(path.join(profileDir, 'DevToolsActivePort'), 'utf8');
    const port = Number.parseInt(content.split(/\r?\n/, 1)[0] ?? '', 10);
    return Number.isSafeInteger(port) && port > 0 ? port : null;
  }, 'Chrome 调试端口');
}

async function resolvePageTarget(port) {
  return waitFor(async () => {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`);
    if (!response.ok) return null;
    const targets = await response.json();
    return targets.find((entry) => entry.type === 'page' && entry.webSocketDebuggerUrl) ?? null;
  }, 'Chrome 页面目标');
}

/** 清理開始後不得再取得資源；若取得與清理交錯，立即回收剛取得的資源，並彙總失敗。 */
async function acquireWhileOpen(isClosing, acquire, release) {
  if (isClosing()) throw new Error('客户端浏览器 proof 已進入全域清理');
  const resource = await acquire();
  if (isClosing()) {
    const failures = [new Error('客户端浏览器 proof 已進入全域清理')];
    try {
      await release(resource);
    } catch (releaseError) {
      failures.push(releaseError);
    }
    throw new AggregateError(failures, '資源取得與全域清理交錯');
  }
  return resource;
}

/** 全域關機：等待所有進行中的瀏覽器 proof 清理結算，再彙總失敗擲出 AggregateError。 */
export async function closeAllClientBrowserProofs() {
  closingAllClientBrowserProofs = true;
  const results = await Promise.allSettled([...activeClientBrowserProofCleanups].map((cleanup) => cleanup()));
  const failures = results.filter((result) => result.status === 'rejected');
  if (failures.length > 0) {
    throw new AggregateError(failures.map((result) => result.reason), `全域清理有 ${failures.length} 項失敗`);
  }
}

export async function withClientBrowserProof({ viewport, profilePrefix, configureViteServer, initialTouch = true }, run) {
  let viteServer = null;
  let chrome = null;
  let cdp = null;
  let profileDir = null;
  let teardownPromise = null;
  let cleanupRequested = false;
  // 清理一旦被要求（本地 finally 或全域關機）即同步反映，封鎖後續資源取得。
  const isClosing = () => closingAllClientBrowserProofs || cleanupRequested;
  const ensureActive = () => {
    if (isClosing()) throw new Error('客户端浏览器 proof 已進入全域清理');
  };
  // 全域關機與本地 finally 共用同一個 memoized teardown，確保每個資源只釋放一次。
  const teardown = () => {
    cleanupRequested = true;
    teardownPromise ??= (async () => {
      const failures = [];
      try {
        // 先走 CDP 優雅關閉讓 Chrome 釋放 profile 文件鎖；Windows 上直接殺進程會殘留
        // first_party_sets.db-journal 等句柄，導致暫存目錄清理 EBUSY。
        await cdp?.send('Browser.close');
      } catch {
        // CDP 已斷開時退回進程信號方式。
      }
      cdp?.close();
      // 任一步驟失敗都不得跳過後續自有資源，最後才彙總非忽略性失敗。
      try {
        await stopChild(chrome);
      } catch (error) {
        failures.push(error);
      }
      try {
        await viteServer?.close();
      } catch (error) {
        failures.push(error);
      }
      if (profileDir) {
        try {
          await rm(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
        } catch (error) {
          // Windows 上 Crashpad 句柄釋放可能超過內建重試窗口導致 EBUSY；暫存 profile 清理
          // 屬衛生問題，不得讓已通過的 proof 判為失敗（殘留目錄交由系統 Temp 清理機制回收）。
          console.warn(`[browser-proof] 暫存 profile 清理失敗（不影響 proof 結果）：${error.code ?? error.message}`);
        }
      }
      if (failures.length > 0) {
        throw new AggregateError(failures, '瀏覽器 proof 資源清理失敗');
      }
    })().finally(() => {
      // 清理結算後才移除註冊，讓並行的全域關機等待進行中的清理。
      activeClientBrowserProofCleanups.delete(teardown);
    });
    return teardownPromise;
  };
  activeClientBrowserProofCleanups.add(teardown);
  try {
    viteServer = await acquireWhileOpen(
      isClosing,
      () => createServer({
        root: clientRoot,
        configFile: path.join(clientRoot, 'vite.config.ts'),
        logLevel: 'silent',
        server: { host: '127.0.0.1', port: 0, strictPort: false },
      }),
      (server) => server.close(),
    );
    configureViteServer?.(viteServer);
    ensureActive();
    await viteServer.listen();
    ensureActive();
    const address = viteServer.httpServer?.address();
    assert(address && typeof address === 'object', 'Vite proof 服務未取得本地端口');
    logProof(`${profilePrefix} vite :${address.port}`);

    profileDir = await acquireWhileOpen(
      isClosing,
      () => mkdtemp(path.join(os.tmpdir(), profilePrefix)),
      (dir) => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }),
    );
    chrome = await acquireWhileOpen(
      isClosing,
      async () => {
        const executable = await findChromeExecutable();
        // 探測可執行檔期間可能已完成清理；final gate 與 spawn 之間不得有 await。
        ensureActive();
        return spawn(executable, [
          // Xvfb 提供可在取消觸控模擬後恢復的滑鼠能力；Alpine headless 的基線沒有指標。
          ...(process.platform === 'linux' && process.env.DISPLAY
            ? ['--ozone-platform=x11']
            : [
              '--headless=new',
              // headless 滑鼠懸停（2）與精準指標（4）；觸控另由 CDP 模擬。
              '--blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4',
            ]),
          '--no-first-run',
          '--no-default-browser-check',
          '--disable-background-networking',
          '--disable-component-update',
          '--disable-default-apps',
          '--disable-extensions',
          '--disable-sync',
          // Docker/Xvfb 下同时打开多个 Chromium 窗口时，被遮挡的后台窗口会被节流，
          // requestAnimationFrame 不再触发，nextPaint 永不解决导致 proof 卡死。
          '--disable-backgrounding-occluded-windows',
          '--disable-renderer-backgrounding',
          '--disable-background-timer-throttling',
          // Linux 隔離 proof 使用 Mesa 軟體 Vulkan；停用 GPU 程序會連 WebGL 一起阻擋。
          ...(process.platform === 'linux' ? ['--use-angle=vulkan', '--ignore-gpu-blocklist'] : ['--disable-gpu']),
          // Docker build 默认只有 64MB /dev/shm，避免渲染器在布局 proof 中阻塞。
          '--disable-dev-shm-usage',
          '--no-sandbox',
          '--remote-debugging-port=0',
          `--user-data-dir=${profileDir}`,
          'about:blank',
        ], { stdio: 'ignore' });
      },
      (child) => stopChild(child),
    );

    logProof(`${profilePrefix} chrome pid=${chrome.pid}`);
    const debugPort = await readDevToolsPort(profileDir);
    const target = await resolvePageTarget(debugPort);
    cdp = new CdpClient(target.webSocketDebuggerUrl);
    await cdp.connect();
    logProof(`${profilePrefix} cdp connected :${debugPort}`);
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: 1,
      mobile: false,
      screenWidth: viewport.width,
      screenHeight: viewport.height,
    });
    await cdp.setTouchEmulationEnabled(initialTouch);
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${address.port}/` });
    await waitFor(
      () => cdp.evaluate(`document.readyState === 'complete' && Boolean(document.getElementById('detail-modal-body'))`),
      '正式客户端页面加载',
    );
    logProof(`${profilePrefix} page ready`);
    return await run(cdp);
  } finally {
    await teardown();
  }
}
