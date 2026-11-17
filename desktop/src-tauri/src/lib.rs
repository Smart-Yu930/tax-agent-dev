mod commands;
mod state;

use state::AppState;
use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            app.manage(AppState::new(dir.join("session.json")));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::bootstrap,
            commands::documents,
            commands::document,
            commands::pending_application,
            commands::run_audit,
            commands::confirm_draft,
            commands::issue_invoice,
            commands::sync_history,
            commands::reset_session,
            commands::policies,
            commands::policy,
            commands::cases,
            commands::acceptance,
            commands::data_quality,
            commands::ledger,
            commands::invoice_samples,
            commands::drafts,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
