use std::collections::HashMap;
use std::path::Path;

use pulldown_cmark::{Event, Parser, Tag, TagEnd};
use tantivy::collector::TopDocs;
use tantivy::directory::MmapDirectory;
use tantivy::query::QueryParser;
use tantivy::schema::{Field, STORED, STRING, Schema, TEXT, TantivyDocument, Value};
use tantivy::{Index, Term};

use crate::api_types::{NoteMeta, SearchFieldScores, SearchHit, Settings};
use crate::history;
use crate::paths::visible_path;
use crate::{Error, Result};

pub const DEFAULT_SEARCH_LIMIT: usize = 20;

#[derive(Debug)]
pub struct SearchIndex {
    index: Index,
    fields: SearchFields,
    docs: HashMap<String, SearchDoc>,
    pub dirty: bool,
    pub degraded: bool,
}

#[derive(Debug, Clone, Copy)]
struct SearchFields {
    note_id: Field,
    title: Field,
    tags: Field,
    headings: Field,
    content: Field,
}

#[derive(Debug, Clone)]
struct SearchDoc {
    content: String,
    headings: String,
}

impl SearchIndex {
    pub fn open(root: &Path) -> Result<Self> {
        let path = root.join(".tansu").join("search");
        std::fs::create_dir_all(&path)?;
        let (schema, fields) = search_schema();
        let directory =
            MmapDirectory::open(&path).map_err(|error| Error::Internal(error.to_string()))?;
        let index = Index::open_or_create(directory, schema.clone()).or_else(|_| {
            std::fs::remove_dir_all(&path)?;
            std::fs::create_dir_all(&path)?;
            Index::create_in_dir(&path, schema)
        })?;
        Ok(Self {
            index,
            fields,
            docs: HashMap::new(),
            dirty: false,
            degraded: false,
        })
    }

    pub fn rebuild(&mut self, root: &Path, notes: &[NoteMeta]) -> Result<()> {
        self.docs.clear();
        let mut writer = self.index.writer::<TantivyDocument>(50_000_000)?;
        writer.delete_all_documents()?;
        for note in notes {
            let path = visible_path(root, &note.path);
            let bytes = match std::fs::read(&path) {
                Ok(bytes) => bytes,
                Err(error) => {
                    self.dirty = true;
                    self.degraded = true;
                    return Err(Error::Io(error));
                }
            };
            let content = history::validate_and_canonicalize(&bytes)?;
            self.index_note_with_writer(&mut writer, note.clone(), &content)?;
        }
        writer.commit()?;
        self.dirty = false;
        self.degraded = false;
        Ok(())
    }

    pub fn index_note(&mut self, meta: NoteMeta, content: &str) {
        if self.index_note_inner(meta, content).is_err() {
            self.dirty = true;
            self.degraded = true;
        }
    }

    pub fn remove_note(&mut self, note_id: &str) {
        self.docs.remove(note_id);
        match self.index.writer::<TantivyDocument>(50_000_000) {
            Ok(mut writer) => {
                writer.delete_term(Term::from_field_text(self.fields.note_id, note_id));
                if writer.commit().is_err() {
                    self.dirty = true;
                    self.degraded = true;
                }
            }
            Err(_) => {
                self.dirty = true;
                self.degraded = true;
            }
        }
    }

    pub fn search(
        &self,
        query: &str,
        settings: &Settings,
        current: &[NoteMeta],
        limit: usize,
    ) -> Vec<SearchHit> {
        let terms = tokenize_query(query);
        if terms.is_empty() || limit == 0 {
            return Vec::new();
        }
        let current_ids = current
            .iter()
            .map(|note| (note.note_id.as_str(), note))
            .collect::<HashMap<_, _>>();
        let Ok(parsed) = self.query_parser(settings).parse_query(query) else {
            return Vec::new();
        };
        let Ok(reader) = self.index.reader() else {
            return Vec::new();
        };
        let searcher = reader.searcher();
        let Ok(top_docs) = searcher.search(&parsed, &TopDocs::with_limit(100).order_by_score())
        else {
            return Vec::new();
        };
        let mut hits = Vec::new();
        for (score, address) in top_docs {
            let Ok(document) = searcher.doc::<TantivyDocument>(address) else {
                continue;
            };
            let Some(note_id) = document
                .get_first(self.fields.note_id)
                .and_then(|value| value.as_str())
            else {
                continue;
            };
            let Some(current_meta) = current_ids.get(note_id) else {
                continue;
            };
            let Some(doc) = self.docs.get(note_id) else {
                continue;
            };
            let field_scores = field_scores(current_meta, doc, &terms, settings);
            hits.push(SearchHit {
                note: (*current_meta).clone(),
                snippet: snippet(&doc.content, &terms),
                score: score + recency_score(current_meta.updated_at_ms, settings.recency_boost),
                field_scores,
            });
        }
        hits.sort_by(|a, b| {
            b.score
                .partial_cmp(&a.score)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| b.note.updated_at_ms.cmp(&a.note.updated_at_ms))
        });
        hits.truncate(limit);
        hits
    }

    fn index_note_inner(&mut self, meta: NoteMeta, content: &str) -> Result<()> {
        let mut writer = self.index.writer::<TantivyDocument>(50_000_000)?;
        self.index_note_with_writer(&mut writer, meta, content)?;
        writer.commit()?;
        self.dirty = false;
        self.degraded = false;
        Ok(())
    }

    fn index_note_with_writer(
        &mut self,
        writer: &mut tantivy::IndexWriter<TantivyDocument>,
        meta: NoteMeta,
        content: &str,
    ) -> Result<()> {
        let (headings, stripped) = strip_markdown(content);
        writer.delete_term(Term::from_field_text(self.fields.note_id, &meta.note_id));
        writer.add_document(self.tantivy_doc(&meta, &headings, &stripped))?;
        self.docs.insert(
            meta.note_id.clone(),
            SearchDoc {
                content: stripped,
                headings,
            },
        );
        Ok(())
    }

    fn tantivy_doc(&self, meta: &NoteMeta, headings: &str, content: &str) -> TantivyDocument {
        let mut document = TantivyDocument::default();
        document.add_text(self.fields.note_id, &meta.note_id);
        document.add_text(self.fields.title, &meta.title);
        document.add_text(self.fields.tags, meta.tags.join(" "));
        document.add_text(self.fields.headings, headings);
        document.add_text(self.fields.content, content);
        document
    }

    fn query_parser(&self, settings: &Settings) -> QueryParser {
        let mut parser = QueryParser::for_index(
            &self.index,
            vec![
                self.fields.title,
                self.fields.tags,
                self.fields.headings,
                self.fields.content,
            ],
        );
        parser.set_field_boost(self.fields.title, settings.search_title_weight);
        parser.set_field_boost(self.fields.tags, settings.search_tag_weight);
        parser.set_field_boost(self.fields.headings, settings.search_heading_weight);
        parser.set_field_boost(self.fields.content, settings.search_content_weight);
        parser
    }
}

fn search_schema() -> (Schema, SearchFields) {
    let mut builder = Schema::builder();
    let note_id = builder.add_text_field("note_id", STRING | STORED);
    let title = builder.add_text_field("title", TEXT | STORED);
    let tags = builder.add_text_field("tags", TEXT);
    let headings = builder.add_text_field("headings", TEXT);
    let content = builder.add_text_field("content", TEXT);
    (
        builder.build(),
        SearchFields {
            note_id,
            title,
            tags,
            headings,
            content,
        },
    )
}

fn strip_markdown(content: &str) -> (String, String) {
    let parser = Parser::new(content);
    let mut headings = String::new();
    let mut stripped = String::new();
    let mut in_heading = false;
    for event in parser {
        match event {
            Event::Start(Tag::Heading { .. }) => in_heading = true,
            Event::End(TagEnd::Heading(_)) => {
                in_heading = false;
                headings.push('\n');
            }
            Event::Text(text) | Event::Code(text) => {
                if in_heading {
                    headings.push_str(&text);
                    headings.push(' ');
                }
                stripped.push_str(&text);
                stripped.push(' ');
            }
            _ => {}
        }
    }
    (headings, stripped)
}

fn tokenize_query(query: &str) -> Vec<String> {
    query
        .split(|ch: char| !ch.is_alphanumeric())
        .map(str::to_lowercase)
        .filter(|term| !term.is_empty())
        .collect()
}

fn field_scores(
    meta: &NoteMeta,
    doc: &SearchDoc,
    terms: &[String],
    settings: &Settings,
) -> SearchFieldScores {
    SearchFieldScores {
        title: weighted_matches(&meta.title, terms, settings.search_title_weight),
        headings: weighted_matches(&doc.headings, terms, settings.search_heading_weight),
        tags: weighted_matches(&meta.tags.join(" "), terms, settings.search_tag_weight),
        content: weighted_matches(&doc.content, terms, settings.search_content_weight),
    }
}

fn weighted_matches(text: &str, terms: &[String], weight: f32) -> f32 {
    if weight <= 0.0 {
        return 0.0;
    }
    let mut score = 0.0;
    for word in WordIter::new(text) {
        for term in terms {
            if word.eq_ignore_ascii_case(term) {
                score += weight;
            } else if starts_with_ignore_ascii_case(word, term) {
                score += weight * 0.8;
            }
        }
    }
    score
}

fn snippet(content: &str, terms: &[String]) -> String {
    if content.is_empty() {
        return String::new();
    }
    let first_match = WordIter::new(content)
        .find(|word| terms.iter().any(|term| word_matches_term(word, term)))
        .and_then(|word| content.find(word))
        .unwrap_or(0);
    let start = floor_char_boundary(content, first_match.saturating_sub(40));
    let start = content[..start]
        .rfind(char::is_whitespace)
        .map(|index| {
            index
                + content[index..]
                    .chars()
                    .next()
                    .map(char::len_utf8)
                    .unwrap_or(0)
        })
        .unwrap_or(0);
    let end = floor_char_boundary(content, (start + 160).min(content.len()));
    let end = content[end..]
        .find(char::is_whitespace)
        .map(|index| end + index)
        .unwrap_or(content.len());

    let mut out = String::new();
    let mut pos = start;
    for (word_start, word_end) in WordBoundIter::new(&content[start..end]) {
        let abs_start = start + word_start;
        let abs_end = start + word_end;
        let word = &content[abs_start..abs_end];
        if terms.iter().any(|term| word_matches_term(word, term)) {
            escape_html_into(&mut out, &content[pos..abs_start]);
            out.push_str("<b>");
            escape_html_into(&mut out, word);
            out.push_str("</b>");
            pos = abs_end;
        }
    }
    escape_html_into(&mut out, &content[pos..end]);
    out.trim().to_string()
}

fn recency_score(updated_at_ms: i64, boost: f32) -> f32 {
    if boost <= 0.0 {
        return 0.0;
    }
    let now = crate::catalog::now_ms();
    let age_days = now.saturating_sub(updated_at_ms) as f32 / 86_400_000.0;
    boost / (1.0 + age_days.max(0.0))
}

fn word_matches_term(word: &str, term: &str) -> bool {
    word.eq_ignore_ascii_case(term) || starts_with_ignore_ascii_case(word, term)
}

fn starts_with_ignore_ascii_case(word: &str, term: &str) -> bool {
    word.len() > term.len()
        && word
            .bytes()
            .zip(term.bytes())
            .all(|(left, right)| left.eq_ignore_ascii_case(&right))
}

fn floor_char_boundary(text: &str, mut index: usize) -> usize {
    while !text.is_char_boundary(index) {
        index -= 1;
    }
    index
}

struct WordIter<'a> {
    text: &'a str,
    inner: WordBoundIter<'a>,
}

impl<'a> WordIter<'a> {
    fn new(text: &'a str) -> Self {
        Self {
            text,
            inner: WordBoundIter::new(text),
        }
    }
}

impl<'a> Iterator for WordIter<'a> {
    type Item = &'a str;

    fn next(&mut self) -> Option<Self::Item> {
        self.inner.next().map(|(start, end)| &self.text[start..end])
    }
}

struct WordBoundIter<'a> {
    bytes: &'a [u8],
    pos: usize,
}

impl<'a> WordBoundIter<'a> {
    fn new(text: &'a str) -> Self {
        Self {
            bytes: text.as_bytes(),
            pos: 0,
        }
    }
}

impl Iterator for WordBoundIter<'_> {
    type Item = (usize, usize);

    fn next(&mut self) -> Option<Self::Item> {
        while self.pos < self.bytes.len() && !self.bytes[self.pos].is_ascii_alphanumeric() {
            self.pos += 1;
        }
        if self.pos >= self.bytes.len() {
            return None;
        }
        let start = self.pos;
        while self.pos < self.bytes.len() && self.bytes[self.pos].is_ascii_alphanumeric() {
            self.pos += 1;
        }
        Some((start, self.pos))
    }
}

fn escape_html_into(out: &mut String, text: &str) {
    for ch in text.chars() {
        match ch {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\n' => out.push(' '),
            _ => out.push(ch),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn note(title: &str, tags: &[&str]) -> NoteMeta {
        NoteMeta {
            note_id: "note".to_string(),
            path: "note.md".to_string(),
            title: title.to_string(),
            tags: tags.iter().map(|tag| tag.to_string()).collect(),
            seq: 1,
            content_hash: "hash".to_string(),
            updated_at_ms: 1,
        }
    }

    #[test]
    fn snippet_highlights_matches_and_escapes_html() {
        let terms = tokenize_query("alpha");
        let rendered = snippet("before <tag> alpha after", &terms);
        assert_eq!(rendered, "before &lt;tag&gt; <b>alpha</b> after");
    }

    #[test]
    fn field_scores_explain_matching_fields() {
        let settings = Settings::default();
        let doc = SearchDoc {
            headings: "Alpha heading".to_string(),
            content: "alpha body".to_string(),
        };
        let scores = field_scores(
            &note("Alpha title", &["alpha"]),
            &doc,
            &["alpha".into()],
            &settings,
        );
        assert!(scores.title > 0.0);
        assert!(scores.headings > 0.0);
        assert!(scores.tags > 0.0);
        assert!(scores.content > 0.0);
    }
}
