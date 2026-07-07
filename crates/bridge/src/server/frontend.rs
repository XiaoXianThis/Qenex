use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use axum::response::{IntoResponse, Response};
use rust_embed::Embed;

#[derive(Embed)]
#[folder = "../../apps/web/dist/"]
struct FrontendAssets;

pub async fn serve_frontend(req: Request<Body>) -> Response {
    let path = req.uri().path().trim_start_matches('/');

    if path.is_empty() {
        return serve_asset("index.html");
    }

    if FrontendAssets::get(path).is_some() {
        return serve_asset(path);
    }

    // SPA fallback: unknown GET paths serve index.html
    if req.method() == axum::http::Method::GET {
        return serve_asset("index.html");
    }

    StatusCode::NOT_FOUND.into_response()
}

fn serve_asset(path: &str) -> Response {
    match FrontendAssets::get(path) {
        Some(content) => {
            let mime = mime_guess::from_path(path)
                .first_raw()
                .unwrap_or("application/octet-stream");
            (
                StatusCode::OK,
                [(header::CONTENT_TYPE, mime)],
                content.data.into_owned(),
            )
                .into_response()
        }
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn embedded_index_exists() {
        assert!(FrontendAssets::get("index.html").is_some());
    }
}
