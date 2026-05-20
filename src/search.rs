use std::collections::HashMap;
use std::path::Path;

use pulldown_cmark::{Event, Parser, Tag, TagEnd};

use crate::api_types::{NoteMeta, SearchHit, Settings};
use crate::history;
use crate::paths::visible_path;
use crate::{Error, Result};

#[derive(Debug, Default)]
pub struct SearchIndex {
    docs: HashMap<String, SearchDoc>,
    pub dirty: bool,
    pub degraded: bool,
}

#[derive(Debug, Clone)]
struct SearchDoc {
    meta: NoteMeta,
    headings: String,
    content: String,
}

impl SearchIndex {
    pub fn rebuild(&mut self, root: &Path, notes: &[NoteMeta]) -> Result<()> {
        self.docs.clear();
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
            self.index_note(note.clone(), &content);
        }
        self.dirty = false;
        self.degraded = false;
        Ok(())
    }

    pub fn index_note(&mut self, meta: NoteMeta, content: &str) {
        let (headings, stripped) = strip_markdown(content);
        self.docs.insert(
            meta.note_id.clone(),
            SearchDoc {
                meta,
                headings,
                content: stripped,
            },
        );
        self.dirty = false;
    }

    pub fn remove_note(&mut self, note_id: &str) {
        self.docs.remove(note_id);
    }

    pub fn search(&self, query: &str, settings: &Settings, current: &[NoteMeta]) -> Vec<SearchHit> {
        let terms = query
            .split_whitespace()
            .map(str::to_lowercase)
            .filter(|term| !term.is_empty())
            .collect::<Vec<_>>();
        if terms.is_empty() {
            return Vec::new();
        }
        let current_ids = current
            .iter()
            .map(|note| (note.note_id.as_str(), note))
            .collect::<HashMap<_, _>>();
        let mut hits = Vec::new();
        for doc in self.docs.values() {
            let Some(current_meta) = current_ids.get(doc.meta.note_id.as_str()) else {
                continue;
            };
            let title = doc.meta.title.to_lowercase();
            let tags = doc.meta.tags.join(" ").to_lowercase();
            let headings = doc.headings.to_lowercase();
            let content = doc.content.to_lowercase();
            let mut score = 0.0_f32;
            for term in &terms {
                if title.contains(term) {
                    score += settings.search_title_weight;
                }
                if tags.contains(term) {
                    score += settings.search_tag_weight;
                }
                if headings.contains(term) {
                    score += settings.search_heading_weight;
                }
                if content.contains(term) {
                    score += settings.search_content_weight;
                }
            }
            if score > 0.0 {
                hits.push(SearchHit {
                    note: (*current_meta).clone(),
                    snippet: snippet(&doc.content, &terms),
                    score,
                });
            }
        }
        hits.sort_by(|a, b| {
            b.score
                .partial_cmp(&a.score)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| b.note.updated_at_ms.cmp(&a.note.updated_at_ms))
        });
        hits
    }
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

fn snippet(content: &str, terms: &[String]) -> String {
    let lower = content.to_lowercase();
    let index = terms
        .iter()
        .filter_map(|term| lower.find(term))
        .min()
        .unwrap_or(0);
    let start = index.saturating_sub(40);
    let end = (index + 120).min(content.len());
    content[start..end].trim().to_string()
}
