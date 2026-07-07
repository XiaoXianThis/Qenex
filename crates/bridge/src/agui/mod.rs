pub mod events;
pub mod sse;

pub use events::{AguiEvent, AguiEventType};
pub use sse::{encode_sse_event, collect_events_until_done, EventStream};
