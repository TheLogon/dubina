use serde_json::{json, Value};
use std::net::TcpStream;
use std::thread;
use std::time::{Duration, Instant};
use tungstenite::{client::IntoClientRequest, connect, Message};

const CDP_PORT: u16 = 19222;

pub fn cdp_ready() -> bool {
    ureq::get(&format!("http://127.0.0.1:{CDP_PORT}/json/version"))
        .timeout(Duration::from_millis(400))
        .call()
        .is_ok()
}

pub fn wait_cdp_ready(timeout: Duration) -> bool {
    let start = Instant::now();
    while start.elapsed() < timeout {
        if cdp_ready() {
            return true;
        }
        thread::sleep(Duration::from_millis(250));
    }
    false
}

fn list_targets() -> Result<Vec<Value>, String> {
    let body = ureq::get(&format!("http://127.0.0.1:{CDP_PORT}/json/list"))
        .timeout(Duration::from_secs(2))
        .call()
        .map_err(|e| format!("CDP list: {e}"))?
        .into_string()
        .map_err(|e| e.to_string())?;
    serde_json::from_str(&body).map_err(|e| e.to_string())
}

fn pick_ws_url(targets: &[Value]) -> Option<String> {
    let mut fallback = None;
    for t in targets {
        let typ = t.get("type").and_then(|v| v.as_str()).unwrap_or("");
        if typ != "page" && typ != "webview" {
            continue;
        }
        let url = t.get("url").and_then(|v| v.as_str()).unwrap_or("");
        let title = t.get("title").and_then(|v| v.as_str()).unwrap_or("");
        let ws = t
            .get("webSocketDebuggerUrl")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())?;
        let blob = format!("{url} {title}").to_lowercase();
        if blob.contains("music.yandex")
            || blob.contains("yandex")
            || blob.contains("музык")
            || url.starts_with("https://")
            || url.starts_with("http://")
            || url.starts_with("file:")
            || url.is_empty()
            || url == "about:blank"
        {
            if blob.contains("music.yandex") || blob.contains("музык") {
                return Some(ws);
            }
            if fallback.is_none() && (typ == "page" || typ == "webview") {
                fallback = Some(ws);
            }
        }
    }
    fallback.or_else(|| {
        targets.iter().find_map(|t| {
            t.get("webSocketDebuggerUrl")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
        })
    })
}

fn eval_js(ws_url: &str, expression: &str) -> Result<String, String> {
    let req = ws_url
        .into_client_request()
        .map_err(|e| e.to_string())?;
    let (mut socket, _) = connect(req).map_err(|e| format!("CDP ws: {e}"))?;

    let payload = json!({
        "id": 1,
        "method": "Runtime.evaluate",
        "params": {
            "expression": expression,
            "awaitPromise": true,
            "returnByValue": true,
        }
    });
    socket
        .send(Message::Text(payload.to_string().into()))
        .map_err(|e| e.to_string())?;

    let deadline = Instant::now() + Duration::from_secs(4);
    while Instant::now() < deadline {
        let msg = socket.read().map_err(|e| e.to_string())?;
        let Message::Text(text) = msg else { continue };
        let v: Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
        if v.get("id").and_then(|x| x.as_u64()) != Some(1) {
            continue;
        }
        if let Some(err) = v.get("error") {
            return Err(err.to_string());
        }
        let result = v
            .pointer("/result/result/value")
            .cloned()
            .unwrap_or(Value::Null);
        return Ok(match result {
            Value::String(s) => s,
            other => other.to_string(),
        });
    }
    Err("CDP timeout".into())
}

const PLAY_JS: &str = r#"(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const label = (el) =>
    (
      (el.getAttribute && (el.getAttribute("aria-label") || el.getAttribute("title") || "")) +
      " " +
      ((el.textContent || "").trim())
    ).toLowerCase();

  const isPause = (el) => /пауза|pause|остановить/.test(label(el));
  const isPlay = (el) => /слушать|play|воспроиз|моя волна/.test(label(el));

  const buttons = Array.from(document.querySelectorAll("button, [role='button'], a"));
  const pauseBtn = buttons.find(isPause);
  if (pauseBtn) return "already-playing";

  const sels = [
    '[data-test-id="PLAY_BUTTON"]',
    '[data-testid="play-button"]',
    'button[aria-label*="Слушать" i]',
    'button[aria-label*="Play" i]',
    'button[aria-label*="Моя волна" i]',
    '.player-controls__btn_play',
    '[class*="PlayButton"]',
    '[class*="playButton"]',
  ];
  for (const s of sels) {
    const el = document.querySelector(s);
    if (el) {
      el.click();
      await sleep(80);
      return "clicked:" + s;
    }
  }

  const playBtn = buttons.find(isPlay);
  if (playBtn) {
    playBtn.click();
    await sleep(80);
    return "clicked:label";
  }

  const any = document.querySelector('[class*="PlayerBar"] button, [class*="player"] button');
  if (any) {
    any.click();
    return "clicked:fallback";
  }
  return "miss";
})()"#;

pub fn play_via_cdp() -> Result<String, String> {
    let targets = list_targets()?;
    let ws = pick_ws_url(&targets).ok_or_else(|| "Нет CDP page для Яндекс Музыки".to_string())?;
    let mut last = String::new();
    for _ in 0..3 {
        last = eval_js(&ws, PLAY_JS)?;
        if last.starts_with("clicked") || last == "already-playing" {
            return Ok(last);
        }
        thread::sleep(Duration::from_millis(700));
    }
    Err(format!("Play не нашёл кнопку ({last})"))
}

pub fn debugging_port() -> u16 {
    CDP_PORT
}

pub fn launch_args() -> Vec<String> {
    vec![format!("--remote-debugging-port={CDP_PORT}")]
}

#[allow(dead_code)]
fn _tcp_probe() {
    let _ = TcpStream::connect(("127.0.0.1", CDP_PORT));
}
