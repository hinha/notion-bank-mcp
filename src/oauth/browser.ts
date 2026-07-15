import { exec } from "node:child_process";
import { platform } from "node:os";
import { log } from "../logging.js";

export function openBrowserIfEnabled(url: string): void {
  const openEnv = process.env.NOTION_BANK_OPEN_BROWSER;
  if (openEnv === "0" || openEnv === "false") return;

  const cmd =
    platform() === "darwin"
      ? `open "${url}"`
      : platform() === "win32"
        ? `start "" "${url}"`
        : `xdg-open "${url}"`;
  exec(cmd, (err) => {
    if (err) log.warn("Could not open browser automatically", { err: String(err) });
  });
}
