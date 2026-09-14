use std::process::Command;

pub fn no_window(cmd: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let _ = cmd;
}

pub fn powershell() -> Command {
    let mut cmd = Command::new("powershell");
    no_window(&mut cmd);
    cmd
}

pub fn cmd_exe() -> Command {
    let mut cmd = Command::new("cmd");
    no_window(&mut cmd);
    cmd
}
