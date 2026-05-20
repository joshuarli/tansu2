use std::collections::HashMap;
use std::path::Path;

use pulldown_cmark::{Event, Parser, Tag, TagEnd};
use tantivy::collector::TopDocs;
use tantivy::directory::MmapDirectory;
use tantivy::query::QueryParser;
use tantivy::schema::{Field, STORED, STRING, Schema, TEXT, TantivyDocument, Value};
use tantivy::{Index, Term};

use crate::api_types::{NoteMeta, SearchHit, Settings};
use crate::history;
use crate::paths::visible_path;
use crate::{Error, Result};

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
        let Ok(parsed) = self.query_parser(settings).parse_query(query) else {
            return Vec::new();
        };
        let Ok(reader) = self.index.reader() else {
            return Vec::new();
        };
        let searcher = reader.searcher();
        let Ok(top_docs) = searcher.search(&parsed, &TopDocs::with_limit(100)) else {
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
            hits.push(SearchHit {
                note: (*current_meta).clone(),
                snippet: snippet(&doc.content, &terms),
                score: score + recency_score(current_meta.updated_at_ms, settings.recency_boost),
            });
        }
        hits.sort_by(|a, b| {
            b.score
                .partial_cmp(&a.score)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| b.note.updated_at_ms.cmp(&a.note.updated_at_ms))
        });
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
        self.docs
            .insert(meta.note_id.clone(), SearchDoc { content: stripped });
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

fn recency_score(updated_at_ms: i64, boost: f32) -> f32 {
    if boost <= 0.0 {
        return 0.0;
    }
    let now = crate::catalog::now_ms();
    let age_days = now.saturating_sub(updated_at_ms) as f32 / 86_400_000.0;
    boost / (1.0 + age_days.max(0.0))
}
