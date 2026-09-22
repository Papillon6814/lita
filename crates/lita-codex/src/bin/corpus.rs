//! Measures how much writing a usable Voice actually needs.
//!
//! This gates a scope decision: a free Slack workspace only exposes the last
//! 90 days of messages, so if a Voice needs hundreds of messages, free-plan
//! users cannot build one. Run with `cargo run -p lita-codex --bin corpus`.

use anyhow::Result;
use lita_codex::{CodexCli, Effort, Preflight, Request};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

/// One person's work-chat messages, in the order they were written. The tail
/// of the list is the oldest, so taking a prefix simulates a shorter history.
const MESSAGES: &[&str] = &[
    "リリースノート書き直しました。前のやつ、機能の説明しかしてなくて「で、何が嬉しいの？」が抜けてたので。",
    "今日の取材、思ったより深掘りされて焦りました。数字の根拠を聞かれたときに即答できなかったのが悔しい。次までに整理しておきます",
    "資料できました！ざっと見てもらえると助かります 🙏",
    "個人的には、機能を全部並べるより「これ1つだけ覚えて帰ってください」を決めたほうが刺さると思ってます。全部言うと何も残らないので。",
    "すみません、さっきの数字間違ってました。正しくは前月比 +12% です。訂正します",
    "note の記事、公開しました。反応見ながら次の企画考えます",
    "採用広報って、結局は「うちで働くとどうなるか」を具体的に書けるかどうかだと思っていて。制度の説明だけだとどこの会社も同じに見えちゃう。",
    "打ち合わせ、15分押しそうです。先に始めててください",
    "プレスリリースのドラフト置いておきました。タイトルだけ3案あるので、どれがいいか意見ほしいです",
    "昨日の登壇、終わったあとに「あの話もっと聞きたい」って言ってもらえたのが一番嬉しかったです",
    "この表現、社内だと通じるけど外には通じないやつですね。言い換え案考えます",
    "数字を出すなら比較対象もセットで出さないと意味ないな、と反省してます",
    "取材依頼きました！来週前半で調整します",
    "個人的には、長い記事より短い記事を数多く出すほうが今のフェーズには合ってる気がしてます。まだ誰も僕らを知らないので。",
    "スライド、文字減らしました。前のは読ませる資料になってたので",
    "すみません、共有遅くなりました。議事録あげておきます",
    "「業界初」って書きたくなるけど、裏が取れないうちは書かないほうがいいと思ってます。一回でも盛ったら信用が飛ぶので。",
    "今週の投稿、反応薄かったです。テーマは悪くなかったと思うので、書き出しを変えて試してみます",
    "デザイン案ありがとうございます！2案目が好きです。理由は、情報量が少ないぶん一番言いたいことが立つからです",
    "イベントの申込、目標の8割まできました。残り3日でどこまで伸ばせるか",
    "広報の仕事って、結局は社内にある良い話を見つけて外に出すことだよなと最近思ってます。ネタは意外と足元にある",
    "リリース日ずれそうです。確定したら改めて共有します",
    "インタビュー記事、本人確認まで終わりました。明日公開します",
    "ちょっと迷ってるんですが、この件は先に出すより溜めて一気に出したほうが効くかもしれないです。どう思いますか",
];

const SIZES: &[usize] = &[4, 8, 24];

#[derive(Debug, Deserialize, Serialize)]
struct VoiceProfile {
    first_person: String,
    tone: Vec<String>,
    sentence_endings: Vec<String>,
    avg_sentence_length_chars: i64,
    preferred_words: Vec<String>,
    opens_with: String,
    uses_emoji: bool,
}

fn schema() -> Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "required": [
            "first_person", "tone", "sentence_endings", "avg_sentence_length_chars",
            "preferred_words", "opens_with", "uses_emoji"
        ],
        "properties": {
            "first_person": {
                "type": "string",
                "description": "The pronoun this person uses for themselves, as a single word. If they avoid it, write the empty string."
            },
            "tone": {
                "type": "array", "items": { "type": "string" },
                "description": "Three to six short adjectives describing the voice."
            },
            "sentence_endings": {
                "type": "array", "items": { "type": "string" },
                "description": "The sentence-ending forms they actually use, most frequent first."
            },
            "avg_sentence_length_chars": {
                "type": "integer",
                "description": "Mean sentence length in characters."
            },
            "preferred_words": {
                "type": "array", "items": { "type": "string" },
                "description": "Words and phrases that recur and feel characteristic of this person."
            },
            "opens_with": {
                "type": "string",
                "description": "How they typically open a message, in one short phrase."
            },
            "uses_emoji": { "type": "boolean", "description": "Whether emoji appear at all." }
        }
    })
}

fn main() -> Result<()> {
    let codex = CodexCli::on_path();
    match codex.preflight()? {
        Preflight::Ready { version } => println!("codex {version}\n"),
        other => anyhow::bail!("codex is not ready: {other:?}"),
    }
    let workdir = tempfile::tempdir()?;

    let mut results = Vec::new();
    for &n in SIZES {
        let corpus = MESSAGES[..n]
            .iter()
            .map(|m| format!("- {m}"))
            .collect::<Vec<_>>()
            .join("\n");
        let prompt = format!(
            "You are analysing one person's writing so that another writer can imitate it \
             convincingly. Below are messages they wrote in a work chat.\n\n{corpus}\n\n\
             Describe their voice, following every field description exactly. Write the \
             descriptive values in Japanese."
        );
        let run = codex.run_typed::<VoiceProfile>(
            &Request {
                prompt,
                schema: schema(),
                model: None,
                effort: Effort::Quality,
                working_dir: workdir.path().to_path_buf(),
            },
            |_| {},
        )?;
        println!("--- n = {n} ({:.0}s) ---", run.elapsed.as_secs_f64());
        println!("{}", serde_json::to_string_pretty(&run.value)?);
        println!();
        results.push((n, run.value));
    }

    println!("=== how the profile moved as the corpus grew ===");
    for (n, p) in &results {
        println!(
            "n={n:>2}  first_person={:<8} emoji={:<5} avg_len={:>3}  tone={}",
            if p.first_person.is_empty() {
                "(none)"
            } else {
                &p.first_person
            },
            p.uses_emoji,
            p.avg_sentence_length_chars,
            p.tone.join("/")
        );
    }
    Ok(())
}
