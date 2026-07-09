//! Shared HTTP client that honors HTTP(S)_PROXY / ALL_PROXY.

use std::time::Duration;

pub fn http_client(timeout: Duration) -> Result<reqwest::Client, String> {
    let mut builder = reqwest::Client::builder().timeout(timeout);

    let proxy_url = std::env::var("HTTPS_PROXY")
        .or_else(|_| std::env::var("https_proxy"))
        .or_else(|_| std::env::var("HTTP_PROXY"))
        .or_else(|_| std::env::var("http_proxy"))
        .or_else(|_| std::env::var("ALL_PROXY"))
        .or_else(|_| std::env::var("all_proxy"))
        .ok();

    if let Some(url) = proxy_url {
        let proxy = reqwest::Proxy::all(url.trim())
            .map_err(|e| format!("invalid proxy URL: {e}"))?;
        builder = builder.proxy(proxy);
    }

    builder.build().map_err(|e| e.to_string())
}
