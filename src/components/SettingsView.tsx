import { useEffect, useState } from "react";
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
import {
  checkForAppUpdate,
  currentAppVersion,
  installAppUpdate,
} from "../updater";

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
  const [appVersion, setAppVersion] = useState("…");
  const [updateStatus, setUpdateStatus] = useState<string | null>(null);
  const [updateBusy, setUpdateBusy] = useState(false);
  const [pendingUpdateVersion, setPendingUpdateVersion] = useState<string | null>(
    null,
  );

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
    void currentAppVersion().then(setAppVersion);
  }, []);

  async function runUpdateCheck() {
    setUpdateBusy(true);
    setPendingUpdateVersion(null);
    setUpdateStatus("Проверяю обновления…");
    const result = await checkForAppUpdate({ install: false });
    switch (result.status) {
      case "up-to-date":
        setUpdateStatus(`Уже последняя версия (${result.version})`);
        break;
      case "available":
        setPendingUpdateVersion(result.version);
        setUpdateStatus(`Доступна версия ${result.version}`);
        break;
      case "updating":
        setUpdateStatus(`Ставлю ${result.version}…`);
        break;
      case "dev":
        setUpdateStatus("Обновления доступны только в установленной версии");
        break;
      case "error":
        setUpdateStatus(result.message);
        break;
    }
    setUpdateBusy(false);
  }

  async function runUpdateInstall() {
    setUpdateBusy(true);
    setUpdateStatus(
      pendingUpdateVersion
        ? `Обновляю до ${pendingUpdateVersion}…`
        : "Обновляю…",
    );
    const result = await installAppUpdate();
    switch (result.status) {
      case "up-to-date":
        setPendingUpdateVersion(null);
        setUpdateStatus(`Уже последняя версия (${result.version})`);
        break;
      case "updating":
        setUpdateStatus(`Ставлю ${result.version}…`);
        break;
      case "available":
        setPendingUpdateVersion(result.version);
        setUpdateStatus(`Доступна версия ${result.version}`);
        break;
      case "dev":
        setUpdateStatus("Обновления доступны только в установленной версии");
        break;
      case "error":
        setUpdateStatus(result.message);
        break;
    }
    setUpdateBusy(false);
  }

  function update(patch: Partial<AppSettings>) {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      saveSettings(next);
      applyAudioOutputSettings({
        outputDeviceId: next.outputDeviceId,
        outputVolume: next.outputVolume,
        wakeVoiceEnabled: next.wakeVoiceEnabled,
        doneVoiceEnabled: next.doneVoiceEnabled,
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
          <p className="panel__sub">Музыка, микрофон, голос и обновления</p>
        </div>
        <button type="button" className="btn btn--ghost" onClick={onBack}>
          Назад
        </button>
      </div>

      <section className="settings-block">
        <h3>Музыка</h3>
        <p className="muted">
          Какую программу открывать по команде «включи музыку». Выбери
          Яндекс Музыку. Если ничего не выбрано, Дубина попробует найти её сама.
        </p>
        <div className="field field--settings">
          <span>Музыкальный плеер</span>
          <AppPicker
            value={settings.musicAppPath}
            displayName={settings.musicAppName}
            onChange={(app) =>
              update({ musicAppPath: app.path, musicAppName: app.name })
            }
          />
        </div>
      </section>

      <section className="settings-block">
        <h3>Микрофон и звук</h3>
        <p className="muted">
          Выбери, через что Дубина тебя слышит и куда отвечает. Можно взять
          микрофон iPhone, если он подключён к Mac.
        </p>

        <CustomSelect
          label="Микрофон"
          value={settings.inputDeviceId}
          options={inputs.map((d) => ({ value: d.deviceId, label: d.label }))}
          onChange={(v) => update({ inputDeviceId: v })}
        />

        <CustomSelect
          label="Динамики"
          value={settings.outputDeviceId}
          options={outputs.map((d) => ({ value: d.deviceId, label: d.label }))}
          onChange={(v) => update({ outputDeviceId: v })}
        />

        <VolumeSlider
          label="Громкость ответов"
          value={settings.outputVolume}
          onChange={(v) => update({ outputVolume: v })}
        />

        {devicesError && <p className="banner banner--error">{devicesError}</p>}
      </section>

      <section className="settings-block">
        <h3>Управление голосом</h3>
        <p className="muted">Как Дубина отвечает голосом.</p>

        <div className="toggle-row">
          <div>
            <strong>Отвечать голосом на «Дубина»</strong>
            <p className="muted">
              Если выключено — вместо «А?» будет короткий звук.
            </p>
          </div>
          <Switch
            checked={settings.wakeVoiceEnabled}
            onChange={(v) => update({ wakeVoiceEnabled: v })}
            ariaLabel="Отвечать голосом на Дубина"
          />
        </div>

        <div className="toggle-row">
          <div>
            <strong>Говорить после команды</strong>
            <p className="muted">
              Короткие фразы вроде «Готово» или «Выполнил», когда команда
              сделана.
            </p>
          </div>
          <Switch
            checked={settings.doneVoiceEnabled}
            onChange={(v) => update({ doneVoiceEnabled: v })}
            ariaLabel="Говорить после команды"
          />
        </div>

        <div className="settings-actions">
          <button
            type="button"
            className="btn btn--chip"
            onClick={() => playActionSafe("wake")}
          >
            Проверить отзыв
          </button>
          <button
            type="button"
            className="btn btn--chip"
            onClick={() => playActionSafe("ok")}
          >
            Проверить «Готово»
          </button>
          <button
            type="button"
            className="btn btn--chip"
            onClick={() => speakSafe("Включаю музыку")}
          >
            Проверить голос
          </button>
        </div>
      </section>

      <section className="settings-block">
        <h3>Обновления</h3>
        <p className="muted">
          Сейчас установлена версия <code>{appVersion}</code>. Сначала можно
          проверить, есть ли новая, и обновить только когда захочешь.
        </p>
        {updateStatus && <p className="tts-status">{updateStatus}</p>}
        <div className="settings-actions">
          {pendingUpdateVersion ? (
            <button
              type="button"
              className="btn btn--primary"
              disabled={updateBusy}
              onClick={() => void runUpdateInstall()}
            >
              {updateBusy ? "Обновляю…" : `Обновить до ${pendingUpdateVersion}`}
            </button>
          ) : (
            <button
              type="button"
              className="btn btn--chip"
              disabled={updateBusy}
              onClick={() => void runUpdateCheck()}
            >
              {updateBusy ? "Проверяю…" : "Проверить обновления"}
            </button>
          )}
        </div>
      </section>

      <section className="settings-block">
        <h3>Поведение</h3>

        <div className="toggle-row">
          <div>
            <strong>Сворачивать в значок</strong>
            <p className="muted">
              При закрытии окна Дубина остаётся в значке у часов и продолжает
              слушать. Если выключить — программа полностью завершится.
            </p>
          </div>
          <Switch
            checked={settings.closeToTray}
            onChange={(v) => update({ closeToTray: v })}
            ariaLabel="Сворачивать в значок"
          />
        </div>

        <div className="toggle-row">
          <div>
            <strong>Запускать вместе с системой</strong>
            <p className="muted">Дубина откроется автоматически после включения компьютера.</p>
          </div>
          <Switch
            checked={settings.autostart}
            onChange={(v) => void toggleAutostart(v)}
            ariaLabel="Запускать вместе с системой"
          />
        </div>

        {autostartError && (
          <p className="banner banner--error">{autostartError}</p>
        )}
      </section>
    </div>
  );
}
