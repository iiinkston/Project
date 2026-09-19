import net from "node:net";
import type { PrinterConfig } from "../config.js";

export class PrinterClient {
  private socket: net.Socket | null = null;
  private readonly host: string;
  private readonly port: number;
  private readonly connectTimeoutMs: number;

  constructor(config: PrinterConfig) {
    this.host = config.ip;
    this.port = config.port;
    this.connectTimeoutMs = config.connectTimeoutMs;
  }

  async connect(): Promise<void> {
    if (this.socket) {
      throw new Error("Printer socket is already connected");
    }

    const socket = new net.Socket();
    this.socket = socket;

    try {
      await new Promise<void>((resolve, reject) => {
        let settled = false;

        const fail = (error: Error) => {
          if (settled) {
            return;
          }
          settled = true;
          cleanupListeners();
          socket.destroy();
          this.socket = null;
          reject(error);
        };

        const succeed = () => {
          if (settled) {
            return;
          }
          settled = true;
          cleanupListeners();
          resolve();
        };

        const onTimeout = () => {
          fail(
            this.toFriendlyError(
              Object.assign(new Error("connect ETIMEDOUT"), { code: "ETIMEDOUT" }),
            ),
          );
        };

        const onError = (error: Error) => {
          fail(this.toFriendlyError(error));
        };

        const cleanupListeners = () => {
          socket.off("connect", succeed);
          socket.off("error", onError);
          socket.off("timeout", onTimeout);
          socket.setTimeout(0);
        };

        socket.setTimeout(this.connectTimeoutMs);
        socket.once("connect", succeed);
        socket.once("error", onError);
        socket.once("timeout", onTimeout);

        socket.connect(this.port, this.host);
      });
    } catch (error) {
      this.socket = null;
      throw error;
    }
  }

  /**
   * Send bytes and resolve only after Node reports the chunk flushed
   * to the OS (write callback), waiting for drain when backpressured.
   */
  async send(buffer: Buffer): Promise<void> {
    const socket = this.socket;
    if (!socket || socket.destroyed) {
      throw new Error("Printer is not connected");
    }

    await new Promise<void>((resolve, reject) => {
      let settled = false;

      const finish = (error?: Error) => {
        if (settled) {
          return;
        }
        settled = true;
        socket.off("error", onError);
        if (error) {
          reject(this.toFriendlyError(error));
          return;
        }
        resolve();
      };

      const onError = (error: Error) => {
        finish(error);
      };

      socket.once("error", onError);

      const accepted = socket.write(buffer, (error) => {
        if (error) {
          finish(error);
          return;
        }

        // Callback = this write has been flushed to the kernel.
        // If write() returned false, also wait for drain.
        if (accepted) {
          finish();
          return;
        }

        socket.once("drain", () => finish());
      });
    });
  }

  async close(): Promise<void> {
    const socket = this.socket;
    this.socket = null;

    if (!socket || socket.destroyed) {
      return;
    }

    await new Promise<void>((resolve) => {
      let finished = false;
      const finish = () => {
        if (finished) {
          return;
        }
        finished = true;
        resolve();
      };

      socket.once("close", finish);
      socket.once("error", finish);
      socket.end();

      setTimeout(() => {
        if (!socket.destroyed) {
          socket.destroy();
        }
        finish();
      }, 1000).unref();
    });
  }

  async testConnection(): Promise<boolean> {
    const probe = new net.Socket();

    try {
      await new Promise<void>((resolve, reject) => {
        let settled = false;

        const fail = (error: Error) => {
          if (settled) {
            return;
          }
          settled = true;
          cleanupListeners();
          probe.destroy();
          reject(error);
        };

        const succeed = () => {
          if (settled) {
            return;
          }
          settled = true;
          cleanupListeners();
          resolve();
        };

        const onTimeout = () => {
          fail(
            this.toFriendlyError(
              Object.assign(new Error("connect ETIMEDOUT"), { code: "ETIMEDOUT" }),
            ),
          );
        };

        const onError = (error: Error) => {
          fail(this.toFriendlyError(error));
        };

        const cleanupListeners = () => {
          probe.off("connect", succeed);
          probe.off("error", onError);
          probe.off("timeout", onTimeout);
          probe.setTimeout(0);
        };

        probe.setTimeout(this.connectTimeoutMs);
        probe.once("connect", succeed);
        probe.once("error", onError);
        probe.once("timeout", onTimeout);
        probe.connect(this.port, this.host);
      });

      await new Promise<void>((resolve) => {
        let finished = false;
        const finish = () => {
          if (finished) {
            return;
          }
          finished = true;
          resolve();
        };

        probe.once("close", finish);
        probe.end();
        setTimeout(() => {
          if (!probe.destroyed) {
            probe.destroy();
          }
          finish();
        }, 500).unref();
      });

      return true;
    } catch (error) {
      if (!probe.destroyed) {
        probe.destroy();
      }
      throw error;
    }
  }

  private toFriendlyError(error: Error): Error {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? String((error as NodeJS.ErrnoException).code)
        : undefined;

    let friendly: string;
    switch (code) {
      case "ECONNREFUSED":
        friendly = "Printer refused TCP connection";
        break;
      case "ETIMEDOUT":
      case "TIMEOUT":
        friendly = "Printer connection timed out";
        break;
      case "ENETUNREACH":
      case "EHOSTUNREACH":
        friendly = "Printer network is unreachable";
        break;
      default:
        friendly = "Printer communication failed";
        break;
    }

    const technical = error.message || String(error);
    const codePart = code ? ` [${code}]` : "";
    return new Error(`${friendly}${codePart}\n${technical}`);
  }
}
