function describeUpdateError(error) {
  const detail = error instanceof Error ? error.message : String(error || "");
  if (/sign|code.?sign|certificate/i.test(detail))
    return "此安装包未签名，macOS 暂不允许自动更新。请下载新版安装包。";
  if (/network|timeout|ENOTFOUND|ECONN|status code 404/i.test(detail))
    return "无法连接更新服务，请检查网络后重试。";
  return detail.slice(0, 400) || "检查更新失败，请稍后重试。";
}

class UpdateController {
  constructor({ updater, supported, hasUnsavedChanges, onStatus }) {
    this.updater = updater;
    this.supported = supported;
    this.hasUnsavedChanges = hasUnsavedChanges;
    this.onStatus = onStatus;
    this.value = supported
      ? { status: "idle" }
      : {
          status: "unsupported",
          message: "自动更新仅适用于已安装的 macOS 桌面版。",
        };

    if (!supported) return;
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
    updater.allowPrerelease = false;
    updater.allowDowngrade = false;
    updater.on("checking-for-update", () =>
      this.publish({ status: "checking" }),
    );
    updater.on("update-available", (info) =>
      this.publish({ status: "available", version: info.version }),
    );
    updater.on("update-not-available", (info) =>
      this.publish({ status: "not-available", version: info.version }),
    );
    updater.on("download-progress", (progress) =>
      this.publish({
        status: "downloading",
        percent: Math.max(0, Math.min(100, progress.percent || 0)),
      }),
    );
    updater.on("update-downloaded", (info) =>
      this.publish({ status: "downloaded", version: info.version }),
    );
    updater.on("error", (error) =>
      this.publish({ status: "error", message: describeUpdateError(error) }),
    );
  }

  publish(value) {
    this.value = value;
    this.onStatus?.({ ...value });
  }

  getStatus() {
    return { ...this.value };
  }

  async check() {
    if (!this.supported) return this.getStatus();
    this.publish({ status: "checking" });
    try {
      await this.updater.checkForUpdates();
    } catch (error) {
      this.publish({ status: "error", message: describeUpdateError(error) });
    }
    return this.getStatus();
  }

  async download() {
    if (!this.supported) return this.getStatus();
    if (this.value.status !== "available")
      throw Error("当前没有可下载的更新。");
    this.publish({ status: "downloading", percent: 0 });
    try {
      await this.updater.downloadUpdate();
    } catch (error) {
      this.publish({ status: "error", message: describeUpdateError(error) });
    }
    return this.getStatus();
  }

  install() {
    if (!this.supported) return this.getStatus();
    if (this.hasUnsavedChanges())
      throw Error("文档尚未保存。请先保存或保留恢复副本，再安装更新。");
    if (this.value.status !== "downloaded") throw Error("更新尚未下载完成。");
    this.updater.quitAndInstall(false, true);
    return this.getStatus();
  }
}

module.exports = { UpdateController, describeUpdateError };
