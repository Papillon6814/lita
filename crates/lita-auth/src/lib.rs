//! Desktop sign-in.
//!
//! The person signs in with Google, but the app never talks to Google
//! directly: Supabase runs the OAuth exchange on its own callback URL and
//! holds the Google client secret (D-41). The app does PKCE against Supabase
//! and receives the result on a loopback port, `http://127.0.0.1:<port>`,
//! which is what Google recommends for native apps and needs no custom URI
//! scheme. Only the Supabase session is ever stored, in the OS keychain.

mod loopback;
pub mod supabase;

pub use supabase::{Session, SupabaseAuth, User};
