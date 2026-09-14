use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
#[cfg(any(target_os = "macos", target_os = "linux"))]
use std::io::Write;
#[cfg(any(target_os = "macos", target_os = "linux"))]
use std::process::Stdio;
use serde::Serialize;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager,
};
#[cfg(target_os = "macos")]
use tauri_plugin_autostart::MacosLauncher;

mod tts;

#[derive(Debug, Clone, Serialize)]
struct InstalledApp {
    name: String,
    path: String,
}

#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    open::that(&url).map_err(|e| e.to_string())
}

#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

#[tauri::command]
fn open_default_browser() -> Result<(), String> {
    
    open::that("https://").map_err(|e| e.to_string())
}

#[tauri::command]
fn list_installed_apps() -> Result<Vec<InstalledApp>, String> {
    let mut apps: Vec<InstalledApp> = Vec::new();

    #[cfg(target_os = "macos")]
    {
        let dirs = [
            PathBuf::from("/Applications"),
            PathBuf::from("/System/Applications"),
            dirs_home().map(|h| h.join("Applications")).unwrap_or_default(),
        ];
        for dir in dirs {
            if !dir.exists() {
                continue;
            }
            collect_macos_apps(&dir, &mut apps);
        }
    }

    #[cfg(target_os = "windows")]
    {
        
        let program_files = std::env::var("ProgramFiles").unwrap_or_else(|_| r"C:\Program Files".into());
        let program_files_x86 =
            std::env::var("ProgramFiles(x86)").unwrap_or_else(|_| r"C:\Program Files (x86)".into());
        for dir in [program_files, program_files_x86] {
            collect_windows_exes(Path::new(&dir), &mut apps, 0);
        }
    }

    #[cfg(target_os = "linux")]
    {
        let dirs = [
            PathBuf::from("/usr/share/applications"),
            dirs_home()
                .map(|h| h.join(".local/share/applications"))
                .unwrap_or_default(),
        ];
        for dir in dirs {
            collect_linux_desktop(&dir, &mut apps);
        }
    }

    apps.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    apps.dedup_by(|a, b| a.path == b.path);
    Ok(apps)
}

fn dirs_home() -> Option<PathBuf> {
    std::env::var_os("HOME").map(PathBuf::from)
}

#[cfg(target_os = "macos")]
fn collect_macos_apps(dir: &Path, apps: &mut Vec<InstalledApp>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) == Some("app") {
            let name = path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("App")
                .to_string();
            apps.push(InstalledApp {
                name,
                path: path.to_string_lossy().to_string(),
            });
        }
    }
}

#[cfg(target_os = "windows")]
fn collect_windows_exes(dir: &Path, apps: &mut Vec<InstalledApp>, depth: u8) {
    if depth > 2 {
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_windows_exes(&path, apps, depth + 1);
        } else if path.extension().and_then(|e| e.to_str()) == Some("exe") {
            let name = path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("App")
                .to_string();
            apps.push(InstalledApp {
                name,
                path: path.to_string_lossy().to_string(),
            });
        }
    }
}

#[cfg(target_os = "linux")]
fn collect_linux_desktop(dir: &Path, apps: &mut Vec<InstalledApp>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("desktop") {
            continue;
        }
        let Ok(content) = fs::read_to_string(&path) else {
            continue;
        };
        let mut name = None;
        let mut exec = None;
        let mut nodisplay = false;
        for line in content.lines() {
            if let Some(v) = line.strip_prefix("Name=") {
                if name.is_none() {
                    name = Some(v.trim().to_string());
                }
            } else if let Some(v) = line.strip_prefix("Exec=") {
                exec = Some(v.split_whitespace().next().unwrap_or("").to_string());
            } else if line == "NoDisplay=true" {
                nodisplay = true;
            }
        }
        if nodisplay {
            continue;
        }
        if let (Some(name), Some(exec)) = (name, exec) {
            if !exec.is_empty() {
                apps.push(InstalledApp { name, path: exec });
            }
        }
    }
}

#[tauri::command]
fn open_app(name: String) -> Result<(), String> {
    open_app_inner(&name)
}

pub(crate) fn open_app_inner(name: &str) -> Result<(), String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("Укажи программу".into());
    }

    
    let as_path = Path::new(name);
    if as_path.exists() {
        #[cfg(target_os = "macos")]
        {
            Command::new("open")
                .arg(as_path)
                .status()
                .map_err(|e| e.to_string())?;
            return Ok(());
        }
        #[cfg(not(target_os = "macos"))]
        {
            open::that(as_path).map_err(|e| e.to_string())?;
            return Ok(());
        }
    }

    #[cfg(target_os = "macos")]
    {
        
        let status = Command::new("open")
            .args(["-a", name])
            .status()
            .map_err(|e| e.to_string())?;
        if status.success() {
            return Ok(());
        }

        if let Some(found) = find_macos_app_fuzzy(name) {
            Command::new("open")
                .arg(&found)
                .status()
                .map_err(|e| e.to_string())?;
            return Ok(());
        }

        return Err(format!(
            "Не найдено приложение «{name}». Выбери его из списка в редакторе."
        ));
    }

    #[cfg(target_os = "windows")]
    {
        let status = Command::new("cmd")
            .args(["/C", "start", "", name])
            .status()
            .map_err(|e| e.to_string())?;
        if !status.success() {
            return Err(format!("Не удалось открыть: {name}"));
        }
        return Ok(());
    }

    #[cfg(target_os = "linux")]
    {
        return Command::new(name)
            .spawn()
            .map(|_| ())
            .or_else(|_| open::that(name).map_err(|e| e.to_string()));
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        Err("Платформа не поддерживается".into())
    }
}

#[cfg(target_os = "macos")]
fn find_macos_app_fuzzy(query: &str) -> Option<PathBuf> {
    let q = query.to_lowercase().replace('ё', "е");
    let mut apps = Vec::new();
    for dir in [
        PathBuf::from("/Applications"),
        PathBuf::from("/System/Applications"),
        dirs_home()?.join("Applications"),
    ] {
        collect_macos_apps(&dir, &mut apps);
    }
    
    let mut best: Option<(usize, PathBuf)> = None;
    for app in apps {
        let n = app.name.to_lowercase().replace('ё', "е");
        let score = if n == q {
            0
        } else if n.contains(&q) || q.contains(&n) {
            1
        } else {
            continue;
        };
        let path = PathBuf::from(app.path);
        match &best {
            None => best = Some((score, path)),
            Some((s, _)) if score < *s => best = Some((score, path)),
            _ => {}
        }
    }
    best.map(|(_, p)| p)
}

#[tauri::command]
fn close_app(name: String) -> Result<(), String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("Укажи название программы".into());
    }

    
    let app_name = Path::new(name)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or(name);

    #[cfg(target_os = "macos")]
    {
        let script = format!(
            "tell application \"{}\" to quit",
            app_name.replace('"', "")
        );
        let status = Command::new("osascript")
            .args(["-e", &script])
            .status()
            .map_err(|e| e.to_string())?;
        if !status.success() {
            let _ = Command::new("pkill").args(["-f", app_name]).status();
        }
        return Ok(());
    }

    #[cfg(target_os = "windows")]
    {
        let exe = if app_name.to_lowercase().ends_with(".exe") {
            app_name.to_string()
        } else {
            format!("{app_name}.exe")
        };
        let _ = Command::new("taskkill")
            .args(["/IM", &exe, "/F"])
            .status()
            .map_err(|e| e.to_string())?;
        return Ok(());
    }

    #[cfg(target_os = "linux")]
    {
        let _ = Command::new("pkill")
            .args(["-f", app_name])
            .status()
            .map_err(|e| e.to_string())?;
        return Ok(());
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        Err("Платформа не поддерживается".into())
    }
}

#[tauri::command]
fn media_key(action: String) -> Result<(), String> {
    media_key_inner(action.trim())
}

#[tauri::command]
fn type_text(text: String) -> Result<(), String> {
    let text = text.trim_end();
    if text.is_empty() {
        return Ok(());
    }
    type_text_inner(text)
}

fn type_text_inner(text: &str) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let mut child = Command::new("pbcopy")
            .stdin(Stdio::piped())
            .spawn()
            .map_err(|e| e.to_string())?;
        if let Some(mut stdin) = child.stdin.take() {
            stdin
                .write_all(text.as_bytes())
                .map_err(|e| e.to_string())?;
        }
        let status = child.wait().map_err(|e| e.to_string())?;
        if !status.success() {
            return Err("pbcopy failed".into());
        }
        std::thread::sleep(std::time::Duration::from_millis(80));
        let status = Command::new("osascript")
            .args([
                "-e",
                "tell application \"System Events\" to keystroke \"v\" using command down",
            ])
            .status()
            .map_err(|e| e.to_string())?;
        if !status.success() {
            return Err(
                "Не удалось вставить текст. Дай Дубине доступ в «Универсальный доступ»."
                    .into(),
            );
        }
        return Ok(());
    }

    #[cfg(target_os = "windows")]
    {
        let b64 = base64_encode(text.as_bytes());
        let ps = format!(
            r#"
$bytes = [Convert]::FromBase64String('{b64}')
$text = [Text.Encoding]::UTF8.GetString($bytes)
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.Clipboard]::SetText($text)
Start-Sleep -Milliseconds 80
[System.Windows.Forms.SendKeys]::SendWait('^v')
"#
        );
        let status = Command::new("powershell")
            .args(["-NoProfile", "-Command", &ps])
            .status()
            .map_err(|e| e.to_string())?;
        if !status.success() {
            return Err("Не удалось вставить текст".into());
        }
        return Ok(());
    }

    #[cfg(target_os = "linux")]
    {
        let ok_clip = if Command::new("wl-copy")
            .arg(text)
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
        {
            true
        } else {
            let mut child = Command::new("xclip")
                .args(["-selection", "clipboard"])
                .stdin(Stdio::piped())
                .spawn()
                .ok();
            if let Some(ref mut c) = child {
                if let Some(mut stdin) = c.stdin.take() {
                    let _ = stdin.write_all(text.as_bytes());
                }
                c.wait().map(|s| s.success()).unwrap_or(false)
            } else {
                false
            }
        };
        if !ok_clip {
            return Err("Нужен wl-copy или xclip".into());
        }
        std::thread::sleep(std::time::Duration::from_millis(80));
        if Command::new("xdotool")
            .args(["key", "ctrl+v"])
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
        {
            return Ok(());
        }
        if Command::new("ydotool")
            .args(["key", "29:1", "47:1", "47:0", "29:0"])
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
        {
            return Ok(());
        }
        return Err("Нужен xdotool или ydotool для вставки".into());
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        Err("type_text не поддерживается".into())
    }
}

#[cfg(target_os = "windows")]
fn base64_encode(bytes: &[u8]) -> String {
    const TABLE: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::new();
    for chunk in bytes.chunks(3) {
        let mut n = (chunk[0] as u32) << 16;
        if chunk.len() > 1 {
            n |= (chunk[1] as u32) << 8;
        }
        if chunk.len() > 2 {
            n |= chunk[2] as u32;
        }
        out.push(TABLE[((n >> 18) & 63) as usize] as char);
        out.push(TABLE[((n >> 12) & 63) as usize] as char);
        if chunk.len() > 1 {
            out.push(TABLE[((n >> 6) & 63) as usize] as char);
        } else {
            out.push('=');
        }
        if chunk.len() > 2 {
            out.push(TABLE[(n & 63) as usize] as char);
        } else {
            out.push('=');
        }
    }
    out
}

#[cfg(target_os = "macos")]
fn post_media_key_macos(key: i64) -> Result<(), String> {
    use objc2_app_kit::{NSEvent, NSEventModifierFlags, NSEventType};
    use objc2_core_graphics::{CGEvent, CGEventTapLocation};
    use objc2_foundation::NSPoint;

    for down in [true, false] {
        let flags = NSEventModifierFlags(if down { 0xa00 } else { 0xb00 });
        let data1 = ((key << 16) | ((if down { 0xa } else { 0xb }) << 8)) as isize;
        let Some(ns_event) =
            NSEvent::otherEventWithType_location_modifierFlags_timestamp_windowNumber_context_subtype_data1_data2(
                NSEventType::SystemDefined,
                NSPoint::new(0.0, 0.0),
                flags,
                0.0,
                0,
                None,
                8,
                data1,
                -1,
            )
        else {
            return Err("Не удалось создать media-событие".into());
        };
        let Some(cg) = ns_event.CGEvent() else {
            return Err("Нет CGEvent для media-клавиши".into());
        };
        CGEvent::post(CGEventTapLocation::HIDEventTap, Some(&cg));
    }
    Ok(())
}

pub(crate) fn media_key_inner(action: &str) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let key: i64 = match action {
            "play_pause" => 16, 
            "next" => 17,       
            "previous" => 18,   
            _ => return Err(format!("Неизвестное медиа-действие: {action}")),
        };
        return post_media_key_macos(key);
    }

    #[cfg(target_os = "windows")]
    {
        let vk: u8 = match action {
            "play_pause" => 0xB3,
            "next" => 0xB0,
            "previous" => 0xB1,
            _ => return Err(format!("Неизвестное медиа-действие: {action}")),
        };
        let ps = format!(
            r#"
Add-Type -TypeDefinition @"
using System.Runtime.InteropServices;
public class Media {{
  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, uint dwExtraInfo);
}}
"@
[Media]::keybd_event({vk}, 0, 0, 0)
[Media]::keybd_event({vk}, 0, 2, 0)
"#
        );
        let status = Command::new("powershell")
            .args(["-NoProfile", "-Command", &ps])
            .status()
            .map_err(|e| e.to_string())?;
        if !status.success() {
            return Err("Не удалось отправить медиа-клавишу".into());
        }
        return Ok(());
    }

    #[cfg(target_os = "linux")]
    {
        let key = match action {
            "play_pause" => "XF86AudioPlay",
            "next" => "XF86AudioNext",
            "previous" => "XF86AudioPrev",
            _ => return Err(format!("Неизвестное медиа-действие: {action}")),
        };
        if Command::new("playerctl")
            .arg(match action {
                "play_pause" => "play-pause",
                "next" => "next",
                "previous" => "previous",
                _ => "",
            })
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
        {
            return Ok(());
        }
        let status = Command::new("xdotool")
            .args(["key", key])
            .status()
            .map_err(|e| e.to_string())?;
        if !status.success() {
            return Err("Нужен playerctl или xdotool для медиа".into());
        }
        return Ok(());
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        Err("Платформа не поддерживается".into())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin({
            #[cfg(target_os = "macos")]
            {
                tauri_plugin_autostart::Builder::new()
                    .macos_launcher(MacosLauncher::LaunchAgent)
                    .build()
            }
            #[cfg(not(target_os = "macos"))]
            {
                tauri_plugin_autostart::Builder::new().build()
            }
        })
        .invoke_handler(tauri::generate_handler![
            open_url,
            open_app,
            close_app,
            quit_app,
            list_installed_apps,
            open_default_browser,
            media_key,
            type_text,
            tts::tts_speak,
            tts::tts_status,
            tts::tts_dir,
            tts::tts_warm_cache,
            tts::start_music_player
        ])
        .setup(|app| {
            let show_i =
                MenuItem::with_id(app, "show", "Показать Дубину", true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "Выйти", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_i, &quit_i])?;

            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .tooltip("Дубина")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "quit" => {
                        app.exit(0);
                    }
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
