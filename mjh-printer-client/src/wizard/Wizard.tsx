import { useCallback, useEffect, useState } from "react";
import { localAgent, type DiscoverHit } from "../api/localAgent";

type Step = 1 | 2 | 3 | 4 | 5;

type Props = {
  onComplete: () => void;
  initialStep?: Step;
};

type CheckState = "idle" | "checking" | "pass" | "fail";

function Badge({ state }: { state: CheckState }) {
  if (state === "checking" || state === "idle") {
    return <span className="wiz-badge pending">检测中</span>;
  }
  if (state === "pass") {
    return <span className="wiz-badge pass">PASS</span>;
  }
  return <span className="wiz-badge fail">FAIL</span>;
}

export function Wizard({ onComplete, initialStep = 1 }: Props) {
  const [step, setStep] = useState<Step>(initialStep);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [apiOk, setApiOk] = useState<CheckState>("idle");
  const [netOk, setNetOk] = useState<CheckState>("idle");
  const [printerOk, setPrinterOk] = useState<CheckState>("idle");

  const [code, setCode] = useState("");
  const [boundStore, setBoundStore] = useState<string | null>(null);
  const [agentConnected, setAgentConnected] = useState(false);

  const [discovered, setDiscovered] = useState<DiscoverHit[]>([]);
  const [printerSet, setPrinterSet] = useState(false);

  const runEnvCheck = useCallback(async () => {
    setApiOk("checking");
    setNetOk("checking");
    setPrinterOk("checking");
    setError(null);

    try {
      await localAgent.health();
      setApiOk("pass");
    } catch {
      setApiOk("fail");
      setNetOk("fail");
      setPrinterOk("fail");
      return;
    }

    try {
      const s = await localAgent.status();
      // 网络：status 可成功拉取即 PASS
      setNetOk("pass");
      setPrinterOk(s.printer.online ? "pass" : "fail");
    } catch {
      setNetOk("fail");
      setPrinterOk("fail");
    }
  }, []);

  useEffect(() => {
    if (step !== 2) return;
    void runEnvCheck();
    const t = setInterval(() => void runEnvCheck(), 3000);
    return () => clearInterval(t);
  }, [step, runEnvCheck]);

  async function onBind() {
    const value = code.trim();
    if (!value) {
      setError("请输入门店注册码");
      return;
    }
    // 已绑定也可以再次提交同一长期注册码，不拦截 already bound。
    setBusy("正在绑定门店…");
    setError(null);
    try {
      const r = await localAgent.bind(value);
      setBoundStore(r.storeName);
      try {
        await localAgent.status();
        setAgentConnected(true);
      } catch {
        setAgentConnected(false);
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : "";
      setError(message && message !== "[object Object]" ? message : "注册码无效，请检查后重试");
    } finally {
      setBusy(null);
    }
  }

  function resetBindForm() {
    setBoundStore(null);
    setAgentConnected(false);
    setError(null);
  }

  async function onDiscover() {
    setBusy("正在扫描局域网…");
    setError(null);
    try {
      const r = await localAgent.discover();
      setDiscovered(r.printers);
      if (r.printers.length === 0) {
        setError("未发现打印机，可稍后在控制面板中重试");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function onUsePrinter(ip: string, port: number) {
    setBusy("正在保存打印机…");
    setError(null);
    try {
      const r = await localAgent.setPrinter(ip, port);
      if (!r.ok) throw new Error(r.error || "保存失败");
      setPrinterSet(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function onTestPrint() {
    setBusy("正在测试打印…");
    setError(null);
    try {
      const r = await localAgent.testPrint();
      if (!r.ok) throw new Error(r.error || "测试打印失败");
      onComplete();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  useEffect(() => {
    if (step === 4 && discovered.length === 0 && !busy) {
      void onDiscover();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  return (
    <div className="wizard">
      <div className="wizard-shell">
        <div className="wizard-progress">
          {[1, 2, 3, 4, 5].map((n) => (
            <span key={n} className={`wiz-step-dot ${step === n ? "current" : ""} ${step > n ? "done" : ""}`} />
          ))}
          <span className="wiz-step-label">步骤 {step} / 5</span>
        </div>

        {busy && <div className="busy">{busy}</div>}
        {error && (
          <div className="toast" role="alert">
            {error}
            <button type="button" onClick={() => setError(null)}>
              ×
            </button>
          </div>
        )}

        {step === 1 && (
          <section className="card wizard-card">
            <p className="wiz-eyebrow">满江红 · 厨房打印</p>
            <h1>欢迎使用满江红打印助手</h1>
            <p className="sub">
              本向导：检测 Agent → 输入门店注册码 → 绑定门店 → 扫描打印机 → 选择 XP-N160II →
              测试打印 → 进入控制台。全程无需 PowerShell。
            </p>
            <div className="actions">
              <button className="primary" type="button" onClick={() => setStep(2)}>
                开始配置
              </button>
            </div>
          </section>
        )}

        {step === 2 && (
          <section className="card wizard-card">
            <h1>检测 Agent</h1>
            <p className="sub">确认本机打印服务 Local API（127.0.0.1:17890）可用。</p>
            <ul className="wiz-checks">
              <li>
                <div>
                  <div className="label">Agent Local API</div>
                  <div className="muted">127.0.0.1:17890</div>
                </div>
                <Badge state={apiOk} />
              </li>
              <li>
                <div>
                  <div className="label">网络</div>
                  <div className="muted">status 可访问</div>
                </div>
                <Badge state={netOk} />
              </li>
              <li>
                <div>
                  <div className="label">打印机在线</div>
                  <div className="muted">厨房 ESC/POS</div>
                </div>
                <Badge state={printerOk} />
              </li>
            </ul>
            <div className="actions">
              <button type="button" onClick={() => void runEnvCheck()} disabled={!!busy}>
                重新检测
              </button>
              <button
                className="primary"
                type="button"
                disabled={apiOk !== "pass"}
                onClick={() => setStep(3)}
              >
                继续
              </button>
            </div>
          </section>
        )}

        {step === 3 && (
          <section className="card wizard-card">
            <h1>绑定门店</h1>
            <p className="sub">请输入总部提供的门店注册码。</p>
            {boundStore ? (
              <>
                <div className="wiz-success">
                  <div className="label">绑定成功</div>
                  <ul className="wiz-result">
                    <li>✓ {boundStore}</li>
                    <li>{agentConnected ? "✓ 打印服务已连接" : "打印服务未连接"}</li>
                  </ul>
                </div>
                <div className="actions">
                  <button type="button" onClick={resetBindForm}>
                    重新绑定
                  </button>
                  <button className="primary" type="button" onClick={() => setStep(4)}>
                    继续
                  </button>
                </div>
              </>
            ) : (
              <>
                <label className="field">
                  <span>门店注册码</span>
                  <input
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder="例如 MJH-001"
                    autoComplete="off"
                    spellCheck={false}
                  />
                </label>
                <div className="actions">
                  <button type="button" onClick={() => setStep(2)}>
                    上一步
                  </button>
                  <button
                    className="primary"
                    type="button"
                    disabled={!!busy || !code.trim()}
                    onClick={() => void onBind()}
                  >
                    绑定
                  </button>
                </div>
              </>
            )}
          </section>
        )}

        {step === 4 && (
          <section className="card wizard-card">
            <h1>选择打印机</h1>
            <p className="sub">扫描本机网段 TCP 9100，选择厨房 XP-N160II。</p>
            <div className="actions" style={{ marginBottom: 12 }}>
              <button type="button" disabled={!!busy} onClick={() => void onDiscover()}>
                重新扫描
              </button>
            </div>
            <ul className="list">
              {discovered.map((p) => (
                <li key={`${p.ip}:${p.port}`}>
                  <div>
                    <strong>{p.ip}</strong>
                    <span className="muted"> :{p.port} · ONLINE · XP-N160II</span>
                  </div>
                  <button
                    className="primary"
                    type="button"
                    disabled={!!busy}
                    onClick={() => void onUsePrinter(p.ip, p.port)}
                  >
                    使用此打印机
                  </button>
                </li>
              ))}
              {discovered.length === 0 && <li className="muted">尚未发现设备</li>}
            </ul>
            {printerSet && (
              <div className="wiz-success" style={{ marginTop: 14 }}>
                <div className="value">打印机已保存</div>
              </div>
            )}
            <div className="actions" style={{ marginTop: 16 }}>
              <button type="button" onClick={() => setStep(3)}>
                上一步
              </button>
              <button
                className="primary"
                type="button"
                disabled={!printerSet}
                onClick={() => setStep(5)}
              >
                继续
              </button>
            </div>
          </section>
        )}

        {step === 5 && (
          <section className="card wizard-card">
            <h1>测试打印</h1>
            <p className="sub">向厨房打印机发送一张测试页，确认链路畅通。</p>
            <div className="actions">
              <button type="button" onClick={() => setStep(4)}>
                上一步
              </button>
              <button
                className="primary"
                type="button"
                disabled={!!busy}
                onClick={() => void onTestPrint()}
              >
                发送测试打印并进入控制台
              </button>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
