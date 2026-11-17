use std::path::PathBuf;
use std::sync::Mutex;
use tax_core::session::SessionState;

pub struct AppState {
    pub session: Mutex<SessionState>,
    pub path: PathBuf,
}

impl AppState {
    pub fn new(path: PathBuf) -> Self {
        let state = tax_core::session::load(&path);
        Self {
            session: Mutex::new(state),
            path,
        }
    }

    pub fn persist(&self, state: &SessionState) -> Result<(), String> {
        tax_core::session::save(&self.path, state)
    }
}
