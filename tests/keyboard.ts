const macOS = process.platform === "darwin";
const modifier = macOS ? "Meta" : "Control";

export const shortcut = (keys: string) => `${modifier}+${keys}`;
export const documentStart = macOS ? "Meta+ArrowUp" : "Control+Home";
export const documentEnd = macOS ? "Meta+ArrowDown" : "Control+End";
export const lineEndSelection = macOS ? "Meta+Shift+ArrowRight" : "Shift+End";
export const clickModifier = macOS ? "Meta" : "Control";
