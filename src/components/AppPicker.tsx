import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AnimatePresence, motion } from "framer-motion";

export type InstalledApp = {
  name: string;
  path: string;
};

type Props = {
  value: string;
  onChange: (app: InstalledApp) => void;
};

export function AppPicker({ value, onChange }: Props) {
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

  const selected = apps.find((a) => a.path === value || a.name === value);

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
      setApps((prev) => {
        if (prev.some((a) => a.path === app.path)) return prev;
        return [app, ...prev];
      });
      onChange(app);
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
          {selected?.name || (value ? value : "Выбери программу…")}
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
              <button type="button" className="btn btn--chip" onClick={() => void pickFile()}>
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
                      value === app.path || value === app.name ? "is-active" : ""
                    }
                    onClick={() => {
                      onChange(app);
                      setOpen(false);
                      setQuery("");
                    }}
                  >
                    <strong>{app.name}</strong>
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
