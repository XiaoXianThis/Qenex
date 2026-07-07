use std::env;
use std::fs;
use std::path::PathBuf;

fn main() {
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR"));
    let dist = manifest_dir.join("../../apps/web/dist");

    println!("cargo:rerun-if-changed=../../apps/web/dist");

    if dist.join("index.html").is_file() {
        return;
    }

    println!(
        "cargo:warning=Frontend dist not found at {}. Run `bun run build` from the repo root, then rebuild.",
        dist.display()
    );

    fs::create_dir_all(&dist).expect("create apps/web/dist");
    fs::write(
        dist.join("index.html"),
        concat!(
            "<!DOCTYPE html><html><head><meta charset=\"utf-8\">",
            "<title>Qenex</title></head><body>",
            "<h1>Qenex</h1><p>Frontend not built. Run <code>bun run build</code> from the repo root, then rebuild the bridge.</p>",
            "</body></html>"
        ),
    )
    .expect("write placeholder index.html");
}
