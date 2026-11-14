// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // `--mcp` : serveur MCP local (lecture seule) sur stdin/stdout, sans interface.
    if std::env::args().any(|a| a == "--mcp") {
        std::process::exit(foulee_lib::lancer_mcp());
    }
    foulee_lib::run()
}
