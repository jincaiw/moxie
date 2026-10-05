function mergeMacUpdateInfo(arm64Info, x64Info) {
  if (!arm64Info || !x64Info || arm64Info.version !== x64Info.version)
    throw Error("arm64 与 x64 更新清单版本必须一致。");
  const filesForArchitecture = (info, architecture) =>
    (info.files || []).filter((file) =>
      new RegExp(`-${architecture}\\.(?:zip|dmg)$`, "i").test(file.url || ""),
    );
  const files = [
    ...filesForArchitecture(arm64Info, "arm64"),
    ...filesForArchitecture(x64Info, "x64"),
  ];
  const urls = new Set(files.map((file) => file.url));
  if (
    urls.size !== files.length ||
    ![...urls].some((url) => /-arm64\.zip$/i.test(url)) ||
    ![...urls].some((url) => /-x64\.zip$/i.test(url))
  )
    throw Error("更新清单必须包含唯一且正确架构的 arm64 和 x64 ZIP 安装包。");
  const { path: _path, sha512: _sha512, ...compatibleInfo } = arm64Info;
  return {
    ...compatibleInfo,
    files,
    releaseDate: arm64Info.releaseDate || x64Info.releaseDate,
  };
}

module.exports = { mergeMacUpdateInfo };
