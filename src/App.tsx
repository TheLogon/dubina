import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { Orb } from "./components/Orb";
import { ScenarioList } from "./components/ScenarioList";
import { ScenarioEditor } from "./components/ScenarioEditor";
import { SettingsView } from "./components/SettingsView";
import { DocsView } from "./components/DocsView";
import {
  deleteScenario,
  findScenarioByPhrase,
  loadScenarios,
  normalizePhrase,
  upsertScenario,
} from "./store/scenarios";
import { findBuiltinByPhrase } from "./commands/builtins";
import { findChatterReply } from "./commands/chatter";
import {
  isDictationStop,
  matchDictationStart,
} from "./commands/dictation";
import {
  createEmptyScenario,
  type AppView,
  type ListenerState,
  type Scenario,
} from "./types/scenario";
import { runScenario } from "./executor/runScenario";
import { playActionSafe, warmTtsCache, speakSafe } from "./audio/soundPlayer";
import { loadSettings, type AppSettings } from "./store/settings";
import {
  extractWakeAndCommand,
  MicPermissionError,
  startVoiceController,
  type VoiceController,
} from "./voice/engine";
import "./styles/global.css";

function App() {
  const [view, setView] = useState<AppView>("home");
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [draft, setDraft] = useState<Scenario | null>(null);
  const [listener, setListener] = useState<ListenerState>("idle");
  const [status, setStatus] = useState<string | null>(null);
  const [caption, setCaption] = useState("");
  const [captionFinal, setCaptionFinal] = useState("");
  const [voiceStatus, setVoiceStatus] = useState("Микрофон…");
  const [micBlocked, setMicBlocked] = useState(false);
  const [voiceEpoch, setVoiceEpoch] = useState(0);
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());
  const settingsRef = useRef(settings);
  const closeToTrayRef = useRef(settings.closeToTray);
  const scenariosRef = useRef(scenarios);
  const listenerRef = useRef(listener);
  const modeRef = useRef<"idle" | "command" | "dictation">("idle");
  const voiceRef = useRef<VoiceController | null>(null);
  const busyRef = useRef(false);
  const wakeLatchRef = useRef(false);
  const lastChatterRef = useRef<{ at: number; phrase: string } | null>(null);
  const handleFinalRef = useRef<(text: string) => void>(() => {});
  const handlePartialRef = useRef<(text: string) => void>(() => {});

  useEffect(() => {
    setScenarios(loadScenarios());
  }, []);

  useEffect(() => {
    closeToTrayRef.current = settings.closeToTray;
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    scenariosRef.current = scenarios;
  }, [scenarios]);

  useEffect(() => {
    listenerRef.current = listener;
  }, [listener]);

  async function revealWindow() {
    try {
      const win = getCurrentWindow();
      await win.show();
      await win.unminimize();
      await win.setFocus();
    } catch {
      
    }
  }

  function replyChatter(phrase: string): boolean {
    const key = normalizePhrase(phrase);
    const last = lastChatterRef.current;
    if (last && last.phrase === key && Date.now() - last.at < 3000) {
      return true;
    }
    const reply = findChatterReply(phrase);
    if (!reply) return false;
    lastChatterRef.current = { at: Date.now(), phrase: key };
    modeRef.current = "idle";
    wakeLatchRef.current = false;
    setListener("idle");
    setStatus(reply);
    setCaption("");
    setCaptionFinal("");
    speakSafe(reply);
    return true;
  }

  function failUnknown() {
    playActionSafe("error");
    setListener("error");
    setStatus("Не понял");
    modeRef.current = "idle";
    wakeLatchRef.current = false;
    setCaption("");
    setCaptionFinal("");
    window.setTimeout(() => setListener("idle"), 1200);
  }

  async function hideWindow() {
    try {
      await getCurrentWindow().hide();
    } catch {
      
    }
  }

  async function startDictation(remainder: string) {
    modeRef.current = "dictation";
    wakeLatchRef.current = false;
    busyRef.current = false;
    setView("home");
    setListener("dictation");
    setStatus("Диктовка — скажи «стоп»");
    setCaption("");
    setCaptionFinal("");
    speakSafe("Диктуй");
    await hideWindow();
    const rest = remainder.trim();
    if (rest) {
      await new Promise((r) => setTimeout(r, 500));
      try {
        await invoke("type_text", { text: `${rest} ` });
        setCaptionFinal(rest);
      } catch (e) {
        setStatus(e instanceof Error ? e.message : "Ошибка вставки");
      }
    }
  }

  function stopDictation() {
    modeRef.current = "idle";
    setListener("idle");
    setStatus("Готово");
    setCaption("");
    setCaptionFinal("");
    speakSafe("Готово");
  }

  async function typeDictated(raw: string) {
    const { woke, command } = extractWakeAndCommand(raw);
    const phrase = (woke ? command : raw).trim();
    if (!phrase) return;
    if (isDictationStop(phrase)) {
      stopDictation();
      return;
    }
    setCaptionFinal(phrase);
    setCaption("");
    setStatus("Пишу…");
    try {
      await invoke("type_text", { text: `${phrase} ` });
      setStatus("Диктовка — скажи «стоп»");
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Ошибка вставки");
    }
  }

  function tryDictationCommand(phrase: string): boolean {
    const hit = matchDictationStart(phrase);
    if (!hit) return false;
    void startDictation(hit.remainder);
    return true;
  }

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void (async () => {
      try {
        const win = getCurrentWindow();
        unlisten = await win.onCloseRequested(async (event) => {
          if (closeToTrayRef.current) {
            event.preventDefault();
            await win.hide();
            
            voiceRef.current?.keepAlive();
            return;
          }
          event.preventDefault();
          try {
            await invoke("quit_app");
          } catch {
            await win.destroy();
          }
        });
      } catch {
        
      }
    })();
    return () => unlisten?.();
  }, []);

  const executeScenario = useCallback(async (scenario: Scenario) => {
    busyRef.current = true;
    modeRef.current = "idle";
    setCaption("");
    setCaptionFinal("");
    setListener("running");
    setStatus(`«${scenario.phrase}»`);
    try {
      await runScenario(scenario, ({ index, total }) => {
        setStatus(`Шаг ${index + 1}/${total}`);
      });
      setListener("idle");
      setStatus("Готово");
    } catch (e) {
      playActionSafe("error");
      setListener("error");
      setStatus(e instanceof Error ? e.message : "Ошибка");
      window.setTimeout(() => setListener("idle"), 1600);
    } finally {
      busyRef.current = false;
      setCaption("");
      setCaptionFinal("");
    }
  }, []);

  const handleFinalUtterance = useCallback(
    async (text: string) => {
      if (busyRef.current) return;
      console.info("[dubina:stt]", text);

      if (modeRef.current === "dictation") {
        await typeDictated(text);
        return;
      }

      if (modeRef.current === "command") {
        setCaptionFinal(text);
        setCaption("");
        const { woke, command } = extractWakeAndCommand(text);
        const phrase = (woke ? command : text).trim();
        wakeLatchRef.current = false;
        if (!phrase) {
          return;
        }
        if (tryDictationCommand(phrase)) return;
        const match =
          findBuiltinByPhrase(phrase, settingsRef.current) ??
          findScenarioByPhrase(scenariosRef.current, phrase);
        if (!match) {
          if (replyChatter(phrase)) return;
          failUnknown();
          return;
        }
        void revealWindow();
        await executeScenario(match);
        return;
      }

      const { woke, command } = extractWakeAndCommand(text);
      if (!woke) {
        wakeLatchRef.current = false;
        return;
      }

      setCaption("");
      setCaptionFinal(command || "Дубина");

      if (command) {
        if (tryDictationCommand(command)) return;
        const match =
          findBuiltinByPhrase(command, settingsRef.current) ??
          findScenarioByPhrase(scenariosRef.current, command);
        if (match) {
          if (!wakeLatchRef.current) {
            void revealWindow();
            setView("home");
            setListener("wake");
            playActionSafe("wake");
            setStatus("А?");
          }
          wakeLatchRef.current = false;
          await executeScenario(match);
          return;
        }
        void revealWindow();
        setView("home");
        wakeLatchRef.current = false;
        if (replyChatter(command)) return;
        failUnknown();
        return;
      }

      if (!wakeLatchRef.current) {
        void revealWindow();
        setView("home");
        setListener("wake");
        playActionSafe("wake");
        setStatus("А?");
      }
      wakeLatchRef.current = false;

      modeRef.current = "command";
      setListener("listening");
      setStatus("Слушаю команду…");
      setCaptionFinal("");
    },
    [executeScenario],
  );

  const handlePartialUtterance = useCallback(
    (text: string) => {
      if (busyRef.current) return;

      if (modeRef.current === "dictation") {
        setCaption(text);
        return;
      }

      if (modeRef.current === "command") {
        setCaption(text);
        return;
      }

      if (modeRef.current !== "idle" || wakeLatchRef.current) return;

      const { woke, command } = extractWakeAndCommand(text);
      if (!woke) return;

      wakeLatchRef.current = true;
      setView("home");
      setCaption("");
      setCaptionFinal(command || "Дубина");

      if (command) {
        if (matchDictationStart(command)) {
          void startDictation(matchDictationStart(command)!.remainder);
          return;
        }
        const match =
          findBuiltinByPhrase(command, settingsRef.current) ??
          findScenarioByPhrase(scenariosRef.current, command);
        if (match) {
          void revealWindow();
          setListener("wake");
          playActionSafe("wake");
          setStatus("А?");
          void executeScenario(match);
          return;
        }
        void revealWindow();
        if (replyChatter(command)) return;
      }

      void revealWindow();
      setListener("wake");
      playActionSafe("wake");
      setStatus("А?");
      modeRef.current = "command";
      setListener("listening");
      setStatus("Слушаю команду…");
    },
    [executeScenario],
  );

  handleFinalRef.current = (text: string) => {
    void handleFinalUtterance(text);
  };
  handlePartialRef.current = (text: string) => {
    handlePartialUtterance(text);
  };

  useEffect(() => {
    
    const t = window.setTimeout(() => {
      void warmTtsCache();
    }, 4000);
    return () => window.clearTimeout(t);
  }, []);

  
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        setMicBlocked(false);
        setVoiceStatus("Запрос доступа к микрофону…");
        const controller = await startVoiceController(
          settings.inputDeviceId,
          {
            onPartial: (t) => {
              if (!cancelled) handlePartialRef.current(t);
            },
            onFinal: (t) => {
              if (!cancelled) handleFinalRef.current(t);
            },
            onError: (m) => {
              if (!cancelled) {
                setVoiceStatus(m);
                console.error("[dubina:voice]", m);
              }
            },
            onStatus: (m) => {
              if (!cancelled) setVoiceStatus(m);
            },
          },
        );
        if (cancelled) {
          controller.stop();
          return;
        }
        setMicBlocked(false);
        voiceRef.current = controller;
        controller.keepAlive();
      } catch (e) {
        if (!cancelled) {
          const msg = e instanceof Error ? e.message : "Ошибка голоса";
          setVoiceStatus(msg);
          setMicBlocked(e instanceof MicPermissionError);
          console.error("[dubina:voice]", e);
        }
      }
    })();

    return () => {
      cancelled = true;
      voiceRef.current?.stop();
      voiceRef.current = null;
    };
  }, [settings.inputDeviceId, voiceEpoch]);

  function openCreate() {
    setDraft(createEmptyScenario());
    setView("editor");
  }

  function openEdit(id: string) {
    const found = scenarios.find((s) => s.id === id);
    if (!found) return;
    setDraft({ ...found, steps: found.steps.map((st) => ({ ...st })) });
    setView("editor");
  }

  function handleSave() {
    if (!draft) return;
    setScenarios(upsertScenario(scenarios, draft));
    setDraft(null);
    setView("scenarios");
  }

  return (
    <div className="app">
      <div className="app__glow" aria-hidden />
      <header className="topbar">
        <button type="button" className="brand" onClick={() => setView("home")}>
          <span className="brand__mark">D</span>
          <span className="brand__name">Dubina</span>
        </button>
        <nav className="nav">
          <button
            type="button"
            className={view === "home" ? "nav__btn is-active" : "nav__btn"}
            onClick={() => setView("home")}
          >
            Главная
          </button>
          <button
            type="button"
            className={
              view === "scenarios" || view === "editor"
                ? "nav__btn is-active"
                : "nav__btn"
            }
            onClick={() => setView("scenarios")}
          >
            Сценарии
          </button>
          <button
            type="button"
            className={view === "docs" ? "nav__btn is-active" : "nav__btn"}
            onClick={() => setView("docs")}
          >
            Документация
          </button>
          <button
            type="button"
            className={view === "settings" ? "nav__btn is-active" : "nav__btn"}
            onClick={() => setView("settings")}
          >
            Настройки
          </button>
        </nav>
      </header>

      <main className="main">
        <AnimatePresence mode="wait">
          {view === "home" && (
            <motion.section
              key="home"
              className="home"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.28 }}
            >
              <h1 className="home__title">Dubina</h1>
              <p className="home__lead">
                Скажи «Дубина» — и команду сценария.
              </p>
              <Orb state={listener} />
              {status && <p className="home__status">{status}</p>}

              <div className="captions" aria-live="polite">
                <div className="captions__engine">{voiceStatus}</div>
                <div className="captions__line">
                  {caption ? (
                    <span className="captions__partial">{caption}</span>
                  ) : captionFinal ? (
                    <span className="captions__final">{captionFinal}</span>
                  ) : (
                    <span className="captions__placeholder">
                      Скажи «Дубина»…
                    </span>
                  )}
                </div>
                {micBlocked && (
                  <button
                    type="button"
                    className="btn btn--primary captions__mic-btn"
                    onClick={() => {
                      setMicBlocked(false);
                      setVoiceEpoch((n) => n + 1);
                    }}
                  >
                    Разрешить микрофон
                  </button>
                )}
              </div>
            </motion.section>
          )}

          {view === "scenarios" && (
            <motion.div
              key="scenarios"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
            >
              <ScenarioList
                scenarios={scenarios}
                onCreate={openCreate}
                onEdit={openEdit}
                onDelete={(id) => setScenarios(deleteScenario(scenarios, id))}
                onRun={(id) => {
                  const s = scenarios.find((x) => x.id === id);
                  if (s) void executeScenario(s);
                }}
              />
            </motion.div>
          )}

          {view === "editor" && draft && (
            <motion.div
              key="editor"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
            >
              <ScenarioEditor
                scenario={draft}
                onChange={setDraft}
                onSave={handleSave}
                onCancel={() => {
                  setDraft(null);
                  setView("scenarios");
                }}
              />
            </motion.div>
          )}

          {view === "docs" && (
            <motion.div
              key="docs"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
            >
              <DocsView onBack={() => setView("home")} />
            </motion.div>
          )}

          {view === "settings" && (
            <motion.div
              key="settings"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
            >
              <SettingsView
                onBack={() => setView("home")}
                onSettingsChange={setSettings}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}

export default App;
