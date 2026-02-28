mod export;
mod git_graph;
mod models;

fn main() -> anyhow::Result<()> {
    export::export_all()
}
