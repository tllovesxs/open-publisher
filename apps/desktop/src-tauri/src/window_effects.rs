//! Native window materials, kept behind platform gates so other desktop
//! targets retain the regular CSS fallback.

#[cfg(target_os = "windows")]
use std::{ffi::c_void, mem::size_of};

#[cfg(target_os = "windows")]
use raw_window_handle::{HasWindowHandle, RawWindowHandle};

#[cfg(target_os = "windows")]
use tauri::{Manager, Runtime, Theme, WebviewWindow, WindowEvent};

#[cfg(target_os = "windows")]
use windows_sys::Win32::{
    Foundation::HWND,
    Graphics::Dwm::{
        DwmSetWindowAttribute, DWMSBT_MAINWINDOW, DWMWA_SYSTEMBACKDROP_TYPE,
        DWMWA_USE_IMMERSIVE_DARK_MODE,
    },
};

#[cfg(target_os = "windows")]
const DWMWA_MICA_EFFECT: u32 = 1_029;

/// Applies the system-managed Mica backdrop to the main application window.
///
/// The DWM calls deliberately treat unsupported Windows versions as a no-op.
/// The transparent Tauri window plus CSS surfaces still provide a readable
/// fallback on Windows 10 and non-Windows hosts.
#[cfg(target_os = "windows")]
pub fn install_windows_mica(app: &tauri::App) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };

    apply_mica(&window, window_prefers_dark_theme(&window));

    let window_for_theme_updates = window.clone();
    window.on_window_event(move |event| {
        if let WindowEvent::ThemeChanged(theme) = event {
            apply_mica(&window_for_theme_updates, matches!(theme, Theme::Dark));
        }
    });
}

/// Reapplies the DWM mode after React explicitly changes the app theme.
#[cfg(target_os = "windows")]
pub fn sync_windows_mica_theme<R: Runtime>(window: &WebviewWindow<R>, dark_mode: bool) {
    apply_mica(window, dark_mode);
}

#[cfg(target_os = "windows")]
fn window_prefers_dark_theme<R: Runtime>(window: &WebviewWindow<R>) -> bool {
    matches!(window.theme(), Ok(Theme::Dark))
}

#[cfg(target_os = "windows")]
fn apply_mica<R: Runtime>(window: &WebviewWindow<R>, dark_mode: bool) {
    let Ok(window_handle) = window.window_handle() else {
        return;
    };
    let RawWindowHandle::Win32(window_handle) = window_handle.as_raw() else {
        return;
    };

    let hwnd = window_handle.hwnd.get() as HWND;
    let dark_mode = u32::from(dark_mode);

    // Windows 11 22H2+: SystemBackdropType's main-window value is Mica.
    // The old 21H2 Mica attribute is retained as a best-effort fallback.
    let _ = set_dwm_attribute(hwnd, DWMWA_USE_IMMERSIVE_DARK_MODE as u32, &dark_mode);
    let backdrop = DWMSBT_MAINWINDOW;
    if set_dwm_attribute(hwnd, DWMWA_SYSTEMBACKDROP_TYPE as u32, &backdrop) < 0 {
        let enabled = 1_i32;
        let _ = set_dwm_attribute(hwnd, DWMWA_MICA_EFFECT, &enabled);
    }
}

#[cfg(target_os = "windows")]
fn set_dwm_attribute<T>(hwnd: HWND, attribute: u32, value: &T) -> i32 {
    // DWM owns the attribute data only for the duration of this synchronous call.
    unsafe {
        DwmSetWindowAttribute(
            hwnd,
            attribute,
            value as *const T as *const c_void,
            size_of::<T>() as u32,
        )
    }
}
