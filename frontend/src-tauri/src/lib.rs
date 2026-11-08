//! IT Help Chatbot desktop shell — Tauri 2. Stores JWT tokens in the OS keyring
//! (DPAPI on Windows / Keychain on macOS / libsecret on Linux) so credentials
//! are never persisted to plaintext on disk.

use keyring::Entry;

const SERVICE: &str = "it-help-chatbot";

/// Save (or overwrite) the access + refresh tokens in the OS keyring.
#[tauri::command]
fn save_tokens(access: String, refresh: String) -> Result<(), String> {
    let entry = Entry::new(SERVICE, "auth").map_err(|e| e.to_string())?;
    let payload = serde_json::json!({ "access": access, "refresh": refresh }).to_string();
    entry.set_password(&payload).map_err(|e| e.to_string())
}

/// Load the stored tokens from the OS keyring.
#[tauri::command]
fn load_tokens() -> Result<serde_json::Value, String> {
    let entry = Entry::new(SERVICE, "auth").map_err(|e| e.to_string())?;
    let value = entry.get_password().map_err(|e| e.to_string())?;
    serde_json::from_str(&value).map_err(|e| e.to_string())
}

/// Clear all stored tokens (on logout).
#[tauri::command]
fn clear_tokens() -> Result<(), String> {
    let entry = Entry::new(SERVICE, "auth").map_err(|e| e.to_string())?;
    entry.delete_credential().map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            save_tokens,
            load_tokens,
            clear_tokens
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
