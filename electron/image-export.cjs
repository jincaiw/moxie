const path = require("node:path");
const { randomUUID } = require("node:crypto");

const MAX_HTML_BYTES = 30 * 1024 * 1024;
const MAX_IMAGE_BYTES = 35 * 1024 * 1024;
const MAX_PIXELS = 50 * 1000 * 1000;
const CAPTURE_HEIGHT = 2048;

async function exportDocumentAsSVG({
  html,
  name,
  parent,
  BrowserWindow,
  dialog,
  atomicWrite,
}) {
  if (
    typeof html !== "string" ||
    !html.trim() ||
    Buffer.byteLength(html) > MAX_HTML_BYTES
  )
    throw Error("图片导出内容为空或超过 30 MB 限制");
  const baseName = path
    .basename(String(name || "文档"))
    .replace(/\.[^.]+$/, "");
  const result = await dialog.showSaveDialog(parent, {
    defaultPath: `${baseName || "文档"}.svg`,
    filters: [{ name: "长图 SVG", extensions: ["svg"] }],
  });
  if (result.canceled || !result.filePath) return null;

  const view = new BrowserWindow({
    show: false,
    width: 1800,
    height: CAPTURE_HEIGHT,
    useContentSize: true,
    webPreferences: {
      partition: `moxie-image-export-${randomUUID()}`,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  try {
    const csp =
      "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:\">";
    const isolatedHTML = /<head\b[^>]*>/i.test(html)
      ? html.replace(/<head\b[^>]*>/i, (head) => head + csp)
      : `<!doctype html><html><head>${csp}</head><body>${html}</body></html>`;
    view.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    view.webContents.session.webRequest.onBeforeRequest(
      { urls: ["http://*/*", "https://*/*"] },
      (_details, callback) => callback({ cancel: true }),
    );
    await view.loadURL(
      `data:text/html;base64,${Buffer.from(isolatedHTML, "utf8").toString("base64")}`,
    );
    const dimensions = await view.webContents.executeJavaScript(`(async () => {
      await document.fonts.ready;
      await Promise.all(Array.from(document.images, image => image.decode()));
      return {
        width: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
        height: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight)
      };
    })()`);
    const { width, height } = dimensions || {};
    if (
      !Number.isInteger(width) ||
      !Number.isInteger(height) ||
      width < 1 ||
      height < 1 ||
      width > 1800 ||
      width * height > MAX_PIXELS
    )
      throw Error("长图尺寸超出限制；请缩小导出正文宽度或拆分文档。");

    const parts = [];
    let byteLength = 0;
    for (let y = 0; y < height; y += CAPTURE_HEIGHT) {
      const sliceHeight = Math.min(CAPTURE_HEIGHT, height - y);
      await view.webContents.executeJavaScript(`new Promise(resolve => {
        window.scrollTo(0, ${y});
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      })`);
      const image = await view.webContents.capturePage({
        x: 0,
        y: 0,
        width,
        height: sliceHeight,
      });
      const png = image.toPNG();
      byteLength += png.length;
      if (byteLength > MAX_IMAGE_BYTES)
        throw Error("图片数据超过 35 MB，已取消导出以限制内存用量。");
      parts.push(
        `<image x="0" y="${y}" width="${width}" height="${sliceHeight}" href="data:image/png;base64,${png.toString("base64")}"/>`,
      );
    }
    const svg = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${parts.join("")}</svg>`,
    );
    await atomicWrite(result.filePath, svg);
    return result.filePath;
  } finally {
    if (!view.isDestroyed()) view.destroy();
  }
}

module.exports = { exportDocumentAsSVG };
