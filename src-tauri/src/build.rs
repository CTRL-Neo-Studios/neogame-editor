//! `dotnet build` in the game project, so NeoGameLib regenerates Data/<Game>.neoschema.json.

use std::io::{BufRead, BufReader, Read};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::thread;

use serde::Serialize;
use tauri::ipc::Channel;

#[derive(Clone, Serialize)]
#[serde(tag = "kind", content = "data", rename_all = "camelCase")]
pub enum BuildEvent {
    Line(String),
    Exit(Option<i32>),
}

/// Runs `dotnet build` with `root` as the working directory (dotnet picks the project/solution there) and streams
/// stdout+stderr lines to `on_event`. Resolves after the process exits; Err only when it couldn't start.
#[tauri::command]
pub async fn dotnet_build(root: String, on_event: Channel<BuildEvent>) -> Result<(), String> {
    let root = PathBuf::from(root);
    if !root.is_dir() {
        return Err(format!("{} is not a folder", root.display()));
    }
    tauri::async_runtime::spawn_blocking(move || {
        let mut cmd = Command::new("dotnet");
        cmd.arg("build").current_dir(&root).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
        // English output regardless of the user's locale, and no colour escapes in the log
        cmd.env("DOTNET_CLI_UI_LANGUAGE", "en").env("DOTNET_NOLOGO", "1");
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }
        let mut child = cmd.spawn().map_err(|e| match e.kind() {
            std::io::ErrorKind::NotFound => "dotnet was not found on PATH. Install the .NET SDK, then restart NeoGame Editor.".to_string(),
            _ => format!("could not start dotnet: {e}"),
        })?;

        // read both pipes concurrently (reading them one after another can deadlock when the other fills up)
        let (tx, rx) = mpsc::channel::<String>();
        let readers: Vec<_> = [
            child.stdout.take().map(|s| Box::new(s) as Box<dyn Read + Send>),
            child.stderr.take().map(|s| Box::new(s) as Box<dyn Read + Send>),
        ]
        .into_iter()
        .flatten()
        .map(|pipe| {
            let tx = tx.clone();
            thread::spawn(move || {
                for line in BufReader::new(pipe).lines().map_while(Result::ok) {
                    let _ = tx.send(line);
                }
            })
        })
        .collect();
        drop(tx);
        for line in rx {
            let _ = on_event.send(BuildEvent::Line(line));
        }
        for reader in readers {
            let _ = reader.join();
        }
        let status = child.wait().map_err(|e| format!("dotnet build failed: {e}"))?;
        let _ = on_event.send(BuildEvent::Exit(status.code()));
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}
