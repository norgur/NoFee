use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use lofty::prelude::*;
use lofty::probe::Probe;

#[derive(Serialize, Deserialize, Debug)]
pub struct TrackMetadata {
    pub id: String,
    pub title: String,
    pub tags: String,
    pub duration: u32,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct Track {
    pub url: String,
    pub metadata: TrackMetadata,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct PlaylistResponse {
    pub tracks: Vec<Track>,
}

fn find_music_dir() -> Option<PathBuf> {
    // Check next to the exe (standard production bundle)
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(parent) = exe_path.parent() {
            let music = parent.join("music");
            if music.exists() && music.is_dir() {
                return Some(music);
            }
        }
    }

    // Check next to the current working dir (local dev)
    if let Ok(cwd) = std::env::current_dir() {
        let music = cwd.join("music");
        if music.exists() && music.is_dir() {
            return Some(music);
        }
    }

    None
}

#[tauri::command]
async fn get_playlist(mood: String) -> Result<PlaylistResponse, String> {
    let mut tracks = Vec::new();
    
    let music_dir = match find_music_dir() {
        Some(path) => path,
        None => {
            log::warn!("Music directory not found.");
            return Ok(PlaylistResponse { tracks });
        }
    };
    
    let mood_dir = music_dir.join(&mood);
    
    if mood_dir.exists() && mood_dir.is_dir() {
        if let Ok(entries) = fs::read_dir(mood_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().and_then(|s| s.to_str()) == Some("mp3") {
                    let file_name = path.file_name().and_then(|s| s.to_str()).unwrap_or("");
                    let base_name = file_name.trim_end_matches(".mp3");
                    
                    let mut metadata = TrackMetadata {
                        id: base_name.to_string(),
                        title: base_name.replace('_', " ").replace('-', " "),
                        tags: String::new(),
                        duration: 0,
                    };

                    // Try extraction with lofty
                    if let Ok(tagged_file) = Probe::open(&path).and_then(|p| p.read()) {
                        if let Some(tag) = tagged_file.primary_tag() {
                            if let Some(title) = tag.title() {
                                metadata.title = title.to_string();
                            }
                        }
                        metadata.duration = tagged_file.properties().duration().as_secs() as u32;
                    }

                    // Look for .json meta file
                    let mut meta_file = path.clone();
                    meta_file.set_extension("json");
                    if meta_file.exists() {
                        if let Ok(content) = fs::read_to_string(meta_file) {
                            if let Ok(json_meta) = serde_json::from_str::<serde_json::Value>(&content) {
                                if let Some(title) = json_meta["title"].as_str() {
                                    metadata.title = title.to_string();
                                }
                                if let Some(tags) = json_meta["tags"].as_str() {
                                    metadata.tags = tags.to_string();
                                }
                            }
                        }
                    }

                    // Send raw absolute path to frontend for conversion
                    let url = path.to_string_lossy().to_string();

                    tracks.push(Track {
                        url,
                        metadata,
                    });
                }
            }
        }
    }

    Ok(PlaylistResponse { tracks })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_log::Builder::default().build())
    .invoke_handler(tauri::generate_handler![get_playlist])
    .setup(|_app| {
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
