import { useCallback, useEffect, useState } from "react";
import {
  localAgent,
  type DiscoverHit,
  type LocalStatus,
  type UpdateCheck,
} from "./api/localAgent";
import { Wizard } from "./wizard/Wizard";

type Tab = "dashboard" | "printer" | "logs" | "settings";

const WIZARD_DONE_KEY = "mjh_wizard_done";

function Dot({ ok }: { ok: boolean }) {
  return <span className={`dot ${ok ? "ok" : "bad"}`} aria-hidden />;
}

function formatTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

export function App() {
  const [tab, setTab] = useState<Tab>("dashboard");
  const [status, setStatus] = useState<LocalStatus | null>(null);
  const [agentUp, setAgentUp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [discovered, setDiscovered] = useState<DiscoverHit[]>([]);
  const [ipDraft, setIpDraft] = useState("");
  const [portDraft, setPortDraft] = useState("9100");
  const [toast, setToast] = useState<string | null>(null);
  const [showWizard, setShowWizard] = useState<boolean | null>(null);
  const [wizardStart, setWizardStart] = useState<1 | 3>(1);
  const [updateInfo, setUpdateInfo] = useState<UpdateCheck | null>(null);
  const [clientVersion, setClientVersion] = useState<string>("1.0.0");

  const refresh = useCallback(async () => {
    try {
      await localAgent.health();
      setAgentUp(true);
      const s = await localAgent.status();
      setStatus(s);
      setIpDraft(s.printer.ip);
      setPortDraft(String(s.printer.port));
      setError(null);
      return s;
    } catch (e) {
      setAgentUp(false);
      setStatus(null);
      setError(e instanceof Error ? e.message : String(e));
      return null;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const s = await refresh();
      if (cancelled) return;

      const done = localStorage.getItem(WIZARD_DONE_KEY) === "1";
      if (s?.bound) {
        localStorage.setItem(WIZARD_DONE_KEY, "1");
        setShowWizard(false);
        return;
      }
      if (!done || s?.bound === false) {
        setShowWizard(true);
        return;
      }
      setShowWizard(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  useEffect(() => {
    if (showWizard !== false) return;
    const t = setInterval(() => void refresh(), 4000);
    return () => clearInterval(t);
  }, [refresh, showWizard]);

  useEffect(() => {
    const baked =
      typeof __MJH_CLIENT_VERSION__ !== "undefined" ? __MJH_CLIENT_VERSION__ : "1.0.0";
    setClientVersion(baked);
    void window.mjhDesktop?.getVersion?.().then((v) => {
      if (v) setClientVersion(v);
    });
  }, []);

  useEffect(() => {
    const unsub = window.mjhDesktop?.onNavigate?.((next) => {
      if (next === "dashboard" || next === "printer" || next === "logs" || next === "settings") {
        setShowWizard(false);
        setTab(next);
      }
    });
    return () => {
      if (typeof unsub === "function") unsub();
    };
  }, []);

  function onWizardComplete() {
    localStorage.setItem(WIZARD_DONE_KEY, "1");
    setWizardStart(1);
    setShowWizard(false);
    void refresh();
  }

  function openRebind() {
    setWizardStart(3);
    setShowWizard(true);
  }

  async function onTestPrint() {
    setBusy("正在测试打印…");
    setToast(null);
    try {
      const r = await localAgent.testPrint();
      setToast(r.ok ? "测试打印已发送" : r.error || "打印失败");
      await refresh();
    } catch (e) {
      setToast(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function onDiscover() {
    setBusy("正在扫描局域网 :9100…");
    setToast(null);
    try {
      const r = await localAgent.discover();
      setDiscovered(r.printers);
      setToast(`扫描完成：${r.subnet}，发现 ${r.printers.length} 台`);
    } catch (e) {
      setToast(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function onUsePrinter(ip: string, port: number) {
    setBusy("正在保存打印机…");
    try {
      const r = await localAgent.setPrinter(ip, port);
      setToast(r.ok ? r.message || "已保存" : r.error || "保存失败");
      await refresh();
      setTab("dashboard");
    } catch (e) {
      setToast(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function onSaveIp() {
    await onUsePrinter(ipDraft.trim(), Number(portDraft) || 9100);
  }

  async function onLoadLogs() {
    setBusy("加载日志…");
    try {
      const r = await localAgent.logs(100);
      setLogs(r.logs);
      setError(null);
    } catch (e) {
      setToast(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function onCheckUpdate() {
    setBusy("正在检查更新…");
    setToast(null);
    try {
      const info = await localAgent.checkUpdate();
      setUpdateInfo(info);
      setToast(
        info.updateAvailable
          ? `发现新版本 ${info.latestVersion}`
          : `已是最新（${info.currentVersion}）`,
      );
    } catch (e) {
      setToast(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function onApplyUpdate() {
    setBusy("正在启动 Agent 更新…");
    setToast(null);
    try {
      const r = await localAgent.applyUpdate();
      setToast(r.ok ? r.message || "更新已启动，请稍候" : r.error || "更新失败");
      // Agent restarts — poll until back
      setTimeout(() => void refresh(), 8000);
    } catch (e) {
      setToast(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  useEffect(() => {
    if (tab === "logs") void onLoadLogs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  if (showWizard === null) {
    return (
      <div className="app">
        <p className="muted">正在连接本机 Agent…</p>
      </div>
    );
  }

  if (showWizard) {
    return <Wizard onComplete={onWizardComplete} initialStep={wizardStart} />;
  }

  const cloudOk = Boolean(status?.cloud.online);
  const printerOk = Boolean(status?.printer.online);
  const bound = Boolean(status?.bound);
  const running = Boolean(agentUp && status?.running);

  return (
    <div className="app">
      <header className="top">
        <div>
          <h1>满江红打印助手</h1>
          <p className="sub">
            门店厨房打印 · 控制面板
            {status?.storeName ? ` · ${status.storeName}` : ""}
          </p>
        </div>
        <nav className="nav">
          <button className={tab === "dashboard" ? "active" : ""} onClick={() => setTab("dashboard")}>
            首页
          </button>
          <button className={tab === "printer" ? "active" : ""} onClick={() => setTab("printer")}>
            打印机
          </button>
          <button className={tab === "logs" ? "active" : ""} onClick={() => setTab("logs")}>
            日志
          </button>
          <button className={tab === "settings" ? "active" : ""} onClick={() => setTab("settings")}>
            设置
          </button>
        </nav>
      </header>

      {toast && (
        <div className="toast" role="status">
          {toast}
          <button type="button" onClick={() => setToast(null)}>
            ×
          </button>
        </div>
      )}
      {busy && <div className="busy">{busy}</div>}

      {tab === "dashboard" && (
        <main className="panel">
          <section className="card hero">
            <div className="row">
              <Dot ok={running} />
              <div>
                <div className="label">Agent 运行状态</div>
                <div className="value">{running ? "运行中" : "未连接"}</div>
                <div className="muted">
                  版本 {status?.version ?? "—"}
                  {status?.build ? ` · ${status.build}` : ""}
                  {status?.pid ? ` · PID ${status.pid}` : ""}
                </div>
              </div>
            </div>
            {!agentUp && (
              <p className="hint">
                无法连接本机 Agent（127.0.0.1:17890）。请确认「MJH Printer Agent」计划任务已启动。
                {error ? `（${error}）` : ""}
              </p>
            )}
          </section>

          <div className="grid">
            <section className="card">
              <div className="row">
                <Dot ok={bound} />
                <div>
                  <div className="label">绑定门店</div>
                  <div className="value">{bound ? status?.storeName || "已绑定" : "未绑定"}</div>
                  <div className="muted">{bound ? "已绑定，可重新绑定" : "请完成向导配对"}</div>
                </div>
              </div>
            </section>
            <section className="card">
              <div className="row">
                <Dot ok={cloudOk} />
                <div>
                  <div className="label">Cloud 连接</div>
                  <div className="value">{cloudOk ? "已连接" : "离线 / 未知"}</div>
                </div>
              </div>
            </section>
            <section className="card">
              <div className="row">
                <Dot ok={printerOk} />
                <div>
                  <div className="label">打印机连接</div>
                  <div className="value">{status?.printer.model ?? "—"}</div>
                  <div className="muted">
                    {status ? `${status.printer.ip}:${status.printer.port}` : "—"}
                    {printerOk ? " · 在线" : " · 离线"}
                  </div>
                </div>
              </div>
            </section>
          </div>

          <section className="card">
            <div className="label">最近同步</div>
            <div className="value">{formatTime(status?.lastSyncAt)}</div>
            <div className="muted">
              轮询 {formatTime(status?.worker.lastPollAt)} · 领取{" "}
              {formatTime(status?.worker.lastClaimAt)}
            </div>
            {status?.worker.lastError && (
              <p className="hint">最近错误：{status.worker.lastError}</p>
            )}
          </section>

          <div className="actions">
            <button className="primary" disabled={!agentUp || !!busy} onClick={() => void onTestPrint()}>
              测试打印
            </button>
            <button disabled={!agentUp} onClick={() => setTab("printer")}>
              打印机设置
            </button>
            <button disabled={!agentUp} onClick={openRebind}>
              重新绑定
            </button>
            <button disabled={!agentUp} onClick={() => setTab("settings")}>
              检查更新
            </button>
            <button disabled={!!busy} onClick={() => void refresh()}>
              刷新
            </button>
          </div>
        </main>
      )}

      {tab === "printer" && (
        <main className="panel">
          <section className="card">
            <h2>当前打印机</h2>
            <label className="field">
              <span>IP</span>
              <input value={ipDraft} onChange={(e) => setIpDraft(e.target.value)} />
            </label>
            <label className="field">
              <span>端口</span>
              <input value={portDraft} onChange={(e) => setPortDraft(e.target.value)} />
            </label>
            <button className="primary" disabled={!agentUp || !!busy} onClick={() => void onSaveIp()}>
              保存
            </button>
          </section>

          <section className="card">
            <h2>自动发现</h2>
            <p className="hint">扫描本机网段 TCP 9100（厨房 ESC/POS · XP-N160II）</p>
            <button disabled={!agentUp || !!busy} onClick={() => void onDiscover()}>
              扫描打印机
            </button>
            <ul className="list">
              {discovered.map((p) => (
                <li key={`${p.ip}:${p.port}`}>
                  <div>
                    <strong>{p.ip}</strong>
                    <span className="muted"> :{p.port} · ONLINE · XP-N160II</span>
                  </div>
                  <button disabled={!!busy} onClick={() => void onUsePrinter(p.ip, p.port)}>
                    使用此打印机
                  </button>
                </li>
              ))}
              {discovered.length === 0 && <li className="muted">尚未发现设备</li>}
            </ul>
          </section>
        </main>
      )}

      {tab === "logs" && (
        <main className="panel">
          <section className="card">
            <div className="row between">
              <h2>最近日志</h2>
              <button disabled={!agentUp || !!busy} onClick={() => void onLoadLogs()}>
                刷新日志
              </button>
            </div>
            <pre className="logs">{logs.length ? logs.join("\n") : "（空）"}</pre>
          </section>
        </main>
      )}

      {tab === "settings" && (
        <main className="panel">
          <section className="card">
            <h2>关于</h2>
            <div className="label">Client 版本</div>
            <div className="value">{clientVersion}</div>
            <div className="muted">MJH Printer Client · Control Plane</div>
            <div className="label" style={{ marginTop: 12 }}>
              Agent 版本
            </div>
            <div className="value">{status?.version ?? "—"}</div>
            <div className="muted">{status?.build ?? ""}</div>
          </section>

          <section className="card">
            <h2>Agent 更新</h2>
            <p className="hint">
              通过本机 Agent API 检查与安装更新。Client 不会自行复制 EXE。
            </p>
            <div className="grid" style={{ marginTop: 12 }}>
              <div>
                <div className="label">当前版本</div>
                <div className="value">
                  {updateInfo?.currentVersion ?? status?.version ?? "—"}
                </div>
              </div>
              <div>
                <div className="label">最新版本</div>
                <div className="value">{updateInfo?.latestVersion ?? "—"}</div>
              </div>
            </div>
            {updateInfo?.notes && (
              <div style={{ marginTop: 12 }}>
                <div className="label">更新说明</div>
                <p className="sub">{updateInfo.notes}</p>
              </div>
            )}
            <div className="actions" style={{ marginTop: 16 }}>
              <button
                className="primary"
                disabled={!agentUp || !!busy}
                onClick={() => void onCheckUpdate()}
              >
                检查更新
              </button>
              <button
                disabled={!agentUp || !!busy || !updateInfo?.updateAvailable}
                onClick={() => void onApplyUpdate()}
              >
                立即更新
              </button>
            </div>
          </section>
        </main>
      )}
    </div>
  );
}
