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
    #[cfg(target_os = "windows")]
    {
        let dir = piper_dir(&app)?;
        if find_piper_bin(&dir).is_none() || find_piper_model(&dir).is_none() {
            return Ok(0);
        }
    }
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
    #[cfg(target_os = "windows")]
    {
        let _ = (text, out);
        return Err("no piper".into());
    }
    #[cfg(not(target_os = "windows"))]
    {
        system_tts_to_file(text, out)
    }
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

    #[cfg(target_os = "windows")]
    {
        let _ = (text, out);
        return Err("web-tts".into());
    }

    #[cfg(target_os = "linux")]
    {
        let out_str = out.to_string_lossy();
        for (bin, extra) in [
            ("espeak-ng", vec!["-v", "ru", "-w", out_str.as_ref()]),
            ("espeak", vec!["-v", "ru", "-w", out_str.as_ref()]),
        ] {
            let mut cmd = Command::new(bin);
            cmd.args(&extra).arg(text);
            if cmd
                .status()
                .map(|s| s.success())
                .unwrap_or(false)
                && out.exists()
            {
                return Ok(());
            }
        }
        return Err("espeak wave failed".into());
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
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

    let path = cache_path(&app, text)?;
    if path.exists() && path.metadata().map(|m| m.len() > 44).unwrap_or(false) {
        return play_wav_file(&path, vol);
    }

    if try_piper_to_file(&app, text, &path).is_ok() {
        return play_wav_file(&path, vol);
    }

    #[cfg(target_os = "windows")]
    {
        let _ = vol;
        return Err("web-tts".into());
    }

    #[cfg(not(target_os = "windows"))]
    {
        if let Ok(cached) = ensure_phrase_cached(&app, text) {
            return play_wav_file(&cached, vol);
        }
        system_tts(text, vol)
    }
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
            #[cfg(target_os = "windows")]
            {
                format!(
                    "Piper не найден — используется системный голос Windows (SAPI).\nДля русского голоса: Параметры → Время и язык → Речь → добавь русский голос.\nИли положи Piper в:\n{p}"
                )
            }
            #[cfg(not(target_os = "windows"))]
            {
                format!(
                    "Piper не найден — пока системный голос.\nПоложи в:\n{p}\n• piper (бинарник)\n• *.onnx + *.onnx.json (русский голос)\nиз https://github.com/OHF-Voice/piper1-gpl"
                )
            }
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
    #[cfg(windows)]
    {
        let mut c = Command::new("where");
        crate::winutil::no_window(&mut c);
        return c
            .arg(name)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false);
    }
    #[cfg(not(windows))]
    {
        Command::new("which")
            .arg(name)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
    }
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

#[cfg(target_os = "windows")]
fn play_wav_winmm(path: &Path) -> bool {
    use std::os::windows::ffi::OsStrExt;
    #[link(name = "winmm")]
    extern "system" {
        fn PlaySoundW(psz_sound: *const u16, hmod: isize, fdw_sound: u32) -> i32;
    }
    const SND_SYNC: u32 = 0x0000;
    const SND_FILENAME: u32 = 0x00020000;
    const SND_NODEFAULT: u32 = 0x0002;
    let wide: Vec<u16> = path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    unsafe {
        PlaySoundW(
            wide.as_ptr(),
            0,
            SND_SYNC | SND_FILENAME | SND_NODEFAULT,
        ) != 0
    }
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
        if play_wav_winmm(path) {
            return Ok(());
        }
        let path_str = path.to_string_lossy().replace('"', "");
        let status = crate::winutil::cmd_exe()
            .args(["/C", "start", "/MIN", "", &path_str])
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
        let _ = (text, vol);
        Err("web-tts".into())
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
    let resolved = resolve_music_app_path(app_path.trim())?;
    let name = music_app_display_name(&resolved);
    let lower = name.to_lowercase();
    let is_yandex = lower.contains("яндекс") || lower.contains("yandex");

    #[cfg(target_os = "macos")]
    {
        if is_yandex {
            return macos_play_yandex(&name, &resolved);
        }
        crate::open_app_inner(&resolved)?;
        macos_force_playback(&name, &resolved);
        return Ok(());
    }

    #[cfg(not(target_os = "macos"))]
    {
        crate::open_app_inner(&resolved)?;
        let path = resolved.clone();
        let name = name.clone();
        thread::spawn(move || {
            let is_shell = path.starts_with("shell:") || path.contains('!');
            if is_shell {
                thread::sleep(Duration::from_millis(1800));
            } else {
                let ok = wait_until_running(&name, Duration::from_secs(5));
                if !ok {
                    thread::sleep(Duration::from_millis(1200));
                } else {
                    thread::sleep(Duration::from_millis(800));
                }
            }

            #[cfg(target_os = "windows")]
            {
                let stem = process_name_from_path(&path);
                let _ = crate::windows_native::focus_exe(&stem);
                thread::sleep(Duration::from_millis(700));
                crate::windows_native::send_media_play_toggle();
                thread::sleep(Duration::from_millis(500));
                let _ = crate::windows_native::focus_exe(&stem);
                thread::sleep(Duration::from_millis(250));
                crate::windows_native::send_media_play();
            }

            #[cfg(target_os = "linux")]
            {
                if crate::media_key_inner("play_pause").is_err() {
                    let _ = Command::new("playerctl").arg("play").status();
                }
            }
        });
        Ok(())
    }
}

fn resolve_music_app_path(preferred: &str) -> Result<String, String> {
    let preferred = preferred.trim();
    if !preferred.is_empty() {
        let path = Path::new(preferred);
        if path.exists() || preferred.starts_with("shell:") || preferred.contains('!') {
            return Ok(preferred.to_string());
        }
        #[cfg(target_os = "macos")]
        {
            if let Some(found) = crate::find_macos_app_fuzzy(preferred) {
                return Ok(found.to_string_lossy().to_string());
            }
        }
    }

    #[cfg(target_os = "macos")]
    {
        for candidate in [
            "/Applications/Яндекс Музыка.app",
            "/Applications/Yandex Music.app",
            "/Applications/Spotify.app",
            "/Applications/Music.app",
            "/System/Applications/Music.app",
        ] {
            if Path::new(candidate).exists() {
                return Ok(candidate.to_string());
            }
        }
        for query in ["Яндекс Музыка", "Yandex Music", "Spotify", "Music"] {
            if let Some(found) = crate::find_macos_app_fuzzy(query) {
                return Ok(found.to_string_lossy().to_string());
            }
        }
    }

    #[cfg(target_os = "windows")]
    {
        let mut candidates: Vec<PathBuf> = Vec::new();
        if let Some(local) = std::env::var_os("LOCALAPPDATA").map(PathBuf::from) {
            candidates.push(local.join("Programs").join("YandexMusic").join("YandexMusic.exe"));
            candidates.push(local.join("YandexMusic").join("YandexMusic.exe"));
            candidates.push(
                local
                    .join("Microsoft")
                    .join("WindowsApps")
                    .join("YandexMusic.exe"),
            );
        }
        if let Some(user) = std::env::var_os("USERPROFILE").map(PathBuf::from) {
            candidates.push(
                user.join("AppData")
                    .join("Roaming")
                    .join("Spotify")
                    .join("Spotify.exe"),
            );
        }
        if let Some(pf) = std::env::var_os("PROGRAMFILES").map(PathBuf::from) {
            candidates.push(pf.join("Spotify").join("Spotify.exe"));
        }
        for c in candidates {
            if c.exists() {
                return Ok(c.to_string_lossy().to_string());
            }
        }
        return Ok("Spotify".to_string());
    }

    #[cfg(target_os = "linux")]
    {
        for bin in ["spotify", "yandex-music", "rhythmbox"] {
            if Command::new("which")
                .arg(bin)
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status()
                .map(|s| s.success())
                .unwrap_or(false)
            {
                return Ok(bin.to_string());
            }
        }
    }

    Err(
        "Не нашёл музыкальный плеер. В настройках выбери Яндекс Музыку или Spotify."
            .into(),
    )
}

fn music_app_display_name(path_or_name: &str) -> String {
    let path = Path::new(path_or_name);
    if path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("app"))
        .unwrap_or(false)
    {
        return path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or(path_or_name)
            .to_string();
    }
    process_name_from_path(path_or_name)
}

#[cfg(target_os = "macos")]
fn macos_play_yandex(app_name: &str, app_path: &str) -> Result<(), String> {
    let name = app_name.replace('"', "");
    let open_target = if Path::new(app_path).exists() {
        app_path.to_string()
    } else {
        name.clone()
    };

    thread::spawn(move || {
        if let Err(e) = ensure_yandex_cdp_and_play(&name, &open_target) {
            eprintln!("[dubina:yandex] {e}");
        }
    });
    Ok(())
}

#[cfg(target_os = "macos")]
fn ensure_yandex_cdp_and_play(name: &str, open_target: &str) -> Result<(), String> {
    use crate::yandex_cdp::{self, debugging_port};

    if !yandex_cdp::cdp_ready() {
        if is_process_running(name) {
            let _ = Command::new("osascript")
                .args(["-e", &format!("tell application \"{name}\" to quit")])
                .status();
            thread::sleep(Duration::from_millis(1200));
            if is_process_running(name) {
                let _ = Command::new("pkill").args(["-f", name]).status();
                thread::sleep(Duration::from_millis(800));
            }
        }

        let port = debugging_port().to_string();
        let status = Command::new("open")
            .args([
                "-g",
                "-a",
                open_target,
                "--args",
                &format!("--remote-debugging-port={port}"),
            ])
            .status()
            .map_err(|e| e.to_string())?;
        if !status.success() {
            return Err("Не удалось запустить Яндекс Музыку с debug-портом".into());
        }
        if !yandex_cdp::wait_cdp_ready(Duration::from_secs(20)) {
            return Err(format!(
                "Яндекс Музыка не открыла debug-порт {port}. Закрой её и скажи «включи музыку» ещё раз."
            ));
        }
        thread::sleep(Duration::from_millis(2500));
    }

    let result = yandex_cdp::play_via_cdp()?;
    eprintln!("[dubina:yandex] cdp play => {result}");
    Ok(())
}

#[cfg(target_os = "macos")]
fn macos_force_playback(app_name: &str, app_path: &str) {
    let name = app_name.replace('"', "");
    let lower = name.to_lowercase();
    let is_spotify = lower.contains("spotify");
    let is_apple_music = lower == "music"
        || (lower.contains("music")
            && !lower.contains("yandex")
            && !lower.contains("яндекс")
            && !is_spotify);

    let already = is_process_running(&name);
    if !already {
        if Path::new(app_path).exists() {
            let _ = Command::new("open").args(["-g", "-a", app_path]).status();
        } else {
            let _ = Command::new("open").args(["-g", "-a", &name]).status();
        }
        let _ = wait_until_running(&name, Duration::from_secs(8));
        thread::sleep(Duration::from_millis(1200));
    }

    if is_spotify {
        let _ = Command::new("osascript")
            .args(["-e", "tell application \"Spotify\" to play"])
            .status();
        return;
    }

    if is_apple_music {
        let _ = Command::new("osascript")
            .args(["-e", "tell application \"Music\" to play"])
            .status();
        return;
    }

    let _ = crate::media_key_inner("play_pause");
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
        if Command::new("pgrep")
            .args(["-if", name])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
        {
            return true;
        }
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
        false
    }

    #[cfg(target_os = "windows")]
    {
        let exe = if name.to_lowercase().ends_with(".exe") {
            name.to_string()
        } else {
            format!("{name}.exe")
        };
        let output = {
            let mut c = Command::new("tasklist");
            crate::winutil::no_window(&mut c);
            c.args(["/FI", &format!("IMAGENAME eq {exe}"), "/NH"])
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::null())
                .output()
        };
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
