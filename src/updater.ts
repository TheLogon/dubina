import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { getVersion } from "@tauri-apps/api/app";

export type UpdateCheckResult =
  | { status: "up-to-date"; version: string }
  | { status: "available"; version: string; current: string; notes?: string }
  | { status: "updating"; version: string }
  | { status: "error"; message: string }
  | { status: "dev"; message: string };

export async function currentAppVersion(): Promise<string> {
  try {
    return await getVersion();
  } catch {
    return "dev";
  }
}

export async function checkForAppUpdate(opts?: {
  install?: boolean;
}): Promise<UpdateCheckResult> {
  const install = opts?.install ?? true;
  let current = "dev";
  try {
    current = await getVersion();
  } catch {
    return {
      status: "dev",
      message: "Обновления работают только в собранном приложении",
    };
  }

  try {
    const update = await check();
    if (!update) {
      return { status: "up-to-date", version: current };
    }

    if (!install) {
      return {
        status: "available",
        version: update.version,
        current,
        notes: update.body ?? undefined,
      };
    }

    await update.downloadAndInstall();
    await relaunch();
    return { status: "updating", version: update.version };
  } catch (e) {
    const message =
      e instanceof Error
        ? e.message
        : typeof e === "string"
          ? e
          : "Не удалось проверить обновления";
    return { status: "error", message };
  }
}
