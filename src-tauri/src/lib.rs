#[cfg(any(target_os = "macos", target_os = "linux"))]
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
#[cfg(any(target_os = "macos", target_os = "linux"))]
use std::io::Write;
#[cfg(any(target_os = "macos", target_os = "linux"))]
use std::process::Stdio;
use serde::Serialize;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager,
};
#[cfg(target_os = "macos")]
use tauri_plugin_autostart::MacosLauncher;

mod tts;
mod winutil;
#[cfg(target_os = "macos")]
mod yandex_cdp;
#[cfg(windows)]
mod windows_native;

#[derive(Debug, Clone, Serialize, serde::Deserialize)]
struct InstalledApp {
    name: String,
    path: String,
}

static APP_LIST_CACHE: Mutex<Option<Vec<InstalledApp>>> = Mutex::new(None);

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
fn list_installed_apps(refresh: Option<bool>) -> Result<Vec<InstalledApp>, String> {
    let refresh = refresh.unwrap_or(false);
    if !refresh {
        if let Ok(guard) = APP_LIST_CACHE.lock() {
            if let Some(cached) = guard.as_ref() {
                return Ok(cached.clone());
            }
        }
    }

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
        collect_windows_apps(&mut apps);
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
    apps.dedup_by(|a, b| a.path.eq_ignore_ascii_case(&b.path));
    if let Ok(mut guard) = APP_LIST_CACHE.lock() {
        *guard = Some(apps.clone());
    }
    Ok(apps)
}

#[tauri::command]
fn pick_app_file() -> Result<Option<InstalledApp>, String> {
    #[cfg(target_os = "windows")]
    {
        return match crate::windows_native::pick_exe_file()? {
            Some((name, path)) => Ok(Some(InstalledApp { name, path })),
            None => Ok(None),
        };
    }

    #[cfg(target_os = "macos")]
    {
        let output = Command::new("osascript")
            .args([
                "-e",
                "POSIX path of (choose file of type {\"app\",\"public.unix-executable\"} with prompt \"Выбери программу\")",
            ])
            .output()
            .map_err(|e| e.to_string())?;
        if !output.status.success() {
            return Ok(None);
        }
        let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if path.is_empty() {
            return Ok(None);
        }
        let name = Path::new(&path)
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("App")
            .to_string();
        return Ok(Some(InstalledApp { name, path }));
    }

    #[cfg(target_os = "linux")]
    {
        let output = Command::new("zenity")
            .args(["--file-selection", "--title=Выбери программу"])
            .output();
        let Ok(out) = output else {
            return Err("Нужен zenity для выбора файла".into());
        };
        if !out.status.success() {
            return Ok(None);
        }
        let path = String::from_utf8_lossy(&out.stdout).trim().to_string();
        if path.is_empty() {
            return Ok(None);
        }
        let name = Path::new(&path)
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("App")
            .to_string();
        return Ok(Some(InstalledApp { name, path }));
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        Err("Не поддерживается".into())
    }
}

fn dirs_home() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
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
fn collect_windows_apps(apps: &mut Vec<InstalledApp>) {
    let mut pairs = Vec::new();
    crate::windows_native::collect_apps(&mut pairs);
    for (name, path) in pairs {
        apps.push(InstalledApp { name, path });
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
        return crate::windows_native::open_path_or_shell(name);
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
pub(crate) fn find_macos_app_fuzzy(query: &str) -> Option<PathBuf> {
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
        let mut c = Command::new("taskkill");
        crate::winutil::no_window(&mut c);
        let _ = c
            .args(["/IM", &exe, "/F"])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
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
        return crate::windows_native::paste_text(text);
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

#[cfg(target_os = "macos")]
fn media_remote_play() -> bool {
    use std::ffi::c_void;

    #[link(name = "MediaRemote", kind = "framework")]
    unsafe extern "C" {
        fn MRMediaRemoteSendCommand(command: u32, user_info: *const c_void) -> u8;
    }

    const MR_PLAY: u32 = 0;
    unsafe { MRMediaRemoteSendCommand(MR_PLAY, std::ptr::null()) != 0 }
}

#[cfg(target_os = "macos")]
pub(crate) fn yandex_press_play(process_name: &str) -> Result<(), String> {
    let name = process_name.replace('"', "");
    if !ensure_accessibility_permission() {
        let _ = media_remote_play();
        let _ = media_key_inner("play_pause");
        return Err(
            "Чтобы включать музыку в фоне, добавь в Универсальный доступ: Cursor (или Terminal) и target/debug/dubina"
                .into(),
        );
    }

    let silent = format!(
        r#"tell application "System Events"
  if not (exists process "{name}") then return "no-process"
  tell process "{name}"
    set played to false
    try
      click menu item "Слушать" of menu 1 of menu bar item "Воспроизведение" of menu bar 1
      set played to true
    end try
    if played is false then
      try
        click menu item "Play" of menu 1 of menu bar item "Playback" of menu bar 1
        set played to true
      end try
    end if
    if played is false then
      try
        click menu item "Play/Pause" of menu 1 of menu bar item "Playback" of menu bar 1
        set played to true
      end try
    end if
    if played is false then
      try
        click menu item "Пауза" of menu 1 of menu bar item "Воспроизведение" of menu bar 1
        set played to true
      end try
    end if
    if played is false then
      try
        repeat with w in windows
          try
            set bs to every UI element of w whose (role is "AXButton" or role is "AXCheckBox")
            repeat with b in bs
              set d to ""
              set n to ""
              try
                set d to description of b as text
              end try
              try
                set n to name of b as text
              end try
              set blob to d & " " & n
              if blob contains "Play" or blob contains "Слушать" or blob contains "play" or blob contains "Воспроиз" then
                click b
                set played to true
                exit repeat
              end if
            end repeat
          end try
          if played then exit repeat
        end repeat
      end try
    end if
    if played then
      return "ok"
    else
      return "miss"
    end if
  end tell
end tell"#
    );

    let out = Command::new("osascript")
        .args(["-e", &silent])
        .output()
        .map_err(|e| e.to_string())?;
    let text = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if text == "ok" {
        return Ok(());
    }

    let _ = media_remote_play();

    let steal = format!(
        r#"tell application "System Events"
  if not (exists process "{name}") then return
  set prevName to ""
  try
    set prevName to name of first application process whose frontmost is true
  end try
  set frontmost of process "{name}" to true
  delay 0.15
  key code 49
  delay 0.1
  if prevName is not "" and prevName is not "{name}" then
    try
      set frontmost of process prevName to true
    end try
  end if
end tell"#
    );
    let _ = Command::new("osascript").args(["-e", &steal]).status();
    Ok(())
}

#[cfg(target_os = "macos")]
pub(crate) fn post_keycode_macos(key_code: u16) -> Result<(), String> {
    use objc2_core_graphics::{CGEvent, CGEventTapLocation};

    for down in [true, false] {
        let Some(ev) = CGEvent::new_keyboard_event(None, key_code, down) else {
            return Err("Не удалось создать клавишу".into());
        };
        CGEvent::post(CGEventTapLocation::HIDEventTap, Some(&ev));
    }
    Ok(())
}

#[cfg(target_os = "macos")]
mod ax {
    use std::ffi::c_void;

    #[link(name = "ApplicationServices", kind = "framework")]
    unsafe extern "C" {
        fn AXIsProcessTrusted() -> u8;
        fn AXIsProcessTrustedWithOptions(options: *const c_void) -> u8;
        static kAXTrustedCheckOptionPrompt: *const c_void;
    }

    #[link(name = "CoreFoundation", kind = "framework")]
    unsafe extern "C" {
        fn CFDictionaryCreate(
            allocator: *const c_void,
            keys: *const *const c_void,
            values: *const *const c_void,
            num_values: isize,
            key_callbacks: *const c_void,
            value_callbacks: *const c_void,
        ) -> *const c_void;
        fn CFRelease(cf: *const c_void);
        static kCFBooleanTrue: *const c_void;
        static kCFTypeDictionaryKeyCallBacks: c_void;
        static kCFTypeDictionaryValueCallBacks: c_void;
    }

    pub fn is_trusted() -> bool {
        unsafe { AXIsProcessTrusted() != 0 }
    }

    pub fn request_with_prompt() -> bool {
        unsafe {
            let key = kAXTrustedCheckOptionPrompt;
            let value = kCFBooleanTrue;
            let keys = [key];
            let values = [value];
            let dict = CFDictionaryCreate(
                std::ptr::null(),
                keys.as_ptr(),
                values.as_ptr(),
                1,
                &kCFTypeDictionaryKeyCallBacks,
                &kCFTypeDictionaryValueCallBacks,
            );
            let ok = AXIsProcessTrustedWithOptions(dict) != 0;
            if !dict.is_null() {
                CFRelease(dict);
            }
            ok
        }
    }
}

#[cfg(target_os = "macos")]
pub(crate) fn ax_is_trusted() -> bool {
    ax::is_trusted()
}

#[cfg(target_os = "macos")]
pub(crate) fn ensure_accessibility_permission() -> bool {
    if ax::is_trusted() {
        return true;
    }
    let _ = ax::request_with_prompt();
    if ax::is_trusted() {
        return true;
    }
    let urls = [
        "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
        "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_Accessibility",
    ];
    for url in urls {
        let _ = std::process::Command::new("open").arg(url).status();
    }
    false
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
        return crate::windows_native::send_media_key(action);
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
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
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
            pick_app_file,
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
            let update_i = MenuItem::with_id(
                app,
                "check_updates",
                "Проверить обновления",
                true,
                None::<&str>,
            )?;
            let sep = PredefinedMenuItem::separator(app)?;
            let quit_i = MenuItem::with_id(app, "quit", "Выйти", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_i, &update_i, &sep, &quit_i])?;

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
                    "check_updates" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                            let _ = window.emit("dubina://check-updates", ());
                        } else {
                            let _ = app.emit("dubina://check-updates", ());
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
