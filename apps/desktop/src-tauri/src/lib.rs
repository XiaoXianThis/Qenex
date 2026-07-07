mod bridge;

use bridge::{
    get_bridge_url, get_default_workspace, open_store, set_last_workspace, start_bridge,
    store_key, BridgeState,
};
use tauri::{AppHandle, Manager, RunEvent};

#[tauri::command]
fn cmd_get_bridge_url(app: AppHandle) -> Result<String, String> {
    get_bridge_url(&app)
}

#[tauri::command]
fn cmd_pick_workspace(app: AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    let picked = app
        .dialog()
        .file()
        .set_title("选择工作目录")
        .blocking_pick_folder();

    if let Some(path) = picked {
        let path_str = path.to_string();
        set_last_workspace(&app, &path_str)?;
        return Ok(Some(path_str));
    }

    Ok(None)
}

#[tauri::command]
fn cmd_get_default_workspace(app: AppHandle) -> Result<String, String> {
    get_default_workspace(&app)
}

#[tauri::command]
fn cmd_storage_get(app: AppHandle, key: String) -> Result<Option<String>, String> {
    let store = open_store(&app)?;
    Ok(store
        .get(store_key(&key))
        .and_then(|value| value.as_str().map(str::to_string)))
}

#[tauri::command]
fn cmd_storage_set(app: AppHandle, key: String, value: String) -> Result<(), String> {
    let store = open_store(&app)?;
    store.set(store_key(&key), serde_json::Value::String(value));
    store.save().map_err(|e| e.to_string())
}

#[tauri::command]
fn cmd_storage_remove(app: AppHandle, key: String) -> Result<(), String> {
    let store = open_store(&app)?;
    store.delete(store_key(&key));
    store.save().map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let handle = app.handle().clone();
            tauri::async_runtime::block_on(async move {
                start_bridge(&handle).await
            })?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            cmd_get_bridge_url,
            cmd_pick_workspace,
            cmd_get_default_workspace,
            cmd_storage_get,
            cmd_storage_set,
            cmd_storage_remove,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let RunEvent::Exit = event {
                if let Some(state) = app_handle.try_state::<BridgeState>() {
                    state.stop();
                }
            }
        });
}
