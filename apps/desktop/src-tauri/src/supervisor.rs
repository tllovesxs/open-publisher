use std::sync::Mutex;

use serde::Serialize;

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeState {
    Standby,
    Starting,
    Ready,
    Stopped,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeSnapshot {
    pub state: RuntimeState,
    pub bridge_mode: &'static str,
    pub generation: u64,
    pub detail: String,
}

/// The WebView talks only to Tauri commands. A production implementation of
/// this interface will own the packaged Python child, its private IPC channel,
/// lifecycle, and health checks. It must never expose the child endpoint or
/// plaintext credentials to the frontend.
pub trait SidecarSupervisor: Send + Sync + 'static {
    fn snapshot(&self) -> Result<RuntimeSnapshot, String>;
    fn ensure_started(&self) -> Result<RuntimeSnapshot, String>;
    fn stop(&self) -> Result<RuntimeSnapshot, String>;
}

#[derive(Debug)]
struct SupervisorState {
    state: RuntimeState,
    generation: u64,
}

/// Runnable interface-only supervisor for the first desktop skeleton.
///
/// This deliberately does not spawn Python yet. Replacing it with
/// `PackagedSidecarSupervisor` will not change the Tauri command contract.
pub struct InterfaceOnlySupervisor {
    inner: Mutex<SupervisorState>,
}

impl Default for InterfaceOnlySupervisor {
    fn default() -> Self {
        Self {
            inner: Mutex::new(SupervisorState {
                state: RuntimeState::Standby,
                generation: 0,
            }),
        }
    }
}

impl InterfaceOnlySupervisor {
    fn describe(state: &SupervisorState, detail: impl Into<String>) -> RuntimeSnapshot {
        RuntimeSnapshot {
            state: state.state,
            bridge_mode: "interface_only",
            generation: state.generation,
            detail: detail.into(),
        }
    }
}

impl SidecarSupervisor for InterfaceOnlySupervisor {
    fn snapshot(&self) -> Result<RuntimeSnapshot, String> {
        let state = self
            .inner
            .lock()
            .map_err(|_| "sidecar supervisor lock was poisoned".to_owned())?;
        Ok(Self::describe(
            &state,
            "Rust command boundary is available; Python sidecar is not bundled in this skeleton.",
        ))
    }

    fn ensure_started(&self) -> Result<RuntimeSnapshot, String> {
        let mut state = self
            .inner
            .lock()
            .map_err(|_| "sidecar supervisor lock was poisoned".to_owned())?;
        state.state = RuntimeState::Starting;
        state.generation += 1;
        // The interface-only implementation completes immediately. The packaged
        // implementation will set Ready only after its private health check.
        state.state = RuntimeState::Ready;
        Ok(Self::describe(
            &state,
            "Interface-only runtime is ready; no model or publishing API was contacted.",
        ))
    }

    fn stop(&self) -> Result<RuntimeSnapshot, String> {
        let mut state = self
            .inner
            .lock()
            .map_err(|_| "sidecar supervisor lock was poisoned".to_owned())?;
        state.state = RuntimeState::Stopped;
        Ok(Self::describe(&state, "Interface-only runtime is stopped."))
    }
}

#[cfg(test)]
mod tests {
    use super::{InterfaceOnlySupervisor, RuntimeState, SidecarSupervisor};

    #[test]
    fn interface_supervisor_has_a_stable_lifecycle() {
        let supervisor = InterfaceOnlySupervisor::default();
        assert!(matches!(
            supervisor.snapshot().expect("snapshot").state,
            RuntimeState::Standby
        ));
        assert!(matches!(
            supervisor.ensure_started().expect("start").state,
            RuntimeState::Ready
        ));
        assert!(matches!(
            supervisor.stop().expect("stop").state,
            RuntimeState::Stopped
        ));
    }
}
