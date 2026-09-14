use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};

fn cache_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = piper_dir(app)?.join("cache");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn cache_path(app: &AppHandle, text: &str) -> Result<PathBuf, String> {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut h = DefaultHasher::new();
    text.hash(&mut h);
    Ok(cache_dir(app)?.join(format!("{:x}.wav", h.finish())))
}

#[tauri::command]
pub fn tts_warm_cache(app: AppHandle, phrases: Vec<String>) -> Result<u32, String> {
    let n = phrases.len() as u32;
    thread::spawn(move || {
        for raw in phrases {
            let text = raw.trim();
            if text.is_empty() {
                continue;
            }
            let _ = ensure_phrase_cached(&app, text);
        }
    });
    Ok(n)
}

fn ensure_phrase_cached(app: &AppHandle, text: &str) -> Result<PathBuf, String> {
    let path = cache_path(app, text)?;
    if path.exists() && path.metadata().map(|m| m.len() > 44).unwrap_or(false) {
        return Ok(path);
    }
    synthesize_to_file(app, text, &path)?;
    Ok(path)
}

fn synthesize_to_file(app: &AppHandle, text: &str, out: &Path) -> Result<(), String> {
    if try_piper_to_file(app, text, out).is_ok() {
        return Ok(());
    }
    system_tts_to_file(text, out)
}

fn try_piper_to_file(app: &AppHandle, text: &str, out: &Path) -> Result<(), String> {
    let dir = piper_dir(app)?;
    let bin = find_piper_bin(&dir).ok_or("no piper")?;
    let model = find_piper_model(&dir).ok_or("no model")?;

    if let Some(parent) = out.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let mut child = Command::new(&bin)
        .args([
            "--model",
            model.to_str().ok_or("model path")?,
            "--output_file",
            out.to_str().ok_or("out path")?,
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| e.to_string())?;

    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(text.as_bytes())
            .map_err(|e| e.to_string())?;
    }

    let status = child.wait().map_err(|e| e.to_string())?;
    if !status.success() {
        return Err("piper failed".into());
    }
    if !out.exists() {
        return Err("piper produced no wav".into());
    }
    Ok(())
}

fn system_tts_to_file(text: &str, out: &Path) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        
        for voice in ["Milena", "Yuri", "Katya", "Milena (Premium)"] {
            let status = Command::new("say")
                .args(["-v", voice, "-r", "210", "-o"])
                .arg(out)
                .arg("--data-format=LEI16@22050")
                .arg(text)
                .status()
                .map_err(|e| e.to_string())?;
            if status.success() && out.exists() {
                return Ok(());
            }
        }
        let status = Command::new("say")
            .args(["-r", "210", "-o"])
            .arg(out)
            .arg(text)
            .status()
            .map_err(|e| e.to_string())?;
        if status.success() && out.exists() {
            return Ok(());
        }
        return Err("say failed".into());
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (text, out);
        Err("system cache unsupported".into())
    }
}

#[tauri::command]
pub fn tts_speak(app: AppHandle, text: String, volume: Option<f32>) -> Result<(), String> {
    let text = text.trim();
    if text.is_empty() {
        return Ok(());
    }
    let vol = volume.unwrap_or(1.0).clamp(0.0, 1.0);

    
    if let Ok(cached) = cache_path(&app, text) {
        if cached.exists() {
            return play_wav_file(&cached, vol);
        }
    }

    
    if let Ok(path) = ensure_phrase_cached(&app, text) {
        return play_wav_file(&path, vol);
    }

    system_tts(text, vol)
}

#[tauri::command]
pub fn tts_status(app: AppHandle) -> Result<String, String> {
    let dir = piper_dir(&app)?;
    let bin = find_piper_bin(&dir);
    let model = find_piper_model(&dir);
    Ok(match (bin, model) {
        (Some(b), Some(m)) => format!(
            "Piper готов\n{}\n{}",
            b.display(),
            m.display()
        ),
        (None, Some(_)) => "Модель есть, но нет бинарника piper. Положи piper в папку голоса.".into(),
        (Some(_), None) => "Есть piper, нет .onnx модели. Положи русский голос Piper в папку.".into(),
        _ => {
            let p = dir.display().to_string();
            format!(
                "Piper не найден — пока системный голос.\nПоложи в:\n{p}\n• piper (бинарник)\n• *.onnx + *.onnx.json (русский голос)\nиз https://github.com/OHF-Voice/piper1-gpl"
            )
        }
    })
}

#[tauri::command]
pub fn tts_dir(app: AppHandle) -> Result<String, String> {
    let dir = piper_dir(&app)?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.to_string_lossy().to_string())
}

fn piper_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("piper");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn find_piper_bin(dir: &Path) -> Option<PathBuf> {
    let local = if cfg!(windows) {
        dir.join("piper.exe")
    } else {
        dir.join("piper")
    };
    if local.exists() {
        return Some(local);
    }
    if which_exists("piper") {
        return Some(PathBuf::from("piper"));
    }
    None
}

fn which_exists(name: &str) -> bool {
    Command::new("which")
        .arg(name)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
        || Command::new("where")
            .arg(name)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
}

fn find_piper_model(dir: &Path) -> Option<PathBuf> {
    let Ok(entries) = fs::read_dir(dir) else {
        return None;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) == Some("onnx") {
            return Some(path);
        }
    }
    None
}

fn play_wav_file(path: &Path, volume: f32) -> Result<(), String> {
    let vol = volume.clamp(0.0, 1.0);
    #[cfg(target_os = "macos")]
    {
        let status = Command::new("afplay")
            .args(["-v", &vol.to_string()])
            .arg(path)
            .status()
            .map_err(|e| e.to_string())?;
        if status.success() {
            return Ok(());
        }
    }
    #[cfg(target_os = "windows")]
    {
        let _ = vol;
        let ps = format!(
            r#"(New-Object Media.SoundPlayer "{}").PlaySync()"#,
            path.to_string_lossy().replace('"', "")
        );
        let status = Command::new("powershell")
            .args(["-NoProfile", "-Command", &ps])
            .status()
            .map_err(|e| e.to_string())?;
        if status.success() {
            return Ok(());
        }
    }
    #[cfg(target_os = "linux")]
    {
        let pulse_vol = (vol * 65536.0).round() as u32;
        if Command::new("paplay")
            .args(["--volume", &pulse_vol.to_string()])
            .arg(path)
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
        {
            return Ok(());
        }
        for player in ["aplay", "ffplay"] {
            let mut cmd = Command::new(player);
            if player == "ffplay" {
                cmd.args([
                    "-nodisp",
                    "-autoexit",
                    "-volume",
                    &((vol * 100.0) as i32).to_string(),
                ]);
            }
            cmd.arg(path);
            if cmd
                .status()
                .map(|s| s.success())
                .unwrap_or(false)
            {
                return Ok(());
            }
        }
    }
    Err("Не удалось проиграть wav".into())
}

fn system_tts(text: &str, volume: f32) -> Result<(), String> {
    let vol = volume.clamp(0.0, 1.0);
    #[cfg(target_os = "macos")]
    {
        let out = std::env::temp_dir().join("dubina_tts.aiff");
        for voice in ["Milena", "Yuri", "Katya", "Milena (Premium)"] {
            let status = Command::new("say")
                .args(["-v", voice, "-o"])
                .arg(&out)
                .arg(text)
                .status()
                .map_err(|e| e.to_string())?;
            if status.success() {
                return play_wav_file(&out, vol);
            }
        }
        let status = Command::new("say")
            .args(["-o"])
            .arg(&out)
            .arg(text)
            .status()
            .map_err(|e| e.to_string())?;
        if status.success() {
            return play_wav_file(&out, vol);
        }
        return Err("say failed".into());
    }

    #[cfg(target_os = "windows")]
    {
        let escaped = text.replace('\'', "''");
        let pct = (vol * 100.0).round() as i32;
        let ps = format!(
            "Add-Type -AssemblyName System.Speech; $s=New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.Rate=0; $s.Volume={pct}; $s.Speak('{escaped}')"
        );
        let status = Command::new("powershell")
            .args(["-NoProfile", "-Command", &ps])
            .status()
            .map_err(|e| e.to_string())?;
        if status.success() {
            return Ok(());
        }
        return Err("SAPI TTS failed".into());
    }

    #[cfg(target_os = "linux")]
    {
        let amp = format!("-a{}", (vol * 200.0).round() as i32);
        for (bin, args) in [
            ("espeak-ng", vec!["-v", "ru", amp.as_str()]),
            ("espeak", vec!["-v", "ru", amp.as_str()]),
            ("festival", vec!["--tts"]),
        ] {
            let mut cmd = Command::new(bin);
            cmd.args(&args).arg(text);
            if cmd
                .status()
                .map(|s| s.success())
                .unwrap_or(false)
            {
                return Ok(());
            }
        }
        return Err("Нет espeak/festival для TTS".into());
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        let _ = (text, vol);
        Err("TTS не поддерживается".into())
    }
}

#[tauri::command]
pub fn start_music_player(app_path: String) -> Result<(), String> {
    let app_path = app_path.trim();
    if app_path.is_empty() {
        return Err(
            "В настройках выбери программу для музыки (Яндекс Музыка, Spotify…)"
                .into(),
        );
    }

    crate::open_app_inner(app_path)?;

    let name = process_name_from_path(app_path);
    let ok = wait_until_running(&name, Duration::from_secs(25));
    if !ok {
        return Err(format!(
            "Приложение «{name}» не запустилось вовремя. Проверь путь в настройках."
        ));
    }

    
    thread::sleep(Duration::from_millis(1200));

    #[cfg(target_os = "macos")]
    {
        let _ = Command::new("osascript")
            .args([
                "-e",
                &format!("tell application \"{name}\" to activate"),
            ])
            .status();
        thread::sleep(Duration::from_millis(400));
    }

    
    if crate::media_key_inner("play_pause").is_err() {
        #[cfg(target_os = "macos")]
        {
            let _ = Command::new("osascript")
                .args(["-e", "tell application \"System Events\" to keystroke space"])
                .status();
        }
    }
    Ok(())
}

fn process_name_from_path(path_or_name: &str) -> String {
    Path::new(path_or_name)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or(path_or_name)
        .to_string()
}

fn wait_until_running(name: &str, timeout: Duration) -> bool {
    let start = Instant::now();
    while start.elapsed() < timeout {
        if is_process_running(name) {
            return true;
        }
        thread::sleep(Duration::from_millis(350));
    }
    false
}

fn is_process_running(name: &str) -> bool {
    #[cfg(target_os = "macos")]
    {
        
        let script = format!(
            "tell application \"System Events\" to (name of processes) contains \"{}\"",
            name.replace('"', "")
        );
        if let Ok(output) = Command::new("osascript").args(["-e", &script]).output() {
            let out = String::from_utf8_lossy(&output.stdout).trim().to_lowercase();
            if out == "true" {
                return true;
            }
        }
        Command::new("pgrep")
            .args(["-if", name])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
    }

    #[cfg(target_os = "windows")]
    {
        let exe = if name.to_lowercase().ends_with(".exe") {
            name.to_string()
        } else {
            format!("{name}.exe")
        };
        let output = Command::new("tasklist")
            .args(["/FI", &format!("IMAGENAME eq {exe}"), "/NH"])
            .output();
        if let Ok(o) = output {
            let s = String::from_utf8_lossy(&o.stdout).to_lowercase();
            return s.contains(&exe.to_lowercase());
        }
        false
    }

    #[cfg(target_os = "linux")]
    {
        Command::new("pgrep")
            .args(["-f", name])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        let _ = name;
        false
    }
}
