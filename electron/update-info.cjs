function mergeMacUpdateInfo(arm64Info, x64Info) {
  if (!arm64Info || !x64Info || arm64Info.version !== x64Info.version)
    throw Error("arm64 与 x64 更新清单版本必须一致。");
  const files = [...(arm64Info.files || []), ...(x64Info.files || [])];
  const urls = new Set(files.map((file) => file.url));
  if (
    ![...urls].some((url) => /arm64.*\.zip$/i.test(url)) ||
    ![...urls].some((url) => /x64.*\.zip$/i.test(url))
  )
    throw Error("更新清单必须同时包含 arm64 和 x64 ZIP 安装包。");
  const { path: _path, sha512: _sha512, ...compatibleInfo } = arm64Info;
  return {
    ...compatibleInfo,
    files,
    releaseDate: arm64Info.releaseDate || x64Info.releaseDate,
  };
}

module.exports = { mergeMacUpdateInfo };
