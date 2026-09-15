#![cfg(windows)]

use arboard::Clipboard;
use std::os::windows::ffi::OsStrExt;
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::thread;
use std::time::Duration;
use windows::core::PCWSTR;
use windows::Win32::Foundation::{BOOL, HWND, LPARAM, WPARAM};
use windows::Win32::UI::Input::KeyboardAndMouse::{
    keybd_event, KEYBD_EVENT_FLAGS, KEYEVENTF_KEYUP, VK_CONTROL, VK_MEDIA_NEXT_TRACK,
    VK_MEDIA_PLAY_PAUSE, VK_MEDIA_PREV_TRACK,
};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetForegroundWindow, GetWindowTextW, GetWindowThreadProcessId,
    IsWindowVisible, SendMessageW, SetForegroundWindow, ShowWindow, HWND_BROADCAST,
    SW_RESTORE, SW_SHOWNORMAL, WM_APPCOMMAND,
};

const CREATE_NO_WINDOW: u32 = 0x08000000;

pub fn send_media_key(action: &str) -> Result<(), String> {
    let app_cmd: i32 = match action {
        "play_pause" => 14,
        "next" => 11,
        "previous" => 12,
        _ => return Err(format!("Неизвестное медиа-действие: {action}")),
    };

    unsafe {
        let _ = SendMessageW(
            HWND_BROADCAST,
            WM_APPCOMMAND,
            WPARAM(0),
            LPARAM((app_cmd << 16) as isize),
        );
    }

    let vk = match action {
        "play_pause" => VK_MEDIA_PLAY_PAUSE,
        "next" => VK_MEDIA_NEXT_TRACK,
        "previous" => VK_MEDIA_PREV_TRACK,
        _ => return Ok(()),
    };
    unsafe {
        keybd_event(vk.0 as u8, 0, KEYBD_EVENT_FLAGS(0), 0);
        keybd_event(vk.0 as u8, 0, KEYEVENTF_KEYUP, 0);
    }
    Ok(())
}

pub fn focus_exe(exe_stem: &str) -> Result<(), String> {
    let target = exe_stem.to_lowercase().replace(".exe", "");
    let hwnd = find_main_window_by_exe(&target)
        .or_else(|| find_main_window_by_title_hints(&target));
    let Some(hwnd) = hwnd else {
        return Err("window not found".into());
    };
    unsafe {
        let _ = ShowWindow(hwnd, SW_RESTORE);
        let _ = SetForegroundWindow(hwnd);
    }
    thread::sleep(Duration::from_millis(250));
    Ok(())
}

fn send_appcommand_play(hwnd: HWND) {
    const APPCOMMAND_MEDIA_PLAY: i32 = 46;
    unsafe {
        let wparam = if hwnd == HWND_BROADCAST {
            WPARAM(0)
        } else {
            WPARAM(hwnd.0 as usize)
        };
        let _ = SendMessageW(
            hwnd,
            WM_APPCOMMAND,
            wparam,
            LPARAM((APPCOMMAND_MEDIA_PLAY << 16) as isize),
        );
    }
}

pub fn send_media_play() {
    unsafe {
        let fg = GetForegroundWindow();
        if fg.0 != 0 {
            send_appcommand_play(fg);
        }
        send_appcommand_play(HWND_BROADCAST);
    }
}

pub fn send_media_play_toggle() {
    let _ = send_media_key("play_pause");
}

pub fn send_space_key() {
    unsafe {
        keybd_event(0x20, 0, KEYBD_EVENT_FLAGS(0), 0);
        keybd_event(0x20, 0, KEYEVENTF_KEYUP, 0);
    }
}

struct EnumData {
    target: String,
    result: Option<HWND>,
}

fn window_title_lower(hwnd: HWND) -> String {
    let mut buf = [0u16; 512];
    let len = unsafe { GetWindowTextW(hwnd, &mut buf) };
    if len <= 0 {
        return String::new();
    }
    String::from_utf16_lossy(&buf[..len as usize]).to_lowercase()
}

unsafe extern "system" fn enum_proc(hwnd: HWND, lparam: LPARAM) -> BOOL {
    let data = &mut *(lparam.0 as *mut EnumData);
    if data.result.is_some() {
        return BOOL(0);
    }
    if !IsWindowVisible(hwnd).as_bool() {
        return BOOL(1);
    }
    let mut pid: u32 = 0;
    GetWindowThreadProcessId(hwnd, Some(&mut pid));
    if pid == 0 {
        return BOOL(1);
    }
    if let Ok(name) = process_image_stem(pid) {
        if name.contains(&data.target) || data.target.contains(&name) {
            data.result = Some(hwnd);
            return BOOL(0);
        }
    }
    BOOL(1)
}

unsafe extern "system" fn enum_title_proc(hwnd: HWND, lparam: LPARAM) -> BOOL {
    let data = &mut *(lparam.0 as *mut EnumData);
    if data.result.is_some() {
        return BOOL(0);
    }
    if !IsWindowVisible(hwnd).as_bool() {
        return BOOL(1);
    }
    let title = window_title_lower(hwnd);
    if title.is_empty() {
        return BOOL(1);
    }
    let music_title = (title.contains("яндекс") && title.contains("музык"))
        || (title.contains("yandex") && title.contains("music"))
        || title.contains("spotify")
        || title == "music"
        || title.contains("яндекс музыка");
    let stem_hit = !data.target.is_empty() && title.contains(&data.target);
    if music_title || stem_hit {
        data.result = Some(hwnd);
        return BOOL(0);
    }
    BOOL(1)
}

fn find_main_window_by_exe(exe_stem: &str) -> Option<HWND> {
    let mut data = EnumData {
        target: exe_stem.to_lowercase(),
        result: None,
    };
    unsafe {
        let _ = EnumWindows(Some(enum_proc), LPARAM(&mut data as *mut _ as isize));
    }
    data.result
}

fn find_main_window_by_title_hints(exe_stem: &str) -> Option<HWND> {
    let mut data = EnumData {
        target: exe_stem.to_lowercase(),
        result: None,
    };
    unsafe {
        let _ = EnumWindows(Some(enum_title_proc), LPARAM(&mut data as *mut _ as isize));
    }
    data.result
}

fn process_image_stem(pid: u32) -> Result<String, String> {
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
        PROCESS_QUERY_LIMITED_INFORMATION,
    };
    unsafe {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid)
            .map_err(|e| e.to_string())?;
        let mut buf = [0u16; 512];
        let mut size = buf.len() as u32;
        QueryFullProcessImageNameW(handle, PROCESS_NAME_WIN32, windows::core::PWSTR(buf.as_mut_ptr()), &mut size)
            .map_err(|e| e.to_string())?;
        let path = String::from_utf16_lossy(&buf[..size as usize]);
        let stem = Path::new(&path)
            .file_stem()
            .map(|s| s.to_string_lossy().to_lowercase())
            .unwrap_or_default();
        let _ = windows::Win32::Foundation::CloseHandle(handle);
        Ok(stem)
    }
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
    let path = std::fs::canonicalize(&path).unwrap_or(path);
    let path_str = path_to_utf8(&path);
    let name = friendly_app_name(&path);
    Ok(Some((name, path_str)))
}

pub fn open_path_or_shell(target: &str) -> Result<(), String> {
    let target = target.trim();
    if target.is_empty() {
        return Err("Пустой путь".into());
    }

    if target.starts_with("shell:") || target.contains('!') {
        let status = Command::new("explorer")
            .arg(target)
            .creation_flags(CREATE_NO_WINDOW)
            .status()
            .map_err(|e| e.to_string())?;
        if status.success() {
            return Ok(());
        }
        return Err(format!("Не удалось открыть: {target}"));
    }

    let path = PathBuf::from(target);
    if !path.exists() {
        return Err(format!("Файл не найден:\n{target}"));
    }

    if shell_execute(&path).is_ok() {
        return Ok(());
    }

    let mut cmd = Command::new(&path);
    if let Some(dir) = path.parent() {
        cmd.current_dir(dir);
    }
    cmd.spawn()
        .map(|_| ())
        .map_err(|e| format!("Не удалось запустить «{}»: {e}", friendly_app_name(&path)))
}

fn shell_execute(path: &Path) -> Result<(), String> {
    use windows::core::w;
    let file = wide(path);
    let dir = path.parent().map(wide);
    let rc = unsafe {
        ShellExecuteW(
            HWND::default(),
            w!("open"),
            PCWSTR(file.as_ptr()),
            PCWSTR::null(),
            dir.as_ref()
                .map(|d| PCWSTR(d.as_ptr()))
                .unwrap_or(PCWSTR::null()),
            SW_SHOWNORMAL,
        )
    };
    if (rc.0 as isize) <= 32 {
        return Err(format!("ShellExecute failed ({})", rc.0 as isize));
    }
    Ok(())
}

fn wide(path: &Path) -> Vec<u16> {
    path.as_os_str().encode_wide().chain(std::iter::once(0)).collect()
}

fn path_to_utf8(path: &Path) -> String {
    let mut s = path.to_string_lossy().to_string();
    if let Some(stripped) = s.strip_prefix(r"\\?\") {
        s = stripped.to_string();
    }
    s
}

pub fn friendly_app_name(path: &Path) -> String {
    let stem = path
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "App".into());
    let key = stem.to_lowercase().replace(' ', "");
    match key.as_str() {
        "yandexmusic" | "yandex.music" | "yamusic" => "Яндекс Музыка".into(),
        "spotify" => "Spotify".into(),
        "chrome" => "Google Chrome".into(),
        "msedge" | "edge" => "Microsoft Edge".into(),
        "firefox" => "Firefox".into(),
        "code" => "VS Code".into(),
        "telegram" | "telegramdesktop" => "Telegram".into(),
        "discord" => "Discord".into(),
        "vlc" => "VLC".into(),
        _ => {
            if let Some(parent) = path
                .parent()
                .and_then(|p| p.file_name())
                .map(|s| s.to_string_lossy().to_string())
            {
                let pl = parent.to_lowercase();
                if pl.contains("yandex") && pl.contains("music") {
                    return "Яндекс Музыка".into();
                }
                if !matches!(
                    pl.as_str(),
                    "application" | "applications" | "bin" | "programs" | "x64" | "x86"
                ) && parent.chars().count() >= 2
                    && !looks_mojibake(&parent)
                {
                    if parent.chars().any(|c| !c.is_ascii()) {
                        return parent;
                    }
                }
            }
            if looks_mojibake(&stem) {
                "Программа".into()
            } else {
                stem
            }
        }
    }
}

fn looks_mojibake(s: &str) -> bool {
    let bad = s.chars().filter(|c| matches!(c, 'Ð' | 'Ñ' | 'Ã' | 'Â' | 'ä' | 'å')).count();
    bad >= 2 || s.contains("Ð") || s.contains("Ñ")
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
            let stem = path
                .file_stem()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_default();
            if is_junk_name(&stem) {
                continue;
            }
            let path_str = path_to_utf8(path);
            if is_junk_path(&path_str) {
                continue;
            }
            let name = friendly_app_name(path);
            apps.push((name, path_str));
            if apps.len() > 400 {
                return;
            }
        }
    }
}

fn push_known(apps: &mut Vec<(String, String)>) {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Some(local) = std::env::var_os("LOCALAPPDATA").map(PathBuf::from) {
        candidates.extend([
            local.join(r"Programs\YandexMusic\YandexMusic.exe"),
            local.join(r"Yandex\YandexMusic\YandexMusic.exe"),
            local.join(r"Programs\Yandex Music\YandexMusic.exe"),
            local.join(r"Spotify\Spotify.exe"),
            local.join(r"Google\Chrome\Application\chrome.exe"),
            local.join(r"Telegram Desktop\Telegram.exe"),
        ]);
    }
    for key in ["ProgramFiles", "ProgramFiles(x86)"] {
        if let Some(pf) = std::env::var_os(key).map(PathBuf::from) {
            candidates.push(pf.join(r"Yandex\YandexMusic\YandexMusic.exe"));
            candidates.push(pf.join(r"Spotify\Spotify.exe"));
            candidates.push(pf.join(r"Google\Chrome\Application\chrome.exe"));
        }
    }
    for path in candidates {
        if path.is_file() {
            apps.push((friendly_app_name(&path), path_to_utf8(&path)));
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
    p.contains("\\uninstall")
        || p.contains("\\update")
        || p.contains("\\crash")
        || p.contains("\\helper")
}
