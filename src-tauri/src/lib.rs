//! Veil Private XRP Payments - Tauri Backend
//!
//! This library provides the Tauri backend functionality for the Veil desktop application.

mod commands;

use tauri::Manager;

/// Initialize the Tauri application with all commands and plugins
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            commands::store_secret,
            commands::get_secret,
            commands::delete_secret,
            commands::has_secret,
        ])
        .setup(|app| {
            #[cfg(debug_assertions)]
            {
                let window = app.get_webview_window("main").unwrap();
                window.open_devtools();
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
