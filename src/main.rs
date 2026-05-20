use tansu2::app::App;
use tansu2::config::load_config;
use tansu2::http::serve;

fn main() {
    if let Err(error) = run() {
        eprintln!("{error}");
        std::process::exit(1);
    }
}

fn run() -> tansu2::Result<()> {
    let port = parse_port();
    let config = load_config()?;
    let app = App::new(config)?;
    serve(app, port)
}

fn parse_port() -> u16 {
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        if arg == "--port"
            && let Some(port) = args.next().and_then(|value| value.parse().ok())
        {
            return port;
        }
    }
    3000
}
