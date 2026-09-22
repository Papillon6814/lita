//! Deployment constants. Both values are public by design: the anon key
//! only identifies the project, and row level security decides what a
//! signed-in user can touch. Self-hosters change these two lines.

pub const SUPABASE_URL: &str = "https://csfvqpqzvcorqlsmfjwb.supabase.co";
pub const SUPABASE_ANON_KEY: &str =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNzZnZxcHF6dmNvcnFsc21mandiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAwNDQ1MDQsImV4cCI6MjEwNTYyMDUwNH0.tU0FlCszq8rzgpyFTLniWffy4Dpq8u_-KVYjIPWCDgo";

/// Keychain service name for the stored session.
pub const KEYCHAIN_SERVICE: &str = "com.papillon6814.lita";
