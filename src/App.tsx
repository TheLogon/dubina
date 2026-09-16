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
import { findBuiltinByPhrase, fetchWeatherLine, isMusicStartPhrase, isWeatherRequest } from "./commands/builtins";
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
import { playActionSafe, warmTtsCache, speakSafe, isSpeechMuted } from "./audio/soundPlayer";
import { loadSettings, type AppSettings } from "./store/settings";
import { checkForAppUpdate } from "./updater";
import { listen } from "@tauri-apps/api/event";
import {
  extractWakeAndCommand,
  MicPermissionError,
  startVoiceController,
  type VoiceController,
} from "./voice/engine";
import { commandTextFromUtterance, isIncompleteCommandFragment, isLikelyTtsEcho, isStopPhrase, mergeCommandFragments, significantTokens } from "./voice/matchCommand";
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
  const commandTimerRef = useRef<number | null>(null);
  const voiceRef = useRef<VoiceController | null>(null);
  const busyRef = useRef(false);
  const wakeLatchRef = useRef(false);
  const runCancelRef = useRef<{ cancelled: boolean }>({ cancelled: false });
  const lastChatterRef = useRef<{ at: number; phrase: string } | null>(null);
  const pendingCmdRef = useRef<{ text: string; at: number } | null>(null);
  const pendingCmdTimerRef = useRef<number | null>(null);
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
    const key = normalizePhrase(commandTextFromUtterance(phrase));
    const last = lastChatterRef.current;
    if (last && last.phrase === key && Date.now() - last.at < 3000) {
      return true;
    }
    const reply = findChatterReply(phrase);
    if (!reply) return false;
    lastChatterRef.current = { at: Date.now(), phrase: key };
    setListener("idle");
    setStatus(reply);
    setCaption("");
    setCaptionFinal("");
    speakSafe(reply);
    enterCommandMode();
    return true;
  }

  function clearCommandTimer() {
    if (commandTimerRef.current !== null) {
      window.clearTimeout(commandTimerRef.current);
      commandTimerRef.current = null;
    }
  }

  function clearPendingCommand() {
    pendingCmdRef.current = null;
    if (pendingCmdTimerRef.current !== null) {
      window.clearTimeout(pendingCmdTimerRef.current);
      pendingCmdTimerRef.current = null;
    }
  }

  function enterCommandMode() {
    modeRef.current = "command";
    wakeLatchRef.current = false;
    setListener("listening");
    setStatus("Слушаю");
    bumpListenTimeout();
  }

  function bumpListenTimeout() {
    clearCommandTimer();
    if (modeRef.current !== "command") return;
    commandTimerRef.current = window.setTimeout(() => {
      if (modeRef.current !== "command") return;
      exitListenMode();
    }, 8000);
  }

  function exitListenMode() {
    clearCommandTimer();
    clearPendingCommand();
    modeRef.current = "idle";
    wakeLatchRef.current = false;
    setListener("idle");
    setStatus(null);
    setCaption("");
    setCaptionFinal("");
  }

  function isGlobalStop(spoken: string): boolean {
    return isStopPhrase(spoken);
  }

  function handleGlobalStop(): boolean {
    if (modeRef.current === "dictation") {
      stopDictation();
      return true;
    }
    if (busyRef.current || listenerRef.current === "running") {
      runCancelRef.current.cancelled = true;
      busyRef.current = false;
      exitListenMode();
      setStatus("Стоп");
      return true;
    }
    if (
      modeRef.current === "command" ||
      listenerRef.current === "listening" ||
      listenerRef.current === "wake" ||
      listenerRef.current === "error"
    ) {
      exitListenMode();
      setStatus("Стоп");
      return true;
    }
    return false;
  }

  function failUnknown() {
    playActionSafe("error");
    setListener("error");
    setStatus("Не понял — говори ещё");
    setCaption("");
    setCaptionFinal("");
    window.setTimeout(() => {
      enterCommandMode();
    }, 900);
  }

  function wakeAck() {
    setListener("wake");
    playActionSafe("wake");
    window.setTimeout(() => {
      voiceRef.current?.keepAlive();
    }, 400);
  }

  function toggleFromOrb() {
    if (busyRef.current) return;
    if (modeRef.current === "dictation") return;
    if (
      modeRef.current === "command" ||
      listenerRef.current === "listening" ||
      listenerRef.current === "wake" ||
      listenerRef.current === "error"
    ) {
      exitListenMode();
      setStatus("Стоп");
      return;
    }
    void revealWindow();
    setView("home");
    wakeAck();
    setStatus("Слушаю");
    setCaption("");
    setCaptionFinal("Дубина");
    enterCommandMode();
  }

  async function handleWeather() {
    busyRef.current = true;
    setListener("running");
    setStatus("Смотрю погоду…");
    try {
      const line = await fetchWeatherLine();
      setStatus(line);
      speakSafe(line);
      enterCommandMode();
    } catch {
      failUnknown();
    } finally {
      busyRef.current = false;
    }
  }

  async function resolveSpoken(raw: string): Promise<boolean> {
    const phrase = commandTextFromUtterance(raw);
    if (!phrase || isLikelyTtsEcho(phrase)) return false;

    if (tryDictationCommand(phrase)) return true;

    if (isWeatherRequest(phrase)) {
      void revealWindow();
      await handleWeather();
      return true;
    }

    const match =
      findBuiltinByPhrase(phrase, settingsRef.current) ??
      findScenarioByPhrase(scenariosRef.current, phrase);
    if (match) {
      void revealWindow();
      await executeScenario(match);
      return true;
    }

    if (replyChatter(phrase)) return true;
    return false;
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
    playActionSafe("ok");
  }

  async function typeDictated(raw: string) {
    const phrase = commandTextFromUtterance(raw);
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
    clearCommandTimer();
    modeRef.current = "idle";
    wakeLatchRef.current = false;
    runCancelRef.current = { cancelled: false };
    const signal = runCancelRef.current;
    setCaption("");
    setCaptionFinal("");
    setListener("running");
    setStatus(`«${scenario.phrase}»`);
    try {
      await runScenario(
        scenario,
        ({ index, total }) => {
          if (signal.cancelled) return;
          setStatus(`Шаг ${index + 1}/${total}`);
        },
        signal,
      );
      if (signal.cancelled) {
        setStatus("Стоп");
        setListener("idle");
        return;
      }
      setStatus("Готово");
      enterCommandMode();
    } catch (e) {
      if (signal.cancelled) {
        setStatus("Стоп");
        setListener("idle");
        return;
      }
      playActionSafe("error");
      setListener("error");
      setStatus(e instanceof Error ? e.message : "Ошибка");
      window.setTimeout(() => {
        enterCommandMode();
      }, 1200);
    } finally {
      busyRef.current = false;
      setCaption("");
      setCaptionFinal("");
    }
  }, []);

  const handleFinalUtterance = useCallback(
    async (text: string) => {
      if (busyRef.current && !isGlobalStop(text)) return;
      const trimmed = text.trim();
      if (!trimmed) return;
      if (isGlobalStop(trimmed) && handleGlobalStop()) return;

      const { woke: wakeHint } = extractWakeAndCommand(trimmed);
      const listeningNow =
        modeRef.current === "command" || modeRef.current === "dictation";
      if (isSpeechMuted() && !wakeHint && !listeningNow) return;
      if (isLikelyTtsEcho(trimmed) && !wakeHint) return;
      console.info("[dubina:stt]", trimmed);

      if (modeRef.current === "dictation") {
        await typeDictated(trimmed);
        return;
      }

      if (modeRef.current === "command") {
        bumpListenTimeout();
        setCaptionFinal(trimmed);
        setCaption("");
        wakeLatchRef.current = false;

        const { woke: onlyWake } = extractWakeAndCommand(trimmed);
        const stripped = commandTextFromUtterance(trimmed);
        if (onlyWake && !stripped) {
          return;
        }

        let phrase = stripped;
        const pending = pendingCmdRef.current;
        if (pending && Date.now() - pending.at < 2500) {
          phrase = mergeCommandFragments(pending.text, phrase || trimmed);
          clearPendingCommand();
        }

        if (!phrase || isLikelyTtsEcho(phrase)) {
          return;
        }

        if (
          findBuiltinByPhrase(phrase, settingsRef.current) ||
          findScenarioByPhrase(scenariosRef.current, phrase) ||
          isMusicStartPhrase(phrase) ||
          isWeatherRequest(phrase) ||
          matchDictationStart(phrase)
        ) {
          clearPendingCommand();
          const ok = await resolveSpoken(phrase);
          if (!ok) failUnknown();
          return;
        }

        if (isIncompleteCommandFragment(phrase)) {
          pendingCmdRef.current = { text: phrase, at: Date.now() };
          if (pendingCmdTimerRef.current !== null) {
            window.clearTimeout(pendingCmdTimerRef.current);
          }
          pendingCmdTimerRef.current = window.setTimeout(() => {
            pendingCmdRef.current = null;
            pendingCmdTimerRef.current = null;
          }, 2200);
          setCaptionFinal(phrase);
          return;
        }

        clearPendingCommand();
        const ok = await resolveSpoken(phrase);
        if (!ok) {
          const toks = significantTokens(phrase);
          if (toks.length <= 1 && phrase.length < 8) return;
          failUnknown();
        }
        return;
      }

      const { woke, command } = extractWakeAndCommand(trimmed);
      if (!woke) {
        wakeLatchRef.current = false;
        return;
      }

      setCaption("");
      setCaptionFinal(command || "Дубина");
      void revealWindow();
      setView("home");

      if (command) {
        if (!wakeLatchRef.current) {
          wakeAck();
          setStatus("Слушаю");
        }
        wakeLatchRef.current = false;
        enterCommandMode();
        const ok = await resolveSpoken(trimmed);
        if (!ok) failUnknown();
        return;
      }

      if (!wakeLatchRef.current) {
        wakeAck();
        setStatus("Слушаю");
      }
      wakeLatchRef.current = false;
      enterCommandMode();
    },
    [executeScenario],
  );

  const handlePartialUtterance = useCallback(
    (text: string) => {
      if (busyRef.current && !isGlobalStop(text)) return;
      const trimmed = text.trim();
      if (!trimmed) return;
      if (isGlobalStop(trimmed) && handleGlobalStop()) return;

      const { woke: wakeHint } = extractWakeAndCommand(trimmed);
      const listeningNow =
        modeRef.current === "command" || modeRef.current === "dictation";
      if (isSpeechMuted() && !wakeHint && !listeningNow) return;

      if (modeRef.current === "dictation") {
        setCaption(trimmed);
        return;
      }

      if (modeRef.current === "command") {
        bumpListenTimeout();
        setCaption(trimmed);
        return;
      }

      if (modeRef.current !== "idle" || wakeLatchRef.current) return;

      const { woke, command } = extractWakeAndCommand(trimmed);
      if (!woke) return;

      wakeLatchRef.current = true;
      void revealWindow();
      setView("home");
      setCaption("");
      setCaptionFinal(command || "Дубина");
      wakeAck();
      setStatus("Слушаю");
      enterCommandMode();

      if (command) {
        const phrase = commandTextFromUtterance(trimmed);
        if (phrase && matchDictationStart(phrase)) {
          void startDictation(matchDictationStart(phrase)!.remainder);
          return;
        }
        if (phrase && isWeatherRequest(phrase)) {
          void handleWeather();
          return;
        }
        const match = phrase
          ? findBuiltinByPhrase(phrase, settingsRef.current) ??
            findScenarioByPhrase(scenariosRef.current, phrase)
          : undefined;
        if (match) {
          void executeScenario(match);
          return;
        }
        if (phrase && replyChatter(phrase)) return;
      }
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
    let unlisten: (() => void) | undefined;

    async function runCheck(showIdle: boolean) {
      if (showIdle) setStatus("Проверяю обновления…");
      const result = await checkForAppUpdate({ install: true });
      if (cancelled) return;
      if (result.status === "up-to-date") {
        if (showIdle) setStatus(`Версия актуальна (${result.version})`);
        return;
      }
      if (result.status === "updating") {
        setStatus(`Обновляю до ${result.version}…`);
        return;
      }
      if (result.status === "available") {
        setStatus(`Доступна версия ${result.version}`);
        return;
      }
      if (result.status === "error" && showIdle) {
        setStatus(result.message);
      }
      if (result.status === "dev" && showIdle) {
        setStatus(result.message);
      }
    }

    void listen("dubina://check-updates", () => {
      void runCheck(true);
    }).then((fn) => {
      unlisten = fn;
    });

    const auto = window.setTimeout(() => {
      void runCheck(false);
    }, 8000);

    return () => {
      cancelled = true;
      window.clearTimeout(auto);
      unlisten?.();
    };
  }, []);

  
  useEffect(() => {
    let cancelled = false;
    let controller: VoiceController | null = null;

    const boot = window.setTimeout(() => {
      void (async () => {
        try {
          setMicBlocked(false);
          setVoiceStatus("Запрос доступа к микрофону…");
          const next = await startVoiceController(settings.inputDeviceId, {
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
          });
          if (cancelled) {
            next.stop();
            return;
          }
          controller = next;
          setMicBlocked(false);
          voiceRef.current = next;
          next.keepAlive();
        } catch (e) {
          if (!cancelled) {
            const msg = e instanceof Error ? e.message : "Ошибка голоса";
            setVoiceStatus(msg);
            setMicBlocked(e instanceof MicPermissionError);
            console.error("[dubina:voice]", e);
          }
        }
      })();
    }, 120);

    return () => {
      cancelled = true;
      window.clearTimeout(boot);
      controller?.stop();
      voiceRef.current?.stop();
      voiceRef.current = null;
    };
  }, [settings.inputDeviceId, voiceEpoch]);

  useEffect(() => {
    const w = window as unknown as {
      __dubina?: {
        playMusic: () => Promise<unknown>;
        match: (phrase: string) => string | null;
      };
    };
    w.__dubina = {
      playMusic: () =>
        invoke("start_music_player", {
          appPath: settingsRef.current.musicAppPath || "",
        }),
      match: (phrase: string) =>
        findBuiltinByPhrase(phrase, settingsRef.current)?.phrase ?? null,
    };
    return () => {
      delete w.__dubina;
    };
  }, []);

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
              <Orb state={listener} onActivate={toggleFromOrb} />
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
                      Я тут...
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
