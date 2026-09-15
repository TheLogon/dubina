#![cfg(windows)]

use arboard::Clipboard;
use std::os::windows::process::CommandExt;
use std::path::PathBuf;
use std::thread;
use std::time::Duration;
use windows::Win32::UI::Input::KeyboardAndMouse::{
    keybd_event, KEYBD_EVENT_FLAGS, KEYEVENTF_KEYUP, VK_CONTROL, VK_MEDIA_NEXT_TRACK,
    VK_MEDIA_PLAY_PAUSE, VK_MEDIA_PREV_TRACK,
};

const CREATE_NO_WINDOW: u32 = 0x08000000;

pub fn send_media_key(action: &str) -> Result<(), String> {
    let vk = match action {
        "play_pause" => VK_MEDIA_PLAY_PAUSE,
        "next" => VK_MEDIA_NEXT_TRACK,
        "previous" => VK_MEDIA_PREV_TRACK,
        _ => return Err(format!("Неизвестное медиа-действие: {action}")),
    };
    unsafe {
        keybd_event(vk.0 as u8, 0, KEYBD_EVENT_FLAGS(0), 0);
        keybd_event(vk.0 as u8, 0, KEYEVENTF_KEYUP, 0);
    }
    Ok(())
}

pub fn paste_text(text: &str) -> Result<(), String> {
    {
        let mut clipboard = Clipboard::new().map_err(|e| e.to_string())?;
        clipboard
            .set_text(text.to_string())
            .map_err(|e| e.to_string())?;
    }
    thread::sleep(Duration::from_millis(60));
    unsafe {
        keybd_event(VK_CONTROL.0 as u8, 0, KEYBD_EVENT_FLAGS(0), 0);
        keybd_event(0x56, 0, KEYBD_EVENT_FLAGS(0), 0);
        keybd_event(0x56, 0, KEYEVENTF_KEYUP, 0);
        keybd_event(VK_CONTROL.0 as u8, 0, KEYEVENTF_KEYUP, 0);
    }
    Ok(())
}

pub fn pick_exe_file() -> Result<Option<(String, String)>, String> {
    let file = rfd::FileDialog::new()
        .add_filter("Programs", &["exe"])
        .set_title("Выбери программу")
        .pick_file();
    let Some(path) = file else {
        return Ok(None);
    };
    let name = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("App")
        .to_string();
    Ok(Some((name, path.to_string_lossy().to_string())))
}

pub fn open_path_or_shell(target: &str) -> Result<(), String> {
    if target.starts_with("shell:") || target.contains('!') {
        let status = std::process::Command::new("explorer")
            .arg(target)
            .creation_flags(CREATE_NO_WINDOW)
            .status()
            .map_err(|e| e.to_string())?;
        if status.success() {
            return Ok(());
        }
    }
    open::that(target).map_err(|e| e.to_string())
}

pub fn collect_apps(apps: &mut Vec<(String, String)>) {
    push_known(apps);

    let roots = [
        std::env::var_os("ProgramData")
            .map(|p| PathBuf::from(p).join(r"Microsoft\Windows\Start Menu\Programs")),
        std::env::var_os("AppData")
            .map(|p| PathBuf::from(p).join(r"Microsoft\Windows\Start Menu\Programs")),
        std::env::var_os("LOCALAPPDATA").map(|p| PathBuf::from(p).join("Programs")),
    ];

    for root in roots.into_iter().flatten() {
        if !root.exists() {
            continue;
        }
        for entry in walkdir::WalkDir::new(&root)
            .follow_links(false)
            .max_depth(5)
            .into_iter()
            .filter_map(|e| e.ok())
        {
            let path = entry.path();
            let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
            if !ext.eq_ignore_ascii_case("exe") {
                continue;
            }
            let name = path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("App");
            if is_junk_name(name) {
                continue;
            }
            let path_str = path.to_string_lossy();
            if is_junk_path(&path_str) {
                continue;
            }
            apps.push((name.to_string(), path_str.to_string()));
            if apps.len() > 400 {
                return;
            }
        }
    }
}

fn push_known(apps: &mut Vec<(String, String)>) {
    let mut candidates: Vec<(&str, PathBuf)> = Vec::new();
    if let Some(local) = std::env::var_os("LOCALAPPDATA").map(PathBuf::from) {
        candidates.extend([
            (
                "Яндекс Музыка",
                local.join(r"Programs\YandexMusic\YandexMusic.exe"),
            ),
            (
                "Яндекс Музыка",
                local.join(r"Yandex\YandexMusic\YandexMusic.exe"),
            ),
            ("Spotify", local.join(r"Spotify\Spotify.exe")),
            (
                "Chrome",
                local.join(r"Google\Chrome\Application\chrome.exe"),
            ),
            ("Telegram", local.join(r"Telegram Desktop\Telegram.exe")),
        ]);
    }
    for key in ["ProgramFiles", "ProgramFiles(x86)"] {
        if let Some(pf) = std::env::var_os(key).map(PathBuf::from) {
            candidates.push((
                "Яндекс Музыка",
                pf.join(r"Yandex\YandexMusic\YandexMusic.exe"),
            ));
            candidates.push(("Spotify", pf.join(r"Spotify\Spotify.exe")));
            candidates.push(("Chrome", pf.join(r"Google\Chrome\Application\chrome.exe")));
        }
    }
    for (name, path) in candidates {
        if path.is_file() {
            apps.push((name.into(), path.to_string_lossy().to_string()));
        }
    }
}

fn is_junk_name(name: &str) -> bool {
    let n = name.to_lowercase();
    n.starts_with("unins")
        || n.contains("setup")
        || n.contains("update")
        || n.contains("crash")
        || n.contains("helper")
        || n == "install"
}

fn is_junk_path(path: &str) -> bool {
    let p = path.to_lowercase();
    p.contains("\\uninstall") || p.contains("\\update") || p.contains("\\crash") || p.contains("\\helper")
}
