//! HTML to the plain text a Voice is extracted from. Headings, paragraphs
//! and lists keep their line breaks; images, links targets and decorations
//! are dropped, since none of them are the person's voice.

/// Renders `html` as plain text, collapsing runs of blank lines.
pub fn to_text(html: &str) -> String {
    let html = neutralize(html);
    let rendered = html2text::config::plain_no_decorate()
        .string_from_read(html.as_bytes(), 10_000)
        .unwrap_or_else(|_| strip_tags(&html));
    collapse(&rendered)
}

/// Rewrites headings to paragraphs and unwraps links before rendering, so
/// the renderer has nothing to decorate: a heading is just a line and a
/// link is just its words.
fn neutralize(html: &str) -> String {
    let mut out = String::with_capacity(html.len());
    let mut rest = html;
    while let Some(lt) = rest.find('<') {
        out.push_str(&rest[..lt]);
        let Some(gt) = rest[lt..].find('>') else {
            out.push_str(&rest[lt..]);
            return out;
        };
        let tag = &rest[lt + 1..lt + gt];
        let closing = tag.starts_with('/');
        let name: String = tag
            .trim_start_matches('/')
            .chars()
            .take_while(|c| c.is_ascii_alphanumeric())
            .collect::<String>()
            .to_ascii_lowercase();
        match name.as_str() {
            "a" => {}
            "h1" | "h2" | "h3" | "h4" | "h5" | "h6" => out.push_str(if closing { "</p>" } else { "<p>" }),
            _ => {
                out.push('<');
                out.push_str(tag);
                out.push('>');
            }
        }
        rest = &rest[lt + gt + 1..];
    }
    out.push_str(rest);
    out
}

/// Last resort if the renderer rejects the input.
fn strip_tags(html: &str) -> String {
    let mut out = String::with_capacity(html.len());
    let mut in_tag = false;
    for c in html.chars() {
        match c {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => out.push(c),
            _ => {}
        }
    }
    out
}

pub(crate) fn collapse(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut blank = 0;
    for line in text.lines() {
        let line = line.trim_end();
        if line.trim().is_empty() {
            blank += 1;
            continue;
        }
        if !out.is_empty() {
            out.push('\n');
            if blank > 0 {
                out.push('\n');
            }
        }
        blank = 0;
        out.push_str(line);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn paragraphs_and_headings_keep_breaks_and_tags_go() {
        let t = to_text("<h2>見出し</h2><p>一段落目。<a href=\"https://x\">リンク</a></p>\n\n\n<p>二段落目 &amp; 記号</p><img src=\"a.png\">");
        assert_eq!(t, "見出し\n\n一段落目。リンク\n\n二段落目 & 記号");
    }

    #[test]
    fn collapse_limits_blank_runs() {
        assert_eq!(collapse("a\n\n\n\nb\n  \nc\n"), "a\n\nb\n\nc");
    }
}
