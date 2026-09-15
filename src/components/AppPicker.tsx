import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AnimatePresence, motion } from "framer-motion";

export type InstalledApp = {
  name: string;
  path: string;
};

type Props = {
  value: string;
  displayName?: string;
  onChange: (app: InstalledApp) => void;
};

function basename(path: string): string {
  const cleaned = path.replace(/\\/g, "/");
  const part = cleaned.split("/").filter(Boolean).pop() ?? path;
  return part.replace(/\.exe$/i, "") || path;
}

function looksMojibake(s: string): boolean {
  return /[ÐÑÃÂ]/.test(s) || (s.match(/[äåæø]/g) ?? []).length >= 2;
}

function friendlyFromPath(path: string): string {
  const stem = basename(path).toLowerCase().replace(/\s+/g, "");
  if (stem.includes("yandexmusic") || stem.includes("yamusic")) return "Яндекс Музыка";
  if (stem === "spotify") return "Spotify";
  if (stem === "chrome") return "Google Chrome";
  if (stem === "telegram") return "Telegram";
  return basename(path);
}

function displayLabel(app: InstalledApp | undefined, value: string, displayName?: string): string {
  const candidates = [app?.name, displayName, value ? friendlyFromPath(value) : ""].filter(
    Boolean,
  ) as string[];
  for (const c of candidates) {
    if (c && !looksMojibake(c) && !c.includes("\\") && !c.includes("/")) return c;
  }
  if (value) return friendlyFromPath(value);
  return "Выбери программу…";
}

export function AppPicker({ value, displayName, onChange }: Props) {
  const [apps, setApps] = useState<InstalledApp[]>([]);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reload(refresh = false) {
    setLoading(true);
    try {
      const list = await invoke<InstalledApp[]>("list_installed_apps", {
        refresh,
      });
      setApps(list);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить список");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload(false);
  }, []);

  const selected = apps.find(
    (a) => a.path === value || a.path.toLowerCase() === value.toLowerCase(),
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return apps.slice(0, 120);
    return apps
      .filter(
        (a) =>
          a.name.toLowerCase().includes(q) || a.path.toLowerCase().includes(q),
      )
      .slice(0, 120);
  }, [apps, query]);

  async function pickFile() {
    try {
      const app = await invoke<InstalledApp | null>("pick_app_file");
      if (!app) return;
      const fixed = {
        path: app.path,
        name:
          looksMojibake(app.name) || !app.name
            ? friendlyFromPath(app.path)
            : app.name,
      };
      setApps((prev) => {
        if (prev.some((a) => a.path.toLowerCase() === fixed.path.toLowerCase())) {
          return prev;
        }
        return [fixed, ...prev];
      });
      onChange(fixed);
      setOpen(false);
      setQuery("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось выбрать файл");
    }
  }

  return (
    <div className="app-picker">
      <button
        type="button"
        className="cselect"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="cselect__value">
          {displayLabel(selected, value, displayName)}
        </span>
        <span className="cselect__chev">▾</span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            className="app-picker__menu"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
          >
            <input
              className="app-picker__search"
              placeholder="Поиск (яндекс, spotify…)"
              value={query}
              autoFocus
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className="app-picker__actions">
              <button
                type="button"
                className="btn btn--chip"
                onClick={() => void pickFile()}
              >
                Указать файл…
              </button>
              <button
                type="button"
                className="btn btn--chip"
                onClick={() => void reload(true)}
              >
                Обновить
              </button>
            </div>
            {loading && <p className="muted">Загрузка приложений…</p>}
            {error && <p className="banner banner--error">{error}</p>}
            <ul className="app-picker__list">
              {filtered.map((app) => (
                <li key={app.path}>
                  <button
                    type="button"
                    className={
                      value.toLowerCase() === app.path.toLowerCase()
                        ? "is-active"
                        : ""
                    }
                    onClick={() => {
                      onChange(app);
                      setOpen(false);
                      setQuery("");
                    }}
                  >
                    <strong>
                      {looksMojibake(app.name)
                        ? friendlyFromPath(app.path)
                        : app.name}
                    </strong>
                    <span>{app.path}</span>
                  </button>
                </li>
              ))}
              {!loading && filtered.length === 0 && (
                <li className="muted">Ничего не найдено — укажи файл вручную</li>
              )}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
