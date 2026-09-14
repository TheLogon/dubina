import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  enable as enableAutostart,
  disable as disableAutostart,
  isEnabled as isAutostartEnabled,
} from "@tauri-apps/plugin-autostart";
import { playActionSafe, applyAudioOutputSettings, speakSafe } from "../audio/soundPlayer";
import {
  type AppSettings,
  type AudioDeviceOption,
  listAudioDevices,
  loadSettings,
  saveSettings,
} from "../store/settings";
import { CustomSelect } from "./ui/CustomSelect";
import { Switch } from "./ui/Switch";
import { VolumeSlider } from "./ui/VolumeSlider";
import { AppPicker } from "./AppPicker";

type Props = {
  onBack: () => void;
  onSettingsChange?: (settings: AppSettings) => void;
};

export function SettingsView({ onBack, onSettingsChange }: Props) {
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());
  const [inputs, setInputs] = useState<AudioDeviceOption[]>([]);
  const [outputs, setOutputs] = useState<AudioDeviceOption[]>([]);
  const [devicesError, setDevicesError] = useState<string | null>(null);
  const [autostartError, setAutostartError] = useState<string | null>(null);
  const [ttsStatus, setTtsStatus] = useState("…");
  const [ttsDir, setTtsDir] = useState("");

  useEffect(() => {
    void (async () => {
      try {
        const { inputs: i, outputs: o } = await listAudioDevices();
        setInputs(i);
        setOutputs(o);
        setDevicesError(null);
      } catch {
        setDevicesError(
          "Не удалось получить список устройств. Разреши доступ к микрофону.",
        );
      }
    })();
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const enabled = await isAutostartEnabled();
        setSettings((prev) => {
          if (prev.autostart === enabled) return prev;
          const next = { ...prev, autostart: enabled };
          saveSettings(next);
          return next;
        });
      } catch {
        
      }
    })();
  }, []);

  useEffect(() => {
    void refreshTts();
  }, []);

  async function refreshTts() {
    try {
      const [status, dir] = await Promise.all([
        invoke<string>("tts_status"),
        invoke<string>("tts_dir"),
      ]);
      setTtsStatus(status);
      setTtsDir(dir);
    } catch {
      setTtsStatus("TTS недоступен вне приложения Tauri");
    }
  }

  function update(patch: Partial<AppSettings>) {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      saveSettings(next);
      applyAudioOutputSettings({
        outputDeviceId: next.outputDeviceId,
        outputVolume: next.outputVolume,
      });
      onSettingsChange?.(next);
      return next;
    });
  }

  async function toggleAutostart(checked: boolean) {
    setAutostartError(null);
    try {
      if (checked) await enableAutostart();
      else await disableAutostart();
      update({ autostart: checked });
    } catch (e) {
      setAutostartError(
        e instanceof Error ? e.message : "Не удалось изменить автозапуск",
      );
    }
  }

  return (
    <div className="panel">
      <div className="panel__head">
        <div>
          <h2 className="panel__title">Настройки</h2>
          <p className="panel__sub">Звук, музыка, трей и автозапуск</p>
        </div>
        <button type="button" className="btn btn--ghost" onClick={onBack}>
          Назад
        </button>
      </div>

      <section className="settings-block">
        <h3>Музыка</h3>
        <p className="muted">
          Команда «включи музыку» откроет выбранный плеер, дождётся запуска и
          нажмёт Play.
        </p>
        <div className="field field--settings">
          <span>Плеер по умолчанию</span>
          <AppPicker
            value={settings.musicAppPath}
            onChange={(app) =>
              update({ musicAppPath: app.path, musicAppName: app.name })
            }
          />
          {settings.musicAppName && (
            <p className="muted">Выбрано: {settings.musicAppName}</p>
          )}
        </div>
      </section>

      <section className="settings-block">
        <h3>Ввод и вывод</h3>
        <p className="muted">Выбери микрофон, динамики и громкость ответов.</p>

        <CustomSelect
          label="Микрофон (вход)"
          value={settings.inputDeviceId}
          options={inputs.map((d) => ({ value: d.deviceId, label: d.label }))}
          onChange={(v) => update({ inputDeviceId: v })}
        />

        <CustomSelect
          label="Динамики (выход)"
          value={settings.outputDeviceId}
          options={outputs.map((d) => ({ value: d.deviceId, label: d.label }))}
          onChange={(v) => update({ outputDeviceId: v })}
        />

        <VolumeSlider
          label="Громкость вывода"
          value={settings.outputVolume}
          onChange={(v) => update({ outputVolume: v })}
        />

        {devicesError && <p className="banner banner--error">{devicesError}</p>}
      </section>

      <section className="settings-block">
        <h3>Голос Дубыны (TTS)</h3>
        <p className="muted">
          Ответы генерируются из текста (Piper или системный голос). Wav больше
          не нужны.
        </p>
        <pre className="tts-status">{ttsStatus}</pre>
        {ttsDir && (
          <p className="muted">
            Папка Piper: <code>{ttsDir}</code>
          </p>
        )}
        <p className="muted">
          Для Piper положи бинарник и русский `.onnx` из{" "}
          <a
            href="https://github.com/OHF-Voice/piper1-gpl"
            target="_blank"
            rel="noreferrer"
          >
            piper1-gpl
          </a>
          .
        </p>
        <div className="settings-actions">
          <button
            type="button"
            className="btn btn--chip"
            onClick={() => playActionSafe("wake")}
          >
            Тест: А?
          </button>
          <button
            type="button"
            className="btn btn--chip"
            onClick={() => playActionSafe("ok")}
          >
            Тест: Готово
          </button>
          <button
            type="button"
            className="btn btn--chip"
            onClick={() => speakSafe("Включаю музыку")}
          >
            Тест: фраза
          </button>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => void refreshTts()}
          >
            Обновить статус
          </button>
        </div>
      </section>

      <section className="settings-block">
        <h3>Поведение</h3>

        <div className="toggle-row">
          <div>
            <strong>Закрывать программу в трей</strong>
            <p className="muted">
              Крестик прячет в трей, Дубина продолжает слушать. Выключено —
              полный выход (голос останавливается).
            </p>
          </div>
          <Switch
            checked={settings.closeToTray}
            onChange={(v) => update({ closeToTray: v })}
            ariaLabel="Закрывать программу в трей"
          />
        </div>

        <div className="toggle-row">
          <div>
            <strong>Автозапуск при старте системы</strong>
            <p className="muted">Запускать Дубину вместе с системой.</p>
          </div>
          <Switch
            checked={settings.autostart}
            onChange={(v) => void toggleAutostart(v)}
            ariaLabel="Автозапуск при старте системы"
          />
        </div>

        {autostartError && (
          <p className="banner banner--error">{autostartError}</p>
        )}
      </section>
    </div>
  );
}
