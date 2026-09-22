//! Desktop sign-in.
//!
//! Google's guidance for native apps is the loopback flow: open the system
//! browser, let it redirect to `http://127.0.0.1:<port>`, and exchange the
//! code with PKCE. No custom URI scheme, no client secret in the app. The
//! resulting Google ID token is then handed to Supabase, which issues the
//! session the rest of Lita uses. Lita never sees a Google password and never
//! stores the Google token; only the Supabase session is kept.

pub mod google;
pub mod supabase;

pub use google::{GoogleIdentity, GoogleSignIn};
pub use supabase::{Session, SupabaseAuth};
