const maxResourceBytes = 256 * 1024;
const catalogUrl =
  "https://raw.githubusercontent.com/jincaiw/moxie/main/public/theme-catalog-v1.json";

function isThemeResourceURL(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password) return false;
  if (
    url.origin === "https://raw.githubusercontent.com" &&
    url.pathname === "/jincaiw/moxie/main/public/theme-catalog-v1.json"
  )
    return true;
  return (
    url.origin === "https://github.com" &&
    /^\/jincaiw\/moxie\/releases\/download\/v\d+\.\d+\.\d+\/theme-[a-z0-9-]+\.(?:css|svg)$/.test(
      url.pathname,
    )
  );
}

async function fetchThemeResource(value, fetchImpl = fetch) {
  if (!isThemeResourceURL(value)) throw new Error("主题资源地址不受信任。");
  const original = new URL(value);
  let current = value;
  let response;
  const signal = AbortSignal.timeout(15000);
  for (let redirects = 0; redirects <= 4; redirects++) {
    response = await fetchImpl(current, {
      redirect: "manual",
      signal,
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    const location = response.headers.get("location");
    if (!location || redirects === 4)
      throw new Error("主题资源重定向次数超出限制。");
    const next = new URL(location, current);
    const allowedRedirectHosts =
      original.hostname === "raw.githubusercontent.com"
        ? ["raw.githubusercontent.com"]
        : [
            "github.com",
            "release-assets.githubusercontent.com",
            "objects.githubusercontent.com",
          ];
    if (
      next.protocol !== "https:" ||
      !allowedRedirectHosts.includes(next.hostname)
    )
      throw new Error("主题资源跳转到了不受信任的地址。");
    current = next.href;
  }
  if (!response) throw new Error("无法获取主题资源。");
  if (!response.ok) throw new Error(`下载失败（${response.status}）。`);
  const final = new URL(response.url || current);
  if (
    final.protocol !== "https:" ||
    final.hostname !== new URL(current).hostname
  )
    throw new Error("主题资源最终地址无效。");
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxResourceBytes)
    throw new Error("主题资源超过 256 KB 限制。");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("主题资源响应为空。");
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value: chunk } = await reader.read();
    if (done) break;
    size += chunk.byteLength;
    if (size > maxResourceBytes) {
      await reader.cancel();
      throw new Error("主题资源超过 256 KB 限制。");
    }
    chunks.push(chunk);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

module.exports = { isThemeResourceURL, fetchThemeResource, maxResourceBytes };
