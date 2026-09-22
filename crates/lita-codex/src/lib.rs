//! Drives the Codex CLI as a subprocess.
//!
//! Lita never reads, stores, or refreshes the user's OpenAI credentials. It
//! spawns the `codex` binary the user has already logged into and reads
//! structured output back from it. Everything in this crate is built on that
//! rule: if a change here would require touching `~/.codex/auth.json`, it is
//! the wrong change.

use std::fmt;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use anyhow::{Context, Result};
use serde::de::DeserializeOwned;
use serde_json::Value;

/// How many trailing bytes of stderr to keep for diagnostics.
const STDERR_TAIL_BYTES: usize = 4096;

/// What a preflight check found. Lita shows the user a different next step for
/// each of these, so they stay distinct rather than collapsing into one error.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Preflight {
    /// Installed, and credentials are configured.
    Ready { version: String },
    /// Installed, but there are no credentials. The user needs `codex login`.
    NotLoggedIn { version: String },
    /// No `codex` binary was found.
    NotInstalled,
}

/// One line of the CLI's JSONL event stream, reduced to what a progress UI needs.
#[derive(Debug, Clone)]
pub struct Event {
    /// The event's `type` field, e.g. `thread.started` or `turn.completed`.
    pub kind: String,
    pub raw: Value,
}

/// Why a run failed, in terms Lita can turn into a useful message.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FailureKind {
    /// Credentials are missing or expired.
    NotLoggedIn,
    /// The account's plan limit was reached.
    QuotaExhausted,
    /// The final message never satisfied the schema we asked for.
    SchemaMismatch,
    /// Anything we could not classify. Show the stderr tail and move on.
    Unknown,
}

#[derive(Debug)]
pub struct RunFailure {
    pub kind: FailureKind,
    pub exit_code: Option<i32>,
    pub stderr_tail: String,
}

impl fmt::Display for RunFailure {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let what = match self.kind {
            FailureKind::NotLoggedIn => "Codex has no usable credentials",
            FailureKind::QuotaExhausted => "the account's Codex usage limit was reached",
            FailureKind::SchemaMismatch => "Codex never returned output matching the schema",
            FailureKind::Unknown => "the Codex CLI failed",
        };
        write!(
            f,
            "{what} (exit {:?})\n{}",
            self.exit_code, self.stderr_tail
        )
    }
}

impl std::error::Error for RunFailure {}

/// How hard the model should think before answering.
///
/// Measured on a short X post: `Fast` returned in 6.6s, `Quality` in 10.8s,
/// with no visible quality difference at that length. Longer pieces may tell a
/// different story, which is why this is the user's choice and not ours.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum Effort {
    /// Lower latency. Reasoning is turned down.
    Fast,
    /// Codex's own default.
    #[default]
    Quality,
}

impl Effort {
    fn as_config_value(self) -> &'static str {
        match self {
            Effort::Fast => "low",
            Effort::Quality => "medium",
        }
    }
}

/// A single generation request.
pub struct Request {
    /// The full prompt, handed to the CLI on stdin.
    pub prompt: String,
    /// A JSON Schema the final message must satisfy.
    pub schema: Value,
    /// Optional model override; `None` uses Codex's default.
    pub model: Option<String>,
    /// How hard to think. Surfaced to the user as a speed/quality switch.
    pub effort: Effort,
    /// Where to run. Deliberately does not have to be a git repository —
    /// Lita's data directory never will be.
    pub working_dir: PathBuf,
}

/// A completed run.
pub struct Run<T> {
    pub value: T,
    pub events: Vec<Event>,
    pub elapsed: Duration,
}

/// A located Codex CLI.
#[derive(Debug, Clone)]
pub struct CodexCli {
    program: PathBuf,
}

impl CodexCli {
    /// Uses whatever `codex` is on PATH.
    pub fn on_path() -> Self {
        Self {
            program: PathBuf::from("codex"),
        }
    }

    /// Uses a specific binary, for users who installed it somewhere unusual.
    pub fn at(program: impl Into<PathBuf>) -> Self {
        Self {
            program: program.into(),
        }
    }

    /// Asks the CLI to describe its own health.
    ///
    /// `codex doctor --json` emits a redacted machine-readable report, which is
    /// far steadier to read than scraping the human-facing output.
    pub fn preflight(&self) -> Result<Preflight> {
        let out = match Command::new(&self.program)
            .arg("doctor")
            .arg("--json")
            .output()
        {
            Ok(out) => out,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                return Ok(Preflight::NotInstalled);
            }
            Err(e) => return Err(e).context("failed to run `codex doctor --json`"),
        };

        let report: Value = serde_json::from_slice(&out.stdout)
            .context("`codex doctor --json` did not produce JSON")?;

        let version = report["codexVersion"]
            .as_str()
            .unwrap_or("unknown")
            .to_string();
        let auth_ok = report["checks"]["auth.credentials"]["status"]
            .as_str()
            .is_some_and(|s| s == "ok");

        Ok(if auth_ok {
            Preflight::Ready { version }
        } else {
            Preflight::NotLoggedIn { version }
        })
    }

    /// Runs one prompt and deserializes the final message into `T`.
    ///
    /// `on_event` is called as each JSONL event arrives, so a caller can drive
    /// a progress indicator without waiting for the run to finish.
    pub fn run_typed<T: DeserializeOwned>(
        &self,
        req: &Request,
        mut on_event: impl FnMut(&Event),
    ) -> Result<Run<T>> {
        let scratch = tempfile::tempdir().context("failed to create a scratch directory")?;
        let schema_path = scratch.path().join("schema.json");
        let output_path = scratch.path().join("final.json");
        std::fs::write(&schema_path, serde_json::to_vec_pretty(&req.schema)?)
            .context("failed to write the output schema")?;

        let started = Instant::now();
        let mut child = self
            .command(req, &schema_path, &output_path)
            .spawn()
            .with_context(|| format!("failed to spawn {}", self.program.display()))?;

        // Hand over the prompt and close stdin, or the CLI waits forever.
        child
            .stdin
            .take()
            .expect("stdin was piped")
            .write_all(req.prompt.as_bytes())
            .context("failed to write the prompt to stdin")?;

        // Drain stderr on its own thread. The CLI streams progress there, and a
        // full pipe buffer would deadlock the stdout reader below.
        let mut stderr = child.stderr.take().expect("stderr was piped");
        let stderr_reader = std::thread::spawn(move || {
            let mut buf = String::new();
            let _ = stderr.read_to_string(&mut buf);
            buf
        });

        let stdout = child.stdout.take().expect("stdout was piped");
        let mut events = Vec::new();
        for line in BufReader::new(stdout).lines() {
            let line = line.context("failed to read the event stream")?;
            if line.trim().is_empty() {
                continue;
            }
            // A line that is not JSON is not worth failing the run over; the
            // typed output is what we actually need.
            if let Ok(raw) = serde_json::from_str::<Value>(&line) {
                let kind = raw["type"].as_str().unwrap_or("unknown").to_string();
                let event = Event { kind, raw };
                on_event(&event);
                events.push(event);
            }
        }

        let status = child.wait().context("failed to wait for the Codex CLI")?;
        let stderr = stderr_reader.join().unwrap_or_default();
        let elapsed = started.elapsed();

        if !status.success() {
            return Err(RunFailure {
                kind: classify(&stderr),
                exit_code: status.code(),
                stderr_tail: tail(&stderr),
            }
            .into());
        }

        let raw = std::fs::read_to_string(&output_path).with_context(|| {
            format!(
                "the run succeeded but wrote no output to {}",
                output_path.display()
            )
        })?;
        let value = serde_json::from_str::<T>(&raw).with_context(|| {
            format!(
                "the final message did not match the schema we asked for:\n{}",
                tail(&raw)
            )
        })?;

        Ok(Run {
            value,
            events,
            elapsed,
        })
    }

    fn command(&self, req: &Request, schema: &Path, output: &Path) -> Command {
        let mut cmd = Command::new(&self.program);
        cmd.arg("exec")
            // Turn stdout into a JSONL event stream we can drive a UI from.
            .arg("--json")
            // Force the final message to satisfy our schema.
            .arg("--output-schema")
            .arg(schema)
            .arg("--output-last-message")
            .arg(output)
            // Read-only means no approval request can ever arrive, and a
            // non-interactive run dies on approval requests.
            .arg("--sandbox")
            .arg("read-only")
            // Lita's working directory is not a git repository, and `codex
            // exec` refuses to start in one otherwise.
            .arg("--skip-git-repo-check")
            // Keep the user's drafts out of ~/.codex session rollouts.
            .arg("--ephemeral")
            // Lita's output must not depend on the user's Codex profile,
            // AGENTS.md files or MCP servers. Without this, a run picks up
            // whatever they have configured — we saw one fail to refresh an
            // unrelated MCP server's OAuth token mid-generation. Credentials
            // live in auth.json, not config.toml, so login still works.
            .arg("--ignore-user-config")
            .arg("-c")
            .arg(format!(
                "model_reasoning_effort=\"{}\"",
                req.effort.as_config_value()
            ));

        if let Some(model) = &req.model {
            cmd.arg("--model").arg(model);
        }

        // `-` makes stdin the prompt.
        cmd.arg("-")
            .current_dir(&req.working_dir)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        cmd
    }
}

fn classify(stderr: &str) -> FailureKind {
    let lower = stderr.to_lowercase();
    if lower.contains("not logged in") || lower.contains("codex login") || lower.contains("401") {
        FailureKind::NotLoggedIn
    } else if lower.contains("usage limit")
        || lower.contains("rate limit")
        || lower.contains("quota")
        || lower.contains("429")
    {
        FailureKind::QuotaExhausted
    } else if lower.contains("schema") {
        FailureKind::SchemaMismatch
    } else {
        FailureKind::Unknown
    }
}

fn tail(s: &str) -> String {
    if s.len() <= STDERR_TAIL_BYTES {
        return s.to_string();
    }
    let start = s
        .char_indices()
        .rev()
        .map(|(i, _)| i)
        .find(|i| s.len() - i >= STDERR_TAIL_BYTES)
        .unwrap_or(0);
    format!("…{}", &s[start..])
}

/// Panics if a prompt is ever built from something that looks like a token.
///
/// Lita's prompts are assembled from the user's own writing, and the whole
/// premise is that credentials never enter this path.
pub fn assert_no_credentials(prompt: &str) {
    for marker in ["sk-", "xoxp-", "xoxb-", "eyJ"] {
        assert!(
            !prompt.contains(marker),
            "prompt contains something token-shaped: {marker}"
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn effort_maps_to_codex_reasoning_levels() {
        assert_eq!(Effort::Fast.as_config_value(), "low");
        assert_eq!(Effort::Quality.as_config_value(), "medium");
        assert_eq!(Effort::default(), Effort::Quality);
    }

    #[test]
    fn classifies_a_login_failure() {
        assert_eq!(
            classify("error: not logged in, run codex login"),
            FailureKind::NotLoggedIn
        );
    }

    #[test]
    fn classifies_a_quota_failure() {
        assert_eq!(
            classify("You have hit your usage limit."),
            FailureKind::QuotaExhausted
        );
    }

    #[test]
    fn tail_keeps_the_end_of_a_long_string() {
        let long = "x".repeat(STDERR_TAIL_BYTES * 2);
        let t = tail(&long);
        assert!(t.starts_with('…'));
        assert!(t.len() <= STDERR_TAIL_BYTES + 8);
    }

    #[test]
    fn tail_leaves_a_short_string_alone() {
        assert_eq!(tail("short"), "short");
    }
}
