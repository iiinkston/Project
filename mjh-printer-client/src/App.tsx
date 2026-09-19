import { useCallback, useEffect, useState } from "react";
import { localAgent, type DiscoverHit, type LocalStatus } from "./api/localAgent";

type Tab = "dashboard" | "printer" | "logs";

function Dot({ ok }: { ok: boolean }) {
  return <span className={`dot ${ok ? "ok" : "bad"}`} aria-hidden />;
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

  const refresh = useCallback(async () => {
    try {
      await localAgent.health();
      setAgentUp(true);
      const s = await localAgent.status();
      setStatus(s);
      setIpDraft(s.printer.ip);
      setPortDraft(String(s.printer.port));
      setError(null);
    } catch (e) {
      setAgentUp(false);
      setStatus(null);
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 4000);
    return () => clearInterval(t);
  }, [refresh]);

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

  useEffect(() => {
    if (tab === "logs") void onLoadLogs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const cloudOk = Boolean(status?.cloud.online);
  const printerOk = Boolean(status?.printer.online);

  return (
    <div className="app">
      <header className="top">
        <div>
          <h1>满江红打印助手</h1>
          <p className="sub">门店厨房打印 · 控制面板</p>
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
              <Dot ok={agentUp} />
              <div>
                <div className="label">服务状态</div>
                <div className="value">{agentUp ? "运行中" : "未连接"}</div>
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
                <Dot ok={cloudOk} />
                <div>
                  <div className="label">云端</div>
                  <div className="value">{cloudOk ? "已连接" : "离线 / 未知"}</div>
                </div>
              </div>
            </section>
            <section className="card">
              <div className="row">
                <Dot ok={printerOk} />
                <div>
                  <div className="label">打印机</div>
                  <div className="value">{status?.printer.model ?? "—"}</div>
                  <div className="muted">
                    {status ? `${status.printer.ip}:${status.printer.port}` : "—"}
                  </div>
                </div>
              </div>
            </section>
            <section className="card">
              <div className="label">Agent 版本</div>
              <div className="value">{status?.version ?? "—"}</div>
              <div className="muted">{status?.build ?? ""}</div>
            </section>
          </div>

          <div className="actions">
            <button className="primary" disabled={!agentUp || !!busy} onClick={() => void onTestPrint()}>
              测试打印
            </button>
            <button disabled={!agentUp} onClick={() => setTab("printer")}>
              打印机设置
            </button>
            <button disabled={!agentUp} onClick={() => setTab("logs")}>
              查看日志
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
            <p className="hint">扫描本机网段 TCP 9100（厨房 ESC/POS）</p>
            <button disabled={!agentUp || !!busy} onClick={() => void onDiscover()}>
              扫描打印机
            </button>
            <ul className="list">
              {discovered.map((p) => (
                <li key={`${p.ip}:${p.port}`}>
                  <div>
                    <strong>{p.ip}</strong>
                    <span className="muted"> :{p.port} · ONLINE</span>
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
    </div>
  );
}
